import '../../config/istPlugin';
import { Schema, model } from 'mongoose';

const activitySchema = new Schema(
  {
    at: { type: Date, required: true },
    by: { type: Schema.Types.ObjectId, ref: 'User' },
    byName: String,
    kind: { type: String, enum: ['created', 'note', 'status', 'followup', 'owner', 'edit', 'converted'], required: true },
    text: String,
  },
  { _id: true },
);

const enquirySchema = new Schema(
  {
    name: { type: String, required: true, trim: true },
    phone: { type: String, required: true, trim: true },
    phoneKey: { type: String, required: true, index: true }, // last ten digits, for duplicate checks
    email: { type: String, lowercase: true, trim: true },
    company: { type: String, trim: true },
    source: { type: String, required: true },
    status: { type: String, required: true, index: true },
    owner: { type: Schema.Types.ObjectId, ref: 'Employee', required: true, index: true },
    nextFollowUp: { type: String, index: true }, // YYYY-MM-DD; kept on closed enquiries only as history
    lostReason: String,
    closedAt: Date,
    client: { type: Schema.Types.ObjectId, ref: 'Client', default: null },
    project: { type: Schema.Types.ObjectId, ref: 'Project', default: null },
    activity: { type: [activitySchema], default: [] },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true },
);
enquirySchema.index({ status: 1, nextFollowUp: 1 });
export const Enquiry = model('Enquiry', enquirySchema);
