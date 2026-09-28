// Time zone helpers (same math as src/lib/timezone.ts on the server).

/** The browser's time zone, e.g. "Europe/Vienna". */
export const browserTimeZone = () => Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";

function offsetMs(utc: number, tz: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(new Date(utc));
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  const wall = Date.UTC(
    get("year"),
    get("month") - 1,
    get("day"),
    get("hour"),
    get("minute"),
    get("second"),
  );
  return wall - Math.floor(utc / 1000) * 1000;
}

/** Last millisecond of `date` ("YYYY-MM-DD") in `tz`, as epoch ms. */
export function endOfDayIn(date: string, tz: string): number {
  const [y, m, d] = date.split("-").map(Number) as [number, number, number];
  const wall = Date.UTC(y, m - 1, d, 23, 59, 59, 999);
  return wall - offsetMs(wall - offsetMs(wall, tz), tz);
}

/** "Sep 30, 2026, 23:59 CEST": a moment as seen in `tz`. */
export function formatInZone(ms: number, tz: string): string {
  // Explicit fields: browsers reject dateStyle/timeStyle combined with timeZoneName.
  return new Intl.DateTimeFormat(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
    timeZone: tz,
    timeZoneName: "short",
  }).format(new Date(ms));
}
