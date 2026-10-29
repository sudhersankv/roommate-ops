// Postgres behind the WhatsApp adapter: the login rows (wa_sessions) and the people it learned (wa_contacts). Only
// loaded lazily (whatsapp-auth.ts, whatsapp-boot.ts), so importing the adapter never builds a DB client.
import { and, eq, inArray, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import type { AuthRows } from "./whatsapp-auth";

const { waSessions, waContacts } = schema;

/** A person the WhatsApp adapter learned: a LID, the phone JID behind it when known, their name. */
export type WaContact = { lid: string; pn?: string | null; name?: string | null };
const BATCH = 200;

export function pgAuthRows(sessionId = "default"): AuthRows {
  const mine = eq(waSessions.id, sessionId);
  return {
    async get(keys) {
      const out = new Map<string, unknown>();
      for (let i = 0; i < keys.length; i += BATCH) {
        const rows = await db
          .select({ key: waSessions.key, value: waSessions.value })
          .from(waSessions)
          .where(and(mine, inArray(waSessions.key, keys.slice(i, i + BATCH))));
        for (const r of rows) out.set(r.key, r.value);
      }
      return out;
    },
    async set(rows) {
      const unique = [...new Map(rows.map((r) => [r.key, r])).values()];
      for (let i = 0; i < unique.length; i += BATCH) {
        await db
          .insert(waSessions)
          .values(unique.slice(i, i + BATCH).map((r) => ({ id: sessionId, key: r.key, value: r.value })))
          .onConflictDoUpdate({ target: [waSessions.id, waSessions.key], set: { value: sql`excluded.value`, updatedAt: sql`now()` } });
      }
    },
    async del(keys) {
      for (let i = 0; i < keys.length; i += BATCH) await db.delete(waSessions).where(and(mine, inArray(waSessions.key, keys.slice(i, i + BATCH))));
    },
    async clear() {
      await db.delete(waSessions).where(mine);
    },
  };
}

export const pgContacts = {
  async all(): Promise<WaContact[]> {
    return db.select({ lid: waContacts.lid, pn: waContacts.pn, name: waContacts.name }).from(waContacts);
  },
  async save(c: WaContact): Promise<void> {
    await db
      .insert(waContacts)
      .values({ lid: c.lid, pn: c.pn ?? null, name: c.name ?? null })
      .onConflictDoUpdate({
        target: waContacts.lid,
        set: { pn: sql`coalesce(excluded.pn, ${waContacts.pn})`, name: sql`coalesce(excluded.name, ${waContacts.name})`, updatedAt: sql`now()` },
      });
  },
};
