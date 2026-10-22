import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { QUEUE_NAMES } from '@college-erp/types';
import { AuthModule } from '../auth/auth.module';
import { CommonGuardsModule } from '../../common/guards/common-guards.module';
import { RbacModule } from '../rbac/rbac.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { WorkflowModule } from '../workflow/workflow.module';
import { AppConfigService } from '../../config/app-config.service';
import { TenantLookupService } from '../../common/tenant/tenant-lookup.service';
import { TenantConfigurationModule } from '../tenant-configuration/tenant-configuration.module';
import { AdmissionsController } from './admissions.controller';
import { AdmissionsService } from './admissions.service';
import { ApplicantAccessGuard } from './portal/applicant-access.guard';
import { ApplicantAccessService } from './portal/applicant-access.service';
import { AdmissionApplicantTokenService } from './portal/applicant-token.service';
import { AdmissionPortalNotificationsService } from './portal/admission-portal-notifications.service';
import { PublicAdmissionsController } from './portal/public-admissions.controller';
import { PublicAdmissionsService } from './portal/public-admissions.service';

@Module({
  imports: [
    CommonGuardsModule,
    RbacModule,
    AuthModule,
    NotificationsModule,
    WorkflowModule,
    TenantConfigurationModule,
    // Applicant tokens reuse the platform RS256 key pair under a separate scope claim; they are
    // never accepted by the tenant-user JwtStrategy (and vice versa).
    JwtModule.registerAsync({
      inject: [AppConfigService],
      useFactory: (config: AppConfigService) => ({
        privateKey: config.get('JWT_PRIVATE_KEY'),
        publicKey: config.get('JWT_PUBLIC_KEY'),
        signOptions: { algorithm: 'RS256' },
      }),
    }),
    // Producers only — the Redis connection is the global QueueModule's.
    BullModule.registerQueue(
      { name: QUEUE_NAMES.NOTIFICATIONS },
      { name: QUEUE_NAMES.DOCUMENT_VIRUS_SCAN },
    ),
  ],
  controllers: [AdmissionsController, PublicAdmissionsController],
  providers: [
    AdmissionsService,
    // The public portal resolves its tenant from the URL slug (no request tenant context), so it
    // needs the same lookup the tenant-resolution middleware uses.
    TenantLookupService,
    AdmissionApplicantTokenService,
    ApplicantAccessGuard,
    ApplicantAccessService,
    AdmissionPortalNotificationsService,
    PublicAdmissionsService,
  ],
})
export class AdmissionsModule {}
