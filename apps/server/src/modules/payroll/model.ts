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
