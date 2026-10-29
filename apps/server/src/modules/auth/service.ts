import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import type { Types } from 'mongoose';
import { env } from '../../config/env';
import { PasswordReset, RefreshToken, User } from '../users/model';
import { sendMail } from '../../utils/mailer';
import { audit } from '../audit/model';
import { badRequest, unauthorized } from '../../utils/errors';

const sha256 = (s: string) => crypto.createHash('sha256').update(s).digest('hex');

export const hashPassword = (pw: string) => bcrypt.hash(pw, 10);

export function signAccessToken(userId: Types.ObjectId | string) {
  return jwt.sign({ sub: String(userId) }, env.JWT_ACCESS_SECRET, {
    expiresIn: env.ACCESS_TOKEN_TTL as jwt.SignOptions['expiresIn'],
  });
}

async function issueRefreshToken(userId: Types.ObjectId) {
  const token = crypto.randomBytes(48).toString('base64url');
  await RefreshToken.create({
    user: userId,
    tokenHash: sha256(token),
    expiresAt: new Date(Date.now() + env.REFRESH_TOKEN_TTL_DAYS * 86400_000),
  });
  return token;
}

export async function login(email: string, password: string, ip?: string) {
  const user = await User.findOne({ email: email.toLowerCase() }).select('+passwordHash');
  const ok = user && user.status === 'active' && (await bcrypt.compare(password, user.passwordHash));
  if (!ok) {
    await audit({ action: 'auth.login_failed', entity: 'User', meta: { email }, ip });
    throw unauthorized('Invalid email or password');
  }
  user.lastLoginAt = new Date();
  await user.save();
  await audit({ actor: user._id, action: 'auth.login', entity: 'User', entityId: user._id, ip });
  return { accessToken: signAccessToken(user._id), refreshToken: await issueRefreshToken(user._id) };
}

/**
 * Rotates the refresh token. Reuse of an already-rotated token signals theft,
 * so every session of that user is revoked.
 */
export async function refresh(token: string) {
  const doc = await RefreshToken.findOne({ tokenHash: sha256(token) });
  if (!doc || doc.expiresAt < new Date()) throw unauthorized('Session expired');
  if (doc.revokedAt) {
    await RefreshToken.updateMany({ user: doc.user, revokedAt: null }, { revokedAt: new Date() });
    await audit({ actor: doc.user, action: 'auth.refresh_reuse', entity: 'User', entityId: doc.user });
    throw unauthorized('Session expired');
  }
  const user = await User.findById(doc.user);
  if (!user || user.status !== 'active') throw unauthorized('Account disabled');

  const next = await issueRefreshToken(user._id);
  doc.revokedAt = new Date();
  doc.replacedBy = sha256(next);
  await doc.save();
  return { accessToken: signAccessToken(user._id), refreshToken: next };
}

export async function logout(token?: string) {
  if (!token) return;
  await RefreshToken.updateOne({ tokenHash: sha256(token) }, { revokedAt: new Date() });
}

export async function changePassword(userId: Types.ObjectId, current: string, next: string) {
  const user = await User.findById(userId).select('+passwordHash');
  if (!user || !(await bcrypt.compare(current, user.passwordHash))) throw badRequest('Current password is incorrect');
  user.passwordHash = await hashPassword(next);
  await user.save();
  await RefreshToken.updateMany({ user: userId, revokedAt: null }, { revokedAt: new Date() });
  await audit({ actor: userId, action: 'auth.password_change', entity: 'User', entityId: userId });
}

const RESET_TTL_MIN = 30;

/** Always resolves silently, so the response never reveals whether an email has an account. */
export async function requestPasswordReset(email: string, ip?: string) {
  const user = await User.findOne({ email: email.toLowerCase(), status: 'active' });
  if (!user) return;
  const token = crypto.randomBytes(32).toString('base64url');
  await PasswordReset.updateMany({ user: user._id, usedAt: null }, { usedAt: new Date() });
  await PasswordReset.create({ user: user._id, tokenHash: sha256(token), expiresAt: new Date(Date.now() + RESET_TTL_MIN * 60_000) });
  await audit({ actor: user._id, action: 'auth.password_reset_requested', entity: 'User', entityId: user._id, ip });
  const link = `${env.CLIENT_ORIGIN}/reset-password?token=${token}`;
  await sendMail(user.email, 'Reset your CMS password', `Use this link within ${RESET_TTL_MIN} minutes to set a new password:

${link}

If you did not ask for this, ignore this email.`);
}

export async function resetPassword(token: string, newPassword: string, ip?: string) {
  const doc = await PasswordReset.findOne({ tokenHash: sha256(token), usedAt: null });
  if (!doc || doc.expiresAt < new Date()) throw badRequest('This reset link is invalid or has expired');
  doc.usedAt = new Date();
  await doc.save();
  await User.updateOne({ _id: doc.user }, { passwordHash: await hashPassword(newPassword) });
  await RefreshToken.updateMany({ user: doc.user, revokedAt: null }, { revokedAt: new Date() });
  await audit({ actor: doc.user, action: 'auth.password_reset', entity: 'User', entityId: doc.user, ip });
}
