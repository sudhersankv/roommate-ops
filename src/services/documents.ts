// Documents (ADR 0018): the files a Group keeps (receipts with their Expense, the lease, Notices, bills, email threads,
// photos someone asked Roomie to keep). Core, always on; every Trick files, none owns. The row is here, the bytes in
// the BlobStore (integrations/blob-store.ts) under "g/<groupId>/<id>", and people open one at /api/docs/<id>, which
// checks they're an active Member of its Group. A photo sent in the Chat is a Document too, held unfiled (filed_at
// null: readable by Roomie, not on the Docs list, gone after 30 days) until someone keeps it or it becomes a receipt.
import { createHash } from "node:crypto";
import { and, desc, eq, ilike, inArray, isNotNull, isNull, lt, ne, or, sql, type SQL } from "drizzle-orm";
import { db, schema } from "@/db";
import { DOCUMENT_KINDS, type DocumentKind } from "@/db/schema";
import { blobStore } from "@/integrations/blob-store";
import { formatInZone } from "@/lib/time";
import { appUrl } from "@/lib/urls";
import { recordFor } from "./activity";
import { NotAllowedError, requireActive } from "./authz";
import { groupTimezone } from "./schedule";
import type { Ctx, GroupCtx } from "./types";

const { documents, expenses, members } = schema;

export { DOCUMENT_KINDS, type DocumentKind };
export const MAX_DOCUMENT_BYTES = 20 * 1024 * 1024;
const UNFILED_DAYS = 30;

export type DocumentSource = { table: string; id: string };
export type Document = {
  id: string;
  groupId: string;
  kind: DocumentKind;
  title: string;
  contentType: string;
  size: number;
  source: DocumentSource | null;
  uploadedBy: string | null;
  uploadedByName: string | null;
  filed: boolean;
  createdAt: Date;
};

/* ---------- pure ---------- */

export const storageKey = (groupId: string, id: string) => `g/${groupId}/${id}`;
/** Where people open a Document (the route checks the session). */
export const docPath = (id: string) => `/api/docs/${id}`;
export const docUrl = (id: string) => `${appUrl()}${docPath(id)}`;

const DOC_PATH = /^\/api\/docs\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i;

/** The Document id behind one of our own links (/api/docs/<id>, or under APP_URL); null for anything else. */
export function docIdFromUrl(url: string): string | null {
  const base = appUrl();
  const rel = url.startsWith("/") ? url : base && url.startsWith(`${base}/`) ? url.slice(base.length) : null;
  return rel ? (DOC_PATH.exec(rel)?.[1]?.toLowerCase() ?? null) : null;
}

/** An Expense's receipt link as people open it (/api/docs/<id>); null for anything else, an old /uploads path included. */
export function receiptHref(url: string | null | undefined): string | null {
  const id = url ? docIdFromUrl(url) : null;
  return id ? docPath(id) : null;
}

/** The same Channel file (a Telegram file id, a WhatsApp message id) is one Document per Group. */
export function stableDocId(groupId: string, name: string): string {
  const h = createHash("sha256").update(`${groupId}:${name}`).digest("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-${((parseInt(h[16], 16) & 3) | 8).toString(16)}${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

const STOP = new Set(["the", "a", "an", "our", "my", "me", "find", "show", "open", "get", "for", "of", "from", "doc", "document", "file", "pdf", "roomie", "please"]);
/** "find the March internet bill" -> ["march", "internet", "bill"]. */
export const searchWords = (query: string) =>
  query
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length > 1 && !STOP.has(w));

/* ---------- reads ---------- */

const select = {
  id: documents.id,
  groupId: documents.groupId,
  kind: documents.kind,
  title: documents.title,
  contentType: documents.contentType,
  size: documents.size,
  source: documents.source,
  uploadedBy: documents.uploadedBy,
  uploadedByName: members.displayName,
  filedAt: documents.filedAt,
  createdAt: documents.createdAt,
};
type Row = { filedAt: Date | null; uploadedByName: string | null } & Omit<Document, "filed" | "uploadedByName">;
const toDocument = ({ filedAt, ...r }: Row): Document => ({ ...r, uploadedByName: r.uploadedByName ?? null, filed: !!filedAt });
const base = () => db.select(select).from(documents).leftJoin(members, eq(members.id, documents.uploadedBy));

/** One live Document of this Group (filed or not), or null. */
export async function getDocument(ctx: GroupCtx, id: string): Promise<Document | null> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  const [r] = await base().where(and(eq(documents.id, id), eq(documents.groupId, ctx.groupId), isNull(documents.deletedAt)));
  return r ? toDocument(r) : null;
}

