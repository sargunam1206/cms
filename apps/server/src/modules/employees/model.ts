import '../../config/istPlugin';
import { Schema, model, type InferSchemaType, type Types } from 'mongoose';
import { EMPLOYEE_STATUS, TAX_REGIMES } from '@cms/shared';

const employeeSchema = new Schema(
  {
    code: { type: String, required: true, unique: true, trim: true, uppercase: true },
    name: { type: String, required: true, trim: true },
    email: { type: String, lowercase: true, trim: true },
    phone: String,
    department: String,
    designation: String,
    manager: { type: Schema.Types.ObjectId, ref: 'Employee', default: null, index: true },
    dateOfJoining: { type: String, required: true }, // YYYY-MM-DD
    dateOfBirth: String,
    pan: { type: String, uppercase: true },
    uan: String,
    esiNumber: String,
    bank: {
      accountNumber: String,
      ifsc: { type: String, uppercase: true },
      bankName: String,
    },
    pfApplicable: { type: Boolean, default: true },
    esiApplicable: { type: Boolean, default: false },
    taxRegime: { type: String, enum: TAX_REGIMES, default: 'new' },
    status: { type: String, enum: EMPLOYEE_STATUS, default: 'active', index: true },
    exitDate: String,
  },
  { timestamps: true },
);

employeeSchema.index({ name: 'text', code: 'text', email: 'text' });

export type EmployeeDoc = InferSchemaType<typeof employeeSchema> & { _id: Types.ObjectId };
export const Employee = model('Employee', employeeSchema);

/** Direct reports of a manager (one level). */
export async function teamIds(managerEmployeeId: Types.ObjectId) {
  const rows = await Employee.find({ manager: managerEmployeeId }).select('_id').lean();
  return rows.map((r) => r._id);
}
