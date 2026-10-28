// Date labels for the dashboard, in the Group's time zone. Days are "YYYY-MM-DD" strings computed on the server
// (localDay) so the server and the browser render the same text.

/** The calendar day of `d` in `tz`, as "YYYY-MM-DD". */
export function localDay(d: Date, tz: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(d)
  const get = (t: Intl.DateTimeFormatPartTypes) => parts.find((p) => p.type === t)?.value ?? ""
  return `${get("year")}-${get("month")}-${get("day")}`
}

// Day strings are read at 17:00 UTC (late morning in the Americas, evening in Asia), so they never slip a day.
function at(iso: string) {
  return new Date(`${iso.slice(0, 10)}T17:00:00Z`)
}

function daysBetween(a: string, b: string) {
  return Math.round((at(b).getTime() - at(a).getTime()) / 86_400_000)
}

export function addDays(iso: string, n: number) {
  const d = at(iso)
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}

/** Labels relative to `today` (the Group's current day). */
export function dateLabels(today: string) {
  const dayFmt = new Intl.DateTimeFormat("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" })
  const shortFmt = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "UTC" })
  const weekdayFmt = new Intl.DateTimeFormat("en-US", { weekday: "long", timeZone: "UTC" })
  return {
    today,
    /** "Today", "Yesterday", or "Mon, Oct 26". */
    dayLabel(iso: string) {
      const d = daysBetween(iso, today)
      if (d === 0) return "Today"
      if (d === 1) return "Yesterday"
      return dayFmt.format(at(iso))
    },
    /** "today", "yesterday", "3 days ago", "Oct 12". */
    ago(iso: string) {
      const d = daysBetween(iso, today)
      if (d <= 0) return "today"
      if (d === 1) return "yesterday"
      if (d < 7) return `${d} days ago`
      return shortFmt.format(at(iso))
    },
    /** "2 days late", "today", "tomorrow", "Friday", or "Nov 20". */
    dueLabel(iso: string) {
      const d = daysBetween(today, iso)
      if (d < 0) return `${-d} ${d === -1 ? "day" : "days"} late`
      if (d === 0) return "today"
      if (d === 1) return "tomorrow"
      if (d < 7) return weekdayFmt.format(at(iso))
      return shortFmt.format(at(iso))
    },
    daysUntil(iso: string) {
      return daysBetween(today, iso)
    },
  }
}

export type DateLabels = ReturnType<typeof dateLabels>
