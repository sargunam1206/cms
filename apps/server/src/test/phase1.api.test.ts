import { Employee } from '../modules/employees/model';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { resetClock, setClock, zonedDateTime } from '../utils/time';
import { AuditLog } from '../modules/audit/model';
import { AttendanceDay } from '../modules/attendance/model';
import { Setting } from '../modules/settings/model';
import { finalizeMissedCheckouts } from '../modules/attendance/service';
import { app, connectTestDb, createPerson, dropTestDb, seedLeaveTypes, seedRoles } from './helpers';

let roles: Awaited<ReturnType<typeof seedRoles>>;
let leaveTypes: Awaited<ReturnType<typeof seedLeaveTypes>>;

beforeAll(async () => {
  await connectTestDb();
  roles = await seedRoles();
  leaveTypes = await seedLeaveTypes();
});
afterAll(dropTestDb);
afterEach(resetClock);

const clockAt = (date: string, time: string) => setClock(() => zonedDateTime(date, time));

describe('auth & RBAC', () => {
  it('rejects requests without a token', async () => {
    expect((await request(app).get('/api/employees')).status).toBe(401);
  });

  it('forbids an employee from admin endpoints', async () => {
    const emp = await createPerson(roles.Employee);
    expect((await request(app).get('/api/users').set(emp.auth)).status).toBe(403);
    expect((await request(app).get('/api/attendance/register').set(emp.auth)).status).toBe(403);
  });

  it('returns permissions on /me', async () => {
    const hr = await createPerson(roles.HR);
    const res = await request(app).get('/api/auth/me').set(hr.auth);
    expect(res.body.role).toBe('HR');
    expect(res.body.permissions).toContain('attendance.lock');
  });

  it("profile returns only the caller's own record, with manager populated", async () => {
    const a = await createPerson(roles.Employee);
    const b = await createPerson(roles.Employee);
    const res = await request(app).get('/api/auth/profile').set(a.auth).expect(200);
    expect(res.body.employee._id).toBe(String(a.employee._id));
    expect(res.body.employee._id).not.toBe(String(b.employee._id));
    expect(res.body.role).toBe('Employee');
    await request(app).get('/api/auth/profile').expect(401);
  });
});

