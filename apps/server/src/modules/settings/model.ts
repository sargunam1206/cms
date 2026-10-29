import '../../config/istPlugin';
import { Schema, model } from 'mongoose';

/**
 * Key/value settings with effective dating. The record with the latest
 * effectiveFrom <= the date in question wins, so history is kept when rules change.
 */
const settingSchema = new Schema(
  {
    key: { type: String, required: true },
    value: { type: Schema.Types.Mixed, required: true },
    effectiveFrom: { type: String, required: true, default: '1970-01-01' }, // YYYY-MM-DD
    updatedBy: { type: Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true },
);

settingSchema.index({ key: 1, effectiveFrom: -1 }, { unique: true });

export const Setting = model('Setting', settingSchema);
