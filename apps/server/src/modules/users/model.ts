import '../../config/istPlugin';
import { Schema, model, type InferSchemaType, type HydratedDocument } from 'mongoose';

const roleSchema = new Schema(
  {
    name: { type: String, required: true, unique: true, trim: true },
    permissions: { type: [String], default: [] },
    system: { type: Boolean, default: false }, // seeded roles cannot be deleted
  },
  { timestamps: true },
);
export type RoleDoc = HydratedDocument<InferSchemaType<typeof roleSchema>>;
export const Role = model('Role', roleSchema);

const userSchema = new Schema(
  {
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    passwordHash: { type: String, required: true, select: false },
    role: { type: Schema.Types.ObjectId, ref: 'Role', required: true },
    employee: { type: Schema.Types.ObjectId, ref: 'Employee', default: null },
    status: { type: String, enum: ['active', 'disabled'], default: 'active' },
    lastLoginAt: Date,
  },
  { timestamps: true },
);
export type UserDoc = HydratedDocument<InferSchemaType<typeof userSchema>>;
export const User = model('User', userSchema);

const refreshTokenSchema = new Schema(
  {
    user: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    tokenHash: { type: String, required: true, unique: true },
    expiresAt: { type: Date, required: true },
    revokedAt: Date,
    replacedBy: String,
  },
  { timestamps: true },
);
refreshTokenSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
export const RefreshToken = model('RefreshToken', refreshTokenSchema);

/** Single-use, short-lived password reset token (only its hash is stored). */
const passwordResetSchema = new Schema(
  {
    user: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    tokenHash: { type: String, required: true, unique: true },
    expiresAt: { type: Date, required: true },
    usedAt: Date,
  },
  { timestamps: true },
);
passwordResetSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
export const PasswordReset = model('PasswordReset', passwordResetSchema);
