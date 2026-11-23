import { MEETING_REMINDER_MINUTES, MEETING_TYPE_LABEL, type MeetingType } from '@cms/shared';
import dayjs from 'dayjs';
import { now } from '../../utils/time';
import { notify, usersOfEmployees } from '../notifications/service';
import { Meeting } from './model';

export const whenText = (m: { date: string; start: string; end: string }) => `${dayjs(m.date).format('ddd DD MMM')}, ${m.start}–${m.end}`;
export const typeText = (t: string) => MEETING_TYPE_LABEL[t as MeetingType] ?? t;

/**
 * Remind everyone in a meeting shortly before it starts. Each meeting is claimed atomically (reminderSentAt), so a
 * second server process or an overlapping run never sends the reminder twice.
 */
export async function notifyMeetingReminders() {
  const t = now();
  const soon = new Date(t.getTime() + MEETING_REMINDER_MINUTES * 60000);
  const due = await Meeting.find({ status: 'scheduled', reminderSentAt: null, startAt: { $gt: t, $lte: soon } }).select('_id').lean();
  let sent = 0;
  for (const { _id } of due) {
    const m = await Meeting.findOneAndUpdate({ _id, reminderSentAt: null }, { $set: { reminderSentAt: t } }, { new: true }).lean();
    if (!m) continue;
    await notify({
      type: 'meeting.reminder',
      to: await usersOfEmployees([m.organizer, ...m.attendees]),
      title: `Starting soon: ${m.title}`,
      body: `${whenText(m)}${m.location ? ` · ${m.location}` : ''}${m.link ? `\nJoin: ${m.link}` : ''}`,
      link: `/meetings/${m._id}`,
      entity: { kind: 'Meeting', id: m._id },
    });
    sent++;
  }
  return sent;
}
