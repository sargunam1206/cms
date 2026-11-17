import '../../config/istPlugin';
import { Schema, model } from 'mongoose';
import { BILLING_TYPES, PROJECT_STATUS, TASK_PRIORITY, TASK_STATUS } from '@cms/shared';

const clientSchema = new Schema(
  {
    name: { type: String, required: true, unique: true, trim: true },
    contactName: String,
    email: { type: String, lowercase: true, trim: true },
    phone: String,
    address: String,
    gstin: { type: String, uppercase: true },
    notes: String,
    active: { type: Boolean, default: true },
  },
  { timestamps: true },
);
export const Client = model('Client', clientSchema);

const projectSchema = new Schema(
  {
    code: { type: String, required: true, unique: true, uppercase: true, trim: true },
    name: { type: String, required: true, trim: true },
    client: { type: Schema.Types.ObjectId, ref: 'Client', default: null },
    manager: { type: Schema.Types.ObjectId, ref: 'Employee', required: true, index: true },
    members: { type: [{ type: Schema.Types.ObjectId, ref: 'Employee' }], default: [], index: true },
    status: { type: String, enum: PROJECT_STATUS, default: 'planning', index: true },
    billingType: { type: String, enum: BILLING_TYPES, default: 'time_material' },
    startDate: String,
    dueDate: String,
    budgetHours: Number,
    description: String,
    baselineAt: Date, // when the milestone plan was last frozen as the baseline
    taskSeq: { type: Number, default: 0 }, // last task number handed out in this project
    createdBy: { type: Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true },
);
export const Project = model('Project', projectSchema);

const commentSchema = new Schema(
  {
    by: { type: Schema.Types.ObjectId, ref: 'User' },
    byName: String,
    text: { type: String, required: true },
    at: { type: Date, required: true },
  },
  { _id: true },
);

const taskSchema = new Schema(
  {
    project: { type: Schema.Types.ObjectId, ref: 'Project', required: true, index: true },
    number: { type: Number, required: true }, // PRJ-001-12 style reference: project code + number
    title: { type: String, required: true, trim: true },
    description: String,
    assignee: { type: Schema.Types.ObjectId, ref: 'Employee', default: null, index: true },
    reporter: { type: Schema.Types.ObjectId, ref: 'User' },
    status: { type: String, enum: TASK_STATUS, default: 'todo' },
    priority: { type: String, enum: TASK_PRIORITY, default: 'medium' },
    estimateHours: Number,
    dueDate: String, // YYYY-MM-DD
    milestone: { type: Schema.Types.ObjectId, ref: 'Milestone', default: null, index: true },
    estimateModule: { type: String, default: null },
    position: { type: Number, default: 0 }, // order within its board column
    completedAt: Date,
    comments: { type: [commentSchema], default: [] },
  },
  { timestamps: true },
);
taskSchema.index({ project: 1, number: 1 }, { unique: true });
taskSchema.index({ project: 1, status: 1, position: 1 });
export const Task = model('Task', taskSchema);
