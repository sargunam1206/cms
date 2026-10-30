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

/** True when real outgoing mail is set up (SMTP_HOST). Otherwise messages are only written to the server log. */
export const mailConfigured = () => !!transport;

export interface Attachment {
  filename: string;
  content: Buffer;
  contentType?: string;
}

/**
 * Sends mail through SMTP. With no SMTP configured (local dev) the message is logged so a link can be copied.
 * Resolves to true only when the message was actually handed to a mail server.
 */
export async function sendMail(to: string, subject: string, text: string, attachments: Attachment[] = []): Promise<boolean> {
  if (!transport) {
    logger.warn({ to, subject, text, attachments: attachments.map((a) => a.filename) }, 'SMTP not configured; email not sent (shown here for development)');
    return false;
  }
  await transport.sendMail({ from: env.MAIL_FROM, to, subject, text, attachments });
  return true;
}
