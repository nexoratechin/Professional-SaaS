import { Module } from '@nestjs/common';
import { EntitlementGate } from './entitlement-gate';

/** Exposes EntitlementGate to every worker processor that imports EntitlementModule. */
@Module({
  providers: [EntitlementGate],
  exports: [EntitlementGate],
})
export class EntitlementModule {}