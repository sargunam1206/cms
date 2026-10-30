import PDFDocument from 'pdfkit';
import ExcelJS from 'exceljs';
import { fillRows } from './service';
import dayjs from 'dayjs';

interface Line {
  code?: string | null;
  name?: string | null;
  amount?: number | null;
  note?: string | null;
}

export interface SlipDoc {
  month: string;
  person?: {
    name?: string | null; code?: string | null; designation?: string | null; department?: string | null; dateOfJoining?: string | null;
    pan?: string | null; uan?: string | null; esiNumber?: string | null;
    bank?: { accountNumber?: string | null; ifsc?: string | null; bankName?: string | null } | null;
  } | null;
  attendance?: { totalDays?: number | null; paidDays?: number | null; lopDays?: number | null } | null;
  earnings: Line[];
  deductions: Line[];
  employerContributions?: Line[];
  gross?: number | null;
  totalDeductions?: number | null;
  net?: number | null;
}

/** Paise to "12,34,567.89" (Indian digit grouping). */
export const money = (paise: number | null | undefined) =>
  ((paise ?? 0) / 100).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const mask = (v?: string | null) => (v ? `${'X'.repeat(Math.max(0, v.length - 4))}${v.slice(-4)}` : '-');

type Layout = { earnings: { code: string; name: string }[]; deductions: { code: string; name: string }[] };

/** Draws one payslip on the current page. Bank account, PAN and UAN are masked on the printed copy. */
export interface CompanyInfo {
  name: string;
  address?: string;
  phone?: string;
  email?: string;
  website?: string;
  gstin?: string;
  pan?: string;
  tan?: string;
  pfRegNo?: string;
  esiRegNo?: string;
  signatoryName?: string;
  signatoryTitle?: string;
  logo?: Buffer;
  signature?: Buffer;
}

/** Draws an image if it can be read; a corrupt upload must never break payslip generation. */
function safeImage(doc: PDFKit.PDFDocument, img: Buffer | undefined, x: number, y: number, fit: [number, number]) {
  if (!img) return false;
  try {
    doc.image(img, x, y, { fit });
    return true;
  } catch {
    return false;
  }
}

/** Letterhead: logo, company name, address, contacts and registration numbers. Returns the y below it. */
function drawHeader(doc: PDFKit.PDFDocument, c: CompanyInfo, L: number, W: number) {
  const top = 36;
  const hasLogo = safeImage(doc, c.logo, L, top, [64, 54]);
  const x = hasLogo ? L + 76 : L;
  const w = W - (x - L);
  doc.font('Helvetica-Bold').fontSize(15).fillColor('#000').text(c.name, x, top, { width: w });
  doc.font('Helvetica').fontSize(8).fillColor('#555');
  if (c.address) doc.text(c.address, x, doc.y + 1, { width: w });
  const contact = [c.phone && `Ph: ${c.phone}`, c.email, c.website].filter(Boolean).join('   |   ');
  if (contact) doc.text(contact, x, doc.y + 1, { width: w });
  const regs = [c.gstin && `GSTIN: ${c.gstin}`, c.pan && `PAN: ${c.pan}`, c.tan && `TAN: ${c.tan}`, c.pfRegNo && `PF Reg: ${c.pfRegNo}`, c.esiRegNo && `ESI Reg: ${c.esiRegNo}`].filter(Boolean).join('   |   ');
  if (regs) doc.text(regs, x, doc.y + 1, { width: w });
  const bottom = Math.max(doc.y, hasLogo ? top + 54 : 0) + 8;
  doc.moveTo(L, bottom).lineTo(L + W, bottom).lineWidth(0.8).strokeColor('#999').stroke().strokeColor('#000').lineWidth(1);
  return bottom;
}

