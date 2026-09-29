import { describe, expect, test } from "bun:test";
import de from "../../web/messages/de.json";
import en from "../../web/messages/en.json";
import { ERRORS } from "../src/lib/error-codes";

describe("error codes", () => {
  // The frontend shows m.error_<code>() and falls back to the server's English message.
  test.each([
    ["en", en],
    ["de", de],
  ] as const)("every code has a %s translation", (_, messages) => {
    const missing = Object.keys(ERRORS).filter((code) => !(`error_${code}` in messages));
    expect(missing).toEqual([]);
  });
});
