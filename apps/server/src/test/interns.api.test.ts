import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { Employee } from '../modules/employees/model';
import { InternTask, Internship } from '../modules/interns/model';
import { AttendanceDay } from '../modules/attendance/model';
import { Notification } from '../modules/notifications/model';
import { Project } from '../modules/projects/model';
import { User } from '../modules/users/model';
import { resetClock, setClock, zonedDateTime } from '../utils/time';
import { finalizeMissedCheckouts } from '../modules/attendance/service';
import { app, connectTestDb, createPerson, dropTestDb, seedRoles } from './helpers';

let roles: Awaited<ReturnType<typeof seedRoles>>;
beforeAll(async () => {
  await connectTestDb();
  roles = await seedRoles();
});
afterAll(dropTestDb);

type Person = Awaited<ReturnType<typeof createPerson>>;
const id = (p: Person) => String(p.employee._id);
const PDF = Buffer.concat([Buffer.from('%PDF-1.4\n'), Buffer.from('1 0 obj <<>> endobj\n'.repeat(20))]);
let n = 0;

async function world() {
  const hr = await createPerson(roles.HR);
  const mentor = await createPerson(roles.Manager);
  const other = await createPerson(roles.Manager);
  const emp = await createPerson(roles.Employee);
  const code = `INT-${++n}-${Math.random().toString(36).slice(2, 5).toUpperCase()}`;
  const email = `${code.toLowerCase()}@college.test`;
  const r = await request(app)
    .post('/api/interns')
    .set(hr.auth)
    .send({ code, name: 'Priya Intern', email, organization: 'Anna University', course: 'B.E. CSE', startDate: '2026-11-01', endDate: '2027-01-31', mentor: id(mentor), stipend: 8000, password: 'Intern@123' })
    .expect(201);
  const internId = r.body._id as string;
  const login = await request(app).post('/api/auth/login').send({ email, password: 'Intern@123' }).expect(200);
  const intern = { auth: { Authorization: `Bearer ${login.body.accessToken}` } };
  return { hr, mentor, other, emp, internId, intern, code };
}

