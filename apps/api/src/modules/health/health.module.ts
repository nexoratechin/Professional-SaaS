import { Module } from '@nestjs/common';
import { HealthController } from './health.controller';
import { HealthService } from './health.service';

/** Liveness/readiness probes and the /health surface. Depends only on global modules (config,
 *  Prisma, Redis, storage); the alert engine imports this module for its dependency snapshot. */
@Module({
  controllers: [HealthController],
  providers: [HealthService],
  exports: [HealthService],
})
export class HealthModule {}
