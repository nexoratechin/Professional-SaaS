import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { CommonGuardsModule } from '../../common/guards/common-guards.module';
import { RbacModule } from '../rbac/rbac.module';
import { StudentsController } from './students.controller';
import { StudentRecordsController } from './student-records.controller';
import { StudentsService } from './students.service';
import { StudentRecordsService } from './student-records.service';

@Module({
  imports: [CommonGuardsModule, RbacModule, AuthModule],
  controllers: [StudentsController, StudentRecordsController],
  providers: [StudentsService, StudentRecordsService],
})
export class StudentsModule {}