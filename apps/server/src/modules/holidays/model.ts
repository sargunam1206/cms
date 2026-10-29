import '../../config/istPlugin';
import { Schema, model } from 'mongoose';

const holidaySchema = new Schema(
  {
    date: { type: String, required: true, unique: true }, // YYYY-MM-DD
    name: { type: String, required: true },
    optional: { type: Boolean, default: false }, // restricted holiday: not a day off for everyone
  },
  { timestamps: true },
);

export const Holiday = model('Holiday', holidaySchema);

/** Mandatory holidays between two dates, as a Set of YYYY-MM-DD. */
export async function holidaySet(from: string, to: string) {
  const rows = await Holiday.find({ date: { $gte: from, $lte: to }, optional: false }).select('date').lean();
  return new Set(rows.map((r) => r.date));
}
