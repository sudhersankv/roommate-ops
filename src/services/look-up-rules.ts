// Look-up's pure rules (#78): never about the group's own Members, "near us" means the Group's saved place, and the
// answer is cut to what fits in a chat line. services/look-up.ts does the rest.
import type { Pin } from "@/lib/place";

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const normalize = (s: string) => s.normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/[’‘]/g, "'").toLowerCase();

/** Placeholder names that aren't a person to protect ("Former member", WhatsApp's "Someone", a bare number). */
const NOT_A_NAME = /^(?:former member|someone|\+?[\d\s()-]+)$/i;

/**
 * The Member a query names, or null: their whole display name, or its first word when that's 2+ letters, as a whole
 * word ("dev's", "Dev Patel" and "DEV" all count; "devices" doesn't). Case- and accent-blind.
 */
export function memberNamed(query: string, names: readonly string[]): string | null {
  const q = normalize(query);
  for (const name of names) {
    const n = normalize(name.trim());
    if (!n || NOT_A_NAME.test(n)) continue;
    const first = n.split(/\s+/)[0];
    const forms = [...new Set([n, ...(first.length >= 2 ? [first] : [])])];
    if (forms.some((f) => new RegExp(`(?:^|[^\\p{L}\\p{N}])${escape(f)}(?=$|[^\\p{L}\\p{N}])`, "u").test(q))) return name;
  }
  return null;
}

/** "near us", "nearby", "around here", "closest", "in our area": the asker means where the group lives. */
export const NEAR_US = /\b(?:near (?:us|me|here|the (?:apartment|apt|house|flat|place))|nearby|near by|around (?:here|us)|closest|nearest|in (?:our|the) (?:area|neighbou?rhood)|close to (?:us|home|here))\b/i;

export const wantsNearUs = (query: string) => NEAR_US.test(query);

/** The query as it goes out: "near us" spelled out as the Group's saved place, when there is one. */
export function localQuery(query: string, place: Pin | null, near: boolean): string {
  const q = query.trim();
  if (!place || !near) return q;
  const where = place.address ?? (place.name ? `${place.name} (${place.lat}, ${place.lng})` : `${place.lat}, ${place.lng}`);
  return `${q.replace(NEAR_US, "").replace(/\s{2,}/g, " ").trim()} near ${where}`;
}

/** At most two sentences and 280 characters, no markdown links or bare urls (the source goes as a button). */
export function shortAnswer(text: string, maxChars = 280): string {
  const plain = text
    .replace(/\[([^\]]+)\]\((?:https?:\/\/)[^)]+\)/g, "$1")
    .replace(/https?:\/\/\S+/g, "")
    .replace(/[*_`#]+/g, "")
    .replace(/\s+/g, " ")
    .trim();
  const sentences = plain.match(/[^.!?]+(?:[.!?]+(?=\s|$)|$)/g)?.map((s) => s.trim()).filter(Boolean) ?? [plain];
  let out = sentences.slice(0, 2).join(" ");
  if (out.length > maxChars) {
    const cut = out.slice(0, maxChars - 1);
    out = `${cut.slice(0, Math.max(cut.lastIndexOf(" "), maxChars / 2)).replace(/[,;:\s]+$/, "")}…`;
  }
  return out;
}
