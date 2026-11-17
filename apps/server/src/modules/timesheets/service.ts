import dayjs from 'dayjs';
import { DEFAULT_TIMESHEET_RULES, timesheetRulesSchema, type TimesheetRules } from '@cms/shared';
import { badRequest, conflict, locked, notFound } from '../../utils/errors';
import { datesBetween, monthOf, now, todayStr } from '../../utils/time';
import { AttendanceDay } from '../attendance/model';
import { dayType } from '../attendance/rules';
import { isMonthLocked } from '../attendance/service';
import { Employee } from '../employees/model';
import { holidaySet } from '../holidays/model';
import { Project, Task } from '../projects/model';
import { getSetting, getWorkCalendar, setSetting } from '../settings/service';
import { TimeLog, Timesheet } from './model';

type Id = string;
export const RULES_KEY = 'timesheetRules';

export async function getRules(): Promise<TimesheetRules> {
  return timesheetRulesSchema.parse({ ...DEFAULT_TIMESHEET_RULES, ...((await getSetting<Partial<TimesheetRules>>(RULES_KEY)) ?? {}) });
}
export const saveRules = (v: TimesheetRules, actor: unknown) => setSetting(RULES_KEY, v, '1970-01-01', actor as never);

/** The Monday of the week containing a date. */
export const mondayOf = (date: string) => {
  const d = dayjs(date);
  return d.subtract((d.day() + 6) % 7, 'day').format('YYYY-MM-DD');
};
export const weekDates = (start: string) => datesBetween(start, dayjs(start).add(6, 'day').format('YYYY-MM-DD'));

export interface DayAvailability {
  date: string;
  type: 'working' | 'weekoff' | 'holiday' | 'leave' | 'inactive';
  /** Minutes the person was at work (from attendance); null when time cannot be logged that day. */
  availableMinutes: number | null;
  reason?: string;
}

/**
 * How much time can be accounted for on a day, from attendance:
 * - checked out: the hours worked; still checked in today: time since check-in;
 * - a past day with an HR-marked status and no times: a full (or half) shift.
 * Nothing can be logged on week-offs, holidays, full-day leave, or days with no attendance at all.
 */
export async function availabilityFor(employee: { _id: unknown; dateOfJoining: string; exitDate?: string | null }, dates: string[]): Promise<Map<string, DayAvailability>> {
  const [cal, holidays, rows] = await Promise.all([
    getWorkCalendar(dates[dates.length - 1]),
    holidaySet(dates[0], dates[dates.length - 1]),
    AttendanceDay.find({ employee: employee._id, date: { $in: dates } }).lean(),
  ]);
  const byDate = new Map(rows.map((r) => [r.date, r]));
  const today = todayStr();
  const out = new Map<string, DayAvailability>();
  for (const date of dates) {
    const inactive = date < employee.dateOfJoining || (!!employee.exitDate && date > employee.exitDate);
    const type = inactive ? 'inactive' : dayType(date, cal, holidays);
    if (type !== 'working') {
      out.set(date, { date, type, availableMinutes: null, reason: type === 'inactive' ? 'Not employed on that day' : type === 'holiday' ? 'Holiday' : 'Week off' });
      continue;
    }
    const r = byDate.get(date);
    if (r?.leave?.fraction === 1) {
      out.set(date, { date, type: 'leave', availableMinutes: null, reason: 'On leave' });
      continue;
    }
    if (!r || (!r.checkIn && !r.override && r.status !== 'present' && r.status !== 'half')) {
      out.set(date, { date, type: 'working', availableMinutes: null, reason: date > today ? 'Future date' : 'No attendance recorded' });
      continue;
    }
    if (r.status === 'absent' && !r.override) {
      out.set(date, { date, type: 'working', availableMinutes: null, reason: 'Marked absent' });
      continue;
    }
    let minutes: number;
    if (r.checkIn && r.checkOut) minutes = r.workedMinutes ?? 0;
    else if (r.checkIn && date === today) minutes = Math.max(0, Math.round((now().getTime() - new Date(r.checkIn).getTime()) / 60000));
    else minutes = r.status === 'half' ? Math.round(cal.minHoursHalfDay * 60) : Math.round(cal.minHoursFullDay * 60);
    // A half-day of approved leave leaves only the other half to account for
    if (r.leave?.fraction === 0.5) minutes = Math.min(minutes, Math.round(cal.minHoursHalfDay * 60));
    out.set(date, { date, type: 'working', availableMinutes: minutes });
  }
  return out;
}

export const fmtHm = (m: number) => `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, '0')} m`;

/** Why a week cannot be edited, or null when it can. */
export async function weekLockReason(employeeId: Id, weekStart: string, rules?: TimesheetRules) {
  const r = rules ?? (await getRules());
  if (r.requireApproval) {
    const sheet = await Timesheet.findOne({ employee: employeeId, weekStart }).lean();
    if (sheet && (sheet.status === 'submitted' || sheet.status === 'approved')) return `The timesheet for this week is ${sheet.status}`;
  }
  return null;
}

export interface LogInput {
  task: string;
  date: string;
  minutes: number;
  note?: string;
}

type ProjectAccess = { _id: unknown; manager: unknown; members: unknown[]; status: string };

