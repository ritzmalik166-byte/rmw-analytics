import { env } from '../config/env.js';
import { logger } from '../config/logger.js';

let transporter = null;

export const mailEnabled = () => Boolean(env.SMTP_HOST);

async function getTransporter() {
  if (!mailEnabled()) return null;
  if (!transporter) {
    const { default: nodemailer } = await import('nodemailer');
    transporter = nodemailer.createTransport({
      host: env.SMTP_HOST, port: env.SMTP_PORT, secure: env.SMTP_SECURE,
      auth: env.SMTP_USER ? { user: env.SMTP_USER, pass: env.SMTP_PASSWORD } : undefined,
    });
  }
  return transporter;
}

/** Send an email; logs and returns false when SMTP is not configured or delivery fails. */
export async function sendMail({ to, subject, text, html, attachments }) {
  const t = await getTransporter();
  if (!t) {
    logger.info({ to, subject }, 'Email skipped (SMTP not configured)');
    return false;
  }
  try {
    await t.sendMail({ from: env.MAIL_FROM, to, subject, text, html, attachments });
    return true;
  } catch (err) {
    logger.error({ err: err.message, subject }, 'Email delivery failed');
    return false;
  }
}
