// Time zone math without a date library, via Intl.

export function isValidTimeZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/** The server's own time zone (UTC in most containers). */
export function serverTimeZone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
}

/** Offset of `tz` from UTC at the instant `utc`, in ms (positive east of Greenwich). */
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

/**
 * The last millisecond of calendar day `date` ("YYYY-MM-DD") in time zone
 * `tz`, as epoch ms. Daylight saving changes are accounted for.
 */
export function endOfDayIn(date: string, tz: string): number {
  const [y, m, d] = date.split("-").map(Number) as [number, number, number];
  const wall = Date.UTC(y, m - 1, d, 23, 59, 59, 999);
  // First guess with the offset at "wall as if UTC", then correct with the
  // offset at the guessed instant (they differ near a DST switch).
  const guess = wall - offsetMs(wall, tz);
  return wall - offsetMs(guess, tz);
}
