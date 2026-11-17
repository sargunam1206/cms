import '../../config/istPlugin';
import { Schema, model } from 'mongoose';
import { MILESTONE_STATUS } from '@cms/shared';

const milestoneSchema = new Schema(
  {
    project: { type: Schema.Types.ObjectId, ref: 'Project', required: true, index: true },
    name: { type: String, required: true, trim: true },
    description: String,
    owner: { type: Schema.Types.ObjectId, ref: 'Employee', default: null },
    plannedStart: { type: String, required: true }, // YYYY-MM-DD
    plannedEnd: { type: String, required: true },
    // Frozen copy of the plan; null for a milestone added after the baseline was set
    baselineStart: String,
    baselineEnd: String,
    status: { type: String, enum: MILESTONE_STATUS, default: 'planned' },
    doneOn: String,
    order: { type: Number, default: 0 },
  },
  { timestamps: true },
);
milestoneSchema.index({ project: 1, plannedEnd: 1 });
export const Milestone = model('Milestone', milestoneSchema);
