import type { Types } from 'mongoose';
import type { LeaveRequestInput } from '@cms/shared';
import { badRequest, conflict, forbidden, notFound } from '../../utils/errors';
import { datesBetween, monthOf, now, todayStr } from '../../utils/time';
import { audit } from '../audit/model';
import { AttendanceDay } from '../attendance/model';
import { dayType } from '../attendance/rules';
import { applyEvaluation, assertMonthUnlocked } from '../attendance/service';
import { Employee } from '../employees/model';
import { holidaySet } from '../holidays/model';
import { getWorkCalendar } from '../settings/service';
import { LeaveBalance, LeaveRequest, LeaveType, type LeaveTypeDoc } from './model';
import { accruedFor, availableBalance, carryForwardAmount } from './rules';

type Id = Types.ObjectId;

/** Working dates (excluding week-offs and holidays) a leave would consume. */
export async function leaveDates(from: string, to: string) {
  const [cal, holidays] = await Promise.all([getWorkCalendar(to), holidaySet(from, to)]);
  return datesBetween(from, to).filter((d) => dayType(d, cal, holidays) === 'working');
}

async function pendingDays(employeeId: Id | string, leaveTypeId: Id | string, year: number, excludeId?: Id) {
  const rows = await LeaveRequest.find({
    employee: employeeId,
    leaveType: leaveTypeId,
    status: 'pending',
    from: { $gte: `${year}-01-01`, $lte: `${year}-12-31` },
    ...(excludeId ? { _id: { $ne: excludeId } } : {}),
  })
    .select('days')
    .lean();
  return rows.reduce((s, r) => s + r.days, 0);
}

async function balanceFor(employee: { _id: Id; dateOfJoining: string }, type: LeaveTypeDoc, year: number, asOf = todayStr(), excludeId?: Id) {
  const doc = await LeaveBalance.findOne({ employee: employee._id, leaveType: type._id, year }).lean();
  const parts = {
    opening: doc?.opening ?? 0,
    accrued: accruedFor(type, year, employee.dateOfJoining, asOf),
    adjustment: doc?.adjustment ?? 0,
    used: doc?.used ?? 0,
    encashed: doc?.encashed ?? 0,
    pending: await pendingDays(employee._id, type._id, year, excludeId),
  };
  return { leaveType: { _id: type._id, code: type.code, name: type.name, paid: type.paid }, year, ...parts, available: availableBalance(parts) };
}

export async function getBalances(employeeId: Id | string, year: number) {
  const emp = await Employee.findById(employeeId).select('dateOfJoining').lean();
  if (!emp) throw notFound('Employee');
  const types = await LeaveType.find({ active: true, paid: true }).sort({ code: 1 }).lean();
  return Promise.all(types.map((t) => balanceFor(emp, t as LeaveTypeDoc, year)));
}

async function assertEnoughBalance(employeeId: Id, type: LeaveTypeDoc, year: number, days: number, excludeId?: Id) {
  if (!type.paid) return; // LOP and other unpaid types have no balance
  const emp = await Employee.findById(employeeId).select('dateOfJoining').lean();
  if (!emp) throw notFound('Employee');
  const bal = await balanceFor(emp, type, year, todayStr(), excludeId);
  if (bal.available < days) throw badRequest(`Insufficient ${type.code} balance: ${bal.available} available, ${days} requested`);
}

/** Checks shared by apply and edit. `excludeId` is the request being edited, so it never conflicts with itself. */
async function validateLeave(employeeId: Id, input: LeaveRequestInput, excludeId?: Id) {
  const type = (await LeaveType.findById(input.leaveType).lean()) as LeaveTypeDoc | null;
  if (!type?.active) throw badRequest('Invalid leave type');
  if (input.halfDay && !type.allowHalfDay) throw badRequest(`${type.code} cannot be taken as half day`);
  if (input.from.slice(0, 4) !== input.to.slice(0, 4)) throw badRequest('Split leave that crosses a year end into two requests');

  for (const m of new Set([monthOf(input.from), monthOf(input.to)])) await assertMonthUnlocked(`${m}-01`);

  const overlap = await LeaveRequest.exists({
    employee: employeeId,
    status: { $in: ['pending', 'approved'] },
    from: { $lte: input.to },
    to: { $gte: input.from },
    ...(excludeId ? { _id: { $ne: excludeId } } : {}),
  });
  if (overlap) throw conflict('Overlaps an existing leave request');

  const dates = await leaveDates(input.from, input.to);
  if (!dates.length) throw badRequest('No working days in the selected range');
  const days = input.halfDay ? 0.5 : dates.length;
  await assertEnoughBalance(employeeId, type, Number(input.from.slice(0, 4)), days, excludeId);
  return { dates, days };
}

export async function applyLeave(employeeId: Id, input: LeaveRequestInput, actor: Id) {
  const { dates, days } = await validateLeave(employeeId, input);
  const req = await LeaveRequest.create({ ...input, employee: employeeId, days, dates });
  await audit({ actor, action: 'leave.apply', entity: 'LeaveRequest', entityId: req._id, after: { ...input, days } });
  return req;
}

/**
 * Owners can edit a request only while it is pending. Once decided, attendance and balances
 * already depend on it, so the way to change it is cancel and re-apply.
 */
