import '../../config/istPlugin';
import { Schema, model } from 'mongoose';
import { COMPONENT_KINDS } from '@cms/shared';

/** Master list of salary components (BASIC, HRA, ...). Values live in templates and structures. */
const salaryComponentSchema = new Schema(
  {
    code: { type: String, required: true, unique: true, uppercase: true, trim: true },
    name: { type: String, required: true, trim: true },
    kind: { type: String, enum: COMPONENT_KINDS, required: true },
    taxable: { type: Boolean, default: true },
    prorate: { type: Boolean, default: true },
    order: { type: Number, default: 0 },
    active: { type: Boolean, default: true },
  },
  { timestamps: true },
);
export const SalaryComponent = model('SalaryComponent', salaryComponentSchema);

const lineSchema = new Schema(
  {
    code: { type: String, required: true },
    fixedAmount: Number, // rupees per month
    formula: String,
  },
  { _id: false },
);

const salaryTemplateSchema = new Schema(
  {
    name: { type: String, required: true, unique: true, trim: true },
    lines: { type: [lineSchema], default: [] },
  },
  { timestamps: true },
);
export const SalaryTemplate = model('SalaryTemplate', salaryTemplateSchema);

/** Effective-dated: the latest record with effectiveFrom <= the payroll month's last day applies. */
const salaryStructureSchema = new Schema(
  {
    employee: { type: Schema.Types.ObjectId, ref: 'Employee', required: true },
    effectiveFrom: { type: String, required: true }, // YYYY-MM-DD
    template: { type: Schema.Types.ObjectId, ref: 'SalaryTemplate' },
    lines: { type: [lineSchema], default: [] },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true },
);
salaryStructureSchema.index({ employee: 1, effectiveFrom: -1 }, { unique: true });
export const SalaryStructure = model('SalaryStructure', salaryStructureSchema);

// ---------- Adjustments ----------
/** Loan or salary advance recovered in monthly EMIs. Balances change only when a run is approved. */
const loanSchema = new Schema(
  {
    employee: { type: Schema.Types.ObjectId, ref: 'Employee', required: true, index: true },
    principal: { type: Number, required: true }, // paise
    emi: { type: Number, required: true }, // paise per month
    startMonth: { type: String, required: true }, // YYYY-MM, first month to deduct
    balance: { type: Number, required: true }, // paise still to recover
    status: { type: String, enum: ['active', 'closed'], default: 'active', index: true },
    note: String,
    createdBy: { type: Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true },
);
export const Loan = model('Loan', loanSchema);

/** Bonus, incentive, arrears, reimbursement or a one-off recovery for a single month. */
const oneTimeItemSchema = new Schema(
  {
    employee: { type: Schema.Types.ObjectId, ref: 'Employee', required: true },
    month: { type: String, required: true }, // YYYY-MM
    kind: { type: String, enum: ['earning', 'deduction'], required: true },
    code: { type: String, required: true, uppercase: true, trim: true },
    name: { type: String, required: true, trim: true },
    amount: { type: Number, required: true }, // paise
    taxable: { type: Boolean, default: true },
    note: String,
    createdBy: { type: Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true },
);
oneTimeItemSchema.index({ month: 1, employee: 1 });
export const OneTimeItem = model('OneTimeItem', oneTimeItemSchema);

// ---------- Runs and payslips ----------
export const RUN_STATUS = ['draft', 'hr_reviewed', 'approved'] as const;

const runSchema = new Schema(
  {
    month: { type: String, required: true, unique: true },
    status: { type: String, enum: RUN_STATUS, default: 'draft', index: true },
    totals: {
      employees: { type: Number, default: 0 },
      gross: { type: Number, default: 0 },
      deductions: { type: Number, default: 0 },
      net: { type: Number, default: 0 },
      employerContributions: { type: Number, default: 0 },
    },
    skipped: { type: [{ employee: { type: Schema.Types.ObjectId, ref: 'Employee' }, name: String, code: String, reason: String }], default: [] },
    computedAt: Date,
    createdBy: { type: Schema.Types.ObjectId, ref: 'User' },
    hrReviewedBy: { type: Schema.Types.ObjectId, ref: 'User' },
    hrReviewedAt: Date,
    approvedBy: { type: Schema.Types.ObjectId, ref: 'User' },
    approvedAt: Date,
    history: { type: [{ action: String, by: { type: Schema.Types.ObjectId, ref: 'User' }, at: Date, comment: String }], default: [] },
  },
  { timestamps: true },
);
export const PayrollRun = model('PayrollRun', runSchema);

const resultLine = new Schema({ code: String, name: String, amount: Number, note: String }, { _id: false });

/** A payslip stores everything it was computed from, so it can be reproduced and defended later. */
const payslipSchema = new Schema(
  {
    run: { type: Schema.Types.ObjectId, ref: 'PayrollRun', required: true, index: true },
    month: { type: String, required: true, index: true },
    employee: { type: Schema.Types.ObjectId, ref: 'Employee', required: true, index: true },
    person: {
      name: String,
      code: String,
      designation: String,
      department: String,
      dateOfJoining: String,
      pan: String,
      uan: String,
      esiNumber: String,
      bank: { accountNumber: String, ifsc: String, bankName: String },
    },
    attendance: {
      totalDays: Number,
      paidDays: Number,
      lopDays: Number,
      presentDays: Number,
      paidLeaveDays: Number,
      lateCount: Number,
    },
    earnings: [resultLine],
    deductions: [resultLine],
    employerContributions: [resultLine],
    gross: Number,
    taxableGross: Number,
    totalDeductions: Number,
    net: Number,
    // Per-loan EMI taken in this payslip; balances are reduced only when the run is approved
    loans: { type: [{ loan: { type: Schema.Types.ObjectId, ref: 'Loan' }, amount: Number, _id: false }], default: [] },
    warnings: [String],
    inputs: Schema.Types.Mixed, // components, statutory rules and year-to-date figures used
  },
  { timestamps: true },
);
payslipSchema.index({ run: 1, employee: 1 }, { unique: true });
export const Payslip = model('Payslip', payslipSchema);
