import { DEFAULT_ENQUIRY_OPTIONS, LOST, WON, enquiryOptionsSchema, type EnquiryOptions } from '@cms/shared';
import { todayStr } from '../../utils/time';
import { getSetting } from '../settings/service';
import { notify, usersOfEmployees } from '../notifications/service';
import { Enquiry } from './model';

export const OPTIONS_KEY = 'enquiryOptions';

export async function getOptions(): Promise<EnquiryOptions> {
  const parsed = enquiryOptionsSchema.safeParse(await getSetting(OPTIONS_KEY));
  return parsed.success ? parsed.data : DEFAULT_ENQUIRY_OPTIONS;
}

export const isClosed = (status: string) => status === WON || status === LOST;
export const allStatuses = (o: EnquiryOptions) => [...o.stages, WON, LOST];

/**
 * Remind owners of enquiries whose follow-up is due today or overdue. Safe to run more than once a day: an owner who
 * still has an unread reminder for the same enquiry and day is not reminded again.
 */
export async function notifyFollowUps(today = todayStr()) {
  const due = await Enquiry.find({ status: { $nin: [WON, LOST] }, nextFollowUp: { $lte: today } }).select('name company owner nextFollowUp').lean();
  let sent = 0;
  for (const e of due) {
    const overdue = e.nextFollowUp! < today;
    await notify({
      type: 'enquiry.followup',
      to: await usersOfEmployees([e.owner]),
      title: `Follow up with ${e.name}${e.company ? ` (${e.company})` : ''}`,
      body: overdue ? `Was due ${e.nextFollowUp}` : 'Due today',
      link: `/enquiries/${e._id}`,
      entity: { kind: 'Enquiry', id: e._id },
      dedupeKey: `${e._id}:${today}`,
    });
    sent++;
  }
  return sent;
}
