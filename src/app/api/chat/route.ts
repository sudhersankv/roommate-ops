// "Ask Roomie" on the dashboard. Same pipeline as the chat (source "ui"), as the signed-in Member of the Group.
import { askRoomie } from "@/pipeline";
import { mastra } from "@/mastra";
import { currentAccount, memberSession } from "@/lib/session";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const body = (await req.json().catch(() => null)) as { groupId?: string; text?: string } | null;
  if (!(await currentAccount())) return Response.json({ error: "Sign in first." }, { status: 401 });
  const session = body?.groupId ? await memberSession(body.groupId) : null;
  if (!session) return Response.json({ error: "You're not a member of this group." }, { status: 403 });
  const text = body?.text?.trim();
  if (!text) return Response.json({ error: "Say something first." }, { status: 400 });
  try {
    return Response.json(await askRoomie(session.ctx, text));
  } catch (err) {
    console.error("[api/chat]", err);
    return Response.json({ error: "Roomie couldn't answer just now. Try again in a moment." }, { status: 502 });
  } finally {
    await mastra.observability.flush?.().catch(() => {});
  }
}
