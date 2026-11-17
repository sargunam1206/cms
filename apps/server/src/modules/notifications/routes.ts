import { Router } from 'express';
import { z } from 'zod';
import { NOTIFICATION_TYPES, notificationPrefsSchema, objectId } from '@cms/shared';
import { validate } from '../../middleware/validate';
import { ah } from '../../utils/asyncHandler';
import { notFound } from '../../utils/errors';
import { now } from '../../utils/time';
import { Notification, NotificationPref } from './model';

export const notificationsRouter = Router();

notificationsRouter.get(
  '/',
  validate(z.object({ unread: z.enum(['true', 'false']).optional(), page: z.coerce.number().int().min(1).default(1), limit: z.coerce.number().int().min(1).max(100).default(20) }), 'query'),
  ah(async (req, res) => {
    const { unread, page, limit } = req.query as unknown as { unread?: string; page: number; limit: number };
    const filter: Record<string, unknown> = { user: req.user!.id };
    if (unread === 'true') filter.readAt = null;
    const [items, total, unreadCount] = await Promise.all([
      Notification.find(filter).sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit).lean(),
      Notification.countDocuments(filter),
      Notification.countDocuments({ user: req.user!.id, readAt: null }),
    ]);
    res.json({ items, total, page, limit, unread: unreadCount });
  }),
);

notificationsRouter.get('/unread-count', ah(async (req, res) => res.json({ unread: await Notification.countDocuments({ user: req.user!.id, readAt: null }) })));

notificationsRouter.post(
  '/read-all',
  ah(async (req, res) => {
    const r = await Notification.updateMany({ user: req.user!.id, readAt: null }, { readAt: now() });
    res.json({ updated: r.modifiedCount });
  }),
);

/** The kinds of notification, for the preferences screen. */
notificationsRouter.get('/types', (_req, res) => res.json(NOTIFICATION_TYPES));

notificationsRouter.get(
  '/prefs',
  ah(async (req, res) => {
    const p = await NotificationPref.findOne({ user: req.user!.id }).lean();
    res.json({ emailMuted: p?.emailMuted ?? [], inAppMuted: p?.inAppMuted ?? [] });
  }),
);

notificationsRouter.put(
  '/prefs',
  validate(notificationPrefsSchema),
  ah(async (req, res) => {
    const p = await NotificationPref.findOneAndUpdate({ user: req.user!.id }, { user: req.user!.id, ...req.body }, { upsert: true, new: true }).lean();
    res.json({ emailMuted: p!.emailMuted, inAppMuted: p!.inAppMuted });
  }),
);

/** Only your own notifications can be marked read; someone else's looks like it does not exist. */
notificationsRouter.post(
  '/:id/read',
  validate(z.object({ id: objectId }), 'params'),
  ah(async (req, res) => {
    const n = await Notification.findOneAndUpdate({ _id: req.params.id, user: req.user!.id, readAt: null }, { readAt: now() }, { new: true }).lean();
    if (!n && !(await Notification.exists({ _id: req.params.id, user: req.user!.id }))) throw notFound('Notification');
    res.json({ ok: true });
  }),
);
