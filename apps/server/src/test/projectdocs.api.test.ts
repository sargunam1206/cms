import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { app, connectTestDb, createPerson, dropTestDb, seedRoles } from './helpers';
import { ProjectDoc, ProjectDocFile } from '../modules/projects/documents';

let roles: Awaited<ReturnType<typeof seedRoles>>;
beforeAll(async () => {
  await connectTestDb();
  roles = await seedRoles();
});
afterAll(dropTestDb);

type Person = Awaited<ReturnType<typeof createPerson>>;
const id = (p: Person) => String(p.employee._id);
const PDF = Buffer.concat([Buffer.from('%PDF-1.4\n'), Buffer.from('1 0 obj <<>> endobj\n'.repeat(20))]);
const PDF2 = Buffer.concat([Buffer.from('%PDF-1.7\n'), Buffer.from('2 0 obj <<>> endobj\n'.repeat(30))]);
const DWG = Buffer.concat([Buffer.from('AC1032'), Buffer.alloc(80, 3)]);
const binary = (res: any, cb: any) => {
  const c: Buffer[] = [];
  res.on('data', (d: Buffer) => c.push(d));
  res.on('end', () => cb(null, Buffer.concat(c)));
};

async function world() {
  const mgmt = await createPerson(roles.Management);
  const lead = await createPerson(roles.Manager);
  const dev = await createPerson(roles.Employee);
  const dev2 = await createPerson(roles.Employee);
  const outsider = await createPerson(roles.Employee);
  const code = `PD-${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
  const project = (await request(app).post('/api/projects').set(mgmt.auth).send({ code, name: 'Docs project', manager: id(lead), members: [id(dev), id(dev2)], status: 'active' }).expect(201)).body;
  const task = (await request(app).post(`/api/projects/${project._id}/tasks`).set(lead.auth).send({ title: 'Kitchen', assignee: id(dev) }).expect(201)).body;
  return { mgmt, lead, dev, dev2, outsider, project, task };
}
type W = Awaited<ReturnType<typeof world>>;
const add = (w: W, who: Person, name: string, body: Buffer, q: object = {}) =>
  request(app).post(`/api/projects/${w.project._id}/documents`).query({ name, title: 'Client brief', category: 'brief', ...q }).set(who.auth).set('Content-Type', 'application/octet-stream').send(body);

describe('project documents', () => {
  it('any member can add one, with category and an optional task link; outsiders cannot see or add', async () => {
    const w = await world();
    const d = (await add(w, w.dev, 'Brief.pdf', PDF, { description: 'What the client wants', task: w.task._id }).expect(201)).body;
    expect(d).toMatchObject({ title: 'Client brief', category: 'brief', canEdit: true });
    expect(d.latest).toMatchObject({ version: 1, name: 'Brief.pdf', size: PDF.length });
    await add(w, w.lead, 'Plan.dwg', DWG, { title: 'Floor plan', category: 'drawing' }).expect(201);

    const l = (await request(app).get(`/api/projects/${w.project._id}/documents`).set(w.dev2.auth).expect(200)).body;
    expect(l.items.map((x: any) => x.title).sort()).toEqual(['Client brief', 'Floor plan']);
    expect(l.items.find((x: any) => x.title === 'Client brief').canEdit).toBe(false); // dev2 did not add it
    await request(app).get(`/api/projects/${w.project._id}/documents`).set(w.outsider.auth).expect(404);
    await add(w, w.outsider, 'x.pdf', PDF).expect(404);
  });

  it('refuses unsafe or fake files', async () => {
    const w = await world();
    await add(w, w.dev, 'run.exe', PDF).expect(400);
    await add(w, w.dev, 'fake.pdf', Buffer.from('hello')).expect(400);
  });

  it('keeps every version; any member can upload a newer one; each version downloads its own bytes', async () => {
    const w = await world();
    const d = (await add(w, w.dev, 'Brief.pdf', PDF).expect(201)).body;
    const v2 = (await request(app).post(`/api/projects/${w.project._id}/documents/${d._id}/versions`).query({ name: 'Brief v2.pdf', note: 'Client changes' }).set(w.dev2.auth).set('Content-Type', 'application/octet-stream').send(PDF2).expect(201)).body;
    expect(v2.versions.map((v: any) => v.version)).toEqual([2, 1]);
    expect(v2.latest).toMatchObject({ version: 2, name: 'Brief v2.pdf', note: 'Client changes' });

    const [newest, oldest] = v2.versions;
    const r1 = await request(app).get(`/api/projects/${w.project._id}/documents/${d._id}/versions/${oldest._id}`).set(w.mgmt.auth).buffer().parse(binary).expect(200);
    expect(Buffer.compare(r1.body, PDF)).toBe(0);
    const r2 = await request(app).get(`/api/projects/${w.project._id}/documents/${d._id}/versions/${newest._id}`).set(w.lead.auth).buffer().parse(binary).expect(200);
    expect(Buffer.compare(r2.body, PDF2)).toBe(0);
    expect(r2.headers['content-disposition']).toMatch(/^attachment/);
  });

  it('only the uploader or the project manager can edit or delete; delete removes the stored files', async () => {
    const w = await world();
    const d = (await add(w, w.dev, 'Brief.pdf', PDF).expect(201)).body;
    await request(app).put(`/api/projects/${w.project._id}/documents/${d._id}`).set(w.dev2.auth).send({ title: 'Renamed', category: 'report' }).expect(403);
    await request(app).put(`/api/projects/${w.project._id}/documents/${d._id}`).set(w.dev.auth).send({ title: 'Renamed', category: 'report' }).expect(200);
    await request(app).delete(`/api/projects/${w.project._id}/documents/${d._id}`).set(w.dev2.auth).expect(403);
    await request(app).delete(`/api/projects/${w.project._id}/documents/${d._id}`).set(w.lead.auth).expect(200);
    expect(await ProjectDoc.countDocuments({ _id: d._id })).toBe(0);
    expect(await ProjectDocFile.countDocuments({ doc: d._id })).toBe(0);
  });

  it('a deleted task leaves its documents on the project', async () => {
    const w = await world();
    const d = (await add(w, w.dev, 'Brief.pdf', PDF, { task: w.task._id }).expect(201)).body;
    await request(app).delete(`/api/projects/tasks/${w.task._id}`).set(w.lead.auth).expect(204);
    const doc = await ProjectDoc.findById(d._id).lean();
    expect(doc?.task).toBeNull();
  });
});
