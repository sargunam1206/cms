import {
  DEFAULT_STATUTORY,
  statutorySchema,
  type StatutorySettings,
} from "@cms/shared";
import { badRequest } from "../../utils/errors";
import { lastDayOfMonth } from "../../utils/time";
import { attendanceSummary } from "../attendance/service";
import { Employee } from "../employees/model";
import { getSetting } from "../settings/service";
import { FormulaError } from "./formula";
import {
  computePayroll,
  PayrollError,
  resolveOrder,
  type EngineComponent,
  type EngineResult,
} from "./engine";
import { SalaryComponent, SalaryStructure } from "./model";

export const STATUTORY_KEY = "statutory";

/** Statutory rules in force on a date; stored values are merged over defaults so older records keep working. */
export async function getStatutory(asOf?: string): Promise<StatutorySettings> {
  const stored = await getSetting<Partial<StatutorySettings>>(
    STATUTORY_KEY,
    asOf,
  );
  return statutorySchema.parse({ ...DEFAULT_STATUTORY, ...(stored ?? {}) });
}

interface Line {
  code: string;
  fixedAmount?: number | null;
  formula?: string | null;
}

/** Joins the component master with an employee's structure lines into engine components. */
export async function buildEngineComponents(
  lines: Line[],
): Promise<EngineComponent[]> {
  const master = await SalaryComponent.find({
    code: { $in: lines.map((l) => l.code) },
    active: true,
  }).lean();
  const byCode = new Map(master.map((m) => [m.code, m]));
  return lines.map((l) => {
    const m = byCode.get(l.code);
    if (!m)
      throw badRequest(`Unknown or inactive salary component "${l.code}"`);
    return {
      code: m.code,
      name: m.name,
      kind: m.kind,
      taxable: m.taxable,
      prorate: m.prorate,
      order: m.order,
      ...(l.formula
        ? { formula: l.formula }
        : { fixedAmount: l.fixedAmount ?? 0 }),
    };
  });
}

/** Checks a set of lines can be evaluated (known codes, no cycles, safe formulas) before they are saved. */
export async function validateLines(lines: Line[]) {
  if (new Set(lines.map((l) => l.code)).size !== lines.length)
    throw badRequest("A component appears twice");
  try {
    resolveOrder(await buildEngineComponents(lines));
  } catch (e) {
    if (e instanceof PayrollError || e instanceof FormulaError)
      throw badRequest(e.message);
    throw e;
  }
}

/** The structure in force for a month, or null when the employee has none yet. */
export async function structureFor(employeeId: string, month: string) {
  return SalaryStructure.findOne({
    employee: employeeId,
    effectiveFrom: { $lte: lastDayOfMonth(month) },
  })
    .sort({ effectiveFrom: -1 })
    .lean();
}

/** Computes one employee's pay for a month from live data. Nothing is saved. */
export async function previewPayslip(
  employeeId: string,
  month: string,
): Promise<EngineResult & { employee: { name: string; code: string } }> {
  const emp = await Employee.findById(employeeId).lean();
  if (!emp) throw badRequest("Employee not found");
  const structure = await structureFor(employeeId, month);
  if (!structure)
    throw badRequest(
      `${emp.name} has no salary structure effective for ${month}`,
    );
  const [summary, statutory, components] = await Promise.all([
    attendanceSummary(employeeId, month),
    getStatutory(lastDayOfMonth(month)),
    buildEngineComponents(structure.lines),
  ]);
  let result: EngineResult;
  try {
    result = computePayroll({
      month,
      components,
      attendance: { totalDays: summary.totalDays, paidDays: summary.paidDays },
      employee: {
        pfApplicable: emp.pfApplicable,
        esiApplicable: emp.esiApplicable,
        taxRegime: emp.taxRegime,
      },
      statutory,
    });
  } catch (e) {
    if (e instanceof PayrollError || e instanceof FormulaError)
      throw badRequest(e.message);
    throw e;
  }
  if (summary.pendingDays > 0)
    result.warnings.push(
      `${summary.pendingDays} working day(s) of attendance are still pending`,
    );
  return { ...result, employee: { name: emp.name, code: emp.code } };
}