/** The Group's filed Documents, newest first; `query` matches every word against the title or the kind. */
export async function listDocuments(ctx: GroupCtx, opts: { kind?: DocumentKind; query?: string; limit?: number } = {}): Promise<Document[]> {
  const where: (SQL | undefined)[] = [eq(documents.groupId, ctx.groupId), isNull(documents.deletedAt), isNotNull(documents.filedAt)];
  if (opts.kind) where.push(eq(documents.kind, opts.kind));
  for (const w of searchWords(opts.query ?? "")) {
    const kind = DOCUMENT_KINDS.find((k) => k === w || `${k}s` === w);
    where.push(kind ? or(ilike(documents.title, `%${w}%`), eq(documents.kind, kind)) : ilike(documents.title, `%${w}%`));
  }
  const rows = await base()
    .where(and(...where))
    .orderBy(desc(documents.createdAt))
    .limit(opts.limit ?? 200);
  return rows.map(toDocument);
}

/** "roomie find the lease": at most `limit`, newest first. */
export const findDocuments = (ctx: GroupCtx, query: string, limit = 5) => listDocuments(ctx, { query, limit });

/** The bytes, for an active Member of the Group only (the route and Roomie's own reads). Null when there's no such file. */
export async function readDocument(ctx: Ctx, id: string): Promise<{ document: Document; bytes: Buffer; contentType: string } | null> {
  await requireActive(ctx);
  const document = await getDocument(ctx, id);
  if (!document) return null;
  const blob = await blobStore().get(storageKey(ctx.groupId, id));
  return blob ? { document, bytes: blob.bytes, contentType: document.contentType || blob.contentType } : null;
}

/** Which Group a live Document is in (the route then checks the session against it). */
export async function documentGroup(id: string): Promise<string | null> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  const [r] = await db.select({ groupId: documents.groupId }).from(documents).where(and(eq(documents.id, id), isNull(documents.deletedAt)));
  return r?.groupId ?? null;
}

/** Internal (vision reads of a Group's own photo): the bytes without a Member check. The caller checked the Group. */
export async function documentBytes(groupId: string, id: string): Promise<{ bytes: Buffer; contentType: string } | null> {
  const document = await getDocument({ groupId }, id);
  if (!document) return null;
  const blob = await blobStore().get(storageKey(groupId, id));
  return blob ? { bytes: blob.bytes, contentType: document.contentType || blob.contentType } : null;
}

export type DocumentView = { id: string; kind: DocumentKind; title: string; createdAt: Date; href: string };

/** The Docs tab and Home's "Recent documents": plain data. Pending Members can't open files, so they see none. */
export async function documentsView(session: { ctx: Ctx }, opts: { kind?: DocumentKind; query?: string; limit?: number } = {}): Promise<DocumentView[]> {
  const [me] = await db.select({ status: members.status }).from(members).where(and(eq(members.id, session.ctx.memberId), eq(members.groupId, session.ctx.groupId)));
  if (me?.status !== "active") return [];
  return (await listDocuments(session.ctx, opts)).map((d) => ({ id: d.id, kind: d.kind, title: d.title, createdAt: d.createdAt, href: docPath(d.id) }));
}

/* ---------- writes ---------- */

export type FileInput = {
  kind: DocumentKind;
  title: string;
  bytes: Buffer;
  contentType: string;
  source?: DocumentSource | null;
  uploadedBy?: string | null;
  /** false = a Chat photo held for reading, not on the Docs list (saveUpload). Default true. */
  filed?: boolean;
  /** A stable id (stableDocId) so the same file is stored once; filing it again returns the first. */
  id?: string;
};

