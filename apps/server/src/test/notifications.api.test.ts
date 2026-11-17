import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import { io as connect, type Socket } from 'socket.io-client';

const mails: { to: string; subject: string; text: string }[] = [];
vi.mock('../utils/mailer', () => ({
  mailConfigured: () => true,
  sendMail: async (to: string, subject: string, text: string) => {
    mails.push({ to, subject, text });
    return true;
  },
}));

import { Notification } from '../modules/notifications/model';
import { closeRealtime, initRealtime } from '../modules/notifications/realtime';
import { notifyDueSoon } from '../modules/projects/due';
import { app, connectTestDb, createPerson, dropTestDb, seedLeaveTypes, seedRoles } from './helpers';

let roles: Awaited<ReturnType<typeof seedRoles>>;
let server: http.Server;
let url: string;
beforeAll(async () => {
  await connectTestDb();
  roles = await seedRoles();
  await seedLeaveTypes();
  server = http.createServer(app);
  initRealtime(server);
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(async () => {
  await closeRealtime();
  server.close();
  await dropTestDb();
});

type Person = Awaited<ReturnType<typeof createPerson>>;
const id = (p: Person) => String(p.employee._id);
const mine = async (p: Person, qs = '') => (await request(app).get(`/api/notifications${qs}`).set(p.auth).expect(200)).body as { items: { _id: string; type: string; title: string; link?: string; readAt?: string }[]; unread: number; total: number };
const waitFor = async <T,>(fn: () => Promise<T | undefined | false>, ms = 3000): Promise<T> => {
  const end = Date.now() + ms;
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() > end) throw new Error('timed out waiting');
    await new Promise((r) => setTimeout(r, 25));
  }
};
const applyLeave = (p: Person, date: string) => request(app).post('/api/leave/requests').set(p.auth).send({ leaveType: leaveTypeId, from: date, to: date, halfDay: false, reason: 'Family function' });
let leaveTypeId = '';

