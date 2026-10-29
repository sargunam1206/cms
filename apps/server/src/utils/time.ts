import dayjs, { type Dayjs } from 'dayjs';
import utc from 'dayjs/plugin/utc';
import timezone from 'dayjs/plugin/timezone';
import { env } from '../config/env';

dayjs.extend(utc);
dayjs.extend(timezone);

export const TZ = env.TZ_NAME;

/**
 * The only source of "now" in the app. Attendance must never trust client clocks.
 * Tests can override via setClock().
 */
let clock: () => Date = () => new Date();
export const now = () => clock();
export const setClock = (fn: () => Date) => {
  clock = fn;
};
export const resetClock = () => {
  clock = () => new Date();
};

export const inTz = (d: Date | string | Dayjs) => dayjs(d).tz(TZ);

/** Calendar date (YYYY-MM-DD) in office timezone. */
export const toDateStr = (d: Date) => inTz(d).format('YYYY-MM-DD');
export const todayStr = () => toDateStr(now());
export const currentMonthStr = () => inTz(now()).format('YYYY-MM');

/** Combine a YYYY-MM-DD date and HH:mm time in office timezone into a Date. */
export const zonedDateTime = (date: string, time: string) => dayjs.tz(`${date} ${time}`, 'YYYY-MM-DD HH:mm', TZ).toDate();

export const minutesBetween = (a: Date, b: Date) => Math.max(0, Math.round((b.getTime() - a.getTime()) / 60000));

export const monthOf = (date: string) => date.slice(0, 7);

/** All YYYY-MM-DD dates in a YYYY-MM month. */
export function datesInMonth(month: string): string[] {
  const start = dayjs(`${month}-01`);
  const n = start.daysInMonth();
  return Array.from({ length: n }, (_, i) => start.add(i, 'day').format('YYYY-MM-DD'));
}

/** Inclusive list of dates between two YYYY-MM-DD strings. */
export function datesBetween(from: string, to: string): string[] {
  const out: string[] = [];
  for (let d = dayjs(from); !d.isAfter(dayjs(to)); d = d.add(1, 'day')) out.push(d.format('YYYY-MM-DD'));
  return out;
}

export const dayOfWeek = (date: string) => dayjs(date).day();

/** 1-based occurrence of this weekday within its month (e.g. 2 for the 2nd Saturday). */
export const weekdayOccurrence = (date: string) => Math.ceil(dayjs(date).date() / 7);