describe('attendance', () => {
  it('uses server time and ignores any client-supplied time', async () => {
    const emp = await createPerson(roles.Employee);
    clockAt('2026-09-01', '09:20');
    const res = await request(app).post('/api/attendance/check-in').set(emp.auth).send({ time: '2026-09-01T03:00:00Z', checkIn: '08:00' });
    expect(res.status).toBe(201);
    expect(new Date(res.body.checkIn).toISOString()).toBe(zonedDateTime('2026-09-01', '09:20').toISOString());
    expect(res.body.isLate).toBe(false);

    const again = await request(app).post('/api/attendance/check-in').set(emp.auth);
    expect(again.status).toBe(409);
  });

  it('3 late arrivals become a half-day LOP; manager regularizes a missed day', async () => {
    const mgr = await createPerson(roles.Manager);
    const emp = await createPerson(roles.Employee, { manager: mgr.employee._id });

    // Tue 1 – Thu 3 Sep 2026: late by 30 minutes, full hours worked
    for (const d of ['2026-09-01', '2026-09-02', '2026-09-03']) {
      clockAt(d, '10:00');
      await request(app).post('/api/attendance/check-in').set(emp.auth).expect(201);
      clockAt(d, '19:00');
      await request(app).post('/api/attendance/check-out').set(emp.auth).expect(200);
    }

    clockAt('2026-09-05', '12:00');
    let res = await request(app).get('/api/attendance/me?month=2026-09').set(emp.auth);
    expect(res.body.summary.lateCount).toBe(3);
    expect(res.body.summary.latePenaltyDays).toBe(0.5);
    expect(res.body.summary.absentDays).toBe(1); // Fri 4 Sep: no record

    // Regularize Fri 4 Sep
    const reg = await request(app)
      .post('/api/regularizations')
      .set(emp.auth)
      .send({ date: '2026-09-04', type: 'missed-checkin', checkIn: '09:30', checkOut: '18:30', reason: 'Forgot to check in' });
    expect(reg.status).toBe(201);

    // Employee cannot approve their own request (no permission)
    expect((await request(app).post(`/api/regularizations/${reg.body._id}/decision`).set(emp.auth).send({ decision: 'approved' })).status).toBe(403);

    const pending = await request(app).get('/api/regularizations/pending').set(mgr.auth);
    expect(pending.body.map((r: { _id: string }) => r._id)).toContain(reg.body._id);

    await request(app).post(`/api/regularizations/${reg.body._id}/decision`).set(mgr.auth).send({ decision: 'approved' }).expect(200);

    res = await request(app).get('/api/attendance/me?month=2026-09').set(emp.auth);
    expect(res.body.summary.absentDays).toBe(0);
    expect(res.body.days.find((d: { date: string }) => d.date === '2026-09-04').status).toBe('present');
  });

  it('a manager cannot act on employees outside their team', async () => {
    const mgr = await createPerson(roles.Manager);
    const other = await createPerson(roles.Employee);
    clockAt('2026-09-10', '12:00');
    const reg = await request(app)
      .post('/api/regularizations')
      .set(other.auth)
      .send({ date: '2026-09-09', type: 'missed-checkin', checkIn: '09:30', checkOut: '18:30', reason: 'Was at client site' });
    expect((await request(app).post(`/api/regularizations/${reg.body._id}/decision`).set(mgr.auth).send({ decision: 'approved' })).status).toBe(403);
  });

  it('locks a month: no edits until HR unlocks, and every unlock is audited', async () => {
    const hr = await createPerson(roles.HR);
    const emp = await createPerson(roles.Employee);
    await request(app).post('/api/attendance/locks/2026-08/lock').set(hr.auth).send({}).expect(200);

    clockAt('2026-08-31', '09:30');
    expect((await request(app).post('/api/attendance/check-in').set(emp.auth)).status).toBe(423);
    expect(
      (
        await request(app)
          .post('/api/regularizations')
          .set(emp.auth)
          .send({ date: '2026-08-20', type: 'missed-checkin', checkIn: '09:30', checkOut: '18:30', reason: 'Late request' })
      ).status,
    ).toBe(423);

    // Employees cannot unlock
    expect((await request(app).post('/api/attendance/locks/2026-08/unlock').set(emp.auth).send({ reason: 'please unlock' })).status).toBe(403);

    await request(app).post('/api/attendance/locks/2026-08/unlock').set(hr.auth).send({ reason: 'Correction for payroll' }).expect(200);
    expect(await AuditLog.exists({ action: 'attendance.unlock', entityId: '2026-08' })).toBeTruthy();
    expect((await request(app).post('/api/attendance/check-in').set(emp.auth)).status).toBe(201);
  });
});

