// Wall-clock time in a Group's time zone (IANA), with Intl only, so it runs on the server and in the browser.
// Everything that says "today", "Tuesday 8pm", "this week" or "Sunday evening" goes through these helpers.
// Wall-clock -> instant: a time that doesn't exist (spring forward) moves forward by the gap; a time that happens twice
// (fall back) is the first one.

export type WallClock = { year: number; month: number; day: number; hour: number; minute: number; second?: number };
export type ZonedParts = Required<WallClock> & { /** 0 = Sunday */ weekday: number };

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;
export const WEEKDAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"] as const;
const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

const formatters = new Map<string, Intl.DateTimeFormat>();
function partsFormatter(tz: string) {
  let f = formatters.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      hourCycle: "h23",
      weekday: "short",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
    formatters.set(tz, f);
  }
  return f;
}

export function isValidTimeZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/** The wall clock in `tz` at instant `d`. */
export function zonedParts(tz: string, d: Date): ZonedParts {
  const parts = partsFormatter(tz).formatToParts(d);
  const get = (t: Intl.DateTimeFormatPartTypes) => parts.find((p) => p.type === t)?.value ?? "";
  return {
    year: Number(get("year")),
    month: Number(get("month")),
    day: Number(get("day")),
    hour: Number(get("hour")) % 24, // some ICU builds print "24" at midnight
    minute: Number(get("minute")),
    second: Number(get("second")),
    weekday: WEEKDAYS.indexOf(get("weekday") as (typeof WEEKDAYS)[number]),
  };
}

export const zonedNow = (tz: string, now = new Date()) => zonedParts(tz, now);

/** UTC offset of `tz` at instant `d`, in ms (Chicago in winter: -6 h). */
export function tzOffsetMs(tz: string, d: Date): number {
  const p = zonedParts(tz, d);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return asUtc - Math.floor(d.getTime() / 1000) * 1000;
}

/** "UTC-05:00" */
export function offsetLabel(tz: string, d: Date): string {
  const m = Math.round(tzOffsetMs(tz, d) / MINUTE);
  const sign = m < 0 ? "-" : "+";
  const a = Math.abs(m);
  return `UTC${sign}${String(Math.floor(a / 60)).padStart(2, "0")}:${String(a % 60).padStart(2, "0")}`;
}

/** The instant a wall-clock time in `tz` happens. Month is 1-12; overflowing fields roll over (day 32 = next month). */
export function zonedTimeToUtc(tz: string, w: WallClock): Date {
  const local = Date.UTC(w.year, w.month - 1, w.day, w.hour, w.minute, w.second ?? 0);
  const before = tzOffsetMs(tz, new Date(local - 12 * HOUR));
  const after = tzOffsetMs(tz, new Date(local + 12 * HOUR));
  const valid = [local - before, local - after].filter((t) => tzOffsetMs(tz, new Date(t)) === local - t);
  if (valid.length) return new Date(Math.min(...valid));
  return new Date(local - before); // in the gap: same distance past the switch
}

const dayKey = (p: { year: number; month: number; day: number }) =>
  `${p.year}-${String(p.month).padStart(2, "0")}-${String(p.day).padStart(2, "0")}`;

/** "YYYY-MM-DD" of instant `d` in `tz`. */
export const dayInZone = (tz: string, d: Date) => dayKey(zonedParts(tz, d));

/** Local midnight (the first instant of the day) of `d` in `tz`. */
export function startOfDay(tz: string, d: Date): Date {
  const p = zonedParts(tz, d);
  return zonedTimeToUtc(tz, { year: p.year, month: p.month, day: p.day, hour: 0, minute: 0 });
}

export const isSameDay = (tz: string, a: Date, b: Date) => dayInZone(tz, a) === dayInZone(tz, b);

/** Same wall-clock time `n` calendar days later in `tz` (a day across DST is 23 or 25 hours). */
export function addDaysInZone(tz: string, d: Date, n: number): Date {
  const p = zonedParts(tz, d);
  return zonedTimeToUtc(tz, { year: p.year, month: p.month, day: p.day + n, hour: p.hour, minute: p.minute, second: p.second });
}

/** Whole calendar days from day string `a` to `b` ("2026-10-28" -> "2026-11-02" = 5). */
export function daysBetweenDays(a: string, b: string): number {
  const t = (s: string) => Date.UTC(Number(s.slice(0, 4)), Number(s.slice(5, 7)) - 1, Number(s.slice(8, 10)));
  return Math.round((t(b) - t(a)) / DAY);
}

