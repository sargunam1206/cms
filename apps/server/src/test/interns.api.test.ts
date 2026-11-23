import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { Employee } from '../modules/employees/model';
import { Internship } from '../modules/interns/model';
import { Notification } from '../modules/notifications/model';
import { Project } from '../modules/projects/model';
import { User } from '../modules/users/model';
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
    .send({ code, name: 'Priya Intern', email, college: 'Anna University', course: 'B.E. CSE', startDate: '2026-11-01', endDate: '2027-01-31', mentor: id(mentor), stipend: 8000, password: 'Intern@123' })
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
    await request(app).post('/api/interns').set(w.mentor.auth).send({ code: 'X-1', name: 'Nope', college: 'X College', startDate: '2026-11-01', endDate: '2026-12-01' }).expect(403);
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
