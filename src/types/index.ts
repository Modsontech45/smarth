import { Request } from 'express';

export type UserRole = 'ADMIN' | 'USER' | 'GUEST';

export interface JWTPayload {
  userId: number;
  email: string;
  role: UserRole;
}

export interface AuthenticatedRequest extends Request {
  user?: JWTPayload;
  device?: DeviceContext;
  userId?: number;
}

export interface DeviceContext {
  id: number;
  owner_id: number;
  name: string;
  type: 'INPUT' | 'OUTPUT';
  zone: string;
}
