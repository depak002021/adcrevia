import { z } from "zod"

import { getPrisma } from "@/lib/db/prisma"
import { decryptCredential, type EncryptedCredential } from "@/lib/encryption/provider-credentials"
import { HttpError } from "@/lib/http/http-error"

import { catalogSlug } from "./catalog-keys"

/**
 * "Is this key good?" without spending anything.
 *
 * Each check is a read the provider does not bill: list models, read credits, or look
 * up a task that does not exist. It proves the key is accepted (and, where the API
 * says so, that the model or balance is there) before anyone pays for a generation
 * that would fail on authentication. The key is decrypted here and never returned.
 */

type AdminActor = { id: string; role: "USER" | "SUPER_ADMIN" }
export type KeyTestResult = { ok: boolean; message: string }

const inputSchema = z.object({ kind: z.enum(["IMAGE", "VIDEO"]), provider: z.string().min(1).max(40) })

type Fetcher = typeof fetch

export async function testCatalogKey(raw: unknown, admin: AdminActor, fetcher: Fetcher = fetch): Promise<KeyTestResult> {
  if (admin.role !== "SUPER_ADMIN") throw new HttpError(403, "Forbidden")
  const { kind, provider } = inputSchema.parse(raw)
  const row = await getPrisma().aPIConfiguration.findFirst({
    where: { provider: { slug: catalogSlug(kind, provider) } },
    orderBy: { createdAt: "desc" },
    select: { encryptedCredential: true },
  })
  if (!row?.encryptedCredential) return { ok: false, message: "No key is saved yet." }
  let key: string
  try {
    key = decryptCredential(row.encryptedCredential as unknown as EncryptedCredential)
  } catch {
    return { ok: false, message: "The saved key cannot be read. Save it again." }
  }
  const check = CHECKS[provider]
  if (!check) return { ok: false, message: "No free check exists for this provider yet." }
  try {
    return await check(key, kind, fetcher)
  } catch {
    return { ok: false, message: "The provider could not be reached. Try again shortly." }
  }
}

const timeout = () => AbortSignal.timeout(15_000)
const rejected = { ok: false, message: "The provider rejected this key. Check it was copied completely." }

const CHECKS: Record<string, (key: string, kind: "IMAGE" | "VIDEO", fetcher: Fetcher) => Promise<KeyTestResult>> = {
  async bfl(key, _kind, fetcher) {
    const response = await fetcher("https://api.bfl.ai/v1/credits", { headers: { "x-key": key }, signal: timeout() })
    if (response.status === 401 || response.status === 403) return rejected
    const body = (await response.json().catch(() => ({}))) as { credits?: number }
    return response.ok
      ? { ok: true, message: `Key accepted · ${typeof body.credits === "number" ? `${body.credits} credits left` : "connected"}` }
      : { ok: false, message: `Unexpected answer (HTTP ${response.status}).` }
  },
  async openai(key, _kind, fetcher) {
    const response = await fetcher("https://api.openai.com/v1/models", { headers: { authorization: `Bearer ${key}` }, signal: timeout() })
    if (response.status === 401 || response.status === 403) return rejected
    const body = (await response.json().catch(() => ({}))) as { data?: Array<{ id: string }> }
    const image = (body.data ?? []).filter((model) => model.id.startsWith("gpt-image")).map((model) => model.id)
    return response.ok
      ? { ok: true, message: `Key accepted · image models: ${image.slice(0, 4).join(", ") || "none listed"}` }
      : { ok: false, message: `Unexpected answer (HTTP ${response.status}).` }
  },
  async google(key, kind, fetcher) {
    const response = await fetcher("https://generativelanguage.googleapis.com/v1beta/models?pageSize=1000", {
      headers: { "x-goog-api-key": key },
      signal: timeout(),
    })
    if (response.status === 400 || response.status === 401 || response.status === 403) return rejected
    const body = (await response.json().catch(() => ({}))) as { models?: Array<{ name: string }> }
    const names = (body.models ?? []).map((model) => model.name.replace("models/", ""))
    const wanted = kind === "VIDEO" ? names.filter((name) => name.startsWith("veo-3.1")) : names.filter((name) => /^gemini-.*image/.test(name))
    if (!response.ok) return { ok: false, message: `Unexpected answer (HTTP ${response.status}).` }
    return wanted.length
      ? { ok: true, message: `Key accepted · ${wanted.slice(0, 3).join(", ")}` }
      : { ok: false, message: `Key accepted, but no ${kind === "VIDEO" ? "Veo 3.1" : "Gemini image"} model is enabled for it.` }
  },
  async seedance(key, _kind, fetcher) {
    const response = await fetcher("https://ark.ap-southeast.bytepluses.com/api/v3/contents/generations/tasks?page_num=1&page_size=1", {
      headers: { authorization: `Bearer ${key}` },
      signal: timeout(),
    })
    if (response.status === 401 || response.status === 403) return rejected
    return response.ok
      ? { ok: true, message: "Key accepted · activate Seedance 2.5 in the BytePlus console if it is not yet" }
      : { ok: false, message: `Unexpected answer (HTTP ${response.status}).` }
  },
  async kling(key, _kind, fetcher) {
    const response = await fetcher("https://api-singapore.klingai.com/tasks?task_ids=0", {
      headers: { authorization: `Bearer ${key}` },
      signal: timeout(),
    })
    const body = (await response.json().catch(() => ({}))) as { code?: number }
    if (response.status === 401 || (typeof body.code === "number" && body.code >= 1000 && body.code <= 1004)) return rejected
    if (body.code === 1101 || body.code === 1102) return { ok: false, message: "Key accepted, but the Kling balance or resource pack is empty." }
    return { ok: true, message: "Key accepted" }
  },
  async runway(key, _kind, fetcher) {
    const response = await fetcher("https://api.dev.runwayml.com/v1/organization", {
      headers: { authorization: `Bearer ${key}`, "x-runway-version": "2024-11-06" },
      signal: timeout(),
    })
    if (response.status === 401 || response.status === 403) return rejected
    const body = (await response.json().catch(() => ({}))) as { creditBalance?: number }
    return response.ok
      ? { ok: true, message: `Key accepted${typeof body.creditBalance === "number" ? ` · ${body.creditBalance} credits` : ""}` }
      : { ok: false, message: `Unexpected answer (HTTP ${response.status}).` }
  },
}
