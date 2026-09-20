import { SetMetadata } from '@nestjs/common';
import type { EntitlementKey } from '@college-erp/auth';

export const ENTITLEMENT_KEY = 'college_erp:required_entitlement';

/** Enforced by EntitlementFlagsGuard. Route must also be behind JwtAuthGuard + TenantMatchGuard.
 * Uses module-fallback semantics via EntitlementsGatewayService.canUse — being entitled to the
 * module is enough until the specific granular entitlement row is explicitly disabled. */
export const RequireEntitlement = (entitlement: EntitlementKey) =>
  SetMetadata(ENTITLEMENT_KEY, entitlement);