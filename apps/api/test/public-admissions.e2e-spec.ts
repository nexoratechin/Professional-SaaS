import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createTenantScopedClient } from '@college-erp/database';
import { StorageService } from '../src/common/storage/storage.service';
import { createTestApp } from './utils/test-app.util';
import { loginAsPlatformAdmin, loginAsTenantUser, provisionTenant } from './utils/platform-admin.util';

// The OTP is otherwise only visible in the worker/console. This flag is refused in production
// (see ApplicantAccessService), so it can never leak a real applicant's code.
process.env.ADMISSION_PORTAL_DEBUG_OTP = 'true';

jest.setTimeout(180_000);

/**
 * End-to-end coverage for the public admissions portal: the unauthenticated applicant realm.
 *
 * Organization fixtures (academic year / campus / programme) are inserted directly with a
 * tenant-scoped client — the same documented fixture exception used by the workflow and RBAC
 * suites — because this test is about the portal, not the organization CRUD surface. Every
 * assertion below goes through the real HTTP API.
 */
describe('Public admissions portal (e2e)', () => {
  let app: INestApplication;
  let platformToken: string;
  let tenant: Awaited<ReturnType<typeof provisionTenant>>;
  let adminToken: string;
  let storage: StorageService;

  const suffix = `${Date.now()}-${Math.floor(Math.random() * 100000)}`;
  const publicSlug = `ug-${suffix}`;
  const applicantEmail = `applicant+${suffix}@example.com`;

  let sessionId: string;
  let programOfferId: string;
  let accessToken: string;
  let applicationId: string;
  let reference: string;

  const tenantHeaders = () => ({ 'X-Tenant-Slug': tenant.slug, Authorization: `Bearer ${adminToken}` });

  beforeAll(async () => {
    app = await createTestApp();
    storage = app.get(StorageService);
    platformToken = await loginAsPlatformAdmin(app);
    tenant = await provisionTenant(app, platformToken);
    adminToken = await loginAsTenantUser(app, tenant.slug, tenant.adminEmail, tenant.adminPassword);

    const client = createTenantScopedClient(tenant.tenant.id);
    const year = await client.academicYear.create({
      data: {
        tenantId: tenant.tenant.id,
        code: `AY-${suffix}`,
        name: 'Test Academic Year',
        startDate: new Date('2026-01-01T00:00:00.000Z'),
        endDate: new Date('2027-12-31T00:00:00.000Z'),
        isCurrent: true,
      },
    });
    await client.campus.create({
      data: { tenantId: tenant.tenant.id, code: `CMP-${suffix}`, name: 'Main Campus' },
    });
    const program = await client.program.create({
      data: {
        tenantId: tenant.tenant.id,
        code: `PRG-${suffix}`,
        name: 'B.Tech Computer Science',
        degreeLevel: 'UG',
        durationYears: 4,
      },
    });

    const session = await request(app.getHttpServer())
      .post('/admissions/sessions')
      .set(tenantHeaders())
      .send({
        code: `ADM-${suffix}`,
        name: 'Test Intake 2027',
        academicYearId: year.id,
        startAt: '2026-01-01T00:00:00.000Z',
        endAt: '2027-12-31T00:00:00.000Z',
        applicationFeeCents: 50_000,
        admissionFeeCents: 100_000,
        requiredDocuments: ['PHOTO', 'ID_PROOF'],
      })
      .expect(201);
    sessionId = session.body.id;

    const offer = await request(app.getHttpServer())
      .post('/admissions/programs')
      .set(tenantHeaders())
      .send({
        sessionId,
        programId: program.id,
        seats: 2,
        applicationFeeCents: 50_000,
        admissionFeeCents: 100_000,
        requiredDocuments: ['PHOTO', 'ID_PROOF'],
      })
      .expect(201);
    programOfferId = offer.body.id;

    await request(app.getHttpServer())
      .patch(`/admissions/sessions/${sessionId}/portal`)
      .set(tenantHeaders())
      .send({
        portalEnabled: true,
        publicSlug,
        portalInstructions: { consentVersion: 'v1', supportEmail: 'help@example.com' },
      })
      .expect(200);
  });

  afterAll(async () => {
    await app.close();
  });

  it('lists the published session and its programmes publicly', async () => {
    const res = await request(app.getHttpServer())
      .get(`/public/admissions/${tenant.slug}/sessions`)
      .expect(200);

    expect(res.body.college.slug).toBe(tenant.slug);
    const listed = (res.body.sessions as Array<{ publicSlug: string; programs: Array<{ offerId: string }> }>).find(
      (entry) => entry.publicSlug === publicSlug,
    );
    expect(listed).toBeDefined();
    expect(listed?.programs[0]?.offerId).toBe(programOfferId);
  });

  it('returns a uniform 404 for an unknown college slug', async () => {
    await request(app.getHttpServer()).get('/public/admissions/no-such-college/sessions').expect(404);
  });

  it('rejects an incorrect OTP and accepts the issued one', async () => {
    const otp = await request(app.getHttpServer())
      .post(`/public/admissions/${tenant.slug}/applicant/otp`)
      .send({ channel: 'EMAIL', contact: applicantEmail })
      .expect(201);

    expect(otp.body.sentTo).not.toContain(applicantEmail);
    const code = otp.body.debugCode as string;
    expect(code).toMatch(/^\d{6}$/);

    await request(app.getHttpServer())
      .post(`/public/admissions/${tenant.slug}/applicant/verify`)
      .send({ channel: 'EMAIL', contact: applicantEmail, code: '000000' })
      .expect(400);

    const verified = await request(app.getHttpServer())
      .post(`/public/admissions/${tenant.slug}/applicant/verify`)
      .send({ channel: 'EMAIL', contact: applicantEmail, code })
      .expect(201);

    accessToken = verified.body.accessToken;
    expect(accessToken).toEqual(expect.any(String));
    expect(verified.body.resumeToken).toEqual(expect.any(String));
  });

  it('creates a draft and rejects submission before documents and consent', async () => {
    const created = await request(app.getHttpServer())
      .post(`/public/admissions/${tenant.slug}/applications`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        publicSlug,
        programOfferId,
        firstName: 'Asha',
        lastName: 'Verma',
        email: applicantEmail,
      })
      .expect(201);

    applicationId = created.body.id;
    reference = created.body.reference;
    expect(created.body.status).toBe('INITIATED');
    expect(created.body.missingDocuments).toEqual(expect.arrayContaining(['PHOTO', 'ID_PROOF']));

    const blocked = await request(app.getHttpServer())
      .post(`/public/admissions/${tenant.slug}/applications/${applicationId}/submit`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ consentVersion: 'v1', declarationAccepted: true })
      .expect(400);
    expect(blocked.body.message).toMatch(/documents/i);
  });

  it('uploads documents through signed URLs and scans them', async () => {
    for (const category of ['PHOTO', 'ID_PROOF']) {
      const reserved = await request(app.getHttpServer())
        .post(`/public/admissions/${tenant.slug}/applications/${applicationId}/documents/upload-url`)
        .set('Authorization', `Bearer ${accessToken}`)
        .send({
          category,
          filename: `${category.toLowerCase()}.pdf`,
          contentType: 'application/pdf',
          sizeBytes: 5,
        })
        .expect(201);

      // The local driver signs a URL served by the API origin, which is not listening under
      // supertest — write the bytes through the same storage service the URL would have used.
      await storage.uploadBuffer(reserved.body.key, Buffer.from('%PDF-'), 'application/pdf');

      const confirmed = await request(app.getHttpServer())
        .post(
          `/public/admissions/${tenant.slug}/applications/${applicationId}/documents/${reserved.body.documentId}/confirm`,
        )
        .set('Authorization', `Bearer ${accessToken}`)
        .send({})
        .expect(201);

      expect(confirmed.body.category).toBe(category);
      expect(confirmed.body.scanStatus).toBe('SCANNING');
    }
  });

  it('submits, appears in the staff pipeline as an online application, and stays editable', async () => {
    const submitted = await request(app.getHttpServer())
      .post(`/public/admissions/${tenant.slug}/applications/${applicationId}/submit`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ consentVersion: 'v1', declarationAccepted: true })
      .expect(201);

    expect(submitted.body.status).toBe('SUBMITTED');
    expect(submitted.body.consent.version).toBe('v1');

    const staff = await request(app.getHttpServer())
      .get('/admissions/applications')
      .query({ submittedVia: 'PORTAL' })
      .set(tenantHeaders())
      .expect(200);

    const rows = staff.body.data as Array<{ id: string; submittedVia: string }>;
    const row = rows.find((entry) => entry.id === applicationId);
    expect(row).toBeDefined();
    expect(row?.submittedVia).toBe('PORTAL');

    await request(app.getHttpServer())
      .patch(`/public/admissions/${tenant.slug}/applications/${applicationId}`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ city: 'Pune' })
      .expect(200);

    // Staff start verification → the applicant's edit window closes.
    const client = createTenantScopedClient(tenant.tenant.id);
    await client.admissionApplication.update({ where: { id: applicationId }, data: { status: 'UNDER_VERIFICATION' } });

    await request(app.getHttpServer())
      .patch(`/public/admissions/${tenant.slug}/applications/${applicationId}`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ city: 'Mumbai' })
      .expect(409);
  });

  it('tracks the application by reference for its owner', async () => {
    const res = await request(app.getHttpServer())
      .get(`/public/admissions/${tenant.slug}/track/${reference}`)
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200);

    expect(res.body.reference).toBe(reference);
    expect(res.body.documents).toHaveLength(2);
  });

  it('does not let one college’s applicant token read another college’s data', async () => {
    const other = await provisionTenant(app, platformToken);
    await request(app.getHttpServer())
      .get(`/public/admissions/${other.slug}/track/${reference}`)
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(400);
  });
});
