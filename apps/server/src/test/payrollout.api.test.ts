import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import dayjs from 'dayjs';
import ExcelJS from 'exceljs';
import { AttendanceDay } from '../modules/attendance/model';
import { Employee } from '../modules/employees/model';
import { LeaveType } from '../modules/leave/model';
import { Loan } from '../modules/payroll/model';
import { fillRows } from '../modules/payroll/service';
import { app, connectTestDb, createPerson, dropTestDb, seedRoles } from './helpers';

let roles: Awaited<ReturnType<typeof seedRoles>>;
beforeAll(async () => {
  await connectTestDb();
  roles = await seedRoles();
});
afterAll(dropTestDb);

const MONTH = '2026-09';
const binary = (res: request.Response, cb: (err: Error | null, b: Buffer) => void) => {
  const chunks: Buffer[] = [];
  res.on('data', (c: Buffer) => chunks.push(c));
  res.on('end', () => cb(null, Buffer.concat(chunks)));
};
const get = (url: string, auth: Record<string, string>) => request(app).get(url).set(auth).buffer(true).parse(binary as never);

async function sheet(buf: Buffer | ArrayBuffer) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf as never);
  return wb;
}

describe('payslip PDF, bank file and statutory reports', () => {
  it('produces them from an approved run, with the right numbers and access rules', async () => {
    const admin = await createPerson(roles.Admin);
    await request(app).put('/api/payroll/workflow').set(admin.auth).send({ managementApproval: false }).expect(200);
    await request(app).post('/api/payroll/components').set(admin.auth).send({ code: 'BASIC', name: 'Basic', kind: 'earning', taxable: true, prorate: true, order: 1, active: true, fixedAmount: 0 }).expect(201);
    const emp = await createPerson(roles.Employee);
    const nobank = await createPerson(roles.Employee);
    await Employee.updateOne({ _id: emp.employee._id }, { bank: { accountNumber: '123456789012', ifsc: 'SBIN0001234', bankName: 'SBI' }, pan: 'ABCDE1234F', uan: '100200300400', esiApplicable: true });

    for (const e of [emp, nobank]) {
      const days = [];
      for (let d = dayjs(`${MONTH}-01`); d.month() === 8; d = d.add(1, 'day')) if (d.day() !== 0) days.push({ employee: e.employee._id, date: d.format('YYYY-MM-DD'), status: 'present', source: 'self' });
      await AttendanceDay.insertMany(days);
      await request(app).post(`/api/payroll/structures/${e.employee._id}`).set(admin.auth).send({ effectiveFrom: '2026-01-01', lines: [{ code: 'BASIC', fixedAmount: 18000 }] }).expect(201);
    }

    const run = (await request(app).post('/api/payroll/runs').set(admin.auth).send({ month: MONTH }).expect(201)).body;
    await request(app).get(`/api/payroll/runs/${run._id}/bank`).set(admin.auth).expect(409); // not approved yet
    await request(app).post(`/api/payroll/runs/${run._id}/compute`).set(admin.auth).expect(200);
    await request(app).post(`/api/payroll/runs/${run._id}/submit`).set(admin.auth).expect(200);

    const detail = (await request(app).get(`/api/payroll/runs/${run._id}`).set(admin.auth)).body;
    const slipId = detail.payslips.find((p: { person: { code: string } }) => p.person.code === emp.employee.code)._id;

    // The payslip always lists the standard rows, even when an amount is zero
    const full = (await request(app).get(`/api/payroll/payslips/${slipId}`).set(admin.auth)).body;
    expect(full.layout.deductions.map((d: { code: string }) => d.code)).toEqual(expect.arrayContaining(['PF', 'ESI', 'PT', 'TDS']));
    expect(full.layout.earnings.map((d: { code: string }) => d.code)).toContain('BASIC');
    expect(fillRows([{ code: 'BASIC', name: 'Basic', amount: 5 }, { code: 'BONUS', name: 'Bonus', amount: 9 }], [{ code: 'BASIC', name: 'Basic' }, { code: 'HRA', name: 'HRA' }])).toEqual([
      { code: 'BASIC', name: 'Basic', amount: 5 },
      { code: 'HRA', name: 'HRA', amount: 0 },
      { code: 'BONUS', name: 'Bonus', amount: 9 },
    ]);

    // PDF
    const r1 = await get(`/api/payroll/payslips/${slipId}/pdf`, admin.auth).expect(200);
    const pdf = r1.body as Buffer;
    expect(r1.headers['content-type']).toContain('application/pdf');
    expect(pdf.subarray(0, 4).toString()).toBe('%PDF');
    // employees get their own PDF, not someone else's, and the generic route is closed to them
    await get(`/api/payroll/my/payslips/${slipId}/pdf`, emp.auth).expect(200);
    await get(`/api/payroll/my/payslips/${slipId}/pdf`, nobank.auth).expect(404);
    await get(`/api/payroll/payslips/${slipId}/pdf`, emp.auth).expect(403);

    // Bank sheet: employees with bank details listed, the other on the "missing" sheet; account kept as text
    const bank = await get(`/api/payroll/runs/${run._id}/bank`, admin.auth).expect(200);
    expect(bank.headers['x-missing-bank-details']).toBe('1');
    const wb = await sheet(bank.body as Buffer);
    const rows = wb.getWorksheet('Bank transfer')!;
    expect(rows.getRow(2).getCell('D').value).toBe('123456789012');
    expect(wb.getWorksheet('Missing bank details')!.rowCount).toBe(2);

    // Reports
    const pf = await sheet((await get(`/api/payroll/runs/${run._id}/reports/pf`, admin.auth).expect(200)).body as Buffer);
    const pfRows: unknown[][] = [];
    pf.worksheets[0].eachRow((r) => pfRows.push(r.values as unknown[]));
    const mine = pfRows.find((r) => r.includes(emp.employee.code))!;
    expect(mine).toContain(15000); // PF wages are capped at the 15,000 ceiling
    expect(mine).toContain(1800); // 12% employee share
    await get(`/api/payroll/runs/${run._id}/reports/esi`, admin.auth).expect(200); // below threshold? 18,000 -> ESI applies
    await get(`/api/payroll/runs/${run._id}/reports/pt`, admin.auth).expect(200);
    await get(`/api/payroll/runs/${run._id}/reports/tds`, admin.auth).expect(200);
    const reg = await sheet((await get(`/api/payroll/runs/${run._id}/reports/salary-register`, admin.auth).expect(200)).body as Buffer);
    expect(reg.worksheets[0].rowCount).toBeGreaterThan(3);
    await get(`/api/payroll/runs/${run._id}/reports/nonsense`, admin.auth).expect(400);
    await get(`/api/payroll/runs/${run._id}/reports/pf`, emp.auth).expect(403);
  });
});

