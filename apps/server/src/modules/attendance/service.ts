import type { Types } from 'mongoose';
import type { AttendanceBulkOverrideInput, AttendanceLateReliefInput, AttendanceOverrideInput, RegularizationInput, WorkCalendarSettings } from '@cms/shared';
import { badRequest, conflict, forbidden, locked, notFound } from '../../utils/errors';
import { datesBetween, datesInMonth, monthOf, now, toDateStr, todayStr, zonedDateTime } from '../../utils/time';
import { audit } from '../audit/model';
import { Employee } from '../employees/model';
import { holidaySet } from '../holidays/model';
import { getWorkCalendar } from '../settings/service';
import { AttendanceDay, AttendanceLock, RegularizationRequest, type AttendanceDayDoc } from './model';
import { dayType, evaluateDay, summarizeMonth, type SummaryDay } from './rules';

type Id = Types.ObjectId;

// ---------- Locking ----------

export async function isMonthLocked(month: string) {
  return !!(await AttendanceLock.exists({ month, locked: true }));
}

export async function assertMonthUnlocked(date: string) {
  if (await isMonthLocked(monthOf(date))) throw locked(`Attendance for ${monthOf(date)} is locked`);
}

export async function lockMonth(month: string, actor: Id, reason = 'Locked') {
  const lock = await AttendanceLock.findOneAndUpdate(
    { month },
    { locked: true, $push: { history: { action: 'lock', by: actor, at: now(), reason } } },
    { upsert: true, new: true },
  );
  await audit({ actor, action: 'attendance.lock', entity: 'AttendanceLock', entityId: month, meta: { reason } });
  return lock;
}

export async function unlockMonth(month: string, actor: Id, reason: string) {
  const lock = await AttendanceLock.findOne({ month });
  if (!lock?.locked) throw badRequest(`${month} is not locked`);
  lock.locked = false;
  lock.history.push({ action: 'unlock', by: actor, at: now(), reason });
  await lock.save();
  await audit({ actor, action: 'attendance.unlock', entity: 'AttendanceLock', entityId: month, meta: { reason } });
  return lock;
}

// ---------- Recompute ----------

/** Re-derives a day's metrics from its punches + leave. Mutates and returns the doc. */
export function applyEvaluation<T extends Partial<AttendanceDayDoc>>(day: T, cal: WorkCalendarSettings): T {
  const ev = evaluateDay(day.date!, day.checkIn, day.checkOut, cal);
  Object.assign(day, {
    workedMinutes: ev.workedMinutes,
    lateMinutes: ev.lateMinutes,
    earlyMinutes: ev.earlyMinutes,
    isLate: ev.isLate,
    status: ev.status,
  });
  if (day.leave && day.leave.fraction === 1) {
    Object.assign(day, { status: 'leave', isLate: false, lateMinutes: 0 });
  } else if (day.leave && !day.checkIn) {
    // Half-day leave with no punches yet: the other half is absent until punched
    Object.assign(day, { status: 'absent' });
  }
  return day;
}

/**
 * An HR override pins the day's status. Later punches still update the times, hours and late
 * flag, but must not silently undo what HR decided.
 */
const pinnedStatus = (day: { override?: unknown; status?: AttendanceDayDoc['status'] | null }) => (day.override ? (day.status ?? null) : null);

// ---------- Self check-in / out (server time only) ----------

export async function getToday(employeeId: Id) {
  const date = todayStr();
  const [day, cal, holidays] = await Promise.all([
    AttendanceDay.findOne({ employee: employeeId, date }).lean(),
    getWorkCalendar(date),
    holidaySet(date, date),
  ]);
  return { serverTime: now(), date, dayType: dayType(date, cal, holidays), shift: { start: cal.shiftStart, end: cal.shiftEnd }, record: day };
}

export async function checkIn(employeeId: Id, actor: Id) {
  const at = now();
  const date = toDateStr(at);
  await assertMonthUnlocked(date);
  const existing = await AttendanceDay.findOne({ employee: employeeId, date });
  if (existing?.checkIn) throw conflict('Already checked in today');
  if (existing?.leave?.fraction === 1) throw conflict('You are on full-day leave today');

  const cal = await getWorkCalendar(date);
  const day = existing ?? new AttendanceDay({ employee: employeeId, date });
  const pinned = pinnedStatus(day);
  day.checkIn = at;
  if (!pinned) day.source = 'self';
  applyEvaluation(day, cal);
  if (pinned) day.status = pinned;
  await day.save();
  await audit({ actor, action: 'attendance.check_in', entity: 'AttendanceDay', entityId: day._id, after: { date, at } });
  return day;
}

