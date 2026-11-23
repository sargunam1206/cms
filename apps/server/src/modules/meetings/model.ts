import '../../config/istPlugin';
import { Schema, model } from 'mongoose';
import { MEETING_STATUS, MEETING_TYPES } from '@cms/shared';

const actionSchema = new Schema(
  {
    text: { type: String, required: true },
    owner: { type: Schema.Types.ObjectId, ref: 'Employee', default: null },
    dueDate: { type: String, default: null }, // YYYY-MM-DD
    done: { type: Boolean, default: false },
    doneAt: Date,
  },
  { _id: true },
);

const meetingSchema = new Schema(
  {
    title: { type: String, required: true, trim: true },
    type: { type: String, enum: MEETING_TYPES, required: true },
    status: { type: String, enum: MEETING_STATUS, default: 'scheduled', index: true },
    date: { type: String, required: true, index: true }, // YYYY-MM-DD (office time), for calendar and list filters
    start: { type: String, required: true }, // HH:mm
    end: { type: String, required: true },
    startAt: { type: Date, required: true, index: true }, // exact instant, for reminders and ordering
    location: String,
    link: String,
    organizer: { type: Schema.Types.ObjectId, ref: 'Employee', required: true, index: true },
    attendees: { type: [{ type: Schema.Types.ObjectId, ref: 'Employee' }], default: [], index: true },
    guests: String,
    agenda: String,
    minutes: String,
    project: { type: Schema.Types.ObjectId, ref: 'Project', default: null, index: true },
    client: { type: Schema.Types.ObjectId, ref: 'Client', default: null, index: true },
    actions: { type: [actionSchema], default: [] },
    reminderSentAt: { type: Date, default: null },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true },
);
meetingSchema.index({ 'actions.owner': 1, 'actions.done': 1 });

export const Meeting = model('Meeting', meetingSchema);