describe('full and final settlement', () => {
  it('pays out the exit month and encashable leave, recovers loans, and needs a second person to finalize', async () => {
    const admin = await createPerson(roles.Admin);
    const mgmt = await createPerson(roles.Management);
    await LeaveType.create({ code: 'EL', name: 'Earned Leave', paid: true, annualQuota: 12, accrual: 'yearly', encashable: true });
    await request(app).post('/api/payroll/components').set(admin.auth).send({ code: 'BASIC', name: 'Basic', kind: 'earning', taxable: true, prorate: true, order: 1, active: true, fixedAmount: 0 });
    const emp = await createPerson(roles.Employee, { doj: '2018-01-01' });
    await request(app).post(`/api/payroll/structures/${emp.employee._id}`).set(admin.auth).send({ effectiveFrom: '2018-01-01', lines: [{ code: 'BASIC', fixedAmount: 30000 }] }).expect(201);
    await request(app).post('/api/payroll/loans').set(admin.auth).send({ employee: emp.employee._id, principal: 10000, emi: 2000, startMonth: '2026-01' }).expect(201);

    const body = { employee: emp.employee._id, includeGratuity: true, extra: [{ name: 'Notice period shortfall', kind: 'deduction', amount: 1000 }] };
    await request(app).post('/api/payroll/fnf/preview').set(admin.auth).send(body).expect(400); // no exit date yet

    await Employee.updateOne({ _id: emp.employee._id }, { exitDate: '2026-10-15', status: 'notice' });
    const prev = (await request(app).post('/api/payroll/fnf/preview').set(admin.auth).send(body).expect(200)).body;
    const codes = prev.lines.map((l: { code: string }) => l.code);
    expect(codes).toEqual(expect.arrayContaining(['SALARY', 'ENCASH_EL', 'GRATUITY', 'LOAN', 'OTHER']));
    // 8.8 completed years -> 9 counted; 30,000 x 15/26 x 9 = 155,769.23
    expect(prev.lines.find((l: { code: string }) => l.code === 'GRATUITY').amount).toBe(15_576_923);
    expect(prev.lines.find((l: { code: string }) => l.code === 'LOAN').amount).toBe(1_000_000);
    expect(prev.gratuity.eligible).toBe(true);
    const sum = prev.lines.reduce((s: number, l: { kind: string; amount: number }) => s + (l.kind === 'earning' ? l.amount : -l.amount), 0);
    expect(prev.total).toBe(sum);

    const saved = (await request(app).post('/api/payroll/fnf').set(admin.auth).send(body).expect(201)).body;
    await request(app).post(`/api/payroll/fnf/${saved._id}/finalize`).set(admin.auth).expect(403); // same person
    await request(app).post(`/api/payroll/fnf/${saved._id}/finalize`).set(mgmt.auth).expect(200);
    expect((await Loan.findOne({ employee: emp.employee._id }).lean())?.status).toBe('closed');
    expect((await Employee.findById(emp.employee._id).lean())?.status).toBe('exited');
    await request(app).post('/api/payroll/fnf').set(admin.auth).send(body).expect(409); // already finalized
    await request(app).delete(`/api/payroll/fnf/${saved._id}`).set(admin.auth).expect(409);
  });
});

