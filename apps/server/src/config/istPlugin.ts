import mongoose, { type Schema } from 'mongoose';
import { inTz } from '../utils/time';

/**
 * For every Date path (createdAt, checkIn, lastLoginAt, ...) keep a readable "<path>IST" string
 * ("2026-10-29 10:08:34") beside it, so the database can be browsed in office time.
 * The Date stays UTC and is the source of truth; the string is derived and never read by the app.
 */
const SUFFIX = 'IST';
export const toIst = (d: Date) => inTz(d).format('YYYY-MM-DD HH:mm:ss');

const isPlain = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && Object.getPrototypeOf(v) === Object.prototype;

/** Adds "<key>IST" beside every Date value inside an update document ($set, $setOnInsert, $push ...). */
function addIstToUpdate(o: Record<string, unknown>) {
  for (const [k, v] of Object.entries(o)) {
    if (v instanceof Date) {
      if (!k.startsWith('$')) o[k + SUFFIX] = toIst(v);
    } else if (Array.isArray(v)) {
      v.forEach((x) => isPlain(x) && addIstToUpdate(x));
    } else if (isPlain(v)) {
      addIstToUpdate(v);
    }
  }
}

export function istPlugin(schema: Schema) {
  const dateFields: string[] = [];
  schema.eachPath((path, type) => {
    if ((type as { instance?: string }).instance === 'Date' && !path.endsWith(SUFFIX)) dateFields.push(path);
  });
  if (!dateFields.length) return;

  schema.add(Object.fromEntries(dateFields.map((p) => [p + SUFFIX, String])));

  // Runs after Mongoose's own timestamps hook (registered when the schema was built), so updatedAt is already set
  schema.pre('save', function () {
    for (const p of dateFields) {
      const v = this.get(p) as Date | null | undefined;
      this.set(p + SUFFIX, v ? toIst(v) : undefined);
    }
  });

  schema.pre(['updateOne', 'updateMany', 'findOneAndUpdate'], function () {
    const update = this.getUpdate();
    if (update && !Array.isArray(update)) addIstToUpdate(update as Record<string, unknown>);
  });
}

// Global plugins apply when a model is compiled, so this must run before the first model() call.
// Every model.ts imports this file first.
mongoose.plugin(istPlugin);
