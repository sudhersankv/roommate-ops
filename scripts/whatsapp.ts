// npx tsx scripts/whatsapp.ts: Roomie on WhatsApp from this terminal (docs/whatsapp.md). Holds the WhatsApp session
// stored in Postgres (wa_sessions), so ONLY run it while no other process holds it: set WHATSAPP_ENABLED=0 on Fly
// first, or the two kick each other off. Not linked yet: prints a QR to scan (WhatsApp on Roomie's phone > Linked
// devices > Link a device), or a pairing code with --pair.
//
//   npx tsx scripts/whatsapp.ts                     QR in the terminal
//   npx tsx scripts/whatsapp.ts --pair 15551234567  pairing code for that number (digits with the country code)
//   npx tsx scripts/whatsapp.ts --timeout 30        exit after 30 s (smoke test)
//
// Ctrl+C stops it after the queued replies are out; the session stays saved.
import "../src/lib/env";
import qrcode from "qrcode-terminal";
import { whatsappClient } from "../src/channels/whatsapp-boot";

const arg = (name: string) => {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
};
const pair = arg("--pair")?.replace(/\D/g, "");
const timeoutS = Number(arg("--timeout") ?? 0);

if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL missing: the WhatsApp session lives in Postgres (docs/whatsapp.md).");
  process.exit(1);
}

const { db } = await import("../src/db");
const { mastra } = await import("../src/mastra");
const { useFakeSplitwiseIfUnavailable } = await import("../src/integrations/splitwise");
await useFakeSplitwiseIfUnavailable();

const wa = await whatsappClient({
  onQr: (qr) => {
    console.log("\n[whatsapp] Scan with WhatsApp on Roomie's phone: Settings > Linked devices > Link a device\n");
    qrcode.generate(qr, { small: true });
  },
  onStatus: (s) => {
    if (s.state === "pairing") console.log(`[whatsapp] pairing code: ${s.pairingCode}  -> WhatsApp on Roomie's phone: Linked devices > Link a device > Link with phone number instead`);
    else if (s.state === "open") console.log(`[whatsapp] connected as ${s.me?.name ?? ""} (${s.me?.jid}). Add this number to a group (docs/whatsapp.md). Ctrl+C to stop.`);
    else if (s.state === "logged_out") {
      console.log("[whatsapp] logged out: the saved session is gone. Run this again to link the number.");
      void shutdown(1);
    } else if (s.state === "disconnected" && s.error) {
      console.log(`[whatsapp] stopped: ${s.error}`);
      void shutdown(1);
    } else if (s.state !== "qr") console.log(`[whatsapp] ${s.state}`);
  },
});

let stopping = false;
async function shutdown(code = 0) {
  if (stopping) return;
  stopping = true;
  console.log("[whatsapp] stopping...");
  await wa.stop().catch(() => {});
  await wa.idle().catch(() => {});
  await mastra.observability.flush().catch(() => {});
  await db.$client.end().catch(() => {});
  process.exit(code);
}
process.on("SIGINT", () => void shutdown());
process.on("SIGTERM", () => void shutdown());
if (timeoutS > 0) setTimeout(() => void shutdown(), timeoutS * 1000).unref();

console.log(`[whatsapp] starting (${(await wa.hasSession()) ? "saved session" : "not linked yet"}). Only one process may hold the session: is WHATSAPP_ENABLED=0 on Fly?`);
await wa.start(pair ? { pairPhone: pair } : {});
