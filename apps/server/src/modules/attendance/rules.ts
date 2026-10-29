/**
 * Pure attendance rules: no DB access, so they are fully unit-testable.
 * All inputs come from the work-calendar settings; nothing is hard-coded.
 */
import type { AttendanceStatus, WorkCalendarSettings } from '@cms/shared';
import { dayOfWeek, minutesBetween, weekdayOccurrence, zonedDateTime } from '../../utils/time';

export type DayType = 'working' | 'weekoff' | 'holiday';

export function dayType(date: string, cal: WorkCalendarSettings, holidays: Set<string>): DayType {
  if (holidays.has(date)) return 'holiday';
  const dow = dayOfWeek(date);
  if (dow === 6 && !cal.weeklyOffs.includes(6)) {
    if (cal.saturdayRule === 'off') return 'weekoff';
    if (cal.saturdayRule === 'alternate' && cal.saturdaysOff.includes(weekdayOccurrence(date))) return 'weekoff';
    return 'working';
  }
  return cal.weeklyOffs.includes(dow) ? 'weekoff' : 'working';
}

export interface DayEvaluation {
  workedMinutes: number;
  lateMinutes: number;
  earlyMinutes: number;
  isLate: boolean;
  status: AttendanceStatus;
}

/**
 * Status from punches. Late is measured from shift start but only flagged once past
 * the grace window. Without a check-out the day is provisionally "present"; the
 * nightly job turns unfinished past days into missed-checkout absences.
 */
export function evaluateDay(
  date: string,
  checkIn: Date | null | undefined,
  checkOut: Date | null | undefined,
  cal: WorkCalendarSettings,
): DayEvaluation {
  if (!checkIn) return { workedMinutes: 0, lateMinutes: 0, earlyMinutes: 0, isLate: false, status: 'absent' };

  const shiftStart = zonedDateTime(date, cal.shiftStart);
  const shiftEnd = zonedDateTime(date, cal.shiftEnd);
  const lateBy = minutesBetween(shiftStart, checkIn);
  const isLate = lateBy > cal.graceMinutes;

  if (!checkOut) {
    return { workedMinutes: 0, lateMinutes: isLate ? lateBy : 0, earlyMinutes: 0, isLate, status: 'present' };
  }

  const workedMinutes = minutesBetween(checkIn, checkOut);
  const earlyMinutes = minutesBetween(checkOut, shiftEnd);
  let status: AttendanceStatus = 'absent';
  if (workedMinutes >= cal.minHoursFullDay * 60) status = 'present';
  else if (workedMinutes >= cal.minHoursHalfDay * 60) status = 'half';

  return { workedMinutes, lateMinutes: isLate ? lateBy : 0, earlyMinutes, isLate, status };
}

export interface SummaryDay {
  date: string;
  /** 'inactive' = before joining or after exit: neither worked nor paid. */
  type: DayType | 'inactive';
  /** Undefined when there is no attendance record for that day. */
  status?: AttendanceStatus;
  isLate?: boolean;
  /** HR excused this day's late mark. */
  lateExcused?: boolean;
  /** Checked in but not yet checked out. */
  open?: boolean;
  leave?: { paid: boolean; fraction: number } | null;
}

export interface AttendanceSummary {
  totalDays: number;
  workingDays: number;
  holidays: number;
  weekoffs: number;
  inactiveDays: number;
  presentDays: number;
  paidLeaveDays: number;
  unpaidLeaveDays: number;
  absentDays: number;
  /** All late marks, including excused ones. */
  lateCount: number;
  lateExcusedCount: number;
  latePenaltyDays: number;
  lopDays: number;
  paidDays: number;
  /** Working days not yet elapsed (current month); not counted as LOP. Payroll requires 0. */
  pendingDays: number;
}

/**
 * Month summary consumed by payroll. Proration is paidDays / totalDays (calendar days),
 * so week-offs and holidays are paid, and only LOP reduces salary.
 */
export function summarizeMonth(days: SummaryDay[], cal: WorkCalendarSettings, today: string): AttendanceSummary {
  const s: AttendanceSummary = {
    totalDays: days.length,
    workingDays: 0,
    holidays: 0,
    weekoffs: 0,
    inactiveDays: 0,
    presentDays: 0,
    paidLeaveDays: 0,
    unpaidLeaveDays: 0,
    absentDays: 0,
    lateCount: 0,
    lateExcusedCount: 0,
    latePenaltyDays: 0,
    lopDays: 0,
    paidDays: 0,
    pendingDays: 0,
  };

  for (const d of days) {
    if (d.type === 'inactive') {
      s.inactiveDays++;
      continue;
    }
    if (d.type === 'holiday') {
      s.holidays++;
      continue;
    }
    if (d.type === 'weekoff') {
      s.weekoffs++;
      continue;
    }
    s.workingDays++;
    if (d.isLate) {
      s.lateCount++;
      if (d.lateExcused) s.lateExcusedCount++;
    }

    const leaveFraction = d.leave?.fraction ?? 0;
    if (leaveFraction > 0) {
      if (d.leave!.paid) s.paidLeaveDays += leaveFraction;
      else s.unpaidLeaveDays += leaveFraction;
    }
    const remaining = 1 - leaveFraction;
    if (remaining <= 0) continue;

    // Future days, and today while not yet checked out, are neither present nor absent yet
    if (d.date > today || (d.date === today && (!d.status || d.open))) {
      s.pendingDays += remaining;
      continue;
    }

    // A half-day leave needs only the half-day threshold for the other half
    let credit = 0;
    if (d.status === 'present') credit = 1;
    else if (d.status === 'half') credit = leaveFraction > 0 ? 1 : 0.5;
    credit = Math.min(credit, 1) * remaining;
    s.presentDays += credit;
    s.absentDays += remaining - credit;
  }

  // Excused late marks (HR relief) never count towards the penalty; the rule can also be switched off entirely
  if (cal.lateLopEnabled && cal.lateMarksPerHalfDay > 0) {
    const counting = Math.max(0, s.lateCount - s.lateExcusedCount - (cal.lateFreeAllowance ?? 0));
    s.latePenaltyDays = Math.floor(counting / cal.lateMarksPerHalfDay) * 0.5;
  }
  s.lopDays = s.absentDays + s.unpaidLeaveDays + s.latePenaltyDays;
  s.paidDays = Math.max(0, s.totalDays - s.inactiveDays - s.lopDays);
  return s;
}
