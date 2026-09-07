import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { QUEUE_NAMES } from '@college-erp/types';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.createApplicationContext(AppModule);

  const shutdown = async () => {
    await app.close();
    process.exit(0);
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);

  console.log(`College ERP worker started — processing queues: ${Object.values(QUEUE_NAMES).join(', ')}`);
}

bootstrap();
