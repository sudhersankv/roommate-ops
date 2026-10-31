// "Scan receipt" on the dashboard: multipart { groupId, file } -> the photo is stored under public/uploads/g-<id>/ and
// read by services/receipts.ts; the answer prefills the add-expense drawer. Same session rules as every page.
import { memberSession } from "@/lib/session"
import { receipts } from "@/services"
import type { ReceiptDraft } from "@/app/g/[groupId]/_components/types"

export const runtime = "nodejs"

export async function POST(req: Request) {
  const form = await req.formData().catch(() => null)
  const groupId = form?.get("groupId")
  const file = form?.get("file")
  const session = typeof groupId === "string" ? await memberSession(groupId) : null
  if (!session) return Response.json({ error: "You're not a member of this group." }, { status: 403 })
  if (session.member.status !== "active") return Response.json({ error: "Hang on, an admin needs to approve you first." }, { status: 403 })
  if (!(file instanceof File) || file.size === 0) return Response.json({ error: "Pick a photo of the receipt." }, { status: 400 })
  try {
    const saved = await receipts.saveUpload(`g-${session.group.id}`, Buffer.from(await file.arrayBuffer()), file.type || "image/jpeg")
    const r = await receipts.parseReceipt({ url: saved.path }, session.group.currency)
    const draft: ReceiptDraft = {
      receiptUrl: saved.path,
      merchant: r.merchant,
      date: r.date,
      totalCents: r.totalCents,
      printedTotalCents: r.printedTotalCents,
      mismatch: r.mismatch,
      items: r.items,
      taxCents: r.taxCents,
      tipCents: r.tipCents,
    }
    return Response.json(draft)
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : "Couldn't read that receipt." }, { status: 422 })
  }
}