describe('HR attendance override', () => {
  const body = (employee: string, extra: object = {}) => ({ employee, date: '2026-06-02', status: 'present', reason: 'Worked at client site', ...extra });

  it('lets HR mark an absent day present, audited; others cannot', async () => {
    const hr = await createPerson(roles.HR);
    const mgr = await createPerson(roles.Manager);
    const emp = await createPerson(roles.Employee, { manager: mgr.employee._id });
    clockAt('2026-06-05', '12:00');
    const id = String(emp.employee._id);

    // Day starts absent (no record)
    let res = await request(app).get('/api/attendance/me?month=2026-06').set(emp.auth);
    expect(res.body.days.find((d: { date: string }) => d.date === '2026-06-02').status).toBeUndefined();
    expect(res.body.summary.absentDays).toBeGreaterThan(0);
    const absentBefore = res.body.summary.absentDays;

    // Employees and managers lack the permission
    expect((await request(app).post('/api/attendance/override').set(emp.auth).send(body(id))).status).toBe(403);
    expect((await request(app).post('/api/attendance/override').set(mgr.auth).send(body(id))).status).toBe(403);

    // Reason is mandatory
    expect((await request(app).post('/api/attendance/override').set(hr.auth).send(body(id, { reason: 'x' }))).status).toBe(400);

    const ok = await request(app).post('/api/attendance/override').set(hr.auth).send(body(id));
    expect(ok.status).toBe(200);
    expect(ok.body.status).toBe('present');
    expect(ok.body.source).toBe('override');

    res = await request(app).get('/api/attendance/me?month=2026-06').set(emp.auth);
    expect(res.body.days.find((d: { date: string }) => d.date === '2026-06-02').status).toBe('present');
    expect(res.body.summary.absentDays).toBe(absentBefore - 1);
    expect(await AuditLog.exists({ action: 'attendance.override', entityId: ok.body._id })).toBeTruthy();
  });

  it('with times it keeps late metrics but the chosen status wins', async () => {
    const hr = await createPerson(roles.HR);
    const emp = await createPerson(roles.Employee);
    clockAt('2026-06-05', '12:00');
    const res = await request(app)
      .post('/api/attendance/override')
      .set(hr.auth)
      .send(body(String(emp.employee._id), { date: '2026-06-03', checkIn: '10:30', checkOut: '11:00' }));
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('present'); // 30 minutes worked would normally be absent
    expect(res.body.isLate).toBe(true);
    expect(res.body.checkInIST).toBe('2026-06-03 10:30:00');
  });

  it('rejects self-override, future dates, non-working days and locked months', async () => {
    const hr = await createPerson(roles.HR);
    const emp = await createPerson(roles.Employee);
    clockAt('2026-06-05', '12:00');
    const id = String(emp.employee._id);
    const go = (b: object, who = hr) => request(app).post('/api/attendance/override').set(who.auth).send(b);

    expect((await go(body(String(hr.employee._id)))).status).toBe(403); // own record
    expect((await go(body(id, { date: '2026-06-20' }))).status).toBe(400); // future
    expect((await go(body(id, { date: '2026-06-07' }))).status).toBe(400); // Sunday

    await request(app).post('/api/attendance/locks/2026-06/lock').set(hr.auth).send({}).expect(200);
    expect((await go(body(id))).status).toBe(423);
  });
});

describe('HR bulk override', () => {
  // Today = Wed 15 Apr 2026. Range Mon 6 – Fri 17 Apr: 9 working days to date, Sun 12 is a week-off, Thu 16 / Fri 17 are future.
  const range = { from: '2026-04-06', to: '2026-04-17', status: 'present', reason: 'Company event, all present' };

  it('previews, applies, skips what it cannot change, and respects locks and permissions', async () => {
    const hr = await createPerson(roles.HR);
    const mgr = await createPerson(roles.Manager);
    const a = await createPerson(roles.Employee);
    const b = await createPerson(roles.Employee);
    clockAt('2026-04-15', '12:00');
    const ids = [a, b, hr].map((p) => String(p.employee._id));
    const post = (body: object, who = hr) => request(app).post('/api/attendance/override/bulk').set(who.auth).send(body);

    expect((await post({ ...range, employees: ids }, mgr)).status).toBe(403);
    expect((await post({ ...range, employees: [] })).status).toBe(400);
    expect((await post({ ...range, employees: ids, from: '2026-01-01' })).status).toBe(400); // > 62 days

    // Dry run writes nothing
    const dry = await post({ ...range, employees: ids, dryRun: true });
    expect(dry.status).toBe(200);
    expect(dry.body).toMatchObject({ dryRun: true, people: 2, updated: 18 });
    expect(await AttendanceDay.countDocuments({ source: 'override', date: { $gte: '2026-04-01', $lte: '2026-04-30' } })).toBe(0);
    // HR's own 12 days, 2 Sundays, 4 future days
    expect(dry.body.skippedByReason).toEqual({ 'Own attendance': 12, 'Holiday or week-off': 2, 'Future date': 4 });

    // Apply
    const res = await post({ ...range, employees: ids });
    expect(res.body).toMatchObject({ dryRun: false, people: 2, updated: 18 });
    expect(await AttendanceDay.countDocuments({ source: 'override', status: 'present', date: { $gte: '2026-04-01', $lte: '2026-04-30' } })).toBe(18);
    expect(await AuditLog.countDocuments({ action: 'attendance.override', 'meta.bulk': true })).toBeGreaterThanOrEqual(18);

    const month = await request(app).get('/api/attendance/me?month=2026-04').set(a.auth);
    expect(month.body.summary.presentDays).toBe(9); // 6–11 Apr, then 13–15 Apr
    expect(month.body.summary.absentDays).toBe(4); // 1–4 Apr were outside the range, so still unmarked

    // Locked month: nothing changes
    await request(app).post('/api/attendance/locks/2026-04/lock').set(hr.auth).send({}).expect(200);
    const locked = await post({ ...range, employees: ids, status: 'absent' });
    expect(locked.body.updated).toBe(0);
    expect(locked.body.skippedByReason['Locked month']).toBeGreaterThan(0);
  });
});