describe('bulk salary import and combined payslips', () => {
  it('checks a spreadsheet of salaries first, applies it all-or-nothing, and exports one PDF for a run', async () => {
    const hr = await createPerson(roles.HR);
    const emp = await createPerson(roles.Employee);
    await request(app).post('/api/payroll/components').set(hr.auth).send({ code: 'BASIC', name: 'Basic', kind: 'earning', taxable: true, prorate: true, order: 1, active: true, fixedAmount: 0 });
    await request(app).post('/api/payroll/components').set(hr.auth).send({ code: 'HRA', name: 'HRA', kind: 'earning', taxable: true, prorate: true, order: 2, active: true, fixedAmount: 0 });

    // The template lists employees and a column per component
    const tpl = await get('/api/payroll/salary-template', hr.auth).expect(200);
    const tplWb = await sheet(tpl.body as Buffer);
    const ws = tplWb.getWorksheet('Salaries')!;
    const header = (ws.getRow(1).values as unknown[]).slice(1);
    expect(header).toEqual(expect.arrayContaining(['Emp code', 'BASIC', 'HRA']));
    await get('/api/payroll/salary-template', emp.auth).expect(403);

    // Build a sheet: one good row, one with a bad amount
    const upload = async (rows: unknown[][], apply = false, auth = hr.auth) => {
      const wb = new ExcelJS.Workbook();
      const w = wb.addWorksheet('Salaries');
      w.addRow(['Emp code', 'Name', 'Effective from', 'BASIC', 'HRA']);
      rows.forEach((r) => w.addRow(r));
      const buf = Buffer.from(await wb.xlsx.writeBuffer());
      const res = await request(app).post(`/api/payroll/salary-import${apply ? '?apply=1' : ''}`).set(auth).set('Content-Type', 'application/octet-stream').send(buf);
      return res;
    };
    const good = [emp.employee.code, 'x', '2026-01-01', 30000, 'f:BASIC*0.4'];
    const bad = ['NOPE99', 'x', '2026-01-01', 'abc', null];

    const checked = (await upload([good, bad])).body;
    expect(checked.applied).toBe(0);
    expect(checked.errors).toBe(1);
    expect(checked.rows.find((r: { code: string }) => r.code === 'NOPE99').errors.length).toBeGreaterThan(0);

    // Applying with an error saves nothing
    expect((await upload([good, bad], true)).body.applied).toBe(0);
    expect((await request(app).get(`/api/payroll/structures/${emp.employee._id}`).set(hr.auth)).body).toHaveLength(0);

    // A clean sheet applies
    const done = (await upload([good], true)).body;
    expect(done).toMatchObject({ applied: 1, errors: 0 });
    const saved = (await request(app).get(`/api/payroll/structures/${emp.employee._id}`).set(hr.auth)).body;
    expect(saved[0].lines).toEqual([{ code: 'BASIC', fixedAmount: 30000 }, { code: 'HRA', formula: 'BASIC*0.4' }]);
    expect((await upload([good], true, emp.auth)).status).toBe(403);
    expect((await upload([[emp.employee.code, 'x', 'tomorrow', 100, null]])).body.errors).toBe(1);
    expect((await upload([[emp.employee.code, 'x', '2026-01-01', null, null]])).body.rows).toHaveLength(0); // blank row skipped

    // Combined PDF: one page per payslip
    await presentJuly(emp.employee._id);
    const run = (await request(app).post('/api/payroll/runs').set(hr.auth).send({ month: '2026-07' }).expect(201)).body;
    await get(`/api/payroll/runs/${run._id}/payslips.pdf`, hr.auth).expect(409); // nothing calculated yet
    await request(app).post(`/api/payroll/runs/${run._id}/compute`).set(hr.auth).expect(200);
    const pdf = await get(`/api/payroll/runs/${run._id}/payslips.pdf`, hr.auth).expect(200);
    expect((pdf.body as Buffer).subarray(0, 4).toString()).toBe('%PDF');
    await get(`/api/payroll/runs/${run._id}/payslips.pdf`, emp.auth).expect(403);
  });
});

