import { z } from "zod"

import { suggestPalette } from "@/features/directions/service"
import { requireUser } from "@/lib/auth/guards"
import { route } from "@/lib/http/route"

const schema = z.object({ projectId: z.string().cuid() })

async function POSTHandler(request: Request) {
  const user = await requireUser()
  const parsed = schema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) return Response.json({ error: "Invalid project." }, { status: 400 })
  try {
    return Response.json({ colors: await suggestPalette(parsed.data.projectId, user.id) })
  } catch (error) {
    if (error instanceof Error && error.message === "OPENAI_API_KEY is required") {
      return Response.json({ error: "The palette provider is not configured yet." }, { status: 503 })
    }
    return Response.json({ error: "Palette suggestions are temporarily unavailable." }, { status: 502 })
  }
}

export const POST = route(POSTHandler)
