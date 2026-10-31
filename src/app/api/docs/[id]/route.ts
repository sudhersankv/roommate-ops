// A Document's file (ADR 0018): only for an active Member of the Group it belongs to. 404 when there's no such
// Document, 403 for anyone else (signed out, another Group, Pending). Private cache only.
import { memberSession } from "@/lib/session"
import { isNotAllowed } from "@/services"
import { documentGroup, readDocument } from "@/services/documents"

export const runtime = "nodejs"

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const groupId = await documentGroup(id)
  if (!groupId) return new Response("Not found", { status: 404 })
  const session = await memberSession(groupId)
  if (!session) return new Response("You're not a member of this group.", { status: 403 })
  try {
    const doc = await readDocument(session.ctx, id)
    if (!doc) return new Response("Not found", { status: 404 })
    return new Response(new Uint8Array(doc.bytes), {
      headers: {
        "content-type": doc.contentType,
        "content-length": String(doc.bytes.length),
        "cache-control": "private, max-age=300",
        "x-content-type-options": "nosniff",
        "content-disposition": `inline; filename="${doc.document.title.replace(/[^\w .-]/g, "_")}"`,
      },
    })
  } catch (e) {
    if (isNotAllowed(e)) return new Response(e.message, { status: 403 })
    throw e
  }
}