function drawPayslip(doc: PDFKit.PDFDocument, slip: SlipDoc, company: CompanyInfo, layout?: Layout) {
  const p = slip.person ?? {};
  const L = 40;
  const W = 515;
  const headerBottom = drawHeader(doc, company, L, W);
  doc.font('Helvetica-Bold').fontSize(11).fillColor('#000').text(`Payslip for ${dayjs(`${slip.month}-01`).format('MMMM YYYY')}`, L, headerBottom + 10, { width: W, align: 'center' });

  const info: [string, string][] = [
    ['Employee', `${p.name ?? ''} (${p.code ?? ''})`],
    ['Designation', p.designation || '-'],
    ['Department', p.department || '-'],
    ['Date of joining', p.dateOfJoining ? dayjs(p.dateOfJoining).format('DD MMM YYYY') : '-'],
    ['PAN', mask(p.pan)],
    ['UAN', mask(p.uan)],
    ['Bank account', `${p.bank?.bankName ?? ''} ${mask(p.bank?.accountNumber)}`.trim()],
    ['Paid days', `${slip.attendance?.paidDays ?? 0} of ${slip.attendance?.totalDays ?? 0} (loss of pay: ${slip.attendance?.lopDays ?? 0})`],
  ];
  let y = headerBottom + 36;
  info.forEach(([k, v], i) => {
    const x = L + (i % 2) * 260;
    if (i % 2 === 0 && i > 0) y += 16;
    doc.font('Helvetica').fontSize(9).fillColor('#666').text(k, x, y, { width: 90 });
    doc.fillColor('#000').text(v, x + 90, y, { width: 165 });
  });
  y += 30;

  const table = (title: string, rows: Line[], total: number | null | undefined, x: number) => {
    let ty = y;
    doc.font('Helvetica-Bold').fontSize(10).text(title, x, ty, { width: 250 });
    ty += 16;
    doc.moveTo(x, ty - 3).lineTo(x + 250, ty - 3).stroke();
    doc.font('Helvetica').fontSize(9);
    for (const r of rows) {
      doc.text(r.name ?? r.code ?? '', x, ty, { width: 170 });
      doc.text(money(r.amount), x + 170, ty, { width: 80, align: 'right' });
      ty += 14;
    }
    doc.moveTo(x, ty).lineTo(x + 250, ty).stroke();
    doc.font('Helvetica-Bold').text('Total', x, ty + 4, { width: 170 });
    doc.text(money(total), x + 170, ty + 4, { width: 80, align: 'right' });
    return ty + 20;
  };
  // Standard rows are always printed, with 0.00 where there is no amount
  const earnRows = layout ? fillRows(slip.earnings, layout.earnings) : slip.earnings;
  const dedRows = layout ? fillRows(slip.deductions, layout.deductions) : slip.deductions;
  const y1 = table('Earnings (Rs.)', earnRows, slip.gross, L);
  const y2 = table('Deductions (Rs.)', dedRows, slip.totalDeductions, L + 265);
  y = Math.max(y1, y2) + 14;

  doc.rect(L, y, W, 28).fill('#f1f5f9');
  doc.fillColor('#000').font('Helvetica-Bold').fontSize(12).text('Net pay', L + 10, y + 8);
  doc.text(`Rs. ${money(slip.net)}`, L + 10, y + 8, { width: W - 20, align: 'right' });
  y += 44;

  if (slip.employerContributions?.length) {
    doc.font('Helvetica').fontSize(8).fillColor('#666').text(`Employer contributions (not part of your pay): ${slip.employerContributions.map((e) => `${e.name} ${money(e.amount)}`).join('  |  ')}`, L, y, { width: W });
  }

  // Authorised signatory, bottom right
  const sigY = 700;
  if (company.signature || company.signatoryName) {
    const sigX = L + W - 170;
    safeImage(doc, company.signature, sigX, sigY, [150, 46]);
    doc.moveTo(sigX, sigY + 52).lineTo(sigX + 160, sigY + 52).lineWidth(0.5).strokeColor('#666').stroke().strokeColor('#000').lineWidth(1);
    doc.font('Helvetica-Bold').fontSize(9).fillColor('#000').text(company.signatoryName || 'Authorised signatory', sigX, sigY + 56, { width: 160 });
    doc.font('Helvetica').fontSize(8).fillColor('#555').text(company.signatoryTitle || (company.signatoryName ? 'Authorised signatory' : ''), sigX, doc.y, { width: 160 });
  }
  doc.fillColor('#888').font('Helvetica').fontSize(8).text('This is a computer-generated payslip.', L, 790, { width: W, align: 'center' });
}

/** One A4 page per payslip, in a single PDF. */
export function payslipsPdf(slips: SlipDoc[], company: CompanyInfo = { name: 'Company' }, layout?: Layout): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 40 });
    const chunks: Buffer[] = [];
    doc.on('data', (c: Buffer) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
    slips.forEach((slip, i) => {
      if (i > 0) doc.addPage();
      drawPayslip(doc, slip, company, layout);
    });
    doc.end();
  });
}

