// P7 · "Ask Roomie" panel. Same agent, acting as the dashboard's selected member.
// Swap to assistant-ui's streaming protocol later; this JSON shape is enough to start.
import { askRoomie } from "@/agent/roomie";
import { listMembers } from "@/services/members";
import { dashboardCtx } from "@/lib/dashboard";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const { text } = (await req.json()) as { text: string };
  const ctx = await dashboardCtx();
  if (!ctx) return Response.json({ error: "no household yet" }, { status: 400 });
  const me = (await listMembers(ctx)).find((m) => m.id === ctx.actorId);
  try {
    const out = await askRoomie(ctx, `[${me?.name ?? "Someone"}] ${text}`);
    return Response.json(out);
  } catch (err) {
    console.error("[api/chat]", err);
    return Response.json({ error: err instanceof Error ? err.message : String(err) }, { status: 502 });
  }
}
