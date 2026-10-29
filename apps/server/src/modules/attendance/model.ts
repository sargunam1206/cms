import '../../config/istPlugin';
import { Schema, model, type InferSchemaType, type Types } from 'mongoose';
import { ATTENDANCE_SOURCE, ATTENDANCE_STATUS, REGULARIZATION_TYPES, REQUEST_STATUS } from '@cms/shared';

const attendanceDaySchema = new Schema(
  {
    employee: { type: Schema.Types.ObjectId, ref: 'Employee', required: true },
    date: { type: String, required: true }, // YYYY-MM-DD in office timezone
    checkIn: Date, // UTC; checkInIST is added by the IST plugin
    checkOut: Date,
    workedMinutes: { type: Number, default: 0 },
    lateMinutes: { type: Number, default: 0 },
    earlyMinutes: { type: Number, default: 0 },
    isLate: { type: Boolean, default: false },
    status: { type: String, enum: ATTENDANCE_STATUS, default: 'absent' },
    source: { type: String, enum: ATTENDANCE_SOURCE, default: 'self' },
    missedCheckout: { type: Boolean, default: false },
    leave: {
      type: new Schema(
        {
          request: { type: Schema.Types.ObjectId, ref: 'LeaveRequest' },
          leaveType: { type: Schema.Types.ObjectId, ref: 'LeaveType' },
          code: String,
          paid: Boolean,
          fraction: Number, // 1 or 0.5
        },
        { _id: false },
      ),
      default: null,
    },
    regularization: { type: Schema.Types.ObjectId, ref: 'RegularizationRequest' },
    // HR relief: this day's late mark does not count towards late-mark LOP
    lateExcused: {
      type: new Schema(
        {
          by: { type: Schema.Types.ObjectId, ref: 'User' },
          reason: String,
          at: Date,
        },
        { _id: false },
      ),
      default: null,
    },
    override: {
      type: new Schema(
        {
          by: { type: Schema.Types.ObjectId, ref: 'User' },
          reason: String,
          at: Date,
        },
        { _id: false },
      ),
      default: null,
    },
  },
  { timestamps: true },
);
attendanceDaySchema.index({ employee: 1, date: 1 }, { unique: true });
attendanceDaySchema.index({ date: 1 });

export type AttendanceDayDoc = InferSchemaType<typeof attendanceDaySchema> & { _id: Types.ObjectId };
export const AttendanceDay = model('AttendanceDay', attendanceDaySchema);

const regularizationSchema = new Schema(
  {
    employee: { type: Schema.Types.ObjectId, ref: 'Employee', required: true, index: true },
    date: { type: String, required: true },
    type: { type: String, enum: REGULARIZATION_TYPES, required: true },
    checkIn: String, // HH:mm requested
    checkOut: String,
    reason: { type: String, required: true },
    status: { type: String, enum: REQUEST_STATUS, default: 'pending', index: true },
    decidedBy: { type: Schema.Types.ObjectId, ref: 'User' },
    decidedAt: Date,
    comment: String,
  },
  { timestamps: true },
);
export const RegularizationRequest = model('RegularizationRequest', regularizationSchema);

const attendanceLockSchema = new Schema(
  {
    month: { type: String, required: true, unique: true }, // YYYY-MM
    locked: { type: Boolean, default: true },
    history: [
      {
        _id: false,
        action: { type: String, enum: ['lock', 'unlock'] },
        by: { type: Schema.Types.ObjectId, ref: 'User' },
        at: Date,
        reason: String,
      },
    ],
  },
  { timestamps: true },
);
export const AttendanceLock = model('AttendanceLock', attendanceLockSchema);
