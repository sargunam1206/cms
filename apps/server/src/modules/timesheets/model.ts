import '../../config/istPlugin';
import { Schema, model } from 'mongoose';

/** Time spent on one task on one day. One entry per person, task and day; changing it replaces the minutes. */
const timeLogSchema = new Schema(
  {
    employee: { type: Schema.Types.ObjectId, ref: 'Employee', required: true },
    task: { type: Schema.Types.ObjectId, ref: 'Task', required: true, index: true },
    project: { type: Schema.Types.ObjectId, ref: 'Project', required: true, index: true },
    date: { type: String, required: true }, // YYYY-MM-DD, office time zone
    minutes: { type: Number, required: true },
    note: String,
  },
  { timestamps: true },
);
timeLogSchema.index({ employee: 1, task: 1, date: 1 }, { unique: true });
timeLogSchema.index({ employee: 1, date: 1 });
export const TimeLog = model('TimeLog', timeLogSchema);

export const SHEET_STATUS = ['open', 'submitted', 'approved', 'rejected'] as const;

/** One per person per week (Monday start), created when the week is first submitted. */
const timesheetSchema = new Schema(
  {
    employee: { type: Schema.Types.ObjectId, ref: 'Employee', required: true },
    weekStart: { type: String, required: true },
    status: { type: String, enum: SHEET_STATUS, default: 'open', index: true },
    totalMinutes: { type: Number, default: 0 },
    submittedAt: Date,
    decidedBy: { type: Schema.Types.ObjectId, ref: 'User' },
    decidedAt: Date,
    comment: String,
  },
  { timestamps: true },
);
timesheetSchema.index({ employee: 1, weekStart: 1 }, { unique: true });
export const Timesheet = model('Timesheet', timesheetSchema);