/** Day string `n` days after `day`. */
export function addDaysToDay(day: string, n: number): string {
  const d = new Date(Date.UTC(Number(day.slice(0, 4)), Number(day.slice(5, 7)) - 1, Number(day.slice(8, 10)) + n));
  return d.toISOString().slice(0, 10);
}

/**
 * The next `weekday` (0 = Sunday) at `hour:minute` in `tz`, strictly after `from`. Today counts when that time is still
 * ahead ("Tuesday 8pm" said on Tuesday at noon is tonight).
 */
export function nextWeekday(tz: string, weekday: number, hour: number, from = new Date(), minute = 0): Date {
  const p = zonedParts(tz, from);
  for (let i = 0; i <= 7; i++) {
    if ((p.weekday + i) % 7 !== weekday) continue;
    const t = zonedTimeToUtc(tz, { year: p.year, month: p.month, day: p.day + i, hour, minute });
    if (t.getTime() > from.getTime()) return t;
  }
  return zonedTimeToUtc(tz, { year: p.year, month: p.month, day: p.day + 7, hour, minute });
}

/** Intl formatting in `tz` ("Tue Nov 3, 8:00 PM"). */
export function formatInZone(d: Date, tz: string, opts: Intl.DateTimeFormatOptions = { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }): string {
  return new Intl.DateTimeFormat("en-US", { ...opts, timeZone: tz }).format(d).replace(/,(?= \w{3} \d)/, "");
}

/** "Wed Oct 28 2026, 11:05" plus weekday, for the agent's instructions. */
export function describeNow(tz: string, now = new Date()): string {
  const p = zonedParts(tz, now);
  const time = `${String(p.hour).padStart(2, "0")}:${String(p.minute).padStart(2, "0")}`;
  return `${WEEKDAY_NAMES[p.weekday]} ${dayKey(p)} ${time} in ${tz} (${offsetLabel(tz, now)})`;
}

const WALL = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{1,2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?)?$/;
const HAS_OFFSET = /(?:Z|[+-]\d{2}:?\d{2})$/i;

/**
 * A time the model or a form gave us. With an offset ("...T20:00:00-06:00", "Z") it's taken as is; a bare wall-clock
 * ("2026-11-03T20:00") is read in the Group's `tz`; a bare date is 9:00 that morning. Invalid -> an Invalid Date.
 */
export function parseInZone(input: string, tz: string): Date {
  const s = input.trim();
  if (HAS_OFFSET.test(s)) return new Date(s);
  const m = WALL.exec(s);
  if (!m) return new Date(Number.NaN);
  const [, y, mo, d, h, mi, sec] = m;
  const w = { year: Number(y), month: Number(mo), day: Number(d), hour: h === undefined ? 9 : Number(h), minute: mi === undefined ? 0 : Number(mi), second: sec ? Number(sec) : 0 };
  if (w.month < 1 || w.month > 12 || w.day < 1 || w.day > 31 || w.hour > 23 || w.minute > 59) return new Date(Number.NaN);
  return zonedTimeToUtc(tz, w);
}

/* ---------- names people say -> IANA ---------- */

