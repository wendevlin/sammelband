import { describe, expect, test } from "bun:test";
import { endOfDayIn, isValidTimeZone } from "../src/lib/timezone";

describe("time zones", () => {
  test("end of a day in different zones, across DST", () => {
    const iso = (ms: number) => new Date(ms).toISOString();
    expect(iso(endOfDayIn("2026-09-30", "UTC"))).toBe("2026-09-30T23:59:59.999Z");
    expect(iso(endOfDayIn("2026-09-30", "Europe/Vienna"))).toBe("2026-09-30T21:59:59.999Z"); // CEST
    expect(iso(endOfDayIn("2026-12-31", "Europe/Vienna"))).toBe("2026-12-31T22:59:59.999Z"); // CET
    expect(iso(endOfDayIn("2026-12-31", "America/New_York"))).toBe("2027-01-01T04:59:59.999Z");
    expect(iso(endOfDayIn("2026-03-29", "Europe/Vienna"))).toBe("2026-03-29T21:59:59.999Z"); // switch day
    expect(iso(endOfDayIn("2026-06-15", "Asia/Kolkata"))).toBe("2026-06-15T18:29:59.999Z"); // +5:30
  });

  test("validates zone names", () => {
    expect(isValidTimeZone("Europe/Vienna")).toBe(true);
    expect(isValidTimeZone("Mars/Olympus")).toBe(false);
  });
});
