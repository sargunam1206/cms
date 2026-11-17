import type { Types } from 'mongoose';
import { NOTIFICATION_TYPES, PERMISSIONS, type NotificationType, type Permission } from '@cms/shared';
import { env } from '../../config/env';
import { logger } from '../../config/logger';
import { sendMail } from '../../utils/mailer';
import { Employee } from '../employees/model';
import { Role, User } from '../users/model';
import { Notification, NotificationPref } from './model';
import { emitToUser } from './realtime';

type Id = Types.ObjectId | string;

export interface NotifyInput {
  type: NotificationType;
  /** User ids to tell. Duplicates and the person who caused the event are dropped. */
  to: Id[];
  title: string;
  body?: string;
  /** Path inside the app that the notification opens. */
  link?: string;
  /** Who did it; never notified about their own action. */
  actor?: Id | null;
  entity?: { kind: string; id: unknown };
  /** Skip if this person already has an unread notification of this type with the same key (used by repeating jobs). */
  dedupeKey?: string;
}

const TYPE = new Map<string, (typeof NOTIFICATION_TYPES)[number]>(NOTIFICATION_TYPES.map((t) => [t.key, t]));

/**
 * Tell people something happened: a bell entry (pushed live to anyone online) and, for events that need action,
 * an email. It never throws: a notification problem must not undo the action that caused it.
 */
export async function notify(input: NotifyInput) {
  try {
    const kind = TYPE.get(input.type);
    if (!kind) return;
    const ids = [...new Set(input.to.map(String))].filter((u) => u !== String(input.actor ?? ''));
    if (!ids.length) return;
    const [users, prefs] = await Promise.all([
      User.find({ _id: { $in: ids }, status: 'active' }).select('email').lean(),
      NotificationPref.find({ user: { $in: ids } }).lean(),
    ]);
    const prefOf = new Map(prefs.map((p) => [String(p.user), p]));

    for (const u of users) {
      const pref = prefOf.get(String(u._id));
      if (!pref?.inAppMuted.includes(input.type)) {
        if (input.dedupeKey && (await Notification.exists({ user: u._id, type: input.type, dedupeKey: input.dedupeKey, readAt: null }))) continue;
        const doc = await Notification.create({
          user: u._id,
          type: input.type,
          title: input.title,
          body: input.body,
          link: input.link,
          entity: input.entity ? { kind: input.entity.kind, id: String(input.entity.id) } : undefined,
          dedupeKey: input.dedupeKey,
        });
        emitToUser(u._id, 'notification', { _id: doc._id, type: doc.type, title: doc.title, body: doc.body, link: doc.link, createdAt: doc.createdAt });
      }
      if (kind.email && !pref?.emailMuted.includes(input.type) && u.email) {
        const url = input.link ? `${env.CLIENT_ORIGIN}${input.link}` : env.CLIENT_ORIGIN;
        // Not awaited: a slow mail server must not slow the request that caused the event
        void sendMail(u.email, input.title, `${input.title}\n${input.body ? `\n${input.body}\n` : ''}\nOpen it: ${url}\n\nYou can turn these emails off under Notifications > Preferences.`).catch((err) =>
          logger.error({ err, to: u.email, type: input.type }, 'Notification email failed'),
        );
      }
    }
  } catch (err) {
    logger.error({ err, type: input.type }, 'Notification failed');
  }
}

// ---------- Who to tell ----------

/** Logins linked to these employees. */
export async function usersOfEmployees(employeeIds: (Id | null | undefined)[]) {
  const ids = employeeIds.filter(Boolean) as Id[];
  if (!ids.length) return [];
  return (await User.find({ employee: { $in: ids }, status: 'active' }).select('_id').lean()).map((u) => u._id);
}

/** Everyone whose role holds a permission (for example every payroll approver). */
export async function usersWithPermission(permission: Permission) {
  const roles = await Role.find({ permissions: permission }).select('_id').lean();
  return (await User.find({ role: { $in: roles.map((r) => r._id) }, status: 'active' }).select('_id').lean()).map((u) => u._id);
}

export async function employeeName(employeeId: Id | null | undefined) {
  if (!employeeId) return 'Someone';
  return (await Employee.findById(employeeId).select('name').lean())?.name ?? 'Someone';
}

/**
 * Who decides an employee's requests: their reporting manager, or, when they have none, whoever manages leave
 * (HR). Mirrors how approvals are routed in the app.
 */
export async function approversOf(employeeId: Id) {
  const emp = await Employee.findById(employeeId).select('manager').lean();
  const manager = emp?.manager ? await usersOfEmployees([emp.manager]) : [];
  return manager.length ? manager : usersWithPermission(PERMISSIONS.LEAVE_MANAGE);
}
