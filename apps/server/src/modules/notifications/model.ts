import '../../config/istPlugin';
import { Schema, model } from 'mongoose';

const notificationSchema = new Schema(
  {
    user: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    type: { type: String, required: true },
    title: { type: String, required: true },
    body: String,
    link: String, // path inside the app, e.g. /approvals
    entity: { kind: String, id: String },
    dedupeKey: String,
    readAt: Date,
  },
  { timestamps: true },
);
notificationSchema.index({ user: 1, createdAt: -1 });
notificationSchema.index({ user: 1, readAt: 1 });
notificationSchema.index({ createdAt: 1 }, { expireAfterSeconds: 180 * 86400 }); // keep six months
export const Notification = model('Notification', notificationSchema);

/** What each person has switched off. Anything not listed follows the defaults. */
const prefSchema = new Schema(
  {
    user: { type: Schema.Types.ObjectId, ref: 'User', required: true, unique: true },
    emailMuted: { type: [String], default: [] },
    inAppMuted: { type: [String], default: [] },
  },
  { timestamps: true },
);
export const NotificationPref = model('NotificationPref', prefSchema);
