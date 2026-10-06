import 'reflect-metadata';
import { ValidationPipe, VersioningType } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import cookieParser from 'cookie-parser';
import express from 'express';
import type { Request } from 'express';
import helmet from 'helmet';
import { AppModule } from './app.module';
import { applyGlobalHeaderParameters } from './common/docs/global-parameters';
import { AppConfigService } from './config/app-config.service';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  const config = app.get(AppConfigService);

  // Subdomain-based tenant resolution and rate limiting both need the real client IP/Host,
  // which only req.socket exposes correctly unless Express trusts the reverse proxy's headers.
  app.set('trust proxy', 1);

  // ── API versioning ────────────────────────────────────────────────────────────────────────
  // Header versioning (X-API-Version) with defaultVersion '1' — every current route is v1 and
  // clients that omit the header (the existing web app, e2e suite) are served v1 exactly as
  // before. New v2+ clients send X-API-Version: 2 once a controller declares @Version('2').
  // (Nest 10 supports one global strategy; URI-style /v1/... prefixes are deliberately reserved
  // as a migration path, not enabled, so no existing route, test or frontend URL changes.)
  app.enableVersioning({
    type: VersioningType.HEADER,
    header: 'X-API-Version',
    defaultVersion: '1',
  });

  app.use(helmet());
  app.use(cookieParser());

  // Inbound integration webhooks must be signature-verified against the bytes the provider actually
  // sent. Nest's JSON body parser is the only reader of the body, so Express's `verify` hook captures
  // the raw buffer onto the request before parsing — IntegrationWebhooksController reads it from
  // there. Without this, the handler would only have the parsed object, and re-serializing it changes
  // key order and whitespace, which invalidates every HMAC digest.
  app.use(
    express.json({
      limit: '1mb',
      verify: (req, _res, buf) => {
        (req as Request & { rawBody?: Buffer }).rawBody = Buffer.from(buf);
      },
    }),
  );
  app.use(express.urlencoded({ extended: true, limit: '1mb' }));
  app.enableCors({ origin: config.get('CORS_ORIGIN'), credentials: true });

  // Global validation contract: strip unknown fields, reject them outright (typos become 400s,
  // not silent no-ops), and auto-transform DTOs (@Type(() => Number) on query params).
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));

  // ── OpenAPI / Swagger ─────────────────────────────────────────────────────────────────────
  const swaggerConfig = new DocumentBuilder()
    .setTitle('College ERP SaaS API')
    .setDescription(
      [
        'Multi-tenant college ERP REST platform built on NestJS, Prisma, PostgreSQL, Redis/BullMQ and MinIO.',
        '',
        '**Versioning** — the current version is **v1**. The version is negotiated via the `X-API-Version` header: ' +
          'omit it entirely (defaults to v1) or send `X-API-Version: 1` explicitly. Future v2+ handlers declare ' +
          '`@Version("2")` and are selected when the header asks for 2; un-versioned routes always answer v1, so ' +
          'existing clients are unaffected. (URI-style `/v1/...` prefixes are reserved, not enabled.)',
        '',
        '**Auth** — tenant users authenticate via `POST /auth/login` (JWT bearer + httpOnly refresh cookie; ' +
          'optionally MFA). Platform operators use `POST /platform/auth/login` instead. Most tenant routes also ' +
          'require a tenant context, resolved from the subdomain in production or the `X-Tenant-Slug` header in dev.',
        '',
        '**Idempotency** — send `Idempotency-Key` on mutating requests to guarantee at-most-once execution ' +
          '(see the header documentation). Concurrent duplicates get `409 Conflict`; retried successes replay ' +
          'the stored response with `Idempotency-Replayed: true`.',
        '',
        '**Errors** — every failure returns the same envelope: `{ statusCode, error, code, message, details?, requestId, path, method, timestamp }`. ' +
          'Validation failures use `code: "VALIDATION_FAILED"` with per-field `details`. Quote `requestId` when opening a support ticket.',
        '',
        '**Pagination** — list endpoints accept `skip`/`take`, modules add `sortBy`/`sortOrder`/`search`; ' +
          'full counts ride in the `X-Total-Count`, `X-Total-Pages`, `X-Page` and `X-Page-Size` headers ' +
          '(bodies stay plain arrays for backward compatibility).',
        '',
        '**Rate limiting** — every route is limited per-IP (`THROTTLE_LIMIT` requests / `THROTTLE_TTL` ms; ' +
          'default 100/min). Auth endpoints are stricter (5/min).',
      ].join('\n\n'),
    )
    .setVersion('1.0.0')
    .addBearerAuth({ type: 'http', scheme: 'bearer', bearerFormat: 'JWT', description: 'Tenant user access token (POST /auth/login)' }, 'access-token')
    .addTag('auth', 'Login, MFA, sessions, password lifecycle and tenant trust devices')
    .addTag('tenants', 'Tenant lifecycle, self-service settings, effective features & entitlements')
    .addTag('students', 'Student 360: profiles, admission numbers, bulk actions, CSV export')
    .addTag('admissions', 'Application lifecycle, documents, evaluations, offers')
    .addTag('academics', 'Courses, curricula, offerings, registrations, advising, calendar')
    .addTag('attendance', 'Sessions, marks, devices and device ingestion')
    .addTag('exams', 'Exam definitions, scheduling, marks entry and grading')
    .addTag('results', 'Result computation, publication and re-evaluation')
    .addTag('fees', 'Fee heads, structures, demands, concessions, payments and refunds')
    .addTag('billing', 'SaaS subscription billing: invoices and payment recording')
    .addTag('payments', 'Payment recording, refunds and billing summaries')
    .addTag('reports', 'Report catalog, preview, exports, saved reports, templates and schedules')
    .build();

  const document = SwaggerModule.createDocument(app, swaggerConfig, {
    operationIdFactory: (_controllerKey: string, methodKey: string) => methodKey,
  });
  applyGlobalHeaderParameters(document);
  SwaggerModule.setup('api/docs', app, document, {
    customSiteTitle: 'College ERP SaaS API',
    swaggerOptions: { persistAuthorization: true, displayRequestDuration: true },
  });

  const port = config.get('PORT');
  await app.listen(port);
  console.log(`College ERP API listening on port ${port} (docs at /api/docs)`);
}

bootstrap();