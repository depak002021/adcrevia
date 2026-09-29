import { createHash } from "node:crypto"
import { createWriteStream } from "node:fs"
import { mkdtemp, readFile, rm, stat } from "node:fs/promises"
import { tmpdir } from "node:os"
import { basename, extname, join, resolve, sep } from "node:path"
import { Readable } from "node:stream"
import { pipeline } from "node:stream/promises"

/**
 * Scratch space for a render.
 *
 * ffmpeg reads files, not URLs. It can open an HTTP source, but a filter graph that
 * re-reads an input — which `xfade` does — would fetch it twice over the network, and
 * a provider URL that expires mid-render fails halfway through an encode that has
 * already cost minutes of CPU. So sources are pulled down first.
 *
 * Everything lives under one temporary directory that is removed in a `finally`. A
 * render is hundreds of megabytes of intermediate files, and a worker that leaks them
 * fills the disk of a host with 138 GB free in a few hundred jobs.
 */

/** Ceiling per source file. A provider clip far above this is a sign of a bad URL. */
const MAX_SOURCE_BYTES = 512 * 1024 * 1024

/** A source that has not started arriving by now is not going to. */
const FETCH_TIMEOUT_MS = 120_000

export class WorkspaceError extends Error {
  constructor(readonly safeErrorCode: string, detail?: string) {
    super(detail ? `${safeErrorCode}: ${detail}` : safeErrorCode)
    this.name = "WorkspaceError"
  }
}

export type RenderWorkspace = {
  dir: string
  /** Absolute path inside the workspace. Rejects anything that escapes it. */
  path(name: string): string
  /** Fetch a URL into the workspace and return the local path. */
  fetch(input: { url: string; name: string; signal?: AbortSignal }): Promise<string>
  /** Read a finished artefact back out, with its size and checksum. */
  read(name: string): Promise<{ bytes: Uint8Array; size: number; checksum: string }>
  dispose(): Promise<void>
}

export async function createRenderWorkspace(prefix = "adcrevia-render-"): Promise<RenderWorkspace> {
  const dir = await mkdtemp(join(tmpdir(), prefix))

  const path = (name: string) => {
    // Storage keys and provider filenames reach this. A `..` in one of them must not
    // be able to write outside the scratch directory.
    const target = resolve(dir, name)
    if (target !== dir && !target.startsWith(`${dir}${sep}`)) throw new WorkspaceError("INVALID_WORKSPACE_PATH")
    return target
  }

  return {
    dir,
    path,

    async fetch({ url, name, signal }) {
      const target = path(name)

      let response: Response
      try {
        response = await fetch(url, {
          signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(FETCH_TIMEOUT_MS)]) : AbortSignal.timeout(FETCH_TIMEOUT_MS),
          redirect: "follow",
        })
      } catch {
        throw new WorkspaceError("SOURCE_UNREACHABLE", hostOf(url))
      }

      if (!response.ok || !response.body) {
        throw new WorkspaceError("SOURCE_UNAVAILABLE", `${hostOf(url)} ${response.status}`)
      }

      const declared = Number(response.headers.get("content-length") ?? 0)
      if (Number.isFinite(declared) && declared > MAX_SOURCE_BYTES) {
        throw new WorkspaceError("SOURCE_TOO_LARGE", `${declared} bytes`)
      }

      // Streamed to disk rather than buffered. A 500 MB clip held in memory on a host
      // with 6 GB free, twice over because the worker runs two jobs at once, is how a
      // worker gets OOM-killed mid-render.
      await pipeline(Readable.fromWeb(response.body as Parameters<typeof Readable.fromWeb>[0]), createWriteStream(target))

      const written = await stat(target)
      if (written.size === 0) throw new WorkspaceError("SOURCE_EMPTY", hostOf(url))
      // Checked again after the fact: `content-length` is advisory and a chunked
      // response does not send one at all.
      if (written.size > MAX_SOURCE_BYTES) throw new WorkspaceError("SOURCE_TOO_LARGE", `${written.size} bytes`)

      return target
    },

    async read(name) {
      const bytes = await readFile(path(name))
      return {
        bytes,
        size: bytes.byteLength,
        // Recorded on the row so a re-render that produced an identical file can be
        // recognised rather than re-uploaded.
        checksum: createHash("sha256").update(bytes).digest("hex"),
      }
    },

    async dispose() {
      await rm(dir, { recursive: true, force: true }).catch(() => {})
    },
  }
}

/**
 * A filename that is safe to hand to ffmpeg.
 *
 * Derived from the URL only for its extension. Provider URLs carry query strings,
 * signatures and occasionally the original upload name, none of which belong in a
 * path, and an extension is the one part ffmpeg actually uses to guess a demuxer.
 */
export function workspaceName(url: string, index: number, fallbackExtension = ".mp4"): string {
  let extension = fallbackExtension
  try {
    const candidate = extname(basename(new URL(url).pathname)).toLowerCase()
    if (/^\.[a-z0-9]{2,5}$/.test(candidate)) extension = candidate
  } catch {
    // Not a URL we can parse. The fallback extension is fine; ffmpeg probes content.
  }
  return `source-${index}${extension}`
}

function hostOf(url: string): string {
  try {
    return new URL(url).host
  } catch {
    return "source"
  }
}