export async function checkOut(employeeId: Id, actor: Id) {
  const at = now();
  const date = toDateStr(at);
  await assertMonthUnlocked(date);
  const day = await AttendanceDay.findOne({ employee: employeeId, date });
  if (!day?.checkIn) throw badRequest('Check in first');

  const cal = await getWorkCalendar(date);
  const pinned = pinnedStatus(day);
  day.checkOut = at; // re-checkout overwrites: the last punch of the day wins
  day.missedCheckout = false;
  applyEvaluation(day, cal);
  if (pinned) day.status = pinned;
  await day.save();
  await audit({ actor, action: 'attendance.check_out', entity: 'AttendanceDay', entityId: day._id, after: { date, at } });
  return day;
}

// ---------- Month views ----------

interface EmploymentWindow {
  dateOfJoining: string;
  exitDate?: string | null;
}

async function monthContext(month: string) {
  const dates = datesInMonth(month);
  const [cal, holidays] = await Promise.all([getWorkCalendar(dates[dates.length - 1]), holidaySet(dates[0], dates[dates.length - 1])]);
  return { dates, cal, holidays };
}

function buildDays(
  dates: string[],
  records: Map<string, AttendanceDayDoc>,
  emp: EmploymentWindow,
  cal: WorkCalendarSettings,
  holidays: Set<string>,
) {
  return dates.map((date) => {
    const r = records.get(date);
    const inactive = date < emp.dateOfJoining || (!!emp.exitDate && date > emp.exitDate);
    const type: SummaryDay['type'] = inactive ? 'inactive' : dayType(date, cal, holidays);
    return {
      date,
      type,
      status: r?.status,
      isLate: r?.isLate,
      lateExcused: !!r?.lateExcused,
      open: !!r?.checkIn && !r?.checkOut && !r?.missedCheckout,
      leave: r?.leave?.fraction ? { paid: !!r.leave.paid, fraction: r.leave.fraction, code: r.leave.code } : null,
      record: r ?? null,
    };
  });
}

export async function employeeMonth(employeeId: Id | string, month: string) {
  const emp = await Employee.findById(employeeId).select('name code dateOfJoining exitDate').lean();
  if (!emp) throw notFound('Employee');
  const { dates, cal, holidays } = await monthContext(month);
  const rows = await AttendanceDay.find({ employee: employeeId, date: { $gte: dates[0], $lte: dates[dates.length - 1] } }).lean();
  const records = new Map(rows.map((r) => [r.date, r as AttendanceDayDoc]));
  const days = buildDays(dates, records, emp, cal, holidays);
  return {
    employee: emp,
    month,
    locked: await isMonthLocked(month),
    days,
    summary: summarizeMonth(days, cal, todayStr()),
  };
}

/** Summary used by payroll (Phase 2) and the HR register. */
export async function attendanceSummary(employeeId: Id | string, month: string) {
  return (await employeeMonth(employeeId, month)).summary;
}

