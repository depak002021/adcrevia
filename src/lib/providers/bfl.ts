import { z } from "zod"

/**
 * Safe, provider-agnostic error codes surfaced by the BFL client. Raw provider
 * response bodies are never attached to the error so secrets or prompt content
 * cannot leak into logs or API responses.
 */
export type BflErrorCode =
  | "PROVIDER_AUTHENTICATION_FAILED"
  | "PROVIDER_RATE_LIMIT"
  | "PROVIDER_MODERATED"
  | "PROVIDER_TIMEOUT"
  | "PROVIDER_UNAVAILABLE"
  | "PROVIDER_REJECTED"
  | "PROVIDER_INVALID_RESPONSE"
  | "PROVIDER_DOWNLOAD_FAILED"

export class BflProviderError extends Error {
  readonly code: BflErrorCode
  readonly status?: number

  constructor(code: BflErrorCode, status?: number, detail?: string) {
    super(detail ? `${code} (${detail})` : code)
    this.name = "BflProviderError"
    this.code = code
    this.status = status
  }
}

const DEFAULT_BASE_URL = "https://api.bfl.ai/v1"
const INITIAL_POLL_DELAY_MS = 1_000
const MAX_POLL_DELAY_MS = 8_000
const IMAGE_DEADLINE_MS = 240_000

const submissionSchema = z.object({
  id: z.string().min(1),
  polling_url: z.string().url(),
  /** What BFL charges for this request, in credits (1 credit = $0.01). */
  cost: z.number().nonnegative().nullish(),
})

// While a request is pending BFL sends `"result": null`; only the Ready state
// carries the sample. Rejecting null here failed every image at its first poll.
const pollResultSchema = z.object({
  status: z.string().min(1),
  result: z.object({ sample: z.string().url().nullish() }).passthrough().nullish(),
  details: z.unknown().optional(),
})

/** BFL's own reason for a moderation ("Protected Content", …): short labels only. */
function moderationReasons(details: unknown): string | undefined {
  if (!details || typeof details !== "object") return undefined
  const reasons = (details as Record<string, unknown>)["Moderation Reasons"]
  if (!Array.isArray(reasons)) return undefined
  const labels = reasons.filter((reason): reason is string => typeof reason === "string").map((reason) => reason.slice(0, 60))
  return labels.length ? labels.join(", ") : undefined
}

/** Which field did not match, for the log: paths and codes only, never values. */
function describeIssues(error: z.ZodError): string {
  return error.issues.slice(0, 3).map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.code}`).join("; ")
}

export type BflSubmission = {
  id: string
  pollingUrl: string
  /** Credits charged for the request, as BFL reports it. */
  cost?: number
}

export type BflReadyResult = {
  sample: string
}

const PENDING_STATUSES = new Set(["Pending", "Reasoning", "Generating", "Queued", "Request Accepted"])
const MODERATION_STATUSES = new Set(["Content Moderated", "Request Moderated"])

export type BflClientOptions = {
  apiKey: string
  fetch?: typeof fetch
  baseUrl?: string
  deadlineMs?: number
  now?: () => number
}

export class BflClient {
  private readonly apiKey: string
  private readonly fetchImpl: typeof fetch
  private readonly baseUrl: string
  private readonly deadlineMs: number
  private readonly now: () => number

  constructor(options: BflClientOptions) {
    if (!options.apiKey) throw new Error("BFL_API_KEY is required")
    this.apiKey = options.apiKey
    this.fetchImpl = options.fetch ?? fetch
    this.baseUrl = (options.baseUrl ?? DEFAULT_BASE_URL).replace(/\/$/, "")
    this.deadlineMs = options.deadlineMs ?? IMAGE_DEADLINE_MS
    this.now = options.now ?? Date.now
  }

  /** Submit a generation request to `/v1/${model}` and read `{ id, polling_url }`. */
  async submit(model: string, payload: Record<string, unknown>): Promise<BflSubmission> {
    const response = await this.request(`${this.baseUrl}/${model}`, {
      method: "POST",
      headers: {
        "x-key": this.apiKey,
        "content-type": "application/json",
      },
      body: JSON.stringify(payload),
    })
    this.assertOk(response)
    const parsed = submissionSchema.safeParse(await this.readJson(response))
    if (!parsed.success) throw new BflProviderError("PROVIDER_INVALID_RESPONSE", response.status, `submit ${describeIssues(parsed.error)}`)
    return { id: parsed.data.id, pollingUrl: parsed.data.polling_url, cost: parsed.data.cost ?? undefined }
  }

  /**
   * Poll the returned URL using the API key until a `Ready` result exposes
   * `result.sample`. Backoff starts at 1s and is capped at 8s; the poll fails
   * with `PROVIDER_TIMEOUT` once the deadline is exceeded.
   */
  async poll(pollingUrl: string): Promise<BflReadyResult> {
    const start = this.now()
    let delay = INITIAL_POLL_DELAY_MS
    for (;;) {
      const response = await this.request(pollingUrl, {
        method: "GET",
        headers: { "x-key": this.apiKey, accept: "application/json" },
      })
      this.assertOk(response)
      const parsed = pollResultSchema.safeParse(await this.readJson(response))
      if (!parsed.success) throw new BflProviderError("PROVIDER_INVALID_RESPONSE", response.status, `poll ${describeIssues(parsed.error)}`)

      const { status, result } = parsed.data
      if (status === "Ready") {
        if (!result?.sample) throw new BflProviderError("PROVIDER_INVALID_RESPONSE", response.status, "poll: Ready without result.sample")
        return { sample: result.sample }
      }
      if (MODERATION_STATUSES.has(status)) throw new BflProviderError("PROVIDER_MODERATED", response.status, moderationReasons(parsed.data.details))
      if (!PENDING_STATUSES.has(status)) throw new BflProviderError("PROVIDER_REJECTED", response.status)

      if (this.now() - start >= this.deadlineMs) throw new BflProviderError("PROVIDER_TIMEOUT")
      await sleep(delay)
      delay = Math.min(delay * 2, MAX_POLL_DELAY_MS)
    }
  }

  private async request(url: string, init: RequestInit): Promise<Response> {
    try {
      return await this.fetchImpl(url, init)
    } catch {
      throw new BflProviderError("PROVIDER_UNAVAILABLE")
    }
  }

  private async readJson(response: Response): Promise<unknown> {
    try {
      return await response.json()
    } catch {
      throw new BflProviderError("PROVIDER_INVALID_RESPONSE", response.status)
    }
  }

  private assertOk(response: Response): void {
    if (response.ok) return
    // Deliberately ignore the response body so provider secrets never surface.
    if (response.status === 401 || response.status === 403) {
      throw new BflProviderError("PROVIDER_AUTHENTICATION_FAILED", response.status)
    }
    if (response.status === 429) throw new BflProviderError("PROVIDER_RATE_LIMIT", response.status)
    if (response.status >= 500) throw new BflProviderError("PROVIDER_UNAVAILABLE", response.status)
    throw new BflProviderError("PROVIDER_REJECTED", response.status)
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