export const payslipPdf = (slip: SlipDoc, company: CompanyInfo = { name: 'Company' }, layout?: Layout) => payslipsPdf([slip], company, layout);

// ---------- Excel ----------
const bold = (row: ExcelJS.Row) => {
  row.font = { bold: true };
  row.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE2E8F0' } };
};

async function toBuffer(wb: ExcelJS.Workbook) {
  return Buffer.from(await wb.xlsx.writeBuffer());
}

export interface SlipRecord extends SlipDoc {
  employee?: unknown;
  taxableGross?: number | null;
  inputs?: { statutory?: { pf?: { basisComponents?: string[]; wageCeiling?: number; capAtCeiling?: boolean } } } | null;
}

const rupees = (paise: number | null | undefined) => Math.round(paise ?? 0) / 100;
const amountOf = (lines: Line[] | undefined, code: string) => lines?.find((l) => l.code === code)?.amount ?? 0;

/** Bank transfer sheet: one row per employee with net pay. Rows lacking bank details go on a second sheet. */
export async function bankSheet(slips: SlipRecord[], month: string) {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Bank transfer');
  ws.columns = [
    { header: 'Emp code', key: 'code', width: 12 },
    { header: 'Name', key: 'name', width: 28 },
    { header: 'Bank', key: 'bank', width: 22 },
    { header: 'Account number', key: 'acc', width: 22 },
    { header: 'IFSC', key: 'ifsc', width: 14 },
    { header: 'Net pay (Rs.)', key: 'net', width: 16 },
    { header: 'Narration', key: 'narr', width: 28 },
  ];
  bold(ws.getRow(1));
  const missing: SlipRecord[] = [];
  let total = 0;
  for (const s of slips) {
    const b = s.person?.bank;
    if (!b?.accountNumber || !b?.ifsc) {
      missing.push(s);
      continue;
    }
    total += s.net ?? 0;
    ws.addRow({ code: s.person?.code, name: s.person?.name, bank: b.bankName, acc: b.accountNumber, ifsc: b.ifsc, net: rupees(s.net), narr: `Salary ${month}` });
  }
  ws.addRow({});
  const t = ws.addRow({ name: 'TOTAL', net: rupees(total) });
  t.font = { bold: true };
  ws.getColumn('acc').numFmt = '@';
  ws.getColumn('net').numFmt = '#,##0.00';
  // keep the account number as text so Excel never turns it into 1.23E+11
  ws.eachRow((r, i) => i > 1 && (r.getCell('acc').numFmt = '@'));
  if (missing.length) {
    const m = wb.addWorksheet('Missing bank details');
    m.columns = [{ header: 'Emp code', key: 'code', width: 12 }, { header: 'Name', key: 'name', width: 28 }, { header: 'Net pay (Rs.)', key: 'net', width: 16 }];
    bold(m.getRow(1));
    missing.forEach((s) => m.addRow({ code: s.person?.code, name: s.person?.name, net: rupees(s.net) }));
  }
  return { buffer: await toBuffer(wb), missing: missing.length, total };
}

export const REPORT_TYPES = ['salary-register', 'pf', 'esi', 'pt', 'tds'] as const;
export type ReportType = (typeof REPORT_TYPES)[number];

