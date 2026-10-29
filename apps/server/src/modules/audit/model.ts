import '../../config/istPlugin';
import { Schema, model, type InferSchemaType, Types } from 'mongoose';

const auditLogSchema = new Schema(
  {
    actor: { type: Schema.Types.ObjectId, ref: 'User' },
    action: { type: String, required: true, index: true },
    entity: { type: String, required: true, index: true },
    entityId: { type: String },
    before: Schema.Types.Mixed,
    after: Schema.Types.Mixed,
    meta: Schema.Types.Mixed,
    ip: String,
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);

auditLogSchema.index({ createdAt: -1 });

export type AuditLogDoc = InferSchemaType<typeof auditLogSchema>;
export const AuditLog = model('AuditLog', auditLogSchema);

export interface AuditInput {
  actor?: Types.ObjectId | string | null;
  action: string;
  entity: string;
  entityId?: unknown;
  before?: unknown;
  after?: unknown;
  meta?: unknown;
  ip?: string;
}

/** Append-only audit trail. Never throws into the caller's flow. */
export async function audit(input: AuditInput) {
  try {
    await AuditLog.create({ ...input, entityId: input.entityId != null ? String(input.entityId) : undefined });
  } catch {
    // auditing must not break the request; the logger captures DB failures elsewhere
  }
}
