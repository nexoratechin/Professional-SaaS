import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { WorkerEnv } from '@college-erp/config';

@Injectable()
export class AppConfigService {
  constructor(private readonly configService: ConfigService<WorkerEnv, true>) {}

  get<K extends keyof WorkerEnv>(key: K): WorkerEnv[K] {
    return this.configService.get(key, { infer: true });
  }
}