const ALIASES: Record<string, string> = {
  chicago: "America/Chicago", central: "America/Chicago", "central time": "America/Chicago", cst: "America/Chicago", cdt: "America/Chicago", ct: "America/Chicago", texas: "America/Chicago", dallas: "America/Chicago", houston: "America/Chicago", austin: "America/Chicago",
  "new york": "America/New_York", nyc: "America/New_York", ny: "America/New_York", eastern: "America/New_York", "eastern time": "America/New_York", est: "America/New_York", edt: "America/New_York", et: "America/New_York", boston: "America/New_York", miami: "America/New_York", atlanta: "America/New_York",
  denver: "America/Denver", mountain: "America/Denver", "mountain time": "America/Denver", mst: "America/Denver", mdt: "America/Denver", arizona: "America/Phoenix", phoenix: "America/Phoenix",
  "los angeles": "America/Los_Angeles", la: "America/Los_Angeles", pacific: "America/Los_Angeles", "pacific time": "America/Los_Angeles", pst: "America/Los_Angeles", pdt: "America/Los_Angeles", pt: "America/Los_Angeles", "san francisco": "America/Los_Angeles", sf: "America/Los_Angeles", seattle: "America/Los_Angeles", california: "America/Los_Angeles",
  toronto: "America/Toronto", vancouver: "America/Vancouver", "mexico city": "America/Mexico_City", "sao paulo": "America/Sao_Paulo", "são paulo": "America/Sao_Paulo",
  london: "Europe/London", uk: "Europe/London", england: "Europe/London", gmt: "Europe/London", bst: "Europe/London", dublin: "Europe/Dublin", ireland: "Europe/Dublin",
  berlin: "Europe/Berlin", germany: "Europe/Berlin", cet: "Europe/Berlin", cest: "Europe/Berlin", paris: "Europe/Paris", france: "Europe/Paris", madrid: "Europe/Madrid", spain: "Europe/Madrid", amsterdam: "Europe/Amsterdam", rome: "Europe/Rome", italy: "Europe/Rome",
  india: "Asia/Kolkata", ist: "Asia/Kolkata", kolkata: "Asia/Kolkata", calcutta: "Asia/Kolkata", mumbai: "Asia/Kolkata", bombay: "Asia/Kolkata", delhi: "Asia/Kolkata", "new delhi": "Asia/Kolkata", bangalore: "Asia/Kolkata", bengaluru: "Asia/Kolkata", chennai: "Asia/Kolkata", hyderabad: "Asia/Kolkata", pune: "Asia/Kolkata",
  dubai: "Asia/Dubai", uae: "Asia/Dubai", singapore: "Asia/Singapore", sgt: "Asia/Singapore", "hong kong": "Asia/Hong_Kong", tokyo: "Asia/Tokyo", japan: "Asia/Tokyo", jst: "Asia/Tokyo", seoul: "Asia/Seoul", korea: "Asia/Seoul", beijing: "Asia/Shanghai", shanghai: "Asia/Shanghai", china: "Asia/Shanghai",
  sydney: "Australia/Sydney", melbourne: "Australia/Melbourne", aest: "Australia/Sydney", auckland: "Pacific/Auckland", "new zealand": "Pacific/Auckland", nz: "Pacific/Auckland",
  utc: "UTC", "utc+0": "UTC", zulu: "UTC",
};

/**
 * "Chicago", "CST", "india", "Europe/Berlin", "new york time" -> an IANA name, or null when it's not one we know
 * (then Roomie asks for a city). US abbreviations win over their namesakes elsewhere (CST is Chicago, IST is India).
 */
export function resolveTimeZone(input: string): string | null {
  const raw = input.trim();
  if (!raw) return null;
  if (raw.includes("/") && isValidTimeZone(raw)) {
    const canonical = supportedZones().find((z) => z.toLowerCase() === raw.toLowerCase());
    return canonical ?? raw;
  }
  const q = raw.toLowerCase().replace(/[.,!?]/g, "").replace(/\s+/g, " ").trim();
  const bare = q.replace(/ (standard |daylight )?(time zone|timezone|time|tz|zone)$/, "").trim();
  if (ALIASES[q]) return ALIASES[q];
  if (ALIASES[bare]) return ALIASES[bare];
  const city = bare.replace(/ /g, "_");
  const hit = supportedZones().find((z) => z.toLowerCase().split("/").pop() === city);
  if (hit) return hit;
  if (/^utc$/i.test(raw) || /^etc\//i.test(raw)) return isValidTimeZone(raw) ? raw : null;
  return null;
}

// Some ICU builds still list the old names; people know the new ones.
const RENAMED: Record<string, string> = { "Asia/Calcutta": "Asia/Kolkata", "Europe/Kiev": "Europe/Kyiv", "Asia/Saigon": "Asia/Ho_Chi_Minh", "Asia/Katmandu": "Asia/Kathmandu", "Asia/Rangoon": "Asia/Yangon" };

let zoneList: string[] | null = null;
/** Every IANA zone the runtime knows (plus UTC). */
export function supportedZones(): string[] {
  if (!zoneList) {
    const intl = Intl as unknown as { supportedValuesOf?: (k: string) => string[] };
    zoneList = [...new Set([...(intl.supportedValuesOf?.("timeZone") ?? []).map((z) => RENAMED[z] ?? z), "UTC"])].filter(isValidTimeZone);
  }
  return zoneList;
}

/** Zones grouped by region ("America", "Europe", ...) for a picker; labels are the city ("New York"). */
export function zonesByRegion(): { region: string; zones: { value: string; label: string }[] }[] {
  const groups = new Map<string, { value: string; label: string }[]>();
  for (const z of supportedZones()) {
    const [region, ...rest] = z.split("/");
    const key = rest.length ? region : "Other";
    const label = (rest.length ? rest.join(" / ") : z).replace(/_/g, " ");
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push({ value: z, label });
  }
  return [...groups.entries()]
    .sort(([a], [b]) => (a === "Other" ? 1 : b === "Other" ? -1 : a.localeCompare(b)))
    .map(([region, zones]) => ({ region, zones: zones.sort((a, b) => a.label.localeCompare(b.label)) }));
}
