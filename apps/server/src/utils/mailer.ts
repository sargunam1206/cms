import nodemailer from 'nodemailer';
import { env } from '../config/env';
import { logger } from '../config/logger';

const transport = env.SMTP_HOST
  ? nodemailer.createTransport({
      host: env.SMTP_HOST,
      port: env.SMTP_PORT,
      secure: env.SMTP_PORT === 465,
      auth: env.SMTP_USER ? { user: env.SMTP_USER, pass: env.SMTP_PASS } : undefined,
    })
  : null;

/** Sends mail through SMTP; with no SMTP configured (local dev) the message is logged so the link can be copied. */
export async function sendMail(to: string, subject: string, text: string) {
  if (!transport) {
    logger.warn({ to, subject, text }, 'SMTP not configured; email not sent (shown here for development)');
    return;
  }
  await transport.sendMail({ from: env.MAIL_FROM, to, subject, text });
}
