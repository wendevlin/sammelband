import { ApiError } from "#lib/api.ts";
import { m } from "#lib/paraglide/messages.js";
import {
  getLocale,
  type Locale,
  locales,
  localStorageKey,
  setLocale,
} from "#lib/paraglide/runtime.js";

export { getLocale, type Locale, locales, m };

/** Language names in their own language, for pickers. */
export const LOCALE_NAMES: Record<Locale, string> = { en: "English", de: "Deutsch" };

type Message = (params?: Record<string, unknown>) => string;

// The `error_*` messages, looked up by code at runtime. Only these are imported
// here: indexing `m` by a computed key would keep every message in the shared
// chunk, where the bundler otherwise splits them per page.
const errorMessages: Record<string, Message> = Object.assign(
  {},
  ...Object.values(
    import.meta.glob<Record<string, Message>>("./paraglide/messages/error_*.js", { eager: true }),
  ),
);

/**
 * A user-facing text for an error. Backend and better-auth errors carry a
 * code: `error_<code>` from the messages when it exists (with the error's
 * params), else the English message the server sent.
 */
export function errorText(e: unknown): string {
  if (e instanceof ApiError) {
    const message = e.code ? errorMessages[`error_${e.code.toLowerCase()}`] : undefined;
    if (message) return message(e.params ?? {});
    return e.message;
  }
  if (e instanceof Error && e.message) return e.message;
  return m.error_unknown();
}

/** The text for an error code stored with a record (e.g. a failed export). */
export function errorCodeText(code: string | null): string {
  const message = code ? errorMessages[`error_${code.toLowerCase()}`] : undefined;
  return message ? message({}) : m.error_unknown();
}

/** Switch the UI language (reloads the page so every text updates). */
export function switchLocale(locale: Locale): void {
  if (locale !== getLocale()) setLocale(locale);
}

/** Forget a saved choice and follow the browser's languages again. */
export function followBrowserLocale(): void {
  try {
    localStorage.removeItem(localStorageKey);
  } catch {
    /* storage unavailable */
  }
  location.reload();
}

/** Apply the language saved in the user's account, if any. */
export function applyAccountLocale(locale: string | null | undefined): void {
  if (locale && (locales as readonly string[]).includes(locale)) switchLocale(locale as Locale);
}

/** A date in the UI language, e.g. "Sep 30, 2026" / "30. Sept. 2026". */
export function formatDate(ms: number | string): string {
  return new Date(ms).toLocaleDateString(getLocale(), { dateStyle: "medium" });
}

/** Keep <html lang> in sync (screen readers, hyphenation). */
export function setDocumentLanguage(): void {
  document.documentElement.lang = getLocale();
}
