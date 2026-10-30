import { companySchema, type CompanyImage, type CompanyProfile } from '@cms/shared';
import { env } from '../../config/env';
import { getSetting } from '../settings/service';
import { CompanyAsset } from './model';

export const COMPANY_KEY = 'company';

export async function getCompany(): Promise<CompanyProfile> {
  const stored = (await getSetting<Partial<CompanyProfile>>(COMPANY_KEY)) ?? {};
  return companySchema.parse({ name: env.COMPANY_NAME, ...stored });
}

export const hasImage = async (key: CompanyImage) => !!(await CompanyAsset.exists({ key }));

/** PNG or JPEG only (what the PDF library can embed), judged by the file's own bytes, not its claimed type. */
export function sniffImage(buf: Buffer): 'image/png' | 'image/jpeg' | null {
  if (buf.length > 8 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  if (buf.length > 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  return null;
}

/** Everything the PDF header and footer need. */
export async function companyForPdf() {
  // Not .lean(): a lean read returns a BSON Binary wrapper, while a hydrated document gives a real Buffer
  const [profile, logo, signature] = await Promise.all([getCompany(), CompanyAsset.findOne({ key: 'logo' }), CompanyAsset.findOne({ key: 'signature' })]);
  return { ...profile, logo: logo?.data?.length ? logo.data : undefined, signature: signature?.data?.length ? signature.data : undefined };
}
