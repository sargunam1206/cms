import express, { Router } from 'express';
import { z } from 'zod';
import { COMPANY_IMAGES, PERMISSIONS, companySchema } from '@cms/shared';
import { authenticate, requirePermission } from '../../middleware/auth';
import { validate } from '../../middleware/validate';
import { ah } from '../../utils/asyncHandler';
import { badRequest, notFound } from '../../utils/errors';
import { audit } from '../audit/model';
import { setSetting } from '../settings/service';
import { CompanyAsset } from './model';
import { COMPANY_KEY, getCompany, hasImage, sniffImage } from './service';

export const companyRouter = Router();
const edit = requirePermission(PERMISSIONS.SETTINGS_MANAGE);
const imageParam = validate(z.object({ image: z.enum(COMPANY_IMAGES) }), 'params');

/** Any signed-in user may read the profile (the app shows the company name); only managers change it. */
companyRouter.get(
  '/',
  authenticate,
  ah(async (_req, res) => {
    res.json({ ...(await getCompany()), hasLogo: await hasImage('logo'), hasSignature: await hasImage('signature') });
  }),
);

companyRouter.put(
  '/',
  authenticate,
  edit,
  validate(companySchema),
  ah(async (req, res) => {
    const before = await getCompany();
    await setSetting(COMPANY_KEY, req.body, '1970-01-01', req.user!.id);
    await audit({ actor: req.user!.id, action: 'company.update', entity: 'Company', before, after: req.body });
    res.json(await getCompany());
  }),
);

companyRouter.get(
  '/:image',
  authenticate,
  imageParam,
  ah(async (req, res) => {
    const a = await CompanyAsset.findOne({ key: req.params.image }); // hydrated, so `data` is a Buffer
    if (!a) throw notFound('Image');
    res.setHeader('Content-Type', a.contentType);
    res.setHeader('Cache-Control', 'private, max-age=60');
    res.send(a.data);
  }),
);

/** The body is the raw image file. */
companyRouter.put(
  '/:image',
  authenticate,
  edit,
  imageParam,
  express.raw({ type: ['image/png', 'image/jpeg', 'application/octet-stream'], limit: '1mb' }),
  ah(async (req, res) => {
    if (!Buffer.isBuffer(req.body) || !req.body.length) throw badRequest('Send a PNG or JPEG image (up to 1 MB)');
    const type = sniffImage(req.body);
    if (!type) throw badRequest('Only PNG or JPEG images are supported');
    await CompanyAsset.findOneAndUpdate({ key: req.params.image }, { key: req.params.image, contentType: type, data: req.body, updatedBy: req.user!.id }, { upsert: true });
    await audit({ actor: req.user!.id, action: `company.${req.params.image}_set`, entity: 'Company', meta: { bytes: req.body.length, type } });
    res.status(204).end();
  }),
);

companyRouter.delete(
  '/:image',
  authenticate,
  edit,
  imageParam,
  ah(async (req, res) => {
    await CompanyAsset.deleteOne({ key: req.params.image });
    await audit({ actor: req.user!.id, action: `company.${req.params.image}_remove`, entity: 'Company' });
    res.status(204).end();
  }),
);
