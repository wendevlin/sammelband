import nodemailer from "nodemailer";
import { config } from "./config";

type SendMail = (opts: {
  to: string;
  subject: string;
  text: string;
  html?: string;
}) => Promise<void>;

function buildTransport(): SendMail {
  if (config.SMTP.HOST && config.SMTP.USER && config.SMTP.PASS) {
    const transporter = nodemailer.createTransport({
      host: config.SMTP.HOST,
      port: config.SMTP.PORT,
      secure: config.SMTP.PORT === 465,
      auth: { user: config.SMTP.USER, pass: config.SMTP.PASS },
    });
    return async (opts) => {
      await transporter.sendMail({
        from: config.SMTP.FROM ?? config.SMTP.USER,
        ...opts,
      });
    };
  }
  // Dev fallback: log to console so magic links / reset links are usable without SMTP.
  return async (opts) => {
    console.log(`[mailer:dev] to=${opts.to} subject=${JSON.stringify(opts.subject)}\n${opts.text}`);
  };
}

export const sendMail: SendMail = buildTransport();
