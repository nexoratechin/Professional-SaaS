import type { AuthenticatedUser, AuthenticatedPlatformUser } from '@college-erp/auth';

declare global {
  namespace Express {
    interface User extends Partial<AuthenticatedUser>, Partial<AuthenticatedPlatformUser> {}
  }
}

export {};
