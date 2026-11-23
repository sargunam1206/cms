import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
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

describe('management project tracker', () => {
  it('summarises progress, lists every document with downloads, and shows the activity feed; members cannot open it', async () => {
    const mgmt = await createPerson(roles.Management);
    const hr = await createPerson(roles.HR);
    const lead = await createPerson(roles.Manager);
    const dev = await createPerson(roles.Employee);
    const code = `TR-${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
    const p = (await request(app).post('/api/projects').set(mgmt.auth).send({ code, name: 'Tracked', manager: id(lead), members: [id(dev)], status: 'active', dueDate: '2099-01-01' }).expect(201)).body;
    const t1 = (await request(app).post(`/api/projects/${p._id}/tasks`).set(lead.auth).send({ title: 'Done task', assignee: id(dev) }).expect(201)).body;
    await request(app).post(`/api/projects/${p._id}/tasks`).set(dev.auth).send({ title: 'Overdue task', assignee: id(dev), dueDate: '2020-01-01' }).expect(201);
    await request(app).post(`/api/projects/tasks/${t1._id}/status`).set(dev.auth).send({ status: 'done' }).expect(200);
    const d = (await request(app).post(`/api/projects/${p._id}/documents`).query({ name: 'Brief.pdf', title: 'Brief', category: 'brief' }).set(dev.auth).set('Content-Type', 'application/octet-stream').send(PDF).expect(201)).body;
    await request(app).get(`/api/projects/${p._id}/documents/${d._id}/versions/${d.latest._id}`).set(lead.auth).expect(200);

    const s = (await request(app).get('/api/projects/tracker/summary').query({ q: code }).set(mgmt.auth).expect(200)).body;
    const row = s.items.find((x: any) => x.code === code);
    expect(row.tasks).toMatchObject({ total: 2, done: 1, overdue: 1 });
    expect(row.progress).toBe(50);
    expect(row.documents.count).toBe(1);
    expect(row.health).toBe('amber'); // overdue work, but the project itself is not late

    const docs = (await request(app).get('/api/projects/tracker/documents').query({ project: p._id }).set(hr.auth).expect(200)).body;
    expect(docs.items[0]).toMatchObject({ title: 'Brief', version: 1, downloads: 1 });
    expect(docs.items[0].lastDownload.by).toBeTruthy();

    const feed = (await request(app).get('/api/projects/tracker/activity').query({ project: code }).set(mgmt.auth).expect(200)).body;
    const actions = feed.map((f: any) => f.action);
    expect(actions).toEqual(expect.arrayContaining(['task.create', 'task.status', 'project.document.add', 'project.document.download']));
    expect(feed.find((f: any) => f.action === 'task.status').detail).toBe('todo → done');

    await request(app).get('/api/projects/tracker/summary').set(dev.auth).expect(403);
    await request(app).get('/api/projects/tracker/summary').set(lead.auth).expect(403);
  });
});