describe('late-mark relief and setting', () => {
  it('HR excuses late marks, the penalty drops, it can be restored; others cannot; locks respected', async () => {
    const hr = await createPerson(roles.HR);
    const mgr = await createPerson(roles.Manager);
    const emp = await createPerson(roles.Employee, { manager: mgr.employee._id });
    const id = String(emp.employee._id);
    const days = ['2026-11-02', '2026-11-03', '2026-11-04']; // Mon–Wed, all late
    for (const d of days) {
      clockAt(d, '10:30');
      await request(app).post('/api/attendance/check-in').set(emp.auth).expect(201);
      clockAt(d, '18:30');
      await request(app).post('/api/attendance/check-out').set(emp.auth).expect(200);
    }
    clockAt('2026-11-10', '12:00');
    const summary = async () => (await request(app).get('/api/attendance/me?month=2026-11').set(emp.auth)).body.summary;
    const relief = (body: object, who = hr) => request(app).post('/api/attendance/late-relief').set(who.auth).send({ employee: id, reason: 'Bus strike', ...body });

    expect(await summary()).toMatchObject({ lateCount: 3, lateExcusedCount: 0, latePenaltyDays: 0.5 });

    // Permissions and validation
    expect((await relief({ dates: [days[0]], excused: true }, mgr)).status).toBe(403);
    expect((await relief({ dates: [days[0]], excused: true }, emp)).status).toBe(403);
    expect((await relief({ dates: [], excused: true })).status).toBe(400);
    expect((await relief({ dates: [days[0]], excused: true, reason: 'x' })).status).toBe(400);

    // Excuse one of the three: penalty gone, lateness still on record
    const ok = await relief({ dates: [days[0], '2026-11-05'], excused: true }); // 5 Nov has no record
    expect(ok.body).toMatchObject({ updated: 1, skipped: [{ date: '2026-11-05', reason: 'Not a late day' }] });
    expect(await summary()).toMatchObject({ lateCount: 3, lateExcusedCount: 1, latePenaltyDays: 0 });
    const month = await request(app).get('/api/attendance/me?month=2026-11').set(emp.auth);
    expect(month.body.days.find((d: { date: string }) => d.date === days[0])).toMatchObject({ isLate: true, lateExcused: true });
    expect(await AuditLog.exists({ action: 'attendance.late_excused' })).toBeTruthy();

    // Restore it
    await relief({ dates: [days[0]], excused: false }).then((r) => expect(r.body.updated).toBe(1));
    expect(await summary()).toMatchObject({ lateExcusedCount: 0, latePenaltyDays: 0.5 });

    // HR cannot excuse their own late marks
    expect((await request(app).post('/api/attendance/late-relief').set(hr.auth).send({ employee: String(hr.employee._id), dates: [days[0]], excused: true, reason: 'Excuse myself' })).status).toBe(403);

    // Locked month
    await request(app).post('/api/attendance/locks/2026-11/lock').set(hr.auth).send({}).expect(200);
    expect((await relief({ dates: [days[0]], excused: true })).status).toBe(423);
  });

  it('turning the rule off in settings removes the penalty, and old saved settings still load', async () => {
    const hr = await createPerson(roles.HR);
    const emp = await createPerson(roles.Employee);
    for (const d of ['2026-12-01', '2026-12-02', '2026-12-03']) {
      clockAt(d, '10:30');
      await request(app).post('/api/attendance/check-in').set(emp.auth).expect(201);
      clockAt(d, '18:30');
      await request(app).post('/api/attendance/check-out').set(emp.auth).expect(200);
    }
    clockAt('2026-12-10', '12:00');
    const summary = async () => (await request(app).get('/api/attendance/me?month=2026-12').set(emp.auth)).body.summary;
    expect((await summary()).latePenaltyDays).toBe(0.5);

    const cal = (await request(app).get('/api/settings/work-calendar').set(hr.auth)).body;
    expect(cal.lateLopEnabled).toBe(true); // default fills in when never saved

    // A record saved under the old rule ("0 = off") loads as off instead of failing validation
    const legacy = { ...cal, lateMarksPerHalfDay: 0 } as Record<string, unknown>;
    delete legacy.lateLopEnabled;
    await Setting.create({ key: 'workCalendar', value: legacy, effectiveFrom: '2026-11-15' });
    clockAt('2026-11-20', '12:00');
    expect((await request(app).get('/api/settings/work-calendar').set(hr.auth)).body).toMatchObject({ lateLopEnabled: false, lateMarksPerHalfDay: 3 });
    await Setting.deleteOne({ key: 'workCalendar', effectiveFrom: '2026-11-15' });
    clockAt('2026-12-10', '12:00');
    await request(app).put('/api/settings/work-calendar').set(hr.auth).send({ value: { ...cal, lateLopEnabled: false }, effectiveFrom: '2026-12-01' }).expect(200);

    const after = await summary();
    expect(after).toMatchObject({ lateCount: 3, latePenaltyDays: 0 });
    expect(after.lopDays).toBe(after.absentDays + after.unpaidLeaveDays); // the late marks add nothing to LOP
  });
});

