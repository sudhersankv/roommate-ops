// /admin/stats/csv: the same numbers as /admin/stats, as one CSV (services/stats.ts). Operators only; anyone else,
// signed out included, gets a 404, as if it didn't exist.
import { currentOperator } from "@/lib/operator"
import { loadStats, statsCsv } from "@/services/stats"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET() {
  const op = await currentOperator()
  if (!op) return new Response("Not found", { status: 404 })
  const now = new Date()
  const csv = statsCsv(await loadStats(op, now))
  return new Response(csv, {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="roomie-stats-${now.toISOString().slice(0, 10)}.csv"`,
      "cache-control": "no-store",
      "x-robots-tag": "noindex",
    },
  })
}