describe('interns', () => {
  it('HR adds an intern with a login; they are an intern record, kept off the Employees list', async () => {
    const w = await world();
    const e = await Employee.findById(w.internId).lean();
    expect(e).toMatchObject({ type: 'intern', designation: 'Intern', dateOfJoining: '2026-11-01' });
    expect(String(e!.manager)).toBe(id(w.mentor));
    const i = await Internship.findOne({ employee: w.internId }).lean();
    expect(i).toMatchObject({ status: 'onboarding', stipend: 800000 });
    expect(i!.checklist.length).toBeGreaterThan(5);

    const emps = (await request(app).get('/api/employees').query({ type: 'employee', limit: 500 }).set(w.hr.auth).expect(200)).body;
    expect(emps.items.some((x: any) => x._id === w.internId)).toBe(false);
    const interns = (await request(app).get('/api/employees').query({ type: 'intern', limit: 500 }).set(w.hr.auth).expect(200)).body;
    expect(interns.items.some((x: any) => x._id === w.internId)).toBe(true);

    const me = (await request(app).get('/api/auth/me').set(w.intern.auth).expect(200)).body;
    expect(me.role).toBe('Intern');
    expect(me.employee.type).toBe('intern');
    expect(me.permissions).not.toContain('payroll.view');
  });

  it('only HR adds interns; the mentor sees their intern, other managers do not; employees cannot open interns', async () => {
    const w = await world();
    await request(app).post('/api/interns').set(w.mentor.auth).send({ code: 'X-1', name: 'Nope', organization: 'X College', startDate: '2026-11-01', endDate: '2026-12-01' }).expect(403);
    const mine = (await request(app).get('/api/interns').set(w.mentor.auth).expect(200)).body;
    expect(mine.items.map((x: any) => x._id)).toEqual([w.internId]);
    expect((await request(app).get('/api/interns').set(w.other.auth).expect(200)).body.items).toHaveLength(0);
    await request(app).get(`/api/interns/${w.internId}`).set(w.other.auth).expect(404);
    await request(app).get('/api/interns').set(w.emp.auth).expect(403);
    const detail = (await request(app).get(`/api/interns/${w.internId}`).set(w.mentor.auth).expect(200)).body;
    expect(detail.stipend).toBeUndefined(); // money is for HR and the intern only
    expect(detail.canGuide).toBe(true);
  });

  it('onboarding checklist: finishing every step makes the intern active', async () => {
    const w = await world();
    const i = (await request(app).get(`/api/interns/${w.internId}`).set(w.hr.auth)).body;
    const items = i.checklist.map((c: any) => ({ label: c.label, done: true }));
    const r = (await request(app).put(`/api/interns/${w.internId}/checklist`).set(w.mentor.auth).send({ items }).expect(200)).body;
    expect(r.status).toBe('active');
    expect(r.checklist[0].doneByName).toBeTruthy();
  });

  it('documents and stipend: the intern uploads their NOC; HR records stipend once per month', async () => {
    const w = await world();
    await request(app).post(`/api/interns/${w.internId}/documents`).query({ name: 'NOC.pdf', title: 'College NOC' }).set(w.intern.auth).set('Content-Type', 'application/octet-stream').send(PDF).expect(201);
    await request(app).post(`/api/interns/${w.internId}/stipend`).set(w.hr.auth).send({ month: '2026-11', amount: 8000, paidOn: '2026-12-01' }).expect(201);
    await request(app).post(`/api/interns/${w.internId}/stipend`).set(w.hr.auth).send({ month: '2026-11', amount: 8000, paidOn: '2026-12-02' }).expect(409);
    await request(app).post(`/api/interns/${w.internId}/stipend`).set(w.mentor.auth).send({ month: '2026-12', amount: 8000, paidOn: '2027-01-01' }).expect(403);
    const d = (await request(app).get(`/api/interns/${w.internId}`).set(w.hr.auth)).body;
    expect(d.documents.map((x: any) => x.title)).toEqual(['College NOC']);
    expect(d.stipendPayments[0]).toMatchObject({ month: '2026-11', amount: 800000 });
  });

  it('allocation puts the intern on the project team; work is given, logged, submitted and reviewed', async () => {
    const w = await world();
    const mgmt = await createPerson(roles.Management);
    const project = (await request(app).post('/api/projects').set(mgmt.auth).send({ code: `IP-${w.code}`.slice(0, 20), name: 'Intern project', manager: id(w.mentor), members: [], status: 'active' }).expect(201)).body;
    await request(app).post(`/api/interns/${w.internId}/allocations`).set(w.mentor.auth).send({ project: project._id, from: '2026-11-03', note: 'Frontend' }).expect(201);
    expect((await Project.findById(project._id).lean())!.members.map(String)).toContain(w.internId);

    const t = (await request(app).post(`/api/interns/${w.internId}/tasks`).set(w.mentor.auth).send({ title: 'Build the login form', kind: 'project', project: project._id, dueDate: '2026-11-20' }).expect(201)).body;
    const internUser = await User.findOne({ employee: w.internId });
    expect(await Notification.countDocuments({ user: internUser!._id, type: 'intern.task' })).toBe(1);
    await request(app).post(`/api/interns/${w.internId}/tasks`).set(w.other.auth).send({ title: 'Not my intern' }).expect(404);

    await request(app).post(`/api/interns/tasks/${t._id}/logs`).set(w.intern.auth).send({ date: '2026-11-04', minutes: 180, note: 'Built the layout' }).expect(201);
    await request(app).post(`/api/interns/tasks/${t._id}/logs`).set(w.mentor.auth).send({ date: '2026-11-04', minutes: 60, note: 'Mentor trying to log' }).expect(403);
    await request(app).post(`/api/interns/tasks/${t._id}/status`).set(w.intern.auth).send({ status: 'approved' }).expect(403); // cannot approve own work
    await request(app).post(`/api/interns/tasks/${t._id}/status`).set(w.intern.auth).send({ status: 'submitted', note: 'Ready' }).expect(200);
    const mentorUser = await User.findOne({ employee: w.mentor.employee._id });
    expect(await Notification.countDocuments({ user: mentorUser!._id, type: 'intern.submitted' })).toBe(1);
    await request(app).post(`/api/interns/tasks/${t._id}/status`).set(w.mentor.auth).send({ status: 'approved', rating: 4, note: 'Good work' }).expect(200);

    const board = (await request(app).get('/api/interns/work').set(w.intern.auth).expect(200)).body;
    expect(board).toHaveLength(1);
    expect(board[0]).toMatchObject({ status: 'approved', loggedMinutes: 180, mine: true, canReview: false });
    expect(board[0].reviews[0]).toMatchObject({ outcome: 'approved', rating: 4 });
    expect((await request(app).get('/api/interns/work').set(w.other.auth).expect(200)).body).toHaveLength(0);
  });

  it('interns log their own enquiries; their mentor sees them in the team view; other interns and managers do not', async () => {
    const w = await world();
    const e = (await request(app).post('/api/enquiries').set(w.intern.auth).send({ name: 'Lead from college fest', phone: `98${String(Date.now()).slice(-8)}`, source: 'Referral', nextFollowUp: '2099-01-01' }).expect(201)).body;
    const mine = (await request(app).get('/api/enquiries').set(w.intern.auth).expect(200)).body;
    expect(mine.items.map((x: any) => x._id)).toContain(e._id);
    const mentorView = (await request(app).get('/api/enquiries').set(w.mentor.auth).expect(200)).body;
    expect(mentorView.items.map((x: any) => x._id)).toContain(e._id);
    const otherView = (await request(app).get('/api/enquiries').set(w.other.auth).expect(200)).body;
    expect(otherView.items.map((x: any) => x._id)).not.toContain(e._id);
  });

  it('a company intern on an hourly basis: hours come from attendance and the amount from the rate', async () => {
    const hr = await createPerson(roles.HR);
    const code = `INT-H-${++n}`;
    const r = await request(app)
      .post('/api/interns')
      .set(hr.auth)
      .send({ code, name: 'Hourly Intern', source: 'company', organization: 'ABC Infotech', startDate: '2026-10-01', endDate: '2026-12-31', payBasis: 'hourly', stipend: 150, hoursPerWeek: 20 })
      .expect(201);
    const d = (await request(app).get(`/api/interns/${r.body._id}`).set(hr.auth).expect(200)).body;
    expect(d).toMatchObject({ source: 'company', organization: 'ABC Infotech', payBasis: 'hourly', stipend: 15000, hoursPerWeek: 20 });

    // 2 days in October: 4h and 6h30m = 10.5 hours at Rs 150 = Rs 1,575
    await AttendanceDay.create([
      { employee: r.body._id, date: '2026-10-05', workedMinutes: 240, status: 'present' },
      { employee: r.body._id, date: '2026-10-06', workedMinutes: 390, status: 'present' },
      { employee: r.body._id, date: '2026-11-02', workedMinutes: 480, status: 'present' },
    ]);
    const h = (await request(app).get(`/api/interns/${r.body._id}/hours`).query({ month: '2026-10' }).set(hr.auth).expect(200)).body;
    expect(h).toMatchObject({ attendanceMinutes: 630, daysWorked: 2, suggestedAmount: 157500 });
    await request(app).post(`/api/interns/${r.body._id}/stipend`).set(hr.auth).send({ month: '2026-10', hours: 10.5, amount: 1575, paidOn: '2026-11-01' }).expect(201);
    const after = (await request(app).get(`/api/interns/${r.body._id}`).set(hr.auth)).body;
    expect(after.stipendPayments[0]).toMatchObject({ month: '2026-10', hours: 10.5, amount: 157500 });

    const list = (await request(app).get('/api/interns').query({ q: 'ABC Info' }).set(hr.auth).expect(200)).body;
    expect(list.items.map((x: any) => x.organization)).toEqual(['ABC Infotech']);
  });

  it('a part-time intern checks in and out several times a day; hours add up; never late, half-day or absent', async () => {
    const hr = await createPerson(roles.HR);
    const code = `INT-P-${++n}`;
    const email = `${code.toLowerCase()}@company.test`;
    const r = await request(app)
      .post('/api/interns')
      .set(hr.auth)
      .send({ code, name: 'Part Timer', email, workType: 'part_time', organization: 'Loyola College', startDate: '2026-09-01', endDate: '2026-12-31', payBasis: 'hourly', stipend: 200, password: 'Intern@123' })
      .expect(201);
    const auth = { Authorization: `Bearer ${(await request(app).post('/api/auth/login').send({ email, password: 'Intern@123' })).body.accessToken}` };
    expect((await Employee.findById(r.body._id).lean())!.workType).toBe('part_time');

    try {
      // Tue 1 Sep: 11:00-12:00 and 16:00-18:00 (3 h, late by full-time rules, but not for part time)
      const at = (d: string, t: string) => setClock(() => zonedDateTime(d, t));
      at('2026-09-01', '11:00');
      await request(app).post('/api/attendance/check-in').set(auth).expect(201);
      at('2026-09-01', '11:30');
      await request(app).post('/api/attendance/check-in').set(auth).expect(409); // already in
      at('2026-09-01', '12:00');
      await request(app).post('/api/attendance/check-out').set(auth).expect(200);
      at('2026-09-01', '16:00');
      await request(app).post('/api/attendance/check-in').set(auth).expect(201);
      const open = (await request(app).get('/api/attendance/today').set(auth).expect(200)).body;
      expect(open.partTime).toBe(true);
      expect(open.record.sessions).toHaveLength(2);
      at('2026-09-01', '18:00');
      await request(app).post('/api/attendance/check-out').set(auth).expect(200);
      // Thu 3 Sep: one hour
      at('2026-09-03', '10:00');
      await request(app).post('/api/attendance/check-in').set(auth).expect(201);
      at('2026-09-03', '11:00');
      await request(app).post('/api/attendance/check-out').set(auth).expect(200);

      const day1 = await AttendanceDay.findOne({ employee: r.body._id, date: '2026-09-01' }).lean();
      expect(day1).toMatchObject({ workedMinutes: 180, status: 'present', isLate: false });
      expect(day1!.sessions).toHaveLength(2);

      at('2026-09-30', '20:00');
      const month = (await request(app).get('/api/attendance/me').query({ month: '2026-09' }).set(auth).expect(200)).body;
      expect(month.summary).toMatchObject({ presentDays: 2, absentDays: 0, lateCount: 0, workedMinutes: 240 });

      const h = (await request(app).get(`/api/interns/${r.body._id}/hours`).query({ month: '2026-09' }).set(hr.auth).expect(200)).body;
      expect(h).toMatchObject({ attendanceMinutes: 240, daysWorked: 2, suggestedAmount: 80000 }); // 4 h x Rs 200

      // Fri 4 Sep: one closed session, then a second left open; the nightly job keeps the closed hour
      at('2026-09-04', '09:00');
      await request(app).post('/api/attendance/check-in').set(auth).expect(201);
      at('2026-09-04', '10:00');
      await request(app).post('/api/attendance/check-out').set(auth).expect(200);
      at('2026-09-04', '15:00');
      await request(app).post('/api/attendance/check-in').set(auth).expect(201);
      await finalizeMissedCheckouts('2026-09-05');
      const day4 = await AttendanceDay.findOne({ employee: r.body._id, date: '2026-09-04' }).lean();
      expect(day4).toMatchObject({ workedMinutes: 60, status: 'present', missedCheckout: true });
    } finally {
      resetClock();
    }
  });

  it('HR deletes an intern with everything that belongs to them; a hired intern cannot be deleted', async () => {
    const w = await world();
    const mgmt = await createPerson(roles.Management);
    const project = (await request(app).post('/api/projects').set(mgmt.auth).send({ code: `DP-${w.code}`.slice(0, 20), name: 'Del project', manager: id(w.mentor), members: [], status: 'active' }).expect(201)).body;
    await request(app).post(`/api/interns/${w.internId}/allocations`).set(w.mentor.auth).send({ project: project._id, from: '2026-11-03' }).expect(201);
    await request(app).post(`/api/interns/${w.internId}/tasks`).set(w.mentor.auth).send({ title: 'Read the docs' }).expect(201);
    await AttendanceDay.create({ employee: w.internId, date: '2026-11-03', workedMinutes: 300, status: 'present' });

    await request(app).delete(`/api/interns/${w.internId}`).set(w.mentor.auth).expect(403);
    await request(app).delete(`/api/interns/${w.internId}`).set(w.hr.auth).expect(200);
    expect(await Employee.exists({ _id: w.internId })).toBeNull();
    expect(await Internship.exists({ employee: w.internId })).toBeNull();
    expect(await User.exists({ employee: w.internId })).toBeNull();
    expect(await InternTask.countDocuments({ intern: w.internId })).toBe(0);
    expect(await AttendanceDay.countDocuments({ employee: w.internId })).toBe(0);
    expect((await Project.findById(project._id).lean())!.members.map(String)).not.toContain(w.internId);
    await request(app).post('/api/auth/login').send({ email: `${w.code.toLowerCase()}@college.test`, password: 'Intern@123' }).expect(401);

    const w2 = await world();
    await request(app).post(`/api/interns/${w2.internId}/convert`).set(w2.hr.auth).send({ dateOfJoining: '2027-02-01' }).expect(200);
    await request(app).delete(`/api/interns/${w2.internId}`).set(w2.hr.auth).expect(409);
  });

  it('completion disables the login; conversion makes them an employee with the Employee role', async () => {
    const w = await world();
    await request(app).patch(`/api/interns/${w.internId}/status`).set(w.hr.auth).send({ status: 'completed', rating: 5, feedback: 'Excellent', certificateIssued: true, date: '2027-01-31' }).expect(200);
    expect((await Employee.findById(w.internId).lean())!.status).toBe('exited');
    expect((await User.findOne({ employee: w.internId }).lean())!.status).toBe('disabled');

    const w2 = await world();
    await request(app).post(`/api/interns/${w2.internId}/convert`).set(w2.hr.auth).send({ dateOfJoining: '2027-02-01', designation: 'Junior Developer' }).expect(200);
    const e = await Employee.findById(w2.internId).lean();
    expect(e).toMatchObject({ type: 'employee', designation: 'Junior Developer', dateOfJoining: '2027-02-01' });
    const u = await User.findOne({ employee: w2.internId }).populate('role').lean();
    expect((u!.role as any).name).toBe('Employee');
    expect((await Internship.findOne({ employee: w2.internId }).lean())!.status).toBe('converted');
  });
});