export async function monthRegister(month: string, employeeFilter: Record<string, unknown>, page = 1, limit = 100) {
  const { dates, cal, holidays } = await monthContext(month);
  const first = dates[0];
  const last = dates[dates.length - 1];
  const filter = {
    ...employeeFilter,
    dateOfJoining: { $lte: last },
    $or: [{ exitDate: null }, { exitDate: { $exists: false } }, { exitDate: '' }, { exitDate: { $gte: first } }],
  };
  const [employees, total] = await Promise.all([
    Employee.find(filter)
      .select('name code department dateOfJoining exitDate')
      .sort({ code: 1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .lean(),
    Employee.countDocuments(filter),
  ]);
  const rows = await AttendanceDay.find({ employee: { $in: employees.map((e) => e._id) }, date: { $gte: first, $lte: last } }).lean();

  const byEmp = new Map<string, Map<string, AttendanceDayDoc>>();
  for (const r of rows) {
    const k = String(r.employee);
    if (!byEmp.has(k)) byEmp.set(k, new Map());
    byEmp.get(k)!.set(r.date, r as AttendanceDayDoc);
  }
  const today = todayStr();
  return {
    month,
    dates,
    total,
    page,
    limit,
    locked: await isMonthLocked(month),
    rows: employees.map((e) => {
      const days = buildDays(dates, byEmp.get(String(e._id)) ?? new Map(), e, cal, holidays);
      return {
        employee: { _id: e._id, name: e.name, code: e.code, department: e.department },
        days: days.map(({ record: _r, ...d }) => d),
        summary: summarizeMonth(days, cal, today),
      };
    }),
  };
}

// ---------- Regularization ----------

export async function createRegularization(employeeId: Id, input: RegularizationInput, actor: Id) {
  if (input.date > todayStr()) throw badRequest('Cannot regularize a future date');
  await assertMonthUnlocked(input.date);
  if (await RegularizationRequest.exists({ employee: employeeId, date: input.date, status: 'pending' })) {
    throw conflict('A pending request already exists for this date');
  }
  const reg = await RegularizationRequest.create({ ...input, employee: employeeId });
  await audit({ actor, action: 'regularization.create', entity: 'RegularizationRequest', entityId: reg._id, after: input });
  return reg;
}

/** Owners can edit a request only while it is pending; after a decision, raise a new one. */
export async function updateRegularization(id: string, employeeId: Id, input: RegularizationInput, actor: Id) {
  const reg = await RegularizationRequest.findOne({ _id: id, employee: employeeId });
  if (!reg) throw notFound('Request');
  if (reg.status !== 'pending') throw conflict(`Only pending requests can be edited; this one is ${reg.status}.`);
  if (input.date > todayStr()) throw badRequest('Cannot regularize a future date');
  await assertMonthUnlocked(input.date);
  if (await RegularizationRequest.exists({ employee: employeeId, date: input.date, status: 'pending', _id: { $ne: reg._id } })) {
    throw conflict('A pending request already exists for this date');
  }

  const before = { date: reg.date, type: reg.type, checkIn: reg.checkIn, checkOut: reg.checkOut, reason: reg.reason };
  reg.set({ ...input, checkIn: input.checkIn || undefined, checkOut: input.checkOut || undefined });
  await reg.save();
  await audit({ actor, action: 'regularization.edit', entity: 'RegularizationRequest', entityId: reg._id, before, after: input });
  return reg;
}

export async function decideRegularization(id: string, decision: 'approved' | 'rejected', actor: { id: Id; employeeId: Id | null }, comment?: string) {
  const reg = await RegularizationRequest.findById(id);
  if (!reg) throw notFound('Request');
  if (reg.status !== 'pending') throw conflict(`Request is already ${reg.status}`);
  if (actor.employeeId && String(reg.employee) === String(actor.employeeId)) throw forbidden('You cannot approve your own request');

  if (decision === 'approved') {
    await assertMonthUnlocked(reg.date);
    const cal = await getWorkCalendar(reg.date);
    const day = (await AttendanceDay.findOne({ employee: reg.employee, date: reg.date })) ?? new AttendanceDay({ employee: reg.employee, date: reg.date });
    if (reg.checkIn) day.checkIn = zonedDateTime(reg.date, reg.checkIn);
    if (reg.checkOut) day.checkOut = zonedDateTime(reg.date, reg.checkOut);
    if (day.checkIn && day.checkOut && day.checkOut <= day.checkIn) throw badRequest('Check-out must be after check-in');
    day.source = 'regularized';
    day.missedCheckout = false;
    day.regularization = reg._id;
    applyEvaluation(day, cal);
    await day.save();
  }

  reg.status = decision;
  reg.decidedBy = actor.id;
  reg.decidedAt = now();
  reg.comment = comment;
  await reg.save();
  await audit({ actor: actor.id, action: `regularization.${decision}`, entity: 'RegularizationRequest', entityId: reg._id, meta: { comment } });
  return reg;
}

export async function cancelRegularization(id: string, employeeId: Id, actor: Id) {
  const reg = await RegularizationRequest.findOne({ _id: id, employee: employeeId });
  if (!reg) throw notFound('Request');
  if (reg.status !== 'pending') throw conflict('Only pending requests can be cancelled');
  reg.status = 'cancelled';
  await reg.save();
  await audit({ actor, action: 'regularization.cancel', entity: 'RegularizationRequest', entityId: reg._id });
  return reg;
}

// ---------- HR override ----------

/**
 * Direct correction by HR/Admin: sets the day's status regardless of hours worked.
 * Bypasses the request/approval flow, so it needs a reason, respects locks and is audited.
 */
export async function overrideDay(input: AttendanceOverrideInput, actor: { id: Id; employeeId: Id | null }) {
  if (actor.employeeId && String(actor.employeeId) === input.employee) throw forbidden('You cannot override your own attendance');
  if (input.date > todayStr()) throw badRequest('Cannot override a future date');
  await assertMonthUnlocked(input.date);

  const emp = await Employee.findById(input.employee).select('dateOfJoining exitDate').lean();
  if (!emp) throw notFound('Employee');
  if (input.date < emp.dateOfJoining || (emp.exitDate && input.date > emp.exitDate)) throw badRequest('Employee was not employed on that date');

  const [cal, holidays] = await Promise.all([getWorkCalendar(input.date), holidaySet(input.date, input.date)]);
  if (dayType(input.date, cal, holidays) !== 'working') throw badRequest('That date is a holiday or week-off');

  const day = (await AttendanceDay.findOne({ employee: input.employee, date: input.date })) ?? new AttendanceDay({ employee: input.employee, date: input.date });
  if (day.leave?.fraction === 1) throw conflict('Employee is on approved leave that day; cancel the leave instead');
  const before = snapshot(day);

  applyOverride(day, cal, input, actor.id);
  await day.save();
  await auditOverride(actor.id, day, before, { employee: input.employee, date: input.date, reason: input.reason });
  return day;
}

interface OverrideValues {
  date: string;
  status: 'present' | 'half' | 'absent';
  checkIn?: string;
  checkOut?: string;
  reason: string;
}

/** Shared by the single and bulk override so both behave identically. */
function applyOverride(day: InstanceType<typeof AttendanceDay>, cal: WorkCalendarSettings, o: OverrideValues, actorId: Id) {
  if (o.checkIn && o.checkOut) {
    day.checkIn = zonedDateTime(o.date, o.checkIn);
    day.checkOut = zonedDateTime(o.date, o.checkOut);
    applyEvaluation(day, cal); // keeps late/early/worked metrics honest
  }
  day.status = o.status; // the override wins over what the hours say
  day.missedCheckout = false;
  day.source = 'override';
  day.override = { by: actorId, reason: o.reason, at: now() };
}

const snapshot = (d: InstanceType<typeof AttendanceDay>) => ({ status: d.status, checkIn: d.checkIn, checkOut: d.checkOut, source: d.source });

const auditOverride = (actor: Id, day: InstanceType<typeof AttendanceDay>, before: object, meta: object) =>
  audit({ actor, action: 'attendance.override', entity: 'AttendanceDay', entityId: day._id, before, after: snapshot(day), meta });

// ---------- Late-mark relief ----------

/**
 * HR/Admin excuses (or restores) the late mark on given days. The lateness stays on record,
 * but excused days do not count towards the late-mark LOP rule.
 */
export async function setLateRelief(input: AttendanceLateReliefInput, actor: { id: Id; employeeId: Id | null }) {
  if (actor.employeeId && String(actor.employeeId) === input.employee) throw forbidden('You cannot change late marks on your own attendance');
  if (!(await Employee.exists({ _id: input.employee }))) throw notFound('Employee');

  const dates = [...new Set(input.dates)];
  for (const m of new Set(dates.map(monthOf))) await assertMonthUnlocked(`${m}-01`);

  const byDate = new Map((await AttendanceDay.find({ employee: input.employee, date: { $in: dates } })).map((d) => [d.date, d]));
  const skipped: { date: string; reason: string }[] = [];
  let updated = 0;
  for (const date of dates) {
    const day = byDate.get(date);
    if (!day?.isLate) {
      skipped.push({ date, reason: 'Not a late day' });
      continue;
    }
    day.set('lateExcused', input.excused ? { by: actor.id, reason: input.reason, at: now() } : null);
    await day.save();
    await audit({
      actor: actor.id,
      action: input.excused ? 'attendance.late_excused' : 'attendance.late_restored',
      entity: 'AttendanceDay',
      entityId: day._id,
      meta: { employee: input.employee, date, reason: input.reason },
    });
    updated++;
  }
  return { updated, skipped };
}

// ---------- HR bulk override ----------

const BULK_MAX_DAYS_TOTAL = 2000; // employees × days in one request

const SKIP_LABEL = {
  self: 'Own attendance',
  locked: 'Locked month',
  future: 'Future date',
  nonworking: 'Holiday or week-off',
  notEmployed: 'Not employed on that date',
  leave: 'On approved leave',
  notFound: 'Employee not found',
} as const;

/**
 * Applies one correction to many employees over a date range. Days that cannot be changed are
 * skipped (not failed) and reported, so one bad day never blocks the rest. dryRun writes nothing.
 */
export async function bulkOverride(input: AttendanceBulkOverrideInput, actor: { id: Id; employeeId: Id | null }) {
  const dates = datesBetween(input.from, input.to);
  const ids = [...new Set(input.employees)];
  if (ids.length * dates.length > BULK_MAX_DAYS_TOTAL) {
    throw badRequest(`Too many days in one go (${ids.length * dates.length}, max ${BULK_MAX_DAYS_TOTAL}); narrow the range or the selection`);
  }

  const today = todayStr();
  const months = [...new Set(dates.map(monthOf))];
  const [emps, lockDocs, holidays] = await Promise.all([
    Employee.find({ _id: { $in: ids } }).select('name code dateOfJoining exitDate').lean(),
    AttendanceLock.find({ month: { $in: months }, locked: true }).select('month').lean(),
    holidaySet(input.from, input.to),
  ]);
  const lockedMonths = new Set(lockDocs.map((l) => l.month));
  const empById = new Map(emps.map((e) => [String(e._id), e]));

  const calByDate = new Map<string, { cal: WorkCalendarSettings; working: boolean }>();
  for (const d of dates) {
    const cal = await getWorkCalendar(d);
    calByDate.set(d, { cal, working: dayType(d, cal, holidays) === 'working' });
  }

  const existing = await AttendanceDay.find({ employee: { $in: emps.map((e) => e._id) }, date: { $in: dates } });
  const byKey = new Map(existing.map((d) => [`${d.employee}|${d.date}`, d]));

  const skipped: { employee: { _id: string; name: string; code: string }; date: string; reason: string }[] = [];
  const touched = new Set<string>();
  let updated = 0;

  for (const id of ids) {
    const emp = empById.get(id);
    const who = { _id: id, name: emp?.name ?? 'Unknown', code: emp?.code ?? '?' };
    for (const date of dates) {
      const skip = (r: keyof typeof SKIP_LABEL) => skipped.push({ employee: who, date, reason: SKIP_LABEL[r] });
      if (!emp) skip('notFound');
      else if (actor.employeeId && String(actor.employeeId) === id) skip('self');
      else if (lockedMonths.has(monthOf(date))) skip('locked');
      else if (date > today) skip('future');
      else if (!calByDate.get(date)!.working) skip('nonworking');
      else if (date < emp.dateOfJoining || (emp.exitDate && date > emp.exitDate)) skip('notEmployed');
      else {
        const day = byKey.get(`${id}|${date}`) ?? new AttendanceDay({ employee: emp._id, date });
        if (day.leave?.fraction === 1) {
          skip('leave');
          continue;
        }
        if (!input.dryRun) {
          const before = snapshot(day);
          applyOverride(day, calByDate.get(date)!.cal, { ...input, date }, actor.id);
          await day.save();
          await auditOverride(actor.id, day, before, { employee: id, date, reason: input.reason, bulk: true });
        }
        updated++;
        touched.add(id);
      }
    }
  }

  const skippedByReason: Record<string, number> = {};
  for (const s of skipped) skippedByReason[s.reason] = (skippedByReason[s.reason] ?? 0) + 1;
  return {
    dryRun: !!input.dryRun,
    days: dates.length,
    people: touched.size,
    updated,
    skippedCount: skipped.length,
    skippedByReason,
    skipped: skipped.slice(0, 200), // enough to review; the full count is in skippedCount
  };
}

// ---------- Nightly job ----------

/** Past days with a check-in but no check-out become missed-checkout absences (fix via regularization). */
export async function finalizeMissedCheckouts(beforeDate = todayStr()) {
  const res = await AttendanceDay.updateMany(
    { date: { $lt: beforeDate }, checkIn: { $ne: null }, checkOut: null, missedCheckout: false, 'leave.fraction': { $ne: 1 }, override: null },
    { $set: { missedCheckout: true, status: 'absent', workedMinutes: 0 } },
  );
  return res.modifiedCount;
}
