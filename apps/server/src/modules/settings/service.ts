import { DEFAULT_WORK_CALENDAR, workCalendarSchema, type WorkCalendarSettings } from '@cms/shared';
import type { Types } from 'mongoose';
import { Setting } from './model';
import { audit } from '../audit/model';

export const SETTING_KEYS = {
  WORK_CALENDAR: 'workCalendar',
} as const;

export async function getSetting<T>(key: string, asOf = '9999-12-31'): Promise<T | null> {
  const doc = await Setting.findOne({ key, effectiveFrom: { $lte: asOf } }).sort({ effectiveFrom: -1 }).lean();
  return (doc?.value as T) ?? null;
}

export async function setSetting(key: string, value: unknown, effectiveFrom: string, actor?: Types.ObjectId) {
  const before = await getSetting(key, effectiveFrom);
  const doc = await Setting.findOneAndUpdate(
    { key, effectiveFrom },
    { value, updatedBy: actor },
    { upsert: true, new: true },
  );
  await audit({ actor, action: 'settings.update', entity: 'Setting', entityId: key, before, after: { value, effectiveFrom } });
  return doc;
}

export async function getWorkCalendar(asOf?: string): Promise<WorkCalendarSettings> {
  const v = await getSetting<WorkCalendarSettings>(SETTING_KEYS.WORK_CALENDAR, asOf);
  // Defaults fill in settings saved before a field existed, so older records keep working
  const stored: Partial<WorkCalendarSettings> = v ?? {};
  // Older records used "late marks = 0" to mean off; that is now the explicit lateLopEnabled switch
  const legacyOff = stored.lateMarksPerHalfDay === 0 && stored.lateLopEnabled === undefined;
  return workCalendarSchema.parse({
    ...DEFAULT_WORK_CALENDAR,
    ...stored,
    ...(legacyOff ? { lateLopEnabled: false, lateMarksPerHalfDay: DEFAULT_WORK_CALENDAR.lateMarksPerHalfDay } : {}),
  });
}
