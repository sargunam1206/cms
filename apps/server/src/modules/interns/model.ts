import '../../config/istPlugin';
import { Schema, model } from 'mongoose';
import { INTERN_PAY_BASIS, INTERN_SOURCES, INTERN_STATUS, INTERN_TASK_KINDS, INTERN_TASK_STATUS } from '@cms/shared';

/** The internship side of an intern: the person themselves is an Employee record with type 'intern'. */
const internshipSchema = new Schema(
  {
    employee: { type: Schema.Types.ObjectId, ref: 'Employee', required: true, unique: true },
    source: { type: String, enum: INTERN_SOURCES, default: 'college' },
    organization: String, // college or company name (required by the API; older records get it from the seed)
    college: String, // older records only; the seed copies it into organization
    course: String,
    yearOfStudy: String,
    startDate: { type: String, required: true }, // YYYY-MM-DD
    endDate: { type: String, required: true },
    mentor: { type: Schema.Types.ObjectId, ref: 'Employee', default: null, index: true },
    status: { type: String, enum: INTERN_STATUS, default: 'onboarding', index: true },
    payBasis: { type: String, enum: INTERN_PAY_BASIS, default: 'monthly' },
    stipend: { type: Number, default: 0 }, // paise: per month, or per hour when payBasis is hourly
    hoursPerWeek: Number,
    checklist: {
      type: [{ label: { type: String, required: true }, done: { type: Boolean, default: false }, doneAt: Date, doneByName: String, note: String }],
      default: [],
    },
    stipendPayments: {
      type: [{ month: String, hours: Number, amount: Number, paidOn: String, note: String, byName: String, at: Date }], // amount in paise
      default: [],
    },
    allocations: {
      type: [{ project: { type: Schema.Types.ObjectId, ref: 'Project' }, from: String, to: String, note: String, byName: String, at: Date }],
      default: [],
    },
    completion: { date: String, rating: Number, feedback: String, certificateIssued: Boolean, byName: String },
    history: { type: [{ at: Date, byName: String, from: String, to: String }], default: [] },
  },
  { timestamps: true },
);
export const Internship = model('Internship', internshipSchema);

const internDocSchema = new Schema(
  {
    intern: { type: Schema.Types.ObjectId, ref: 'Employee', required: true, index: true },
    title: { type: String, required: true },
    name: { type: String, required: true },
    mime: { type: String, required: true },
    size: { type: Number, required: true },
    uploadedBy: { type: Schema.Types.ObjectId, ref: 'User' },
    uploadedByName: String,
  },
  { timestamps: true },
);
export const InternDoc = model('InternDoc', internDocSchema);
export const InternDocFile = model(
  'InternDocFile',
  new Schema({ doc: { type: Schema.Types.ObjectId, ref: 'InternDoc', required: true, unique: true }, data: { type: Buffer, required: true } }),
);

/** Work given to an intern by a mentor: a learning exercise or a piece of a project, logged daily and reviewed. */
const internTaskSchema = new Schema(
  {
    intern: { type: Schema.Types.ObjectId, ref: 'Employee', required: true, index: true },
    mentor: { type: Schema.Types.ObjectId, ref: 'Employee', default: null, index: true },
    title: { type: String, required: true, trim: true },
    description: String,
    kind: { type: String, enum: INTERN_TASK_KINDS, default: 'learning' },
    project: { type: Schema.Types.ObjectId, ref: 'Project', default: null },
    dueDate: { type: String, default: null },
    estimateHours: Number,
    status: { type: String, enum: INTERN_TASK_STATUS, default: 'assigned', index: true },
    logs: { type: [{ date: String, minutes: Number, note: String, at: Date }], default: [] },
    reviews: { type: [{ outcome: String, rating: Number, note: String, byName: String, at: Date }], default: [] },
    submittedNote: String,
    assignedBy: { type: Schema.Types.ObjectId, ref: 'User' },
    assignedByName: String,
  },
  { timestamps: true },
);
export const InternTask = model('InternTask', internTaskSchema);
