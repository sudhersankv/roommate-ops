// Pins (#78), pure and client-safe: a shared location coming in (IncomingMessage.location), one going out
// (Outgoing.location), and the Group's saved place. Never live location: the adapters drop those before they get here.

export type Pin = { lat: number; lng: number; name?: string; address?: string };

const finite = (n: unknown): n is number => typeof n === "number" && Number.isFinite(n);

/** A pin with coordinates in range and its texts trimmed (and capped), or null. */
export function cleanPin(p: { lat?: unknown; lng?: unknown; name?: unknown; address?: unknown } | null | undefined): Pin | null {
  if (!p || !finite(p.lat) || !finite(p.lng) || Math.abs(p.lat) > 90 || Math.abs(p.lng) > 180) return null;
  const text = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim().replace(/\s+/g, " ").slice(0, 200) : undefined);
  const name = text(p.name);
  const address = text(p.address);
  return { lat: round(p.lat), lng: round(p.lng), ...(name ? { name } : {}), ...(address ? { address } : {}) };
}

/** Six decimals is about 10 cm: more is noise. */
const round = (n: number) => Math.round(n * 1e6) / 1e6;

/** A maps link anyone can open (dev-chat, the dashboard). */
export const mapsUrl = (p: Pick<Pin, "lat" | "lng">) => `https://www.google.com/maps/search/?api=1&query=${p.lat},${p.lng}`;

/** "Costco Wholesale, 1430 S Ashland Ave" / "41.8625, -87.6664": what people read. */
export const pinLabel = (p: Pin) => [p.name, p.address].filter(Boolean).join(", ") || `${p.lat}, ${p.lng}`;

const quoted = (s: string) => `"${s.replace(/["\]]/g, "'")}"`;

/** How a shared pin sits in Roomie's line, next to the text: `[location: 41.8625,-87.6664 name="Costco" address="1430 S Ashland Ave"]`. */
export const pinTag = (p: Pin) => `[location: ${p.lat},${p.lng}${p.name ? ` name=${quoted(p.name)}` : ""}${p.address ? ` address=${quoted(p.address)}` : ""}]`;
