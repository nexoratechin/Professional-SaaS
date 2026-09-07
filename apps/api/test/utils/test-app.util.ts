import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import cookieParser from 'cookie-parser';
import { AppModule } from '../../src/app.module';

/** Boots the full Nest app the same way main.ts does (minus listen()), against whatever
 * DATABASE_URL/REDIS_URL/JWT_* the test process has — a real Postgres + Redis (docker-compose
 * or CI services) is required, matching the blueprint's tenant-isolation/workflow test levels. */
export async function createTestApp(): Promise<INestApplication> {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  const app = moduleRef.createNestApplication();
  app.use(cookieParser());
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
  await app.init();
  return app;
}
