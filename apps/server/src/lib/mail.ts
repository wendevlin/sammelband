import nodemailer from "nodemailer";
import { config } from "../config";

// Outgoing email over SMTP. Optional: without SMTP_HOST nothing is sent and
// features that need mail (password reset) are off.

export type Mail = { to: string; subject: string; text: string; html: string };

type Transport = { sendMail(mail: Mail & { from: string }): Promise<unknown> };

let transport: Transport | null = config.SMTP
  ? nodemailer.createTransport({
      host: config.SMTP.host,
      port: config.SMTP.port,
      secure: config.SMTP.secure,
      auth: config.SMTP.user ? { user: config.SMTP.user, pass: config.SMTP.password } : undefined,
    })
  : null;
let from = config.SMTP?.from ?? "Sammelband <sammelband@localhost>";

export function mailEnabled(): boolean {
  return transport !== null;
}

/**
 * Send without waiting: callers answer the request right away, whether the
 * address exists or the SMTP server is slow or down (no timing or error
 * differences to probe). Failures are logged.
 */
export function sendMailInBackground(mail: Mail): void {
  if (!transport) {
    console.error("[mail] not configured, dropped:", mail.subject);
    return;
  }
  transport.sendMail({ from, ...mail }).catch((err) => {
    console.error("[mail] sending failed", { to: mail.to, subject: mail.subject, err });
  });
}

/** Log at startup whether the SMTP server accepts our connection. */
export async function checkMailOnStartup(): Promise<void> {
  if (!config.SMTP || !transport) return;
  const smtp = transport as unknown as { verify(): Promise<unknown> };
  try {
    await smtp.verify();
    console.log(`[mail] SMTP ready (${config.SMTP.host}:${config.SMTP.port})`);
  } catch (err) {
    console.error(`[mail] SMTP ${config.SMTP.host}:${config.SMTP.port} not reachable`, err);
  }
}

/** Tests: capture mail instead of sending it (null turns mail off). */
export function setMailTransport(t: Transport | null, sender = from): void {
  transport = t;
  from = sender;
}
