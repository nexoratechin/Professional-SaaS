import { Module } from '@nestjs/common';
import { CommonGuardsModule } from '../../common/guards/common-guards.module';
import { AuthModule } from '../auth/auth.module';
import { StudentsModule } from '../students/students.module';
import { TenantConfigurationModule } from '../tenant-configuration/tenant-configuration.module';
import { FeeAssignmentsService } from './fee-assignments.service';
import { FeeAssignmentsController } from './fee-assignments.controller';
import { FeeConcessionsService } from './fee-concessions.service';
import { FeeConcessionsController } from './fee-concessions.controller';
import { FeeDemandsService } from './fee-demands.service';
import { FeeDemandsController } from './fee-demands.controller';
import { FeeHeadsService } from './fee-heads.service';
import { FeeHeadsController } from './fee-heads.controller';
import { FeePaymentsService } from './fee-payments.service';
import { FeePaymentsController } from './fee-payments.controller';
import { FeeRefundsService } from './fee-refunds.service';
import { FeeRefundsController } from './fee-refunds.controller';
import { FeeReportsService } from './fee-reports.service';
import { FeeReportsController } from './fee-reports.controller';
import { FeeStructuresService } from './fee-structures.service';
import { FeeStructuresController } from './fee-structures.controller';

@Module({
  imports: [CommonGuardsModule, AuthModule, StudentsModule, TenantConfigurationModule],
  controllers: [
    FeeHeadsController,
    FeeStructuresController,
    FeeAssignmentsController,
    FeeDemandsController,
    FeePaymentsController,
    FeeConcessionsController,
    FeeRefundsController,
    FeeReportsController,
  ],
  providers: [
    FeeHeadsService,
    FeeStructuresService,
    FeeAssignmentsService,
    FeeDemandsService,
    FeePaymentsService,
    FeeConcessionsService,
    FeeRefundsService,
    FeeReportsService,
  ],
  exports: [FeeReportsService],
})
export class FeesModule {}