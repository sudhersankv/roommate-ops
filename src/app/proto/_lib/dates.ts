// The prototype runs on a fixed "today" so server and client render the same text.
export const TODAY = "2026-10-28"
export const TIME_ZONE = "America/Chicago"

// Date-only strings are read at 17:00 UTC (late morning in Chicago), so they never slip to another day.
function at(iso: string) {
  return new Date(`${iso.slice(0, 10)}T17:00:00Z`)
}

function daysBetween(a: string, b: string) {
  return Math.round((at(b).getTime() - at(a).getTime()) / 86_400_000)
}

const dayFmt = new Intl.DateTimeFormat("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: TIME_ZONE })
const shortFmt = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: TIME_ZONE })
const weekdayFmt = new Intl.DateTimeFormat("en-US", { weekday: "long", timeZone: TIME_ZONE })

/** "Today", "Yesterday", or "Mon, Oct 26". */
export function dayLabel(iso: string) {
  const d = daysBetween(iso, TODAY)
  if (d === 0) return "Today"
  if (d === 1) return "Yesterday"
  return dayFmt.format(at(iso))
}

/** "today", "yesterday", "3 days ago", "Oct 12". */
export function ago(iso: string) {
  const d = daysBetween(iso, TODAY)
  if (d === 0) return "today"
  if (d === 1) return "yesterday"
  if (d < 7) return `${d} days ago`
  return shortFmt.format(at(iso))
}

/** "today", "tomorrow", "in 4 days", "Friday", or "Nov 20". */
export function dueLabel(iso: string) {
  const d = daysBetween(TODAY, iso)
  if (d < 0) return `${-d} ${d === -1 ? "day" : "days"} late`
  if (d === 0) return "today"
  if (d === 1) return "tomorrow"
  if (d < 7) return weekdayFmt.format(at(iso))
  return shortFmt.format(at(iso))
}

export function daysUntil(iso: string) {
  return daysBetween(TODAY, iso)
}

export function addDays(iso: string, n: number) {
  const d = at(iso)
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}
