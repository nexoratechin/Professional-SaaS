import { Global, Module } from '@nestjs/common';
import Redis from 'ioredis';
import { recordRedisEvent, recordRedisState } from '@college-erp/observability';
import { AppConfigService } from '../../config/app-config.service';
import { REDIS_CLIENT } from './redis.constants';

/**
 * Shared ioredis connection. Connection lifecycle events are instrumented into the metrics
 * registry (redis_up gauge + event counters) so an outage is visible on /metrics and can trigger
 * the dependency_redis_down alert even during the window where PING still answers.
 */
@Global()
@Module({
  providers: [
    {
      provide: REDIS_CLIENT,
      inject: [AppConfigService],
      useFactory: (config: AppConfigService) => {
        const client = new Redis(config.get('REDIS_URL'));
        client.on('ready', () => {
          recordRedisState(true);
          recordRedisEvent('ready');
        });
        client.on('error', () => {
          recordRedisState(false);
          recordRedisEvent('error');
        });
        client.on('reconnecting', () => recordRedisEvent('reconnecting'));
        client.on('end', () => {
          recordRedisState(false);
          recordRedisEvent('end');
        });
        recordRedisState(client.status === 'ready');
        return client;
      },
    },
  ],
  exports: [REDIS_CLIENT],
})
export class RedisModule {}
