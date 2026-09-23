import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { CommonGuardsModule } from '../../common/guards/common-guards.module';
import { RbacModule } from '../rbac/rbac.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { LibraryController } from './library.controller';
import { LibraryService } from './library.service';

@Module({
  imports: [CommonGuardsModule, RbacModule, AuthModule, NotificationsModule],
  controllers: [LibraryController],
  providers: [LibraryService],
})
export class LibraryModule {}