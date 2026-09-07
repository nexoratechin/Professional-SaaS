import { SetMetadata } from '@nestjs/common';
import type { FeatureKey } from '@college-erp/auth';

export const FEATURE_KEY = 'college_erp:required_feature';

/** Enforced by FeatureFlagsGuard. Route must also be behind JwtAuthGuard + TenantMatchGuard. */
export const RequireFeature = (feature: FeatureKey) => SetMetadata(FEATURE_KEY, feature);
