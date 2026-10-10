import { Global, Module } from '@nestjs/common';
import { CacheService } from './cache.service';
import { RedisModule } from '../redis/redis.module';

/**
 * Exposes {@link CacheService} application-wide (dashboards, catalogs, summaries).
 * Depends on the globally-provided REDIS_CLIENT from RedisModule; imported here
 * for explicit dependency ordering.
 */
@Global()
@Module({
  imports: [RedisModule],
  providers: [CacheService],
  exports: [CacheService],
})
export class CacheModule {}
