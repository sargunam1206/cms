import dayjs from 'dayjs';
import { env } from '../../config/env';
import { logger } from '../../config/logger';
import { conflict } from '../../utils/errors';
import { mailConfigured, sendMail } from '../../utils/mailer';
import { now } from '../../utils/time';
import { audit } from '../audit/model';
import { Employee } from '../employees/model';
import { User } from '../users/model';
import { payslipPdf } from './documents';
import { Payslip } from './model';
import { getRun } from './runs';
import { payslipLayout } from './service';

export interface EmailSummary {
  sent: number;
  alreadySent: number;
  failed: { name: string; code: string; reason: string }[];
  noEmail: { name: string; code: string }[];
}

/**
 * Emails each employee their own payslip PDF. Only approved runs. Payslips already emailed are skipped unless
 * `resend` is true, so pressing the button twice never double-sends.
 */
export async function emailRunPayslips(runId: string, actor: unknown, resend = false): Promise<EmailSummary> {
  const run = await getRun(runId);
  if (run.status !== 'approved') throw conflict('Payslips can be emailed once the run is approved');
  if (!mailConfigured()) throw conflict('Email is not set up. Add the SMTP_* settings in apps/server/.env, then restart the server');

  const layout = await payslipLayout();
  const slips = await Payslip.find({ run: run._id }).sort({ 'person.code': 1 }).lean();
  const summary: EmailSummary = { sent: 0, alreadySent: 0, failed: [], noEmail: [] };
  const monthName = dayjs(`${run.month}-01`).format('MMMM YYYY');

  for (const s of slips) {
    const who = { name: s.person?.name ?? '', code: s.person?.code ?? '' };
    if (s.emailedAt && !resend) {
      summary.alreadySent++;
      continue;
    }
    const emp = await Employee.findById(s.employee).select('email').lean();
    const login = emp?.email ? null : await User.findOne({ employee: s.employee }).select('email').lean();
    const to = emp?.email || login?.email;
    if (!to) {
      summary.noEmail.push(who);
      continue;
    }
    try {
      const pdf = await payslipPdf(s as never, env.COMPANY_NAME, layout);
      const delivered = await sendMail(
        to,
        `Your payslip for ${monthName}`,
        `Hello ${who.name},\n\nYour payslip for ${monthName} is attached.\nIf anything looks wrong, please contact HR.\n\n${env.COMPANY_NAME}`,
        [{ filename: `payslip-${run.month}.pdf`, content: pdf, contentType: 'application/pdf' }],
      );
      if (!delivered) throw new Error('Mail server not available');
      await Payslip.updateOne({ _id: s._id }, { emailedAt: now() });
      summary.sent++;
    } catch (e) {
      logger.error({ err: e, employee: who.code }, 'Payslip email failed');
      summary.failed.push({ ...who, reason: (e as Error).message });
    }
  }
  await audit({
    actor: actor as never,
    action: 'payroll.email_payslips',
    entity: 'PayrollRun',
    entityId: run._id,
    meta: { month: run.month, sent: summary.sent, failed: summary.failed.length, noEmail: summary.noEmail.length, resend },
  });
  return summary;
}
