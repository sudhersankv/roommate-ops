// P7 · "Ask Roomie" panel. Same pipeline as the chat, acting as the dashboard's selected member (source "ui").
// Swap to assistant-ui's streaming protocol later; this JSON shape is enough to start.
import { askRoomie } from "@/pipeline";
import { mastra } from "@/mastra";
import { dashboardCtx } from "@/lib/dashboard";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const { text } = (await req.json()) as { text: string };
  const ctx = await dashboardCtx();
  if (!ctx) return Response.json({ error: "no household yet" }, { status: 400 });
  try {
    return Response.json(await askRoomie(ctx, text));
  } catch (err) {
    console.error("[api/chat]", err);
    return Response.json({ error: err instanceof Error ? err.message : String(err) }, { status: 502 });
  } finally {
    await mastra.observability.flush?.().catch(() => {});
  }
}
