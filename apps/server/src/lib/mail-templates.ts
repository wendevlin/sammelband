import type { Mail } from "./mail";

// Emails, in English and German like the web app. The web app's messages
// live in apps/web/messages; mail is sent by the server, so its few texts are
// here.

export type MailLocale = "en" | "de";

/** The account's language, else the browser's (Accept-Language), else English. */
export function mailLocale(
  accountLocale: string | null | undefined,
  request?: Request,
): MailLocale {
  if (accountLocale === "de" || accountLocale === "en") return accountLocale;
  const accepted = request?.headers.get("accept-language") ?? "";
  for (const part of accepted.split(",")) {
    const lang = part.trim().slice(0, 2).toLowerCase();
    if (lang === "de" || lang === "en") return lang;
  }
  return "en";
}

const escapeHtml = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

/** Plain text plus a minimal HTML version with the link as a button. */
function build(
  to: string,
  subject: string,
  lines: string[],
  link: { url: string; label: string },
  footer: string,
): Mail {
  const text = [...lines, "", link.url, "", footer].join("\n");
  const html = `<!doctype html>
<html><body style="font-family: system-ui, sans-serif; color: #2b2320; line-height: 1.5">
${lines.map((l) => `<p>${escapeHtml(l)}</p>`).join("\n")}
<p><a href="${escapeHtml(link.url)}" style="display: inline-block; padding: 10px 18px; border-radius: 8px; background: #7B1E2E; color: #fff; text-decoration: none">${escapeHtml(link.label)}</a></p>
<p style="color: #7a6e69; font-size: 13px">${escapeHtml(footer)}</p>
</body></html>`;
  return { to, subject, text, html };
}

export function passwordResetMail(
  locale: MailLocale,
  user: { email: string; name: string },
  url: string,
): Mail {
  if (locale === "de") {
    return build(
      user.email,
      "Dein Sammelband-Passwort zurücksetzen",
      [
        `Hallo ${user.name},`,
        "jemand (hoffentlich du) möchte das Passwort für dein Sammelband-Konto zurücksetzen. Über diesen Link wählst du ein neues. Er gilt eine Stunde und nur einmal.",
      ],
      { url, label: "Neues Passwort wählen" },
      "Warst du das nicht? Dann ignoriere diese E-Mail, dein Passwort bleibt, wie es ist.",
    );
  }
  return build(
    user.email,
    "Reset your Sammelband password",
    [
      `Hi ${user.name},`,
      "someone (hopefully you) asked to reset the password of your Sammelband account. Use this link to choose a new one. It works once, within one hour.",
    ],
    { url, label: "Choose a new password" },
    "Wasn't you? Then ignore this email; your password stays as it is.",
  );
}
