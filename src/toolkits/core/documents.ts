import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import { DOCUMENT_KINDS } from "@/db/schema";
import { docPath, findDocuments, keepDocument } from "@/services/documents";
import { formatInZone } from "@/lib/time";
import { dashboardUrl } from "@/lib/urls";
import { groupTimezone } from "@/services/schedule";
import { ctxOf } from "../util";

export const documentTools = {
  keep_document: createTool({
    id: "keep_document",
    description:
      "\"roomie keep this\" on a photo or file in the message ('[photo: <url>]'): files it with the group's documents. Pass that url, and a title and kind when they said one ('keep this, it's the lease' -> kind lease, title 'Lease').",
    inputSchema: z.object({
      url: z.string().optional().describe("The [photo: ...] url from the message"),
      title: z.string().optional().describe("Short, e.g. 'Lease 2026-27', 'Internet bill March'"),
      kind: z.enum(DOCUMENT_KINDS).optional(),
    }),
    execute: async (input, context) => {
      const doc = await keepDocument(ctxOf(context), input);
      return { kept: doc.title, kind: doc.kind };
    },
  }),
  find_documents: createTool({
    id: "find_documents",
    description:
      "Search the group's documents by title or kind ('find the lease', 'the March internet bill'): at most 5, newest first. Set open=true only when they asked to open or see one; then `links` has the link to each.",
    inputSchema: z.object({
      query: z.string().min(1),
      open: z.boolean().optional(),
    }),
    execute: async ({ query, open }, context) => {
      const ctx = ctxOf(context);
      const [found, tz] = await Promise.all([findDocuments(ctx, query), groupTimezone(ctx.groupId)]);
      const list = found.map((d) => ({ title: d.title, kind: d.kind, added: formatInZone(d.createdAt, tz, { month: "short", day: "numeric", year: "numeric" }), by: d.uploadedByName }));
      const links = open ? found.flatMap((d) => { const url = dashboardUrl(docPath(d.id)); return url ? [{ text: d.title, url }] : []; }) : [];
      return { found: list, ...(links.length ? { links } : {}) };
    },
  }),
};
