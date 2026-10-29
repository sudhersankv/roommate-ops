// /admin/whatsapp's API: GET = the connection status; POST { action: "start" | "request-pairing-code" | "logout",
// phone? }. Operators only (ROOMIE_OPERATOR_EMAILS); anyone else gets a 404, as if it didn't exist.
import { currentOperator } from "@/lib/operator";
import { DISABLED, whatsappClient, whatsappEnabled } from "@/channels/whatsapp-boot";
import type { WhatsAppStatus } from "@/channels/whatsapp";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type WhatsAppAdminStatus = WhatsAppStatus & { enabled: boolean };

const notFound = () => new Response("Not found", { status: 404 });
const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { "cache-control": "no-store" } });

async function current(): Promise<WhatsAppAdminStatus> {
  if (!whatsappEnabled()) return { enabled: false, state: "disconnected", error: DISABLED, since: Date.now() };
  return { enabled: true, ...(await whatsappClient()).status() };
}

export async function GET() {
  if (!(await currentOperator())) return notFound();
  return json(await current());
}

export async function POST(req: Request) {
  const operator = await currentOperator();
  if (!operator) return notFound();
  if (!whatsappEnabled()) return json({ ...(await current()), error: DISABLED }, 409);
  const body = (await req.json().catch(() => null)) as { action?: string; phone?: string } | null;
  const client = await whatsappClient();
  try {
    if (body?.action === "start") await client.start();
    else if (body?.action === "request-pairing-code") await client.requestPairingCode(String(body.phone ?? ""));
    else if (body?.action === "logout") await client.logout();
    else return json({ error: "Unknown action." }, 400);
  } catch (err) {
    return json({ ...(await current()), error: err instanceof Error ? err.message : String(err) }, 400);
  }
  console.log(`[whatsapp] ${operator.email}: ${body.action}`);
  return json(await current());
}