export async function reportSheet(type: ReportType, slips: SlipRecord[], month: string) {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet(type);
  const add = (cols: { header: string; key: string; width?: number; money?: boolean }[]) => {
    ws.columns = cols.map((c) => ({ header: c.header, key: c.key, width: c.width ?? 16 }));
    bold(ws.getRow(1));
    cols.filter((c) => c.money).forEach((c) => (ws.getColumn(c.key).numFmt = '#,##0.00'));
  };
  const totals = (keys: string[]) => {
    ws.addRow({});
    const row = ws.addRow({ name: 'TOTAL' });
    for (const k of keys) {
      let sum = 0;
      ws.eachRow((r, i) => i > 1 && r !== row && typeof r.getCell(k).value === 'number' && (sum += r.getCell(k).value as number));
      row.getCell(k).value = Math.round(sum * 100) / 100;
    }
    row.font = { bold: true };
  };
  const base = (s: SlipRecord) => ({ code: s.person?.code, name: s.person?.name });

  if (type === 'salary-register') {
    const earn = [...new Map(slips.flatMap((s) => s.earnings).map((l) => [l.code, l.name])).entries()];
    const ded = [...new Map(slips.flatMap((s) => s.deductions).map((l) => [l.code, l.name])).entries()];
    add([
      { header: 'Emp code', key: 'code', width: 12 }, { header: 'Name', key: 'name', width: 26 },
      { header: 'Paid days', key: 'paid', width: 10 },
      ...earn.map(([c, n]) => ({ header: String(n ?? c), key: `e_${c}`, money: true })),
      { header: 'Gross', key: 'gross', money: true },
      ...ded.map(([c, n]) => ({ header: String(n ?? c), key: `d_${c}`, money: true })),
      { header: 'Total deductions', key: 'ded', money: true }, { header: 'Net pay', key: 'net', money: true },
    ]);
    for (const s of slips) {
      const row: Record<string, unknown> = { ...base(s), paid: s.attendance?.paidDays, gross: rupees(s.gross), ded: rupees(s.totalDeductions), net: rupees(s.net) };
      earn.forEach(([c]) => (row[`e_${c}`] = rupees(amountOf(s.earnings, String(c)))));
      ded.forEach(([c]) => (row[`d_${c}`] = rupees(amountOf(s.deductions, String(c)))));
      ws.addRow(row);
    }
    totals([...earn.map(([c]) => `e_${c}`), 'gross', ...ded.map(([c]) => `d_${c}`), 'ded', 'net']);
  } else if (type === 'pf') {
    add([
      { header: 'Emp code', key: 'code', width: 12 }, { header: 'Name', key: 'name', width: 26 }, { header: 'UAN', key: 'uan', width: 16 },
      { header: 'PF wages', key: 'wages', money: true }, { header: 'Employee PF', key: 'ee', money: true }, { header: 'Employer PF', key: 'er', money: true },
    ]);
    for (const s of slips) {
      const ee = amountOf(s.deductions, 'PF');
      if (!ee) continue;
      const pf = s.inputs?.statutory?.pf;
      const basis = pf?.basisComponents ?? ['BASIC'];
      let wages = basis.reduce((sum, c) => sum + amountOf(s.earnings, c), 0);
      if (pf?.capAtCeiling !== false && pf?.wageCeiling) wages = Math.min(wages, pf.wageCeiling * 100);
      ws.addRow({ ...base(s), uan: s.person?.uan ?? '', wages: rupees(wages), ee: rupees(ee), er: rupees(amountOf(s.employerContributions, 'PF_ER')) });
    }
    totals(['wages', 'ee', 'er']);
  } else if (type === 'esi') {
    add([
      { header: 'Emp code', key: 'code', width: 12 }, { header: 'Name', key: 'name', width: 26 }, { header: 'ESI number', key: 'esi', width: 18 },
      { header: 'Gross wages', key: 'gross', money: true }, { header: 'Employee ESI', key: 'ee', money: true }, { header: 'Employer ESI', key: 'er', money: true },
    ]);
    for (const s of slips) {
      const ee = amountOf(s.deductions, 'ESI');
      if (!ee) continue;
      ws.addRow({ ...base(s), esi: s.person?.esiNumber ?? '', gross: rupees(s.gross), ee: rupees(ee), er: rupees(amountOf(s.employerContributions, 'ESI_ER')) });
    }
    totals(['gross', 'ee', 'er']);
  } else if (type === 'pt') {
    add([{ header: 'Emp code', key: 'code', width: 12 }, { header: 'Name', key: 'name', width: 26 }, { header: 'Gross', key: 'gross', money: true }, { header: 'Professional tax', key: 'pt', money: true }]);
    for (const s of slips) {
      const pt = amountOf(s.deductions, 'PT');
      if (pt) ws.addRow({ ...base(s), gross: rupees(s.gross), pt: rupees(pt) });
    }
    totals(['gross', 'pt']);
  } else {
    add([
      { header: 'Emp code', key: 'code', width: 12 }, { header: 'Name', key: 'name', width: 26 }, { header: 'PAN', key: 'pan', width: 14 },
      { header: 'Taxable earnings', key: 'taxable', money: true }, { header: 'TDS deducted', key: 'tds', money: true },
    ]);
    for (const s of slips) ws.addRow({ ...base(s), pan: s.person?.pan ?? '', taxable: rupees(s.taxableGross), tds: rupees(amountOf(s.deductions, 'TDS')) });
    totals(['taxable', 'tds']);
  }
  ws.insertRow(1, [`${type.replace('-', ' ')} · ${dayjs(`${month}-01`).format('MMMM YYYY')}`]).font = { bold: true, size: 13 };
  return toBuffer(wb);
}
