import '../../config/istPlugin';
import { Schema, model } from 'mongoose';

const folderSchema = new Schema(
  {
    name: { type: String, required: true, trim: true, unique: true },
    description: String,
    editors: { type: [{ type: Schema.Types.ObjectId, ref: 'Employee' }], default: [] },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true },
);
export const ConfidentialFolder = model('ConfidentialFolder', folderSchema);

const versionSchema = new Schema(
  {
    version: { type: Number, required: true },
    name: { type: String, required: true },
    mime: { type: String, required: true },
    size: { type: Number, required: true },
    note: String,
    uploadedBy: { type: Schema.Types.ObjectId, ref: 'User' },
    uploadedByName: String,
    at: { type: Date, required: true },
  },
  { _id: true },
);

const docSchema = new Schema(
  {
    folder: { type: Schema.Types.ObjectId, ref: 'ConfidentialFolder', required: true, index: true },
    title: { type: String, required: true, trim: true },
    description: String,
    expiresOn: { type: String, default: null, index: true }, // YYYY-MM-DD
    remindDays: { type: Number, default: 30 },
    versions: { type: [versionSchema], default: [] },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User' },
    createdByName: String,
  },
  { timestamps: true },
);
export const ConfidentialDoc = model('ConfidentialDoc', docSchema);

/** File bytes, one record per version, kept apart so lists never load them. */
export const ConfidentialFile = model(
  'ConfidentialFile',
  new Schema({
    doc: { type: Schema.Types.ObjectId, ref: 'ConfidentialDoc', required: true, index: true },
    version: { type: Schema.Types.ObjectId, required: true, unique: true },
    data: { type: Buffer, required: true },
  }),
);

/** Every time someone opens a confidential file. Never edited or deleted from the app. */
export const ConfidentialAccess = model(
  'ConfidentialAccess',
  new Schema({
    doc: { type: Schema.Types.ObjectId, ref: 'ConfidentialDoc', required: true, index: true },
    folder: { type: Schema.Types.ObjectId, ref: 'ConfidentialFolder' },
    title: String,
    version: Number,
    user: { type: Schema.Types.ObjectId, ref: 'User' },
    userName: String,
    ip: String,
    at: { type: Date, required: true, index: true },
  }),
);
