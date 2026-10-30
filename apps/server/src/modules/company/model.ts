import '../../config/istPlugin';
import { Schema, model } from 'mongoose';
import { COMPANY_IMAGES } from '@cms/shared';

/** Logo and signature images (PNG or JPEG, small), kept in the database so they back up with everything else. */
const assetSchema = new Schema(
  {
    key: { type: String, enum: COMPANY_IMAGES, required: true, unique: true },
    contentType: { type: String, required: true },
    data: { type: Buffer, required: true },
    updatedBy: { type: Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true },
);
export const CompanyAsset = model('CompanyAsset', assetSchema);
