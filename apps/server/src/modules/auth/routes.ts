import { Router, type Response } from 'express';
import rateLimit from 'express-rate-limit';
import { changePasswordSchema, forgotPasswordSchema, loginSchema, resetPasswordSchema } from '@cms/shared';
import { env } from '../../config/env';
import { authenticate } from '../../middleware/auth';
import { validate } from '../../middleware/validate';
import { ah } from '../../utils/asyncHandler';
import { Employee } from '../employees/model';
import * as auth from './service';

const COOKIE = 'cms_rt';

function setRefreshCookie(res: Response, token: string) {
  res.cookie(COOKIE, token, {
    httpOnly: true,
    sameSite: 'strict',
    secure: env.NODE_ENV === 'production',
    path: '/api/auth',
    maxAge: env.REFRESH_TOKEN_TTL_DAYS * 86400_000,
  });
}

const loginLimiter = rateLimit({
  windowMs: 15 * 60_000,
  limit: env.NODE_ENV === 'test' ? 10_000 : 20,
  standardHeaders: true,
  legacyHeaders: false,
});

const resetLimiter = rateLimit({
  windowMs: 15 * 60_000,
  limit: env.NODE_ENV === 'test' ? 10_000 : 10,
  standardHeaders: true,
  legacyHeaders: false,
});

export const authRouter = Router();

authRouter.post(
  '/login',
  loginLimiter,
  validate(loginSchema),
  ah(async (req, res) => {
    const { accessToken, refreshToken } = await auth.login(req.body.email, req.body.password, req.ip);
    setRefreshCookie(res, refreshToken);
    res.json({ accessToken });
  }),
);

authRouter.post(
  '/refresh',
  ah(async (req, res) => {
    const { accessToken, refreshToken } = await auth.refresh(req.cookies?.[COOKIE] ?? '');
    setRefreshCookie(res, refreshToken);
    res.json({ accessToken });
  }),
);

authRouter.post(
  '/forgot-password',
  resetLimiter,
  validate(forgotPasswordSchema),
  ah(async (req, res) => {
    await auth.requestPasswordReset(req.body.email, req.ip);
    res.status(204).end();
  }),
);

authRouter.post(
  '/reset-password',
  resetLimiter,
  validate(resetPasswordSchema),
  ah(async (req, res) => {
    await auth.resetPassword(req.body.token, req.body.newPassword, req.ip);
    res.status(204).end();
  }),
);

authRouter.post(
  '/logout',
  ah(async (req, res) => {
    await auth.logout(req.cookies?.[COOKIE]);
    res.clearCookie(COOKIE, { path: '/api/auth' });
    res.status(204).end();
  }),
);

authRouter.get(
  '/me',
  authenticate,
  ah(async (req, res) => {
    const u = req.user!;
    const employee = u.employeeId ? await Employee.findById(u.employeeId).select('code name designation department').lean() : null;
    res.json({
      id: u.id,
      email: u.email,
      role: u.roleName,
      permissions: [...u.permissions],
      employee,
    });
  }),
);

// The signed-in user's own profile; never accepts an id, so nobody can read another person's record here
authRouter.get(
  '/profile',
  authenticate,
  ah(async (req, res) => {
    const u = req.user!;
    const employee = u.employeeId
      ? await Employee.findById(u.employeeId)
          .select('-createdAt -updatedAt -__v')
          .populate('manager', 'name code designation')
          .lean()
      : null;
    res.json({ email: u.email, role: u.roleName, employee });
  }),
);

authRouter.post(
  '/change-password',
  authenticate,
  validate(changePasswordSchema),
  ah(async (req, res) => {
    await auth.changePassword(req.user!.id, req.body.currentPassword, req.body.newPassword);
    res.clearCookie(COOKIE, { path: '/api/auth' });
    res.status(204).end();
  }),
);