/** Store the bytes and the row. Any Trick files through here; who may is the caller's check. */
export async function fileDocument(ctx: GroupCtx, input: FileInput): Promise<Document> {
  if (!DOCUMENT_KINDS.includes(input.kind)) throw new Error(`"${input.kind}" isn't a kind of document.`);
  if (input.bytes.length === 0) throw new Error("That file is empty.");
  if (input.bytes.length > MAX_DOCUMENT_BYTES) throw new Error("That file is over 20 MB.");
  const title = input.title.trim().replace(/\s+/g, " ").slice(0, 200) || "Untitled";
  if (input.id) {
    const existing = await getDocument(ctx, input.id);
    if (existing) return existing;
  }
  const id = input.id ?? crypto.randomUUID();
  const key = storageKey(ctx.groupId, id);
  await blobStore().put(key, input.bytes, input.contentType);
  const now = new Date();
  const row = {
    kind: input.kind,
    title,
    contentType: input.contentType,
    size: input.bytes.length,
    storageKey: key,
    source: input.source ?? null,
    uploadedBy: input.uploadedBy ?? null,
    filedAt: input.filed === false ? null : now,
    createdAt: now,
    deletedAt: null,
  };
  try {
    // A stable id that's taken here can only be a deleted Document (a live one returned above): the same photo sent
    // again after someone deleted it comes back as a new one.
    await db
      .insert(documents)
      .values({ id, groupId: ctx.groupId, ...row })
      .onConflictDoUpdate({ target: documents.id, set: row, setWhere: and(eq(documents.groupId, ctx.groupId), isNotNull(documents.deletedAt)) });
  } catch (e) {
    await blobStore().delete(key).catch(() => {});
    throw e;
  }
  const doc = await getDocument(ctx, id);
  if (!doc) throw new Error("Couldn't keep that file. Try sending it again?");
  return doc;
}

/**
 * An Expense's receipt: the Document becomes a filed receipt pointing at it, titled after the Expense, and the Expense
 * points back (receipt_document_id). A receipt belongs to one Expense: attaching it to another moves it, and the
 * Expense it was on loses its receipt, in the same transaction.
 */
export async function attachReceipt(ctx: Ctx, documentId: string, expense: { id: string; description: string }): Promise<boolean> {
  return db.transaction(async (tx) => {
    const rows = await tx
      .update(documents)
      .set({
        kind: "receipt",
        title: `Receipt: ${expense.description}`.slice(0, 200),
        source: { table: "expenses", id: expense.id },
        filedAt: sql`coalesce(${documents.filedAt}, now())`,
        uploadedBy: sql`coalesce(${documents.uploadedBy}, ${ctx.memberId}::uuid)`,
      })
      .where(and(eq(documents.id, documentId), eq(documents.groupId, ctx.groupId), isNull(documents.deletedAt)))
      .returning({ id: documents.id });
    if (!rows.length) return false;
    await tx
      .update(expenses)
      .set({ receiptDocumentId: null, receiptUrl: null })
      .where(and(eq(expenses.groupId, ctx.groupId), eq(expenses.receiptDocumentId, documentId), ne(expenses.id, expense.id)));
    await tx.update(expenses).set({ receiptDocumentId: documentId }).where(and(eq(expenses.id, expense.id), eq(expenses.groupId, ctx.groupId)));
    return true;
  });
}

const NOT_OURS = "I can only keep photos and files sent in this group's chat or uploaded on its dashboard.";

/**
 * "roomie keep this" on a photo or file in the message (`url` = its [photo: ...] link): it's filed, with a kind and a
 * title when they said one. Keeping it twice just renames it. Active Members only.
 */
export async function keepDocument(ctx: Ctx, input: { url?: string; title?: string; kind?: DocumentKind }, now = new Date()): Promise<Document> {
  await requireActive(ctx);
  if (!input.url) throw new Error("Send the photo or file with \"roomie keep this\" and I'll file it.");
  const id = docIdFromUrl(input.url);
  const doc = id ? await getDocument(ctx, id) : null;
  if (!doc) throw new Error(NOT_OURS);
  const kind = input.kind ?? doc.kind;
  const title = input.title?.trim() || (doc.filed ? doc.title : `Photo, ${formatInZone(now, await groupTimezone(ctx.groupId), { month: "short", day: "numeric" })}`);
  await db
    .update(documents)
    .set({ kind, title: title.slice(0, 200), filedAt: sql`coalesce(${documents.filedAt}, now())`, uploadedBy: sql`coalesce(${documents.uploadedBy}, ${ctx.memberId}::uuid)` })
    .where(eq(documents.id, doc.id));
  await recordFor(ctx, "document.kept", `kept ${title}`, { table: "documents", id: doc.id });
  return (await getDocument(ctx, doc.id))!;
}

