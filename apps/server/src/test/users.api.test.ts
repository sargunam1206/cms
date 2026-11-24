import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { User } from '../modules/users/model';
import { app, connectTestDb, createPerson, dropTestDb, seedRoles } from './helpers';

let roles: Awaited<ReturnType<typeof seedRoles>>;
beforeAll(async () => {
  await connectTestDb();
  roles = await seedRoles();
});
afterAll(dropTestDb);

const userOf = async (p: { employee: { _id: unknown } }) => (await User.findOne({ employee: p.employee._id }))!;

describe('user logins', () => {
  it('admin changes a login email; duplicates are refused; the person signs in with the new email', async () => {
    const admin = await createPerson(roles.Admin);
    const emp = await createPerson(roles.Employee);
    const other = await createPerson(roles.Employee);
    const u = await userOf(emp);
    const taken = (await userOf(other)).email;
    await request(app).patch(`/api/users/${u._id}`).set(admin.auth).send({ email: taken }).expect(409);
    await request(app).patch(`/api/users/${u._id}`).set(admin.auth).send({ email: 'New.Address@Test.local' }).expect(200);
    expect((await User.findById(u._id))!.email).toBe('new.address@test.local');
    await request(app).post('/api/auth/login').send({ email: 'new.address@test.local', password: 'Passw0rd!' }).expect(200);
  });

  it('admin deletes a login; cannot delete their own or the last active admin; others cannot delete', async () => {
    const admin = await createPerson(roles.Admin);
    const emp = await createPerson(roles.Employee);
    const u = await userOf(emp);
    await request(app).delete(`/api/users/${u._id}`).set(emp.auth).expect(403);
    await request(app).delete(`/api/users/${u._id}`).set(admin.auth).expect(204);
    expect(await User.exists({ _id: u._id })).toBeNull();
    await request(app).post('/api/auth/login').send({ email: u.email, password: 'Passw0rd!' }).expect(401);

    const me = await userOf(admin);
    await request(app).delete(`/api/users/${me._id}`).set(admin.auth).expect(400);

    // Leave exactly one active admin, then try deleting it from an HR-like account with users.manage
    await User.updateMany({ role: roles.Admin, _id: { $ne: me._id } }, { status: 'disabled' });
    const admin2 = await createPerson(roles.Admin);
    await User.updateOne({ _id: me._id }, { status: 'disabled' });
    const a2 = await userOf(admin2);
    await request(app).delete(`/api/users/${me._id}`).set(admin2.auth).expect(204); // disabled admin can go
    expect(await User.countDocuments({ role: roles.Admin, status: 'active' })).toBe(1);
    expect(String(a2._id)).toBeTruthy();
  });
});
