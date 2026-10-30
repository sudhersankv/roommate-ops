// "Ask Roomie" on the dashboard. Same pipeline as the chat (source "ui"), as the signed-in Member of the Group.
// Capped like the chat (lib/caps.ts): 2,000 characters a message, 60 agent runs a day per Member -> 429.
import { askRoomie, CappedError } from "@/pipeline";
import { mastra } from "@/mastra";
import { MAX_INPUT_CHARS } from "@/lib/caps";
import { isNotAllowed } from "@/services/authz";
import { currentAccount, memberSession } from "@/lib/session";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const body = (await req.json().catch(() => null)) as { groupId?: string; text?: string } | null;
  if (!(await currentAccount())) return Response.json({ error: "Sign in first." }, { status: 401 });
  const session = body?.groupId ? await memberSession(body.groupId) : null;
  if (!session) return Response.json({ error: "You're not a member of this group." }, { status: 403 });
  const text = typeof body?.text === "string" ? body.text.trim() : "";
  if (!text) return Response.json({ error: "Say something first." }, { status: 400 });
  if (text.length > MAX_INPUT_CHARS) return Response.json({ error: `Keep it under ${MAX_INPUT_CHARS.toLocaleString("en-US")} characters.` }, { status: 413 });
  try {
    return Response.json(await askRoomie(session.ctx, text));
  } catch (err) {
    if (err instanceof CappedError) return Response.json({ error: err.message }, { status: 429 });
    if (isNotAllowed(err)) return Response.json({ error: err.message }, { status: 403 });
    console.error("[api/chat]", err);
    return Response.json({ error: "Roomie couldn't answer just now. Try again in a moment." }, { status: 502 });
  } finally {
    await mastra.observability.flush?.().catch(() => {});
  }
}