/** Take a Document off the list and delete its bytes: whoever uploaded it, or an Admin. */
export async function deleteDocument(ctx: Ctx, id: string): Promise<{ deleted: string }> {
  const actor = await requireActive(ctx);
  const doc = await getDocument(ctx, id);
  if (!doc) throw new Error("That document isn't here anymore.");
  if (actor.role !== "admin" && doc.uploadedBy !== actor.id) throw new NotAllowedError(`Only whoever added "${doc.title}" or an admin can delete it.`, "not-yours");
  await db.update(documents).set({ deletedAt: new Date() }).where(eq(documents.id, doc.id));
  await blobStore().delete(storageKey(ctx.groupId, doc.id));
  await recordFor(ctx, "document.deleted", `deleted ${doc.title}`, { table: "documents", id: doc.id });
  return { deleted: doc.title };
}

/* ---------- forget me, delete group data, retention ---------- */

/**
 * The file first, then the row. A file the store wouldn't delete keeps its row, soft-deleted, so retention
 * (purgeOldDocuments) tries again; nothing is left in storage without a row pointing at it. Returns how many went.
 */
async function hardDelete(rows: { id: string; storageKey: string }[]): Promise<number> {
  if (!rows.length) return 0;
  const gone: string[] = [];
  const kept: string[] = [];
  let firstError: unknown;
  for (const r of rows) {
    try {
      await blobStore().delete(r.storageKey);
      gone.push(r.id);
    } catch (e) {
      kept.push(r.id);
      firstError ??= e;
    }
  }
  if (gone.length) await db.delete(documents).where(inArray(documents.id, gone));
  if (kept.length) {
    await db.update(documents).set({ deletedAt: sql`coalesce(${documents.deletedAt}, now())` }).where(inArray(documents.id, kept));
    console.warn(`[documents] couldn't delete ${kept.length} file(s); kept their rows for retention to retry`, firstError);
  }
  return gone.length;
}

/** What a Member uploaded (forget me reads it before anonymizing). */
export async function documentsForMember(groupId: string, memberId: string): Promise<Document[]> {
  return (await base().where(and(eq(documents.groupId, groupId), eq(documents.uploadedBy, memberId)))).map(toDocument);
}

/** "forget me", part one: their own photos go (rows and bytes). */
export async function deleteMemberPhotos(groupId: string, memberId: string): Promise<number> {
  const rows = await db
    .select({ id: documents.id, storageKey: documents.storageKey })
    .from(documents)
    .where(and(eq(documents.groupId, groupId), eq(documents.uploadedBy, memberId), eq(documents.kind, "photo")));
  return hardDelete(rows);
}

/** "forget me", part two: the rest stays for the Group, without their name on it. */
export async function anonymizeUploader(groupId: string, memberId: string): Promise<number> {
  const rows = await db.update(documents).set({ uploadedBy: null }).where(and(eq(documents.groupId, groupId), eq(documents.uploadedBy, memberId))).returning({ id: documents.id });
  return rows.length;
}

/** "forget me": the photos in a Member's forgotten chat lines, unless someone filed them (a kept photo, a receipt). */
export async function deleteUnfiledByUrl(groupId: string, urls: readonly string[]): Promise<number> {
  const ids = urls.map(docIdFromUrl).filter((id): id is string => !!id);
  if (!ids.length) return 0;
  const rows = await db
    .select({ id: documents.id, storageKey: documents.storageKey })
    .from(documents)
    .where(and(eq(documents.groupId, groupId), inArray(documents.id, ids), isNull(documents.filedAt)));
  return hardDelete(rows);
}

/** "delete group data": every Document of the Group, rows and bytes. */
export async function deleteGroupDocuments(groupId: string): Promise<number> {
  const rows = await db.select({ id: documents.id, storageKey: documents.storageKey }).from(documents).where(eq(documents.groupId, groupId));
  return hardDelete(rows);
}

/** Retention: Chat photos nobody filed, and deleted Documents' rows, after 30 days. */
export async function purgeOldDocuments(now = new Date(), days = UNFILED_DAYS): Promise<number> {
  const cutoff = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
  const rows = await db
    .select({ id: documents.id, storageKey: documents.storageKey })
    .from(documents)
    .where(or(and(isNull(documents.filedAt), lt(documents.createdAt, cutoff)), lt(documents.deletedAt, cutoff)));
  return hardDelete(rows);
}
