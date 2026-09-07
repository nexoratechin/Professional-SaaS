import { Global, Module } from '@nestjs/common';
import Redis from 'ioredis';
import { AppConfigService } from '../../config/app-config.service';
import { REDIS_CLIENT } from './redis.constants';

@Global()
@Module({
  providers: [
    {
      provide: REDIS_CLIENT,
      inject: [AppConfigService],
      useFactory: (config: AppConfigService) => new Redis(config.get('REDIS_URL')),
    },
  ],
  exports: [REDIS_CLIENT],
})
export class RedisModule {}
