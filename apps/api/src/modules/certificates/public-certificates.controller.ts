import { Controller, Get, Param } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { CertificatesService } from './certificates.service';

/**
 * Public, unauthenticated certificate verification. Tenant resolution is middleware-based for the
 * tenant-protected routes; these routes are excluded from that middleware (and from tenant-required
 * guards) in `main.ts`/`AppModule.configure`. The QR token itself is the only credential — its
 * randomness is what makes a "scan to verify" link safe to print on the document.
 */
@ApiTags('public-certificates')
@Controller('public/certificates')
export class PublicCertificatesController {
  constructor(private readonly certificatesService: CertificatesService) {}

  @Get('verify/:qrToken')
  @ApiOperation({ summary: 'Verify a certificate by its printed QR token (public, no auth).' })
  verify(@Param('qrToken') qrToken: string) {
    return this.certificatesService.verifyByToken(qrToken);
  }
}