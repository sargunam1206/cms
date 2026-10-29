import { Router } from 'express';
import { ALL_PERMISSIONS, PERMISSIONS, createUserSchema, roleSchema, updateUserSchema } from '@cms/shared';
import { requirePermission } from '../../middleware/auth';
import { validate } from '../../middleware/validate';
import { escapeRegex } from '../../utils/regex';
import { ah } from '../../utils/asyncHandler';
import { badRequest, conflict, notFound } from '../../utils/errors';
import { audit } from '../audit/model';
import { hashPassword } from '../auth/service';
import { RefreshToken, Role, User } from './model';

// ---------- Users ----------
export const usersRouter = Router();
usersRouter.use(requirePermission(PERMISSIONS.USERS_MANAGE));

usersRouter.get(
  '/',
  ah(async (req, res) => {
    const q = typeof req.query.q === 'string' ? req.query.q.trim().slice(0, 100) : '';
    const filter = q ? { email: new RegExp(escapeRegex(q), 'i') } : {};
    const page = Math.max(1, Number(req.query.page) || 1);
    const limit = Math.min(200, Math.max(1, Number(req.query.limit) || 50));
    const [items, total] = await Promise.all([
      User.find(filter).populate('role', 'name').populate('employee', 'name code').sort({ email: 1 }).skip((page - 1) * limit).limit(limit).lean(),
      User.countDocuments(filter),
    ]);
    res.json({ items, total, page, limit });
  }),
);

usersRouter.post(
  '/',
  validate(createUserSchema),
  ah(async (req, res) => {
    const { password, ...rest } = req.body;
    if (rest.employee && (await User.exists({ employee: rest.employee }))) throw conflict('That employee already has a login');
    const user = await User.create({ ...rest, passwordHash: await hashPassword(password) });
    await audit({ actor: req.user!.id, action: 'user.create', entity: 'User', entityId: user._id, after: { email: user.email, role: user.role } });
    res.status(201).json({ _id: user._id, email: user.email });
  }),
);

usersRouter.patch(
  '/:id',
  validate(updateUserSchema),
  ah(async (req, res) => {
    const { password, ...rest } = req.body;
    if (String(req.user!.id) === req.params.id && rest.status === 'disabled') throw badRequest('You cannot disable yourself');
    if (rest.employee && (await User.exists({ employee: rest.employee, _id: { $ne: req.params.id } })))
      throw conflict('That employee already has a login');
    const update: Record<string, unknown> = { ...rest };
    if (password) update.passwordHash = await hashPassword(password);
    const user = await User.findByIdAndUpdate(req.params.id, update, { new: true });
    if (!user) throw notFound('User');
    if (password || rest.status === 'disabled') {
      await RefreshToken.updateMany({ user: user._id, revokedAt: null }, { revokedAt: new Date() });
    }
    await audit({
      actor: req.user!.id,
      action: 'user.update',
      entity: 'User',
      entityId: user._id,
      after: { ...rest, passwordReset: !!password },
    });
    res.json({ _id: user._id, email: user.email });
  }),
);

// ---------- Roles ----------
export const rolesRouter = Router();

rolesRouter.get(
  '/',
  requirePermission(PERMISSIONS.ROLES_MANAGE, PERMISSIONS.USERS_MANAGE),
  ah(async (_req, res) => {
    res.json({ roles: await Role.find().sort({ name: 1 }).lean(), allPermissions: ALL_PERMISSIONS });
  }),
);

rolesRouter.post(
  '/',
  requirePermission(PERMISSIONS.ROLES_MANAGE),
  validate(roleSchema),
  ah(async (req, res) => {
    const role = await Role.create(req.body);
    await audit({ actor: req.user!.id, action: 'role.create', entity: 'Role', entityId: role._id, after: req.body });
    res.status(201).json(role);
  }),
);

rolesRouter.put(
  '/:id',
  requirePermission(PERMISSIONS.ROLES_MANAGE),
  validate(roleSchema),
  ah(async (req, res) => {
    const before = await Role.findById(req.params.id).lean();
    if (!before) throw notFound('Role');
    if (before.name === 'Admin' && !req.body.permissions.includes(PERMISSIONS.ROLES_MANAGE)) {
      throw badRequest('Admin must keep roles.manage to avoid lock-out');
    }
    const role = await Role.findByIdAndUpdate(req.params.id, { ...req.body, name: before.system ? before.name : req.body.name }, { new: true });
    await audit({ actor: req.user!.id, action: 'role.update', entity: 'Role', entityId: req.params.id, before, after: role?.toObject() });
    res.json(role);
  }),
);

rolesRouter.delete(
  '/:id',
  requirePermission(PERMISSIONS.ROLES_MANAGE),
  ah(async (req, res) => {
    const role = await Role.findById(req.params.id);
    if (!role) throw notFound('Role');
    if (role.system) throw badRequest('System roles cannot be deleted');
    if (await User.exists({ role: role._id })) throw conflict('Role is assigned to users');
    await role.deleteOne();
    await audit({ actor: req.user!.id, action: 'role.delete', entity: 'Role', entityId: role._id, before: role.toObject() });
    res.status(204).end();
  }),
);
