import '../../config/istPlugin';
import { Schema, model } from 'mongoose';

/** An employee's request to change their bank details; HR approves before payroll ever sees it. */
const bankChangeSchemaDb = new Schema(
  {
    employee: { type: Schema.Types.ObjectId, ref: 'Employee', required: true, index: true },
    bank: {
      accountNumber: { type: String, required: true },
      ifsc: { type: String, required: true },
      bankName: { type: String, required: true },
    },
    status: { type: String, enum: ['pending', 'approved', 'rejected', 'cancelled'], default: 'pending', index: true },
    decidedBy: { type: Schema.Types.ObjectId, ref: 'User' },
    decidedAt: Date,
    comment: String,
  },
  { timestamps: true },
);

export const BankChangeRequest = model('BankChangeRequest', bankChangeSchemaDb);
