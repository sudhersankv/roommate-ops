// Pure: who a forwarded email originally came from (ADR 0016). A Member forwards the landlord's mail to the Lease
// Inbox, so the envelope sender is the Member; the landlord is in the quoted header block. Gmail, Outlook and Apple
// Mail write that block differently, and Gmail / Outlook forwards are often HTML-only. The first block wins.

export type Forwarded = { from: string; name?: string; date?: string; subject?: string };

/** Where a forwarded header block starts. Outlook's separator line is underscores (an <hr> in HTML). */
const MARKER = /^[>\s]*(?:-{3,}\s*Forwarded message\s*-{3,}|Begin forwarded message:|-{3,}\s*Original Message\s*-{3,}|_{10,})\s*$/im;
const HEADER = /^[>\s]*(From|Date|Sent|Subject|To|Cc):\s*(.*)$/i;
const ADDRESS = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i;

/** "Brookfield Leasing <Leasing@Brookfield.com>" -> "leasing@brookfield.com"; null when there's no address. */
export function addressOf(header: string): string | null {
  const angled = /<([^>]+)>/.exec(header)?.[1];
  const m = ADDRESS.exec(angled ?? header);
  return m ? m[0].toLowerCase() : null;
}

/** "leasing@brookfieldresidential.com" -> "brookfieldresidential.com". */
export function domainOf(address: string): string | null {
  const a = addressOf(address);
  return a ? a.slice(a.indexOf("@") + 1) : null;
}

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };

/** Enough HTML-to-text for header blocks: line breaks kept, tags dropped, entities decoded. */
export function htmlToText(html: string): string {
  return html
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, "")
    .replace(/<hr[^>]*>/gi, "\n________________________________\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|tr|li|h\d|blockquote)>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&(#\d+|#x[0-9a-f]+|\w+);/gi, (all, e: string) => {
      if (e[0] === "#") return String.fromCodePoint(e[1].toLowerCase() === "x" ? parseInt(e.slice(2), 16) : Number(e.slice(1)));
      return ENTITIES[e.toLowerCase()] ?? all;
    })
    .replace(/[ \t ]+/g, " ");
}

function nameOf(header: string): string | undefined {
  const name = header
    .replace(/<[^>]*>/g, "")
    .replace(/["']/g, "")
    .trim();
  return name && !ADDRESS.test(name) ? name : undefined;
}

export function parseForwarded(text: string | null, html: string | null): Forwarded | null {
  const body = text?.trim() ? text : html ? htmlToText(html) : "";
  const marker = MARKER.exec(body);
  if (!marker) return null;

  const fields: Record<string, string> = {};
  let started = false;
  for (const line of body.slice(marker.index + marker[0].length).split(/\r?\n/).slice(0, 20)) {
    const h = HEADER.exec(line);
    if (h) {
      const key = h[1].toLowerCase() === "sent" ? "date" : h[1].toLowerCase();
      fields[key] ??= h[2].trim();
      started = true;
    } else if (started && line.replace(/^[>\s]*/, "") === "" && fields.from && fields.subject) break;
  }

  const from = fields.from ? addressOf(fields.from) : null;
  if (!from) return null;
  const out: Forwarded = { from };
  const name = nameOf(fields.from);
  if (name) out.name = name;
  if (fields.date) out.date = fields.date;
  if (fields.subject) out.subject = fields.subject;
  return out;
}