describe('HR override sticks', () => {
  it('later check-in / check-out keep the status HR chose, and the nightly job skips the day', async () => {
    const hr = await createPerson(roles.HR);
    const emp = await createPerson(roles.Employee);
    const id = String(emp.employee._id);
    const day = '2026-10-12';
    const row = () => AttendanceDay.findOne({ employee: emp.employee._id, date: day }).lean();

    // HR marks the day present with no times; the employee then punches 30 minutes in total
    clockAt(day, '09:00');
    await request(app).post('/api/attendance/override').set(hr.auth).send({ employee: id, date: day, status: 'present', reason: 'Worked offsite' }).expect(200);

    clockAt(day, '10:00');
    await request(app).post('/api/attendance/check-in').set(emp.auth).expect(201);
    expect(await row()).toMatchObject({ status: 'present', source: 'override', isLate: true });

    // Before check-out, the nightly job must not turn the open day into a missed check-out
    await finalizeMissedCheckouts('2026-10-13');
    expect(await row()).toMatchObject({ status: 'present', missedCheckout: false });

    clockAt(day, '10:30');
    await request(app).post('/api/attendance/check-out').set(emp.auth).expect(200);
    // 30 minutes worked would normally be absent, but HR's decision stays
    expect(await row()).toMatchObject({ status: 'present', source: 'override', workedMinutes: 30 });

    // Without an override the same punches do give absent (rule unchanged)
    const plain = await createPerson(roles.Employee);
    clockAt(day, '10:00');
    await request(app).post('/api/attendance/check-in').set(plain.auth).expect(201);
    clockAt(day, '10:30');
    const out = await request(app).post('/api/attendance/check-out').set(plain.auth).expect(200);
    expect(out.body.status).toBe('absent');
  });
});

