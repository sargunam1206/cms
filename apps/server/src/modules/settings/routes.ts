import { Router } from 'express';
import { z } from 'zod';
import { PERMISSIONS, dateStr, workCalendarSchema } from '@cms/shared';
import { requirePermission } from '../../middleware/auth';
import { validate } from '../../middleware/validate';
import { ah } from '../../utils/asyncHandler';
import { badRequest } from '../../utils/errors';
import { todayStr } from '../../utils/time';
import { Setting } from './model';
import { SETTING_KEYS, getWorkCalendar, setSetting } from './service';

export const settingsRouter = Router();

/** Everyone may read the work calendar (shift times are shown on the check-in widget). */
settingsRouter.get(
  '/work-calendar',
  ah(async (_req, res) => {
    res.json(await getWorkCalendar(todayStr()));
  }),
);

settingsRouter.get(
  '/work-calendar/history',
  requirePermission(PERMISSIONS.SETTINGS_MANAGE),
  ah(async (_req, res) => {
    res.json(await Setting.find({ key: SETTING_KEYS.WORK_CALENDAR }).sort({ effectiveFrom: -1 }).lean());
  }),
);

settingsRouter.put(
  '/work-calendar',
  requirePermission(PERMISSIONS.SETTINGS_MANAGE),
  validate(z.object({ value: workCalendarSchema, effectiveFrom: dateStr.optional() })),
  ah(async (req, res) => {
    const { value, effectiveFrom = todayStr() } = req.body;
    if (value.minHoursHalfDay > value.minHoursFullDay) throw badRequest('Half-day hours cannot exceed full-day hours');
    if (value.shiftEnd <= value.shiftStart) throw badRequest('Shift end must be after shift start');
    await setSetting(SETTING_KEYS.WORK_CALENDAR, value, effectiveFrom, req.user!.id);
    res.json(await getWorkCalendar(todayStr()));
  }),
);
