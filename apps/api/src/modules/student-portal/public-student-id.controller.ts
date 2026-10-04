import { Controller, Get, Param } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { StudentPortalService } from './student-portal.service';

/**
 * Public, unauthenticated student digital-ID verification. Like the certificate verify route,
 * this controller is excluded from TenantResolutionMiddleware (path `public/*` in AppModule), so
 * there is no tenant header/guard: the unguessable idCardToken is the only credential. The
 * service returns a minimal, non-sensitive projection — never contact details or documents.
 */
@ApiTags('public-student-id')
@Controller('public/student-id')
export class PublicStudentIdController {
  constructor(private readonly portal: StudentPortalService) {}

  @Get('verify/:token')
  @ApiOperation({ summary: 'Verify a student digital-ID QR token (public, no auth).' })
  verify(@Param('token') token: string) {
    return this.portal.verifyIdCard(token);
  }
}