describe('regularization edit', () => {
  it('owner can edit a pending request; the approved result uses the edited times', async () => {
    const mgr = await createPerson(roles.Manager);
    const emp = await createPerson(roles.Employee, { manager: mgr.employee._id });
    const other = await createPerson(roles.Employee);
    clockAt('2026-09-10', '12:00');
    const base = { type: 'missed-checkin', checkIn: '09:30', checkOut: '18:30', reason: 'Forgot to check in' };
    const make = (date: string) => request(app).post('/api/regularizations').set(emp.auth).send({ ...base, date });
    const put = (rid: string, body: object, who = emp) => request(app).put(`/api/regularizations/${rid}`).set(who.auth).send(body);

    const r1 = (await make('2026-09-08')).body._id;
    const edited = await put(r1, { ...base, date: '2026-09-09', checkIn: '10:00', checkOut: '19:00', reason: 'Corrected details' });
    expect(edited.status).toBe(200);
    expect(edited.body).toMatchObject({ _id: r1, date: '2026-09-09', checkIn: '10:00', status: 'pending' });

    // Validation applies to edits too
    expect((await put(r1, { ...base, date: '2026-09-20' })).status).toBe(400); // future
    expect((await put(r1, { ...base, reason: 'x' })).status).toBe(400);

    // The date just vacated can be used again, but not a date that already has another pending request
    expect((await make('2026-09-08')).status).toBe(201);
    expect((await put(r1, { ...base, date: '2026-09-08' })).status).toBe(409);

    // Someone else's request looks like it does not exist
    expect((await put(r1, { ...base, date: '2026-09-09' }, other)).status).toBe(404);

    // Approval uses the edited times; afterwards it is no longer editable
    await request(app).post(`/api/regularizations/${r1}/decision`).set(mgr.auth).send({ decision: 'approved' }).expect(200);
    const day = await AttendanceDay.collection.findOne({ employee: emp.employee._id, date: '2026-09-09' });
    expect(day?.checkInIST).toBe('2026-09-09 10:00:00'); // the edited 10:00, not the original 09:30
    expect(day?.status).toBe('present');
    expect((await put(r1, { ...base, date: '2026-09-09' })).status).toBe(409);
  });
});

describe('leave edit', () => {
  it('owner can edit a pending request (balance re-checked); decided or foreign requests cannot be edited', async () => {
    const mgr = await createPerson(roles.Manager);
    const emp = await createPerson(roles.Employee, { manager: mgr.employee._id });
    const other = await createPerson(roles.Employee);
    clockAt('2026-08-03', '10:00');
    const cl = String(leaveTypes.CL._id); // quota 2

    // Mon 10 – Tue 11 Aug = 2 days
    const made = await request(app).post('/api/leave/requests').set(emp.auth).send({ leaveType: cl, from: '2026-08-10', to: '2026-08-11', reason: 'Trip' });
    expect(made.body.days).toBe(2);
    const id = made.body._id;
    const put = (body: object, who = emp, rid = id) => request(app).put(`/api/leave/requests/${rid}`).set(who.auth).send(body);

    // Shrink to one day: allowed, and the request is the same record
    const shrunk = await put({ leaveType: cl, from: '2026-08-10', to: '2026-08-10', reason: 'Shorter trip' });
    expect(shrunk.status).toBe(200);
    expect(shrunk.body).toMatchObject({ _id: id, days: 1, reason: 'Shorter trip', status: 'pending' });

    // Growing beyond the balance is refused; growing within it is fine (own pending days are not double-counted)
    expect((await put({ leaveType: cl, from: '2026-08-10', to: '2026-08-13', reason: 'Too long' })).status).toBe(400);
    expect((await put({ leaveType: cl, from: '2026-08-10', to: '2026-08-11', reason: 'Back to two' })).status).toBe(200);

    // Someone else's request looks like it does not exist
    expect((await put({ leaveType: cl, from: '2026-08-10', to: '2026-08-10', reason: 'Not mine' }, other)).status).toBe(404);

    // Once approved it can no longer be edited
    await request(app).post(`/api/leave/requests/${id}/decision`).set(mgr.auth).send({ decision: 'approved' }).expect(200);
    expect((await put({ leaveType: cl, from: '2026-08-10', to: '2026-08-10', reason: 'Too late' })).status).toBe(409);
  });
});

