import { Module } from '@nestjs/common';
import { CommonGuardsModule } from '../../common/guards/common-guards.module';
import { PlatformOpsController } from './platform-ops.controller';
import { PlatformOpsService } from './platform-ops.service';

@Module({
  imports: [CommonGuardsModule],
  controllers: [PlatformOpsController],
  providers: [PlatformOpsService],
})
export class PlatformOpsModule {}
