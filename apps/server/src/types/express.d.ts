import type { Types } from 'mongoose';
import type { Permission } from '@cms/shared';

export interface AuthUser {
  id: Types.ObjectId;
  email: string;
  roleName: string;
  permissions: Set<Permission>;
  employeeId: Types.ObjectId | null;
}

declare global {
  namespace Express {
    interface Request {
      user?: AuthUser;
    }
  }
}