describe('leave', () => {
  it('approval deducts balance, marks attendance, and enforces the balance', async () => {
    const mgr = await createPerson(roles.Manager);
    const emp = await createPerson(roles.Employee, { manager: mgr.employee._id });
    clockAt('2026-07-01', '10:00');

    // Mon 13 – Tue 14 Jul 2026 = 2 working days (CL quota is 2)
    const apply = await request(app)
      .post('/api/leave/requests')
      .set(emp.auth)
      .send({ leaveType: String(leaveTypes.CL._id), from: '2026-07-13', to: '2026-07-14', reason: 'Family function' });
    expect(apply.status).toBe(201);
    expect(apply.body.days).toBe(2);

    // Pending days already reserve the balance
    const more = await request(app)
      .post('/api/leave/requests')
      .set(emp.auth)
      .send({ leaveType: String(leaveTypes.CL._id), from: '2026-07-20', to: '2026-07-20', reason: 'Personal' });
    expect(more.status).toBe(400);

    await request(app).post(`/api/leave/requests/${apply.body._id}/decision`).set(mgr.auth).send({ decision: 'approved' }).expect(200);

    const bal = await request(app).get('/api/leave/balances/me?year=2026').set(emp.auth);
    const cl = bal.body.find((b: { leaveType: { code: string } }) => b.leaveType.code === 'CL');
    expect(cl.used).toBe(2);
    expect(cl.available).toBe(0);

    const day = await AttendanceDay.findOne({ employee: emp.employee._id, date: '2026-07-13' }).lean();
    expect(day?.status).toBe('leave');
    expect(day?.leave?.paid).toBe(true);

    // LOP has no balance limit
    const lop = await request(app)
      .post('/api/leave/requests')
      .set(emp.auth)
      .send({ leaveType: String(leaveTypes.LOP._id), from: '2026-07-20', to: '2026-07-20', reason: 'Personal' });
    expect(lop.status).toBe(201);

    // Overlapping request rejected
    const overlap = await request(app)
      .post('/api/leave/requests')
      .set(emp.auth)
      .send({ leaveType: String(leaveTypes.LOP._id), from: '2026-07-14', to: '2026-07-15', reason: 'Overlap' });
    expect(overlap.status).toBe(409);

    // Cancelling approved future leave restores balance and clears attendance
    await request(app).post(`/api/leave/requests/${apply.body._id}/cancel`).set(emp.auth).expect(200);
    const after = await request(app).get('/api/leave/balances/me?year=2026').set(emp.auth);
    expect(after.body.find((b: { leaveType: { code: string } }) => b.leaveType.code === 'CL').used).toBe(0);
    expect(await AttendanceDay.exists({ employee: emp.employee._id, date: '2026-07-13' })).toBeNull();
  });
});