export async function updateLeave(id: string, employeeId: Id, input: LeaveRequestInput, actor: Id) {
  const req = await LeaveRequest.findOne({ _id: id, employee: employeeId });
  if (!req) throw notFound('Leave request');
  if (req.status !== 'pending') throw conflict(`Only pending requests can be edited; this one is ${req.status}. Cancel it and apply again.`);

  const before = { leaveType: req.leaveType, from: req.from, to: req.to, halfDay: req.halfDay, days: req.days, reason: req.reason };
  const { dates, days } = await validateLeave(employeeId, input, req._id);
  req.set({ ...input, days, dates });
  await req.save();
  await audit({ actor, action: 'leave.edit', entity: 'LeaveRequest', entityId: req._id, before, after: { ...input, days } });
  return req;
}

/** Writes (or clears) the leave marker on each attendance day and recomputes its status. */
async function syncAttendance(req: { _id: Id; employee: Id; dates: string[]; halfDay: boolean }, type: LeaveTypeDoc | null) {
  if (!req.dates.length) return;
  const cal = await getWorkCalendar(req.dates[req.dates.length - 1]);
  for (const date of req.dates) {
    const day = (await AttendanceDay.findOne({ employee: req.employee, date })) ?? new AttendanceDay({ employee: req.employee, date, source: 'leave' });
    day.set(
      'leave',
      type ? { request: req._id, leaveType: type._id, code: type.code, paid: type.paid, fraction: req.halfDay ? 0.5 : 1 } : null,
    );
    applyEvaluation(day, cal);
    if (!type && !day.checkIn && day.source === 'leave') await day.deleteOne();
    else await day.save();
  }
}

export async function decideLeave(id: string, decision: 'approved' | 'rejected', actor: { id: Id; employeeId: Id | null }, comment?: string) {
  const req = await LeaveRequest.findById(id);
  if (!req) throw notFound('Leave request');
  if (req.status !== 'pending') throw conflict(`Request is already ${req.status}`);
  if (actor.employeeId && String(req.employee) === String(actor.employeeId)) throw forbidden('You cannot approve your own leave');

  if (decision === 'approved') {
    const type = (await LeaveType.findById(req.leaveType).lean()) as LeaveTypeDoc | null;
    if (!type) throw badRequest('Leave type no longer exists');
    for (const m of new Set(req.dates.map(monthOf))) await assertMonthUnlocked(`${m}-01`);
    const year = Number(req.from.slice(0, 4));
    await assertEnoughBalance(req.employee, type, year, req.days, req._id);
    await syncAttendance(req, type);
    if (type.paid) {
      await LeaveBalance.updateOne({ employee: req.employee, leaveType: type._id, year }, { $inc: { used: req.days } }, { upsert: true });
    }
  }

  req.status = decision;
  req.decidedBy = actor.id;
  req.decidedAt = now();
  req.comment = comment;
  await req.save();
  await audit({ actor: actor.id, action: `leave.${decision}`, entity: 'LeaveRequest', entityId: req._id, meta: { comment } });
  return req;
}

/**
 * Owners can cancel pending leave, or approved leave that has not started.
 * HR (leave.manage) can cancel any approved leave in an unlocked month.
 */
export async function cancelLeave(id: string, actor: { id: Id; employeeId: Id | null }, canManage: boolean) {
  const req = await LeaveRequest.findById(id);
  if (!req) throw notFound('Leave request');
  const isOwner = !!actor.employeeId && String(req.employee) === String(actor.employeeId);
  if (!isOwner && !canManage) throw forbidden();
  if (!['pending', 'approved'].includes(req.status)) throw conflict(`Request is already ${req.status}`);
  if (req.status === 'approved') {
    if (!canManage && req.from <= todayStr()) throw forbidden('Leave already started; ask HR to cancel');
    for (const m of new Set(req.dates.map(monthOf))) await assertMonthUnlocked(`${m}-01`);
    await syncAttendance(req, null);
    const type = await LeaveType.findById(req.leaveType).lean();
    if (type?.paid) {
      await LeaveBalance.updateOne({ employee: req.employee, leaveType: req.leaveType, year: Number(req.from.slice(0, 4)) }, { $inc: { used: -req.days } });
    }
  }
  req.status = 'cancelled';
  await req.save();
  await audit({ actor: actor.id, action: 'leave.cancel', entity: 'LeaveRequest', entityId: req._id });
  return req;
}

export async function adjustBalance(input: { employee: string; leaveType: string; year: number; delta: number; reason: string }, actor: Id) {
  const doc = await LeaveBalance.findOneAndUpdate(
    { employee: input.employee, leaveType: input.leaveType, year: input.year },
    { $inc: { adjustment: input.delta }, $push: { adjustments: { delta: input.delta, reason: input.reason, by: actor, at: now() } } },
    { upsert: true, new: true },
  );
  await audit({ actor, action: 'leave.balance_adjust', entity: 'LeaveBalance', entityId: doc._id, meta: input });
  return doc;
}

/** Year-end: next year's opening = min(unused, carryForwardMax). Re-running overwrites, so it is idempotent. */
export async function carryForward(year: number, actor?: Id) {
  const types = (await LeaveType.find({ active: true, paid: true, carryForwardMax: { $gt: 0 } }).lean()) as LeaveTypeDoc[];
  const employees = await Employee.find({ status: { $ne: 'exited' } }).select('dateOfJoining').lean();
  let updated = 0;
  for (const emp of employees) {
    for (const t of types) {
      const bal = await balanceFor(emp, t, year, `${year}-12-31`);
      const opening = carryForwardAmount(bal.available, t.carryForwardMax);
      await LeaveBalance.updateOne({ employee: emp._id, leaveType: t._id, year: year + 1 }, { $set: { opening } }, { upsert: true });
      updated++;
    }
  }
  await audit({ actor, action: 'leave.carry_forward', entity: 'LeaveBalance', meta: { year, updated } });
  return { year, updated };
}
