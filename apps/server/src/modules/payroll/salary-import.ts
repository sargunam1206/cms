import ExcelJS from 'exceljs';
import dayjs from 'dayjs';
import { COMPONENT_CODE, dateOnly } from '@cms/shared';
import { todayStr } from '../../utils/time';
import { audit } from '../audit/model';
import { Employee } from '../employees/model';
import { SalaryComponent, SalaryStructure } from './model';
import { validateLines } from './service';

type Id = import('mongoose').Types.ObjectId | string;
interface Line {
  code: string;
  fixedAmount?: number;
  formula?: string;
}
export interface RowResult {
  row: number;
  code: string;
  name?: string;
  effectiveFrom?: string;
  lines?: Line[];
  errors: string[];
}

const FORMULA_PREFIX = 'f:';
const FIXED_COLS = 3; // Emp code, Name, Effective from

/** Blank sheet pre-filled with every active employee's current salary, one column per component. */
export async function salaryTemplate() {
  const comps = await SalaryComponent.find({ active: true }).sort({ order: 1, code: 1 }).lean();
  const emps = await Employee.find({ status: { $ne: 'exited' } }).sort({ code: 1 }).lean();
  const first = dayjs(todayStr()).startOf('month').format('YYYY-MM-DD');

  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Salaries');
  ws.columns = [
    { header: 'Emp code', key: 'code', width: 12 },
    { header: 'Name (do not edit)', key: 'name', width: 28 },
    { header: 'Effective from (YYYY-MM-DD)', key: 'from', width: 26 },
    ...comps.map((c) => ({ header: c.code, key: c.code, width: 14 })),
  ];
  ws.getRow(1).font = { bold: true };
  ws.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE2E8F0' } };
  ws.getColumn('from').numFmt = '@';

  for (const e of emps) {
    const s = await SalaryStructure.findOne({ employee: e._id }).sort({ effectiveFrom: -1 }).lean();
    const row: Record<string, unknown> = { code: e.code, name: e.name, from: first };
    for (const l of s?.lines ?? []) row[l.code] = l.formula ? `${FORMULA_PREFIX}${l.formula}` : l.fixedAmount;
    ws.addRow(row);
  }

  const help = wb.addWorksheet('How to fill');
  help.getColumn(1).width = 110;
  [
    'One row per employee. Leave a salary cell blank to leave that component out.',
    'Type monthly amounts in rupees, for example 25000.',
    `For a formula, type ${FORMULA_PREFIX} followed by the formula, for example ${FORMULA_PREFIX}BASIC*0.4 (not an Excel "=" formula).`,
    'Effective from is the first day the new salary applies. Earlier months keep their old salary.',
    'Do not rename the column headings or the employee codes. Rows with every salary cell blank are skipped.',
    'Upload the file in the app: it checks every row first and changes nothing until you confirm.',
  ].forEach((t) => help.addRow([t]));
  return Buffer.from(await wb.xlsx.writeBuffer());
}

const cellText = (v: ExcelJS.CellValue): string => {
  if (v === null || v === undefined) return '';
  if (typeof v === 'object' && 'result' in v) return String(v.result ?? '');
  if (typeof v === 'object' && 'text' in v) return String(v.text ?? '');
  if (v instanceof Date) return dayjs(v).format('YYYY-MM-DD');
  return String(v).trim();
};

/** Reads and checks an uploaded sheet. Nothing is saved here. */
export async function parseSalarySheet(buffer: Buffer): Promise<RowResult[]> {
  const wb = new ExcelJS.Workbook();
  try {
    await wb.xlsx.load(buffer as never);
  } catch {
    throw new Error('That file is not a readable Excel (.xlsx) workbook');
  }
  const ws = wb.getWorksheet('Salaries') ?? wb.worksheets[0];
  if (!ws) throw new Error('The workbook has no sheet');

  const headers: string[] = [];
  ws.getRow(1).eachCell({ includeEmpty: true }, (c, col) => (headers[col] = cellText(c.value)));
  const compCols = headers.map((h, col) => ({ h, col })).filter((x) => x.col > FIXED_COLS && x.h);
  const bad = compCols.filter((x) => !COMPONENT_CODE.test(x.h));
  if (bad.length) throw new Error(`Unrecognised column heading(s): ${bad.map((b) => b.h).join(', ')}`);
  if (!compCols.length) throw new Error('No salary component columns found');

  const emps = new Map((await Employee.find({ status: { $ne: 'exited' } }).select('code name').lean()).map((e) => [e.code.toUpperCase(), e]));
  const known = new Set((await SalaryComponent.find({ active: true }).select('code').lean()).map((c) => c.code));
  const seen = new Set<string>();
  const results: RowResult[] = [];

  ws.eachRow((row, n) => {
    if (n === 1) return;
    const code = cellText(row.getCell(1).value).toUpperCase();
    if (!code) return;
    const r: RowResult = { row: n, code, errors: [] };
    const emp = emps.get(code);
    if (!emp) r.errors.push('Unknown or exited employee code');
    else r.name = emp.name;
    if (seen.has(code)) r.errors.push('Employee appears twice in the sheet');
    seen.add(code);

    const from = cellText(row.getCell(3).value);
    if (!dateOnly.safeParse(from).success || !dayjs(from).isValid()) r.errors.push(`Effective from "${from}" is not a date like 2026-10-01`);
    else r.effectiveFrom = from;

    const lines: Line[] = [];
    for (const { h, col } of compCols) {
      const txt = cellText(row.getCell(col).value);
      if (!txt) continue;
      if (!known.has(h)) {
        r.errors.push(`${h} is not an active component`);
        continue;
      }
      if (txt.toLowerCase().startsWith(FORMULA_PREFIX)) lines.push({ code: h, formula: txt.slice(FORMULA_PREFIX.length).trim().toUpperCase() });
      else {
        const n2 = Number(txt.replace(/,/g, ''));
        if (!Number.isFinite(n2) || n2 < 0) r.errors.push(`${h}: "${txt}" is not a valid amount`);
        else lines.push({ code: h, fixedAmount: n2 });
      }
    }
    if (!lines.length && !r.errors.length) return; // fully blank row: skip
    if (!lines.length) r.errors.push('No salary amounts');
    r.lines = lines;
    results.push(r);
  });
  return results;
}

/** Validates formulas and cycles per row (needs the component master) and fills in errors. */
export async function checkRows(rows: RowResult[]) {
  for (const r of rows) {
    if (r.errors.length || !r.lines) continue;
    try {
      await validateLines(r.lines);
    } catch (e) {
      r.errors.push((e as Error).message);
    }
  }
  return rows;
}

/** All-or-nothing: if any row has an error, nothing is saved. */
export async function applySalarySheet(rows: RowResult[], actor: Id) {
  if (rows.some((r) => r.errors.length)) return { applied: 0 };
  let applied = 0;
  for (const r of rows) {
    const emp = await Employee.findOne({ code: r.code }).select('_id').lean();
    if (!emp) continue;
    await SalaryStructure.findOneAndUpdate(
      { employee: emp._id, effectiveFrom: r.effectiveFrom },
      { employee: emp._id, effectiveFrom: r.effectiveFrom, lines: r.lines, createdBy: actor },
      { upsert: true, new: true },
    );
    applied++;
  }
  await audit({ actor: actor as never, action: 'payroll.salary_import', entity: 'SalaryStructure', meta: { rows: applied, codes: rows.map((r) => r.code) } });
  return { applied };
}