describe('profile self-service', () => {
  it('employee edits phone directly; bank change needs HR approval and applies only then', async () => {
    const emp = await createPerson(roles.Employee);
    const hr = await createPerson(roles.HR);

    await request(app).put('/api/profile/contact').set(emp.auth).send({ phone: 'abc' }).expect(400);
    await request(app).put('/api/profile/contact').set(emp.auth).send({ phone: '+91 98765 43210' }).expect(200);
    expect((await Employee.findById(emp.employee._id).lean())?.phone).toBe('+91 98765 43210');

    const bank = { accountNumber: '123456789012', ifsc: 'sbin0001234', bankName: 'SBI' };
    await request(app).post('/api/profile/bank-changes').set(emp.auth).send({ ...bank, ifsc: 'bad' }).expect(400);
    const created = await request(app).post('/api/profile/bank-changes').set(emp.auth).send(bank).expect(201);
    expect(created.body.bank.ifsc).toBe('SBIN0001234');
    expect((await Employee.findById(emp.employee._id).lean())?.bank?.accountNumber).toBeUndefined();

    // employees cannot see or decide the queue
    await request(app).get('/api/profile/bank-changes/pending').set(emp.auth).expect(403);
    await request(app).post(`/api/profile/bank-changes/${created.body._id}/decision`).set(emp.auth).send({ decision: 'approved' }).expect(403);

    await request(app).post(`/api/profile/bank-changes/${created.body._id}/decision`).set(hr.auth).send({ decision: 'approved' }).expect(200);
    expect((await Employee.findById(emp.employee._id).lean())?.bank?.accountNumber).toBe('123456789012');
    await request(app).post(`/api/profile/bank-changes/${created.body._id}/decision`).set(hr.auth).send({ decision: 'approved' }).expect(400);
  });

  it('HR cannot approve their own bank change', async () => {
    const hr = await createPerson(roles.HR);
    const r = await request(app).post('/api/profile/bank-changes').set(hr.auth).send({ accountNumber: '999999999', ifsc: 'HDFC0000001', bankName: 'HDFC' }).expect(201);
    await request(app).post(`/api/profile/bank-changes/${r.body._id}/decision`).set(hr.auth).send({ decision: 'approved' }).expect(403);
  });
});

describe('list filters and input hardening', () => {
  it('employees: validated status, department (case-insensitive), departments list, exit date required', async () => {
    const hr = await createPerson(roles.HR);
    const mk = (code: string, department: string, extra = {}) =>
      request(app).post('/api/employees').set(hr.auth).send({ code, name: `Name ${code}`, department, dateOfJoining: '2024-01-01', ...extra });
    await mk('F001', 'Sales').expect(201);
    await mk('F002', 'Support').expect(201);
    await mk('F003', 'Sales', { status: 'exited' }).expect(400); // no exit date
    await mk('F003', 'Sales', { status: 'exited', exitDate: '2026-01-31' }).expect(201);

    const list = (qs: string) => request(app).get(`/api/employees?${qs}`).set(hr.auth);
    expect((await list('department=sales')).body.items.map((e: { code: string }) => e.code).sort()).toEqual(['F001', 'F003']);
    expect((await list('department=sales&status=active')).body.total).toBe(1);
    expect((await list('q=F00')).body.total).toBe(3);
    await list('status=bogus').expect(400);
    expect((await list('q=(.*')).body.total).toBe(0); // regex characters are literal
    const deps = await request(app).get('/api/employees/departments').set(hr.auth).expect(200);
    expect(deps.body).toEqual(expect.arrayContaining(['Sales', 'Support']));

    const reg = (qs: string) => request(app).get(`/api/attendance/register?month=2026-09&${qs}`).set(hr.auth);
    const codes = async (qs: string) => (await reg(qs)).body.rows.map((r: { employee: { code: string } }) => r.employee.code);
    expect(await codes('department=support')).toEqual(['F002']);
    expect(await codes('q=f001')).toEqual(['F001']);
    expect(await codes('q=nobody-here')).toEqual([]);
  });

  it('audit date range, leave filter validation, users search, oversized body', async () => {
    const admin = await createPerson(roles.Admin);
    expect((await request(app).get('/api/audit?from=2099-01-01').set(admin.auth).expect(200)).body.total).toBe(0);
    expect((await request(app).get('/api/audit?from=2000-01-01&to=2099-01-01').set(admin.auth)).body.total).toBeGreaterThan(0);
    await request(app).get('/api/audit?from=garbage').set(admin.auth).expect(400);
    await request(app).get('/api/leave/requests?status=bogus').set(admin.auth).expect(400);
    await request(app).get('/api/leave/requests?from=garbage').set(admin.auth).expect(400);
    const all = (await request(app).get('/api/users').set(admin.auth)).body.total;
    const some = (await request(app).get('/api/users?q=zzz-no-match').set(admin.auth)).body.total;
    expect(all).toBeGreaterThan(0);
    expect(some).toBe(0);
    await request(app).post('/api/auth/login').send({ email: 'a@b.co', password: 'x'.repeat(1_500_000) }).expect(413);
  });
});
