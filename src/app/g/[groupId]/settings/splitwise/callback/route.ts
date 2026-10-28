// Composio sends the Admin back here after the Splitwise sign-in. We check the connection is really live (and
// remember who made it), then go back to Settings with a notice.
import { NextResponse, type NextRequest } from "next/server"

import { memberSession } from "@/lib/session"
import { splitwise } from "@/services"

export async function GET(req: NextRequest, { params }: { params: Promise<{ groupId: string }> }) {
  const { groupId } = await params
  const back = (notice: string) => NextResponse.redirect(new URL(`/g/${groupId}/settings?splitwise=${notice}`, req.url))
  const session = await memberSession(groupId)
  if (!session) return NextResponse.redirect(new URL("/", req.url))
  if (req.nextUrl.searchParams.get("status") === "failed") return back("failed")
  try {
    await splitwise.finishConnect(session.ctx)
    return back("connected")
  } catch (e) {
    console.warn("[splitwise] connect callback:", e instanceof Error ? e.message : e)
    return back("failed")
  }
}
