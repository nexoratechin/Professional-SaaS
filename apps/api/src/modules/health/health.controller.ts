import { Controller, Get, Res } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { HealthService } from './health.service';

/**
 * Health surface:
 *  - GET /health       — liveness + build info (kept backwards compatible with the original
 *                        { status, timestamp } contract; no dependency I/O).
 *  - GET /health/live  — alias of /health for Kubernetes liveness probes.
 *  - GET /health/ready — dependency readiness; 200 when database+Redis are up (degraded allowed),
 *                        503 when a critical dependency is down.
 *
 * All health routes are exempt from tenant resolution and request logging, and are safe to expose
 * to a load balancer/ingress (no sensitive data — probe latencies only).
 */
@ApiTags('health')
@Controller('health')
export class HealthController {
  constructor(private readonly health: HealthService) {}

  @Get()
  check() {
    return this.health.live();
  }

  @Get('live')
  live() {
    return this.health.live();
  }

  @Get('ready')
  async ready(@Res() response: Response): Promise<void> {
    const report = await this.health.readiness();
    response.status(report.status === 'down' ? 503 : 200).json(report);
  }
}
