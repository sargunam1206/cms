import dayjs from 'dayjs';
import { PERMISSIONS } from '@cms/shared';
import { todayStr } from '../../utils/time';
import { notify, usersOfEmployees, usersWithPermission } from '../notifications/service';
import { ConfidentialDoc, ConfidentialFolder } from './model';

/**
 * Daily: tell a folder's editors and the confidential managers about documents inside their reminder window or past
 * their date. The dedupe key (document + date) means one unread reminder per person, not one every morning.
 */
export async function notifyExpiringDocuments() {
  const today = todayStr();
  const docs = await ConfidentialDoc.find({ expiresOn: { $ne: null } }).select('title folder expiresOn remindDays').lean();
  const due = docs.filter((d) => dayjs(d.expiresOn!).subtract(d.remindDays ?? 30, 'day').format('YYYY-MM-DD') <= today);
  if (!due.length) return 0;
  const managers = await usersWithPermission(PERMISSIONS.CONFIDENTIAL_MANAGE);
  const folders = new Map((await ConfidentialFolder.find({ _id: { $in: due.map((d) => d.folder) } }).select('name editors').lean()).map((f) => [String(f._id), f]));
  for (const d of due) {
    const f = folders.get(String(d.folder));
    const past = d.expiresOn! < today;
    await notify({
      type: 'document.expiry',
      to: [...managers, ...(await usersOfEmployees(f?.editors ?? []))],
      title: `${past ? 'Expired' : 'Due soon'}: ${d.title}`,
      body: `${f?.name ?? 'Confidential'} · ${past ? 'expired on' : 'due on'} ${dayjs(d.expiresOn!).format('DD MMM YYYY')}`,
      link: `/confidential?folder=${d.folder}`,
      entity: { kind: 'ConfidentialDoc', id: d._id },
      dedupeKey: `${d._id}:${d.expiresOn}`,
    });
  }
  return due.length;
}
