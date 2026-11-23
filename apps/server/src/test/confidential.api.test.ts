import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { ConfidentialAccess, ConfidentialDoc, ConfidentialFile } from '../modules/confidential/model';
import { notifyExpiringDocuments } from '../modules/confidential/service';
import { Notification } from '../modules/notifications/model';
import { User } from '../modules/users/model';
import { resetClock, setClock } from '../utils/time';
import { app, connectTestDb, createPerson, dropTestDb, seedRoles } from './helpers';

let roles: Awaited<ReturnType<typeof seedRoles>>;
beforeAll(async () => {
  await connectTestDb();
  roles = await seedRoles();
});
afterAll(dropTestDb);
afterEach(resetClock);

type Person = Awaited<ReturnType<typeof createPerson>>;
const id = (p: Person) => String(p.employee._id);
const PDF = Buffer.concat([Buffer.from('%PDF-1.4\n'), Buffer.from('1 0 obj <<>> endobj\n'.repeat(20))]);
const PDF2 = Buffer.concat([Buffer.from('%PDF-1.7\n'), Buffer.from('9 0 obj <<>> endobj\n'.repeat(25))]);
const binary = (res: any, cb: any) => {
  const c: Buffer[] = [];
  res.on('data', (d: Buffer) => c.push(d));
  res.on('end', () => cb(null, Buffer.concat(c)));
};

async function world() {
  const mgmt = await createPerson(roles.Management);
  const hr = await createPerson(roles.HR);
  const hr2 = await createPerson(roles.HR);
  const manager = await createPerson(roles.Manager);
  const emp = await createPerson(roles.Employee);
  const name = `Legal ${Math.random().toString(36).slice(2, 7)}`;
  const folder = (await request(app).post('/api/confidential/folders').set(mgmt.auth).send({ name, editors: [id(hr)] }).expect(201)).body;
  return { mgmt, hr, hr2, manager, emp, folder };
}
type W = Awaited<ReturnType<typeof world>>;
const add = (w: W, who: Person, q: object = {}, body = PDF) =>
  request(app).post(`/api/confidential/folders/${w.folder._id}/documents`).query({ name: 'Lease.pdf', title: 'Office lease', ...q }).set(who.auth).set('Content-Type', 'application/octet-stream').send(body);

describe('confidential documents', () => {
  it('only Admin, Management and HR can open the area; Managers and Employees cannot', async () => {
    const w = await world();
    await request(app).get('/api/confidential/folders').set(w.hr2.auth).expect(200);
    await request(app).get('/api/confidential/folders').set(w.manager.auth).expect(403);
    await request(app).get('/api/confidential/folders').set(w.emp.auth).expect(403);
    await request(app).post('/api/confidential/folders').set(w.hr.auth).send({ name: 'Mine' }).expect(403); // HR cannot create folders
  });

  it('folder editors (and Management) upload; other HR can read but not upload or delete', async () => {
    const w = await world();
    const d = (await add(w, w.hr).expect(201)).body;
    await add(w, w.mgmt, { title: 'Insurance' }).expect(201);
    await add(w, w.hr2, { title: 'Nope' }).expect(403);
    const l = (await request(app).get(`/api/confidential/folders/${w.folder._id}/documents`).set(w.hr2.auth).expect(200)).body;
    expect(l.items).toHaveLength(2);
    expect(l.canEdit).toBe(false);
    await request(app).delete(`/api/confidential/documents/${d._id}`).set(w.hr2.auth).expect(403);
  });

  it('logs every download, keeps versions, and keeps the log after delete', async () => {
    const w = await world();
    const d = (await add(w, w.hr).expect(201)).body;
    const v2 = (await request(app).post(`/api/confidential/documents/${d._id}/versions`).query({ name: 'Lease signed.pdf', note: 'signed' }).set(w.hr.auth).set('Content-Type', 'application/octet-stream').send(PDF2).expect(201)).body;
    expect(v2.versions.map((v: any) => v.version)).toEqual([2, 1]);

    const r = await request(app).get(`/api/confidential/documents/${d._id}/versions/${v2.versions[1]._id}`).set(w.hr2.auth).buffer().parse(binary).expect(200);
    expect(Buffer.compare(r.body, PDF)).toBe(0);
    await request(app).get(`/api/confidential/documents/${d._id}/versions/${v2.versions[0]._id}`).set(w.mgmt.auth).buffer().parse(binary).expect(200);

    const log = (await request(app).get(`/api/confidential/documents/${d._id}/access`).set(w.mgmt.auth).expect(200)).body;
    expect(log).toHaveLength(2);
    expect(log.map((x: any) => x.version).sort()).toEqual([1, 2]);

    await request(app).delete(`/api/confidential/documents/${d._id}`).set(w.hr.auth).expect(200);
    expect(await ConfidentialFile.countDocuments({ doc: d._id })).toBe(0);
    expect(await ConfidentialAccess.countDocuments({ doc: d._id })).toBe(2);
  });

  it('a folder with documents cannot be deleted', async () => {
    const w = await world();
    await add(w, w.hr).expect(201);
    await request(app).delete(`/api/confidential/folders/${w.folder._id}`).set(w.mgmt.auth).expect(409);
  });

  it('expiry: listed when inside the reminder window, and editors + managers are reminded once', async () => {
    const w = await world();
    const d = (await add(w, w.hr, { title: 'Trade licence', expiresOn: '2027-06-30', remindDays: 30 }).expect(201)).body;
    setClock(() => new Date('2027-05-20T04:00:00Z')); // 41 days before
    expect(await notifyExpiringDocuments()).toBe(0);
    setClock(() => new Date('2027-06-05T04:00:00Z')); // 25 days before
    const exp = (await request(app).get('/api/confidential/expiring').set(w.hr2.auth).expect(200)).body;
    expect(exp.map((x: any) => String(x._id))).toContain(String(d._id));
    await notifyExpiringDocuments();
    await notifyExpiringDocuments(); // the next morning: no second unread reminder
    const hrUser = (await User.findOne({ employee: w.hr.employee._id }))!._id;
    const mgmtUser = (await User.findOne({ employee: w.mgmt.employee._id }))!._id;
    expect(await Notification.countDocuments({ user: hrUser, type: 'document.expiry' })).toBe(1);
    expect(await Notification.countDocuments({ user: mgmtUser, type: 'document.expiry' })).toBeGreaterThanOrEqual(1);
    expect(await ConfidentialDoc.countDocuments({ _id: d._id })).toBe(1);
  });
});
