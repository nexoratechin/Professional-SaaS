import { Controller, Get, NotFoundException, Req, Res, UnauthorizedException } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import { defaultRegistry } from '@college-erp/observability';
import type { Request, Response } from 'express';
import { AppConfigService } from '../../config/app-config.service';
import { QueueMonitoringService } from '../queue/queue-monitoring.service';

/**
 * Prometheus text exposition endpoint. Scraped by the monitoring stack; never part of the public
 * API contract (excluded from Swagger, exempt from tenant resolution).
 *
 * Protection model: when METRICS_TOKEN is configured the endpoint requires
 * `Authorization: Bearer <token>` (or `X-Metrics-Token`) — production deployments should always
 * set it or restrict the route at the ingress. Without a token the endpoint is open (dev/CI
 * default), and can be disabled entirely with METRICS_ENABLED=false.
 */
@ApiExcludeController()
@Controller('metrics')
export class MetricsController {
  constructor(
    private readonly config: AppConfigService,
    private readonly queueMonitoring: QueueMonitoringService,
  ) {}

  @Get()
  async scrape(@Req() request: Request, @Res() response: Response): Promise<void> {
    if (!this.config.get('METRICS_ENABLED')) {
      throw new NotFoundException();
    }
    this.assertAuthorized(request);

    // Refresh queue gauges if the periodic sampler is stale, so a scrape always reflects reality.
    await this.queueMonitoring.ensureFreshMetrics(25_000).catch(() => undefined);

    response.setHeader('content-type', 'text/plain; version=0.0.4; charset=utf-8');
    response.send(defaultRegistry.render());
  }

  private assertAuthorized(request: Request): void {
    const token = this.config.get('METRICS_TOKEN');
    if (!token) return;
    const header = request.header('authorization') ?? '';
    const bearer = header.startsWith('Bearer ') ? header.slice('Bearer '.length) : undefined;
    const provided = bearer ?? request.header('x-metrics-token');
    if (provided !== token) {
      throw new UnauthorizedException('A valid metrics token is required.');
    }
  }
}
