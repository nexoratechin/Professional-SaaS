import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { ApiEnv } from '@college-erp/config';

@Injectable()
export class AppConfigService {
  constructor(private readonly configService: ConfigService<ApiEnv, true>) {}

  get<K extends keyof ApiEnv>(key: K): ApiEnv[K] {
    return this.configService.get(key, { infer: true });
  }
}