/** Set the minutes for a task on a day. Returns what the day now looks like. */
export async function setLog(employeeId: Id, input: LogInput, canLogOn: (project: ProjectAccess) => boolean) {
  // Independent reads go out together; the checks below still run in the same order as before
  const [emp, task, rules] = await Promise.all([Employee.findById(employeeId).select('dateOfJoining exitDate').lean(), Task.findById(input.task).lean(), getRules()]);
  if (!emp) throw notFound('Employee');
  if (!task) throw notFound('Task');
  const today = todayStr();
  const [project, monthLocked, lockReason, avail, otherLogs] = await Promise.all([
    Project.findById(task.project).select('code manager members status').lean(),
    isMonthLocked(monthOf(input.date)),
    weekLockReason(employeeId, mondayOf(input.date), rules),
    availabilityFor(emp, [input.date]).then((m) => m.get(input.date)!),
    TimeLog.find({ employee: employeeId, date: input.date, task: { $ne: task._id } }).select('minutes').lean(),
  ]);
  if (!project || !canLogOn(project)) throw notFound('Task');
  if (input.date > today) throw badRequest('You cannot log time for a future day');
  if (monthLocked) throw locked(`${monthOf(input.date)} is locked; time can no longer be changed`);
  if (lockReason) throw conflict(`${lockReason}; ask your manager to send it back to make changes`);

  const others = otherLogs.reduce((s, l) => s + l.minutes, 0);
  let logged = others;
  if (input.minutes === 0) {
    await TimeLog.deleteOne({ employee: employeeId, task: task._id, date: input.date });
  } else {
    if (['completed', 'cancelled'].includes(project.status)) throw conflict(`Project ${project.code} is ${project.status}; time cannot be logged on it`);
    if (avail.availableMinutes == null) throw badRequest(`You cannot log time on ${dayjs(input.date).format('DD MMM')}: ${avail.reason?.toLowerCase()}`);
    const cap = avail.availableMinutes + rules.toleranceMinutes;
    if (others + input.minutes > cap) {
      const room = Math.max(0, cap - others);
      throw badRequest(
        `Attendance shows ${fmtHm(avail.availableMinutes)} for ${dayjs(input.date).format('DD MMM')} (plus ${rules.toleranceMinutes} min allowance) and ${fmtHm(others)} is already logged on other tasks, so you can log at most ${fmtHm(room)} here`,
      );
    }
    await TimeLog.findOneAndUpdate(
      { employee: employeeId, task: task._id, date: input.date },
      { employee: employeeId, task: task._id, project: task.project, date: input.date, minutes: input.minutes, note: input.note },
      { upsert: true },
    );
    logged += input.minutes;
  }
  return { date: input.date, logged, availableMinutes: avail.availableMinutes, remaining: avail.availableMinutes == null ? 0 : Math.max(0, avail.availableMinutes + rules.toleranceMinutes - logged) };
}

/** The weekly grid: seven days, one row per task with time or assigned to the person, and the week's sheet status. */
export async function weekGrid(employeeId: Id, weekStart: string) {
  const emp = await Employee.findById(employeeId).select('name code dateOfJoining exitDate').lean();
  if (!emp) throw notFound('Employee');
  const dates = weekDates(weekStart);
  const rules = await getRules();
  const [avail, logs, sheet, lock] = await Promise.all([
    availabilityFor(emp, dates),
    TimeLog.find({ employee: employeeId, date: { $in: dates } }).lean(),
    Timesheet.findOne({ employee: employeeId, weekStart }).lean(),
    isMonthLocked(monthOf(dates[0])),
  ]);
  const assigned = await Task.find({ assignee: employeeId, status: { $ne: 'done' } }).select('_id').lean();
  const taskIds = [...new Set([...logs.map((l) => String(l.task)), ...assigned.map((t) => String(t._id))])];
  const tasks = await Task.find({ _id: { $in: taskIds } }).select('number title status project').populate('project', 'code name status').lean();
  const rows = tasks
    .map((t) => {
      const minutes: Record<string, number> = {};
      for (const l of logs) if (String(l.task) === String(t._id)) minutes[l.date] = l.minutes;
      const project = t.project as unknown as { _id: unknown; code: string; name: string; status: string };
      return {
        task: { _id: t._id, ref: `${project.code}-${t.number}`, title: t.title, status: t.status, project: { _id: project._id, code: project.code, name: project.name, status: project.status } },
        minutes,
        total: Object.values(minutes).reduce((a, b) => a + b, 0),
      };
    })
    .sort((a, b) => a.task.ref.localeCompare(b.task.ref, undefined, { numeric: true }));
  const today = todayStr();
  const days = dates.map((date) => {
    const a = avail.get(date)!;
    const logged = logs.filter((l) => l.date === date).reduce((s, l) => s + l.minutes, 0);
    return { ...a, logged, canLog: a.availableMinutes != null && date <= today, remaining: a.availableMinutes == null ? 0 : Math.max(0, a.availableMinutes + rules.toleranceMinutes - logged) };
  });
  const lockReason = lock ? 'This month is locked' : await weekLockReason(employeeId, weekStart, rules);
  return {
    employee: { _id: emp._id, name: emp.name, code: emp.code },
    weekStart,
    days,
    rows,
    total: days.reduce((s, d) => s + d.logged, 0),
    sheet: { status: sheet?.status ?? 'open', comment: sheet?.comment ?? null },
    requireApproval: rules.requireApproval,
    toleranceMinutes: rules.toleranceMinutes,
    locked: !!lockReason,
    lockReason,
  };
}
