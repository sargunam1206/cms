import type { NextFunction, Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import type { Permission } from '@cms/shared';
import { env } from '../config/env';
import { User } from '../modules/users/model';
import { forbidden, unauthorized } from '../utils/errors';
import type { AuthUser } from '../types/express';

/**
 * Verifies the bearer access token, then reloads the user + role so permission
 * changes and account disabling take effect immediately.
 */
export async function authenticate(req: Request, _res: Response, next: NextFunction) {
  try {
    const header = req.headers.authorization;
    if (!header?.startsWith('Bearer ')) throw unauthorized();
    let payload: { sub: string };
    try {
      payload = jwt.verify(header.slice(7), env.JWT_ACCESS_SECRET) as { sub: string };
    } catch {
      throw unauthorized('Session expired');
    }
    const user = await User.findById(payload.sub).populate<{ role: { name: string; permissions: string[] } }>('role').lean();
    if (!user || user.status !== 'active') throw unauthorized('Account disabled');
    req.user = {
      id: user._id,
      email: user.email,
      roleName: user.role.name,
      permissions: new Set(user.role.permissions as Permission[]),
      employeeId: user.employee ?? null,
    } satisfies AuthUser;
    next();
  } catch (err) {
    next(err);
  }
}

/** Passes if the user holds ANY of the listed permissions. */
export const requirePermission =
  (...perms: Permission[]) =>
  (req: Request, _res: Response, next: NextFunction) => {
    if (!req.user) return next(unauthorized());
    if (perms.some((p) => req.user!.permissions.has(p))) return next();
    next(forbidden());
  };

export const hasPermission = (req: Request, p: Permission) => !!req.user?.permissions.has(p);

/** Endpoints for self-service need the user to be linked to an employee record. */
export function requireEmployee(req: Request) {
  if (!req.user?.employeeId) throw forbidden('Your login is not linked to an employee record');
  return req.user.employeeId;
}
