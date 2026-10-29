// Fly's health check. Cheap: no DB round-trip, so a slow Neon wake-up never restarts the machine.
export const dynamic = "force-dynamic";

export function GET() {
  return Response.json({ ok: true, app: "roomie", at: new Date().toISOString() });
}