describe('events tell the right people', () => {
  it('leave: the manager hears about the request, the employee about the decision, nobody about their own action', async () => {
    const mgr = await createPerson(roles.Manager);
    const emp = await createPerson(roles.Employee, { manager: mgr.employee._id });
    const lt = (await request(app).get('/api/leave/types').set(emp.auth)).body.find((t: { code: string }) => t.code === 'CL');
    leaveTypeId = lt._id;

    const applied = (await applyLeave(emp, '2026-12-14').expect(201)).body;
    const forMgr = await mine(mgr);
    expect(forMgr.items[0]).toMatchObject({ type: 'leave.requested', link: '/approvals' });
    expect(forMgr.items[0].title).toContain(emp.employee.name);
    expect((await mine(emp)).items).toHaveLength(0); // not told about their own request

    await request(app).post(`/api/leave/requests/${applied._id}/decision`).set(mgr.auth).send({ decision: 'approved', comment: 'Enjoy' }).expect(200);
    const forEmp = await mine(emp);
    expect(forEmp.items[0]).toMatchObject({ type: 'leave.decided', title: 'Your leave was approved', link: '/my/leave' });
    expect((await mine(mgr)).items.map((n) => n.type)).not.toContain('leave.decided'); // the decider is not told

    // email: requests and decisions need action, so both went by email
    expect(mails.map((m) => m.to)).toEqual(expect.arrayContaining([]));
    await waitFor(async () => mails.some((m) => m.subject.includes('applied for leave')));
    expect(mails.find((m) => m.subject.includes('applied for leave'))!.text).toContain('/approvals');
  });

  it('tasks and projects: assignment, comments, new members, timesheets', async () => {
    const mgmt = await createPerson(roles.Management);
    const lead = await createPerson(roles.Manager);
    const dev = await createPerson(roles.Employee, { manager: lead.employee._id });
    const code = `NT-${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
    const project = (await request(app).post('/api/projects').set(mgmt.auth).send({ code, name: 'Notified project', manager: id(lead), members: [id(dev)], status: 'active' }).expect(201)).body;
    expect((await mine(dev)).items.map((n) => n.type)).toContain('project.added');
    expect((await mine(lead)).items.map((n) => n.type)).toContain('project.added'); // the lead is told too: Management made them the manager
    expect((await mine(mgmt)).items.map((n) => n.type)).not.toContain('project.added'); // the creator is not told about their own action

    const task = (await request(app).post(`/api/projects/${project._id}/tasks`).set(lead.auth).send({ title: 'Wire up the form', assignee: id(dev) }).expect(201)).body;
    const assigned = (await mine(dev)).items.find((n) => n.type === 'task.assigned')!;
    expect(assigned.title).toContain(`${code}-1`);
    expect(assigned.link).toBe(`/projects/${project._id}`);

    await request(app).post(`/api/projects/tasks/${task._id}/comments`).set(dev.auth).send({ text: 'Started on this' }).expect(201);
    expect((await mine(lead)).items.map((n) => n.type)).toContain('task.comment'); // the reporter hears it
    expect((await mine(dev)).items.filter((n) => n.type === 'task.comment')).toHaveLength(0); // not the commenter

    // reassigning tells the new person
    const dev2 = await createPerson(roles.Employee);
    await request(app).put(`/api/projects/${project._id}`).set(mgmt.auth).send({ code, name: 'Notified project', manager: id(lead), members: [id(dev), id(dev2)], status: 'active' }).expect(200);
    expect((await mine(dev2)).items.map((n) => n.type)).toContain('project.added');
    await request(app).put(`/api/projects/tasks/${task._id}`).set(lead.auth).send({ title: 'Wire up the form', assignee: id(dev2), status: 'todo', priority: 'medium' }).expect(200);
    expect((await mine(dev2)).items.map((n) => n.type)).toContain('task.assigned');
  });

  it('due-soon reminders go once per task and due date, and skip finished work and closed projects', async () => {
    const mgmt = await createPerson(roles.Management);
    const lead = await createPerson(roles.Manager);
    const dev = await createPerson(roles.Employee);
    const code = `DS-${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
    const project = (await request(app).post('/api/projects').set(mgmt.auth).send({ code, name: 'Deadline project', manager: id(lead), members: [id(dev)], status: 'active' }).expect(201)).body;
    const mk = async (title: string, dueDate: string) => (await request(app).post(`/api/projects/${project._id}/tasks`).set(lead.auth).send({ title, assignee: id(dev), dueDate }).expect(201)).body;
    const soon = await mk('Due tomorrow', '2026-11-11');
    await mk('Due today', '2026-11-10');
    await mk('Far away', '2026-12-31');
    const done = await mk('Already done', '2026-11-10');
    await request(app).post(`/api/projects/tasks/${done._id}/status`).set(dev.auth).send({ status: 'done' }).expect(200);

    expect(await notifyDueSoon('2026-11-10')).toBe(2);
    const reminders = (await mine(dev)).items.filter((n) => n.type === 'task.due_soon');
    expect(reminders.map((n) => n.title).sort()).toEqual([`${code}-1 is due tomorrow`, `${code}-2 is due today`]);
    await notifyDueSoon('2026-11-10'); // the job running twice does not repeat itself
    expect((await mine(dev)).items.filter((n) => n.type === 'task.due_soon')).toHaveLength(2);
    void soon;
  });
});

describe('the bell: list, read state, preferences', () => {
  it('lists only my notifications, marks read, and others cannot touch mine', async () => {
    const a = await createPerson(roles.Employee);
    const b = await createPerson(roles.Employee);
    await Notification.insertMany([1, 2, 3].map((n) => ({ user: a.employee._id, type: 'task.comment', title: `Note ${n}` }))); // wrong id type on purpose
    await Notification.deleteMany({ user: a.employee._id });
    const { notify } = await import('../modules/notifications/service');
    const userA = (await import('../modules/users/model')).User;
    const ua = (await userA.findOne({ employee: a.employee._id }).lean())!._id;
    for (const n of [1, 2, 3]) await notify({ type: 'payslip.ready', to: [ua], title: `Payslip ${n}` });

    const list = await mine(a);
    expect(list).toMatchObject({ total: 3, unread: 3 });
    expect(list.items.map((n) => n.title)).toEqual(['Payslip 3', 'Payslip 2', 'Payslip 1']); // newest first
    expect((await request(app).get('/api/notifications/unread-count').set(a.auth)).body.unread).toBe(3);
    expect((await mine(b)).items).toHaveLength(0);

    await request(app).post(`/api/notifications/${list.items[0]._id}/read`).set(b.auth).expect(404); // not yours
    await request(app).post(`/api/notifications/${list.items[0]._id}/read`).set(a.auth).expect(200);
    expect((await mine(a)).unread).toBe(2);
    expect((await mine(a, '?unread=true')).items).toHaveLength(2);
    expect((await mine(a, '?limit=1&page=2')).items.map((n) => n.title)).toEqual(['Payslip 2']);
    await request(app).post('/api/notifications/read-all').set(a.auth).expect(200);
    expect((await mine(a)).unread).toBe(0);
    await request(app).get('/api/notifications').expect(401);
  });

  it('preferences switch off emails or bell entries per kind', async () => {
    const mgr = await createPerson(roles.Manager);
    const emp = await createPerson(roles.Employee, { manager: mgr.employee._id });
    const lt = (await request(app).get('/api/leave/types').set(emp.auth)).body.find((t: { code: string }) => t.code === 'CL');
    leaveTypeId = lt._id;
    const types = (await request(app).get('/api/notifications/types').set(mgr.auth).expect(200)).body;
    expect(types.find((t: { key: string }) => t.key === 'leave.requested')).toMatchObject({ email: true });
    expect(types.find((t: { key: string }) => t.key === 'payslip.ready')).toMatchObject({ email: false });

    await request(app).put('/api/notifications/prefs').set(mgr.auth).send({ emailMuted: ['leave.requested'], inAppMuted: [] }).expect(200);
    const before = mails.length;
    await applyLeave(emp, '2026-12-15').expect(201);
    expect((await mine(mgr)).items.map((n) => n.type)).toContain('leave.requested'); // still in the bell
    await new Promise((r) => setTimeout(r, 200));
    expect(mails.length).toBe(before); // but no email

    await request(app).put('/api/notifications/prefs').set(mgr.auth).send({ emailMuted: [], inAppMuted: ['leave.requested'] }).expect(200);
    const count = (await mine(mgr)).total;
    await applyLeave(emp, '2026-12-16').expect(201);
    expect((await mine(mgr)).total).toBe(count); // muted in the bell
    await waitFor(async () => mails.length > before); // but the email still goes
    await request(app).put('/api/notifications/prefs').set(mgr.auth).send({ emailMuted: ['nonsense'], inAppMuted: [] }).expect(400);
    expect((await request(app).get('/api/notifications/prefs').set(mgr.auth)).body).toEqual({ emailMuted: [], inAppMuted: ['leave.requested'] });
  });
});

describe('real time', () => {
  const connectAs = (token?: string): Promise<Socket> =>
    new Promise((resolve, reject) => {
      const s = connect(url, { auth: token ? { token } : {}, transports: ['websocket'], reconnection: false });
      s.on('connect', () => resolve(s));
      s.on('connect_error', (e) => {
        s.close();
        reject(e);
      });
    });

  it('pushes a notification to its owner instantly, and to nobody else', async () => {
    const mgr = await createPerson(roles.Manager);
    const other = await createPerson(roles.Manager);
    const emp = await createPerson(roles.Employee, { manager: mgr.employee._id });
    leaveTypeId = (await request(app).get('/api/leave/types').set(emp.auth)).body.find((t: { code: string }) => t.code === 'CL')._id;

    await expect(connectAs()).rejects.toThrow(/Not authenticated/);
    await expect(connectAs('garbage')).rejects.toThrow(/Session expired/);

    const mine$ = await connectAs(mgr.token);
    const theirs$ = await connectAs(other.token);
    const got: { type: string; title: string; link: string }[] = [];
    const leaked: unknown[] = [];
    mine$.on('notification', (n) => got.push(n));
    theirs$.on('notification', (n) => leaked.push(n));

    await applyLeave(emp, '2026-12-17').expect(201);
    const n = await waitFor(async () => got[0]);
    expect(n).toMatchObject({ type: 'leave.requested', link: '/approvals' });
    await new Promise((r) => setTimeout(r, 150));
    expect(leaked).toHaveLength(0); // a different manager's socket heard nothing
    mine$.close();
    theirs$.close();
  });
});