async function presentJuly(employee: unknown) {
  const days = [];
  for (let d = dayjs('2026-07-01'); d.month() === 6; d = d.add(1, 'day')) if (d.day() !== 0) days.push({ employee, date: d.format('YYYY-MM-DD'), status: 'present', source: 'self' });
  await AttendanceDay.insertMany(days);
}

// 1x1 transparent PNG
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');

describe('company profile on documents', () => {
  it('validates and stores details, accepts only PNG/JPEG, and puts logo and signature into the payslip PDF', async () => {
    const admin = await createPerson(roles.Admin);
    const emp = await createPerson(roles.Employee);

    // everyone can read; only settings managers can change
    expect((await request(app).get('/api/company').set(emp.auth).expect(200)).body.hasLogo).toBe(false);
    await request(app).put('/api/company').set(emp.auth).send({ name: 'Acme' }).expect(403);

    const details = { name: 'Acme Industries Pvt Ltd', address: '12 Mount Road\nChennai 600002', phone: '044 1234 5678', email: 'hr@acme.in', gstin: '33abcde1234f1z5', pan: 'abcde1234f', signatoryName: 'R. Kumar', signatoryTitle: 'HR Manager' };
    await request(app).put('/api/company').set(admin.auth).send({ ...details, gstin: '123' }).expect(400);
    await request(app).put('/api/company').set(admin.auth).send({ ...details, pan: 'nope' }).expect(400);
    await request(app).put('/api/company').set(admin.auth).send({ ...details, name: '' }).expect(400);
    const saved = (await request(app).put('/api/company').set(admin.auth).send(details).expect(200)).body;
    expect(saved).toMatchObject({ gstin: '33ABCDE1234F1Z5', pan: 'ABCDE1234F' }); // upper-cased

    // images
    const put = (img: string, body: Buffer, auth: Record<string, string> = admin.auth) => request(app).put(`/api/company/${img}`).set(auth).set('Content-Type', 'application/octet-stream').send(body);
    await put('logo', Buffer.from('<svg></svg>')).expect(400); // not PNG/JPEG
    await put('logo', PNG, emp.auth).expect(403);
    await request(app).put('/api/company/other').set(admin.auth).send(PNG).expect(400);
    await put('logo', Buffer.concat([PNG, Buffer.alloc(1_100_000)])).expect(413);

    // a PDF without images, then with them
    const withoutImages = await payslipPdfLength(admin, roles);
    expect(withoutImages.includes('/Subtype /Image')).toBe(false);
    await put('logo', PNG).expect(204);
    await put('signature', PNG).expect(204);
    expect((await request(app).get('/api/company').set(emp.auth)).body).toMatchObject({ hasLogo: true, hasSignature: true });
    const img = await request(app).get('/api/company/logo').set(emp.auth).buffer(true).parse(binary as never).expect(200);
    expect(img.headers['content-type']).toBe('image/png');
    expect((img.body as Buffer).equals(PNG)).toBe(true); // the exact bytes come back
    const withImages = await payslipPdfLength(admin, roles);
    expect(withImages.includes('/Subtype /Image')).toBe(true); // logo and signature really are embedded
    expect(withImages.length).toBeGreaterThan(withoutImages.length);

    await request(app).delete('/api/company/logo').set(admin.auth).expect(204);
    await request(app).get('/api/company/logo').set(admin.auth).expect(404);
  });
});

/** Runs a one-person payroll for a month and returns the size of that person's payslip PDF. */
let monthCounter = 0;
async function payslipPdfLength(admin: { auth: Record<string, string> }, r: Awaited<ReturnType<typeof seedRoles>>) {
  const month = ['2026-02', '2026-03', '2026-04'][monthCounter++];
  const p = await createPerson(r.Employee);
  const days = [];
  for (let d = dayjs(`${month}-01`); d.format('YYYY-MM') === month; d = d.add(1, 'day')) if (d.day() !== 0) days.push({ employee: p.employee._id, date: d.format('YYYY-MM-DD'), status: 'present', source: 'self' });
  await AttendanceDay.insertMany(days);
  await request(app).post(`/api/payroll/structures/${p.employee._id}`).set(admin.auth).send({ effectiveFrom: '2026-01-01', lines: [{ code: 'BASIC', fixedAmount: 20000 }] }).expect(201);
  const run = (await request(app).post('/api/payroll/runs').set(admin.auth).send({ month }).expect(201)).body;
  await request(app).post(`/api/payroll/runs/${run._id}/compute`).set(admin.auth).expect(200);
  const slips = (await request(app).get(`/api/payroll/runs/${run._id}`).set(admin.auth)).body.payslips;
  const res = await get(`/api/payroll/payslips/${slips[0]._id}/pdf`, admin.auth).expect(200);
  expect((res.body as Buffer).subarray(0, 4).toString()).toBe('%PDF');
  return res.body as Buffer;
}
