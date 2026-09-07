import { Global, Module } from '@nestjs/common';
import { PlatformPrismaService } from './platform-prisma.service';
import { TenantContextService } from './tenant-context.service';
import { TenantScopedPrismaService } from './tenant-scoped-prisma.service';

@Global()
@Module({
  providers: [PlatformPrismaService, TenantContextService, TenantScopedPrismaService],
  exports: [PlatformPrismaService, TenantContextService, TenantScopedPrismaService],
})
export class PrismaModule {}
