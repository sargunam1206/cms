import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import dayjs from 'dayjs';
import { Types } from 'mongoose';
import { toIst } from '../config/istPlugin';
import { AttendanceDay, AttendanceLock } from '../modules/attendance/model';
import { lockMonth, unlockMonth } from '../modules/attendance/service';
import { Employee } from '../modules/employees/model';
import { LeaveBalance } from '../modules/leave/model';
import { Setting } from '../modules/settings/model';
import { connectTestDb, dropTestDb } from './helpers';

beforeAll(connectTestDb);
afterAll(dropTestDb);

const SHAPE = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/;
// Independent of toIst(): IST is UTC+05:30
const istOf = (d: Date) => dayjs(d).add(330, 'minute').utc().format('YYYY-MM-DD HH:mm:ss');

describe('IST companion fields', () => {
  it('save(): createdAt / updatedAt and explicit Date fields', async () => {
    const emp = await Employee.create({ code: 'I1', name: 'Ist Test', dateOfJoining: '2024-01-01' });
    const day = await AttendanceDay.create({ employee: emp._id, date: '2026-10-29', checkIn: new Date('2026-10-29T04:38:34.152Z') });

    const rawEmp = await Employee.collection.findOne({ _id: emp._id });
    expect(rawEmp!.createdAtIST).toBe(istOf(rawEmp!.createdAt));
    expect(rawEmp!.updatedAtIST).toBe(istOf(rawEmp!.updatedAt));

    const rawDay = await AttendanceDay.collection.findOne({ _id: day._id });
    expect(rawDay!.checkInIST).toBe('2026-10-29 10:08:34'); // 04:38:34 UTC
    expect(rawDay!.checkOutIST).toBeUndefined();

    // a later save keeps the companions in step
    day.checkOut = new Date('2026-10-29T13:00:00Z');
    await day.save();
    expect((await AttendanceDay.collection.findOne({ _id: day._id }))!.checkOutIST).toBe('2026-10-29 18:30:00');
  });

  it('updates and upserts: timestamps and $push-ed subdocument dates', async () => {
    const actor = new Types.ObjectId();
    await lockMonth('2026-05', actor, 'test'); // findOneAndUpdate upsert + $push { at: Date }
    await unlockMonth('2026-05', actor, 'testing the unlock'); // save() on a subdocument array

    const raw = await AttendanceLock.collection.findOne({ month: '2026-05' });
    expect(raw!.createdAtIST).toBe(istOf(raw!.createdAt));
    expect(raw!.updatedAtIST).toBe(istOf(raw!.updatedAt));
    expect(raw!.history).toHaveLength(2);
    for (const h of raw!.history) {
      expect(h.atIST).toMatch(SHAPE);
      expect(h.atIST).toBe(istOf(h.at));
    }
  });

  it('updateOne with $inc/$push still gets updatedAt IST', async () => {
    const e = new Types.ObjectId();
    await LeaveBalance.updateOne({ employee: e, leaveType: e, year: 2026 }, { $inc: { used: 1 } }, { upsert: true });
    const raw = await LeaveBalance.collection.findOne({ employee: e });
    expect(raw!.createdAtIST).toBe(istOf(raw!.createdAt));
    expect(raw!.updatedAtIST).toBe(istOf(raw!.updatedAt));
  });

  it('findOneAndUpdate on settings', async () => {
    await Setting.findOneAndUpdate({ key: 'k', effectiveFrom: '2026-01-01' }, { value: 1 }, { upsert: true, new: true });
    const raw = await Setting.collection.findOne({ key: 'k' });
    expect(raw!.updatedAtIST).toBe(istOf(raw!.updatedAt));
  });

  it('toIst formats in Asia/Kolkata', () => {
    expect(toIst(new Date('2026-12-31T20:00:00Z'))).toBe('2027-01-01 01:30:00');
  });
});
