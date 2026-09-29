import { readStorageStatus, saveStorageConfiguration } from "@/features/admin/storage/service"
import { requireSuperAdmin } from "@/lib/auth/guards"
import { HttpError } from "@/lib/http/http-error"
import { route } from "@/lib/http/route"

/**
 * Where generated media goes.
 *
 * GET never returns the credential, not even masked from the real value: the mask is a
 * fixed placeholder precisely so a secret's length cannot be inferred from it. The
 * endpoint, bucket and public URL are not secret and are returned, because an
 * administrator has to be able to see what is configured.
 */

async function GETHandler() {
  await requireSuperAdmin()
  return Response.json({ storage: await readStorageStatus() })
}

async function PUTHandler(request: Request) {
  const admin = await requireSuperAdmin()

  try {
    const storage = await saveStorageConfiguration(await request.json().catch(() => null), admin)
    return Response.json({ storage })
  } catch (error) {
    if (error instanceof HttpError) return Response.json({ error: error.message }, { status: error.status })
    if (error && typeof error === "object" && "issues" in error) {
      const issues = error as { issues: Array<{ path: Array<string | number>; message: string }> }
      // Field-level messages, so the console can put each one on its own input rather
      // than showing a single unhelpful banner.
      return Response.json(
        {
          error: "Check the storage details and try again.",
          fields: Object.fromEntries(
            issues.issues.map((issue) => [String(issue.path[0] ?? "form"), issue.message]),
          ),
        },
        { status: 400 },
      )
    }
    throw error
  }
}

export const GET = route(GETHandler)
export const PUT = route(PUTHandler)
