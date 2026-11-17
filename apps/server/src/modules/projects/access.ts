import type { Request } from 'express';
import { PERMISSIONS } from '@cms/shared';
import { hasPermission } from '../../middleware/auth';
import { forbidden, notFound } from '../../utils/errors';
import { Project } from './model';

type ProjectLike = { manager?: unknown; members?: unknown[] };

const same = (a: unknown, b: unknown) => a != null && b != null && String(a) === String(b);

/** Sees every project (HR, Management, Admin). */
export const seesAll = (req: Request) => hasPermission(req, PERMISSIONS.PROJECTS_VIEW);

/** Sees this project: all-projects right, or leads it, or is a member. */
export function canSee(req: Request, p: ProjectLike) {
  const me = req.user?.employeeId;
  return seesAll(req) || same(p.manager, me) || (p.members ?? []).some((m) => same(m, me));
}

/**
 * Edits this project and its tasks and members: needs projects.manage, and either leads the project or can see
 * all projects (Admin, Management). A Manager manages only the projects they lead; HR can look but not change.
 */
export function canManage(req: Request, p: ProjectLike) {
  if (!hasPermission(req, PERMISSIONS.PROJECTS_MANAGE)) return false;
  return seesAll(req) || same(p.manager, req.user?.employeeId);
}

/** Loads a project the caller may see, or fails with 404 (so existence is not revealed to people outside it). */
export async function projectForCaller(req: Request, id: string) {
  const p = await Project.findById(id);
  if (!p || !canSee(req, p)) throw notFound('Project');
  return p;
}

export function assertManage(req: Request, p: ProjectLike) {
  if (!canManage(req, p)) throw forbidden('Only the project manager can do that');
}
