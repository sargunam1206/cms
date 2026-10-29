import '../../config/istPlugin';
import { Schema, model, type InferSchemaType, type Types } from 'mongoose';
import { LEAVE_ACCRUAL, REQUEST_STATUS } from '@cms/shared';

const leaveTypeSchema = new Schema(
  {
    code: { type: String, required: true, unique: true, uppercase: true, trim: true },
    name: { type: String, required: true },
    paid: { type: Boolean, default: true }, // unpaid types (LOP) have no balance and reduce pay
    annualQuota: { type: Number, default: 0 },
    accrual: { type: String, enum: LEAVE_ACCRUAL, default: 'yearly' },
    carryForwardMax: { type: Number, default: 0 },
    encashable: { type: Boolean, default: false },
    allowHalfDay: { type: Boolean, default: true },
    active: { type: Boolean, default: true },
  },
  { timestamps: true },
);
export type LeaveTypeDoc = InferSchemaType<typeof leaveTypeSchema> & { _id: Types.ObjectId };
export const LeaveType = model('LeaveType', leaveTypeSchema);

const leaveBalanceSchema = new Schema(
  {
    employee: { type: Schema.Types.ObjectId, ref: 'Employee', required: true },
    leaveType: { type: Schema.Types.ObjectId, ref: 'LeaveType', required: true },
    year: { type: Number, required: true },
    opening: { type: Number, default: 0 }, // carried forward from last year
    adjustment: { type: Number, default: 0 }, // manual HR corrections (+/-)
    used: { type: Number, default: 0 },
    encashed: { type: Number, default: 0 },
    adjustments: [
      {
        _id: false,
        delta: Number,
        reason: String,
        by: { type: Schema.Types.ObjectId, ref: 'User' },
        at: Date,
      },
    ],
  },
  { timestamps: true },
);
leaveBalanceSchema.index({ employee: 1, leaveType: 1, year: 1 }, { unique: true });
export const LeaveBalance = model('LeaveBalance', leaveBalanceSchema);

const leaveRequestSchema = new Schema(
  {
    employee: { type: Schema.Types.ObjectId, ref: 'Employee', required: true, index: true },
    leaveType: { type: Schema.Types.ObjectId, ref: 'LeaveType', required: true },
    from: { type: String, required: true },
    to: { type: String, required: true },
    halfDay: { type: Boolean, default: false },
    days: { type: Number, required: true }, // working days only; holidays/week-offs excluded
    dates: [String], // the working dates actually consumed
    reason: String,
    status: { type: String, enum: REQUEST_STATUS, default: 'pending', index: true },
    decidedBy: { type: Schema.Types.ObjectId, ref: 'User' },
    decidedAt: Date,
    comment: String,
  },
  { timestamps: true },
);
leaveRequestSchema.index({ employee: 1, from: 1, to: 1 });
export const LeaveRequest = model('LeaveRequest', leaveRequestSchema);
