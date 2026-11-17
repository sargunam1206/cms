import '../../config/istPlugin';
import { Schema, model } from 'mongoose';
import { ESTIMATE_STATUS } from '@cms/shared';

const lineSchema = new Schema(
  {
    module: { type: String, required: true, trim: true },
    task: { type: String, required: true, trim: true },
    role: { type: String, required: true, trim: true },
    hours: { type: Number, required: true },
    note: String,
    // Rates in paise per hour, frozen when the estimate is saved so later rate card changes do not rewrite history
    costRate: { type: Number, required: true },
    billingRate: { type: Number, required: true },
  },
  { _id: true },
);

const estimateSchema = new Schema(
  {
    project: { type: Schema.Types.ObjectId, ref: 'Project', required: true, index: true },
    version: { type: Number, required: true },
    status: { type: String, enum: ESTIMATE_STATUS, default: 'draft', index: true },
    note: String,
    lines: { type: [lineSchema], default: [] },
    totalHours: { type: Number, default: 0 },
    totalCost: { type: Number, default: 0 }, // paise
    totalBilling: { type: Number, default: 0 }, // paise
    createdBy: { type: Schema.Types.ObjectId, ref: 'User' },
    submittedBy: { type: Schema.Types.ObjectId, ref: 'User' },
    submittedAt: Date,
    decidedBy: { type: Schema.Types.ObjectId, ref: 'User' },
    decidedAt: Date,
    decisionComment: String,
  },
  { timestamps: true },
);
estimateSchema.index({ project: 1, version: 1 }, { unique: true });
export const Estimate = model('Estimate', estimateSchema);
