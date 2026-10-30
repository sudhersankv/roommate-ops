// Who may add Roomie to a WhatsApp group (audit H4: the beta is invite-only). Allowed: a number in
// WHATSAPP_ALLOWED_ADDERS (comma-separated digits with the country code) or the WhatsApp number on a beta request
// marked "onboarded" at /admin/beta. While neither exists (env unset AND no onboarded request has a number), anyone
// may, as before: the allowlist switches itself on with its first entry. Telegram stays open (lib/caps.ts caps it).
import { and, eq, isNotNull } from "drizzle-orm";
import { db, schema } from "@/db";
import { dashboardUrl } from "@/lib/urls";

export const digitsOf = (s: string) => s.replace(/\D/g, "");

/** The number behind a phone JID ("15551234567@s.whatsapp.net" -> "15551234567"); undefined for a LID. */
export const jidDigits = (jid: string) => (/@s\.whatsapp\.net$/.test(jid) ? digitsOf(jid.split("@")[0].split(":")[0]) : undefined);

export function envAdders(raw = process.env.WHATSAPP_ALLOWED_ADDERS): string[] {
  return (raw ?? "")
    .split(",")
    .map(digitsOf)
    .filter((d) => d.length >= 7);
}

/**
 * Pure: whether `adder` (their number's digits, if WhatsApp showed it) may add Roomie. Exact digits only: an entry
 * written without its country code matches nothing (a suffix match would admit the same digits in every country).
 */
export function adderAllowed(adder: string | undefined, allowed: string[]): boolean {
  if (!allowed.length) return true;
  if (!adder) return false;
  return allowed.includes(adder);
}

/** Everyone on the allowlist right now: the env numbers plus onboarded beta requests' numbers. */
export async function allowedAdders(): Promise<string[]> {
  const rows = await db
    .select({ phone: schema.betaRequests.phone })
    .from(schema.betaRequests)
    .where(and(eq(schema.betaRequests.status, "onboarded"), isNotNull(schema.betaRequests.phone)));
  return [...envAdders(), ...rows.map((r) => digitsOf(r.phone ?? "")).filter((d) => d.length >= 7)];
}

export const betaOnlyLine = () => {
  const home = dashboardUrl("/");
  return home ? `I'm in a small beta right now: ask for access at ${home}#whatsapp-beta` : "I'm in a small beta right now: ask for access on Roomie's website.";
};

/** The WhatsApp adapter's admission check for whoever added Roomie (`userExternalId` is a phone JID or a LID). */
export async function whatsappAdmission(adder: { userExternalId: string }): Promise<{ ok: true } | { ok: false; say: string }> {
  const allowed = await allowedAdders();
  return adderAllowed(jidDigits(adder.userExternalId), allowed) ? { ok: true } : { ok: false, say: betaOnlyLine() };
}
