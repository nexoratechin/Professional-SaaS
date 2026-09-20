/**
 * Attendance device gateway — the PUBLIC hardware-facing push endpoint. Unlike every other
 * attendance route this controller has NO JWT/tenant guards: physical devices have no user
 * session. Instead, the request is self-authenticating:
 *
 *  * the tenant + device are resolved by the device `code` in the URL path (device codes are
 *    tenant-unique), and
 *  * the device proves identity via its provisioned push token — an `Authorization: Bearer
 *    <token>` header compared in constant-time — plus an OPTIONAL HMAC push signature
 *    (`X-Device-Signature` over `timestamp.JSON.stringify({code, events})`) as defense in depth.
 *
 * Concurrency is governed by the global ThrottlerGuard; tenant ingestion can be switched off via
 * TenantConfigAttendance.deviceIngestEnabled. The route is excluded from TenantResolutionMiddleware
 * (device traffic carries no tenant header/subdomain) — see app.module.ts.
 */
import { Body, Controller, Headers, Param, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { AttendanceDevicesService } from './devices/attendance-devices.service';

@ApiTags('attendance')
@Controller('attendance/devices/ingest')
export class AttendanceDeviceGatewayController {
  constructor(private readonly devicesService: AttendanceDevicesService) {}

  @Post(':code/events')
  pushEvents(
    @Param('code') code: string,
    @Body() payload: unknown,
    @Headers('authorization') authorization?: string,
    @Headers('x-device-signature') signature?: string,
    @Headers('x-device-timestamp') timestamp?: string,
  ) {
    const bearerToken = authorization?.startsWith('Bearer ')
      ? authorization.slice('Bearer '.length).trim()
      : authorization?.trim() || null;
    return this.devicesService.ingestPushByCode(code, payload, {
      bearerToken,
      signature: signature || null,
      timestamp: timestamp || null,
    });
  }
}