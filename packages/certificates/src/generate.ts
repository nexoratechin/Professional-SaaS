/**
 * Framework-agnostic certificate generation pipeline.
 *
 * This is the single implementation of "requested certificate -> numbered, snapshotted, rendered
 * PDF" so the synchronous API path and the async worker path cannot drift. The caller supplies a
 * tenant-scoped Prisma client plus the environment-specific effects (storage, audit, branding
 * config), which is what lets apps/api run it inline in development and apps/worker run it on the
 * certificate-generation queue in production.
 */
import { randomBytes } from 'crypto';
import {
  Prisma,
  CertificateStatus,
  type CertificateType,
  type TenantScopedPrismaClient,
} from '@college-erp/database';
import {
  type CertificateBranding,
} from './pdf';
import {
  resolveCertificateSections,
  certificateTitle,
  type FieldContext,
  type ResultProcessRow,
} from './fields';
import {
  formatCertificateNumber,
  highestSequence,
  resolveCertificatePrefix,
  resolvePadding,
  typeTail,
  type CertificateNumbering,
} from './numbering';
import { buildCertificatePdf } from './pdf';

export interface CertificateGenerationErrorOptions {
  /** When false, retrying the job cannot help (bad state / missing data). */
  retryable?: boolean;
}

/** Typed failure so the worker can distinguish a transient fault from a permanent one. */
export class CertificateGenerationError extends Error {
  readonly retryable: boolean;
  constructor(message: string, options: CertificateGenerationErrorOptions = {}) {
    super(message);
    this.name = 'CertificateGenerationError';
    this.retryable = options.retryable ?? false;
  }
}

export interface CertificateBrandingConfig {
  branding: unknown;
  numbering: unknown;
}

export interface CertificateGenerationDeps {
  /** Tenant-authored branding/numbering snapshot (TenantConfiguration.data sections). */
  loadBrandingConfig(tenantId: string): Promise<CertificateBrandingConfig>;
  /** Must produce a key under the tenant's storage prefix. */
  storageKeyFor(tenantId: string, fileName: string): string;
  uploadPdf(tenantId: string, key: string, buffer: Buffer, contentType: string): Promise<void>;
  /** Fire-and-forget audit entry; failures must not fail generation. */
  recordAudit(entry: {
    tenantId: string;
    actorUserId: string;
    action: string;
    entityType: string;
    entityId: string;
    after?: unknown;
  }): Promise<void>;
  publicBaseUrl: string;
  now?: () => Date;
}

export interface GenerateCertificateInput {
  tenantId: string;
  certificateId: string;
  actorUserId: string;
  templateId?: string;
}

export interface GeneratedCertificateResult {
  certificateId: string;
  certificateNumber: string;
  storageKey: string;
  title: string;
  certificateType: string;
}

interface StudentForCertificate {
  id: string;
  fullName: string;
  admissionNumber: string | null;
  rollNumber: string | null;
  registrationNumber: string | null;
  firstName: string;
  middleName: string | null;
  lastName: string;
  gender: string | null;
  dateOfBirth: Date | null;
  admittedOn: Date | null;
  nationality: string | null;
  email: string | null;
  city: string | null;
  state: string | null;
  program: { id: string; code: string; name: string } | null;
  campus: { id: string; name: string } | null;
  batch: { id: string; name: string } | null;
}

const GENERATABLE_TYPES = new Set(['TRANSCRIPT', 'GRADE_CARD', 'MARKSHEET']);
const MAX_NUMBER_ATTEMPTS = 25;

/**
 * Generate the PDF + numbering for an already-REQUESTED certificate and advance it to GENERATED.
 * Idempotent for an already-GENERATED certificate (returns its existing PDF info) so a duplicate
 * BullMQ delivery is harmless.
 */
export async function generateCertificate(
  db: TenantScopedPrismaClient,
  deps: CertificateGenerationDeps,
  input: GenerateCertificateInput,
): Promise<GeneratedCertificateResult> {
  const { tenantId, certificateId, actorUserId } = input;

  const certificate = await db.studentCertificate.findFirst({ where: { id: certificateId, tenantId } });
  if (!certificate) {
    throw new CertificateGenerationError(`Certificate ${certificateId} not found for tenant ${tenantId}.`);
  }

  // Idempotent replay: a certificate that already completed generation short-circuits.
  if (certificate.status === CertificateStatus.GENERATED || certificate.status === CertificateStatus.APPROVED
    || certificate.status === CertificateStatus.ISSUED) {
    return {
      certificateId: certificate.id,
      certificateNumber: certificate.certificateNumber ?? '',
      storageKey: certificate.storageKey ?? '',
      title: certificate.title ?? certificateTitle(certificate.certificateType),
      certificateType: certificate.certificateType,
    };
  }
  if (certificate.status !== CertificateStatus.REQUESTED) {
    throw new CertificateGenerationError(
      `Only a REQUESTED certificate can be generated (current status: ${certificate.status}).`,
    );
  }

  const student = await assertStudent(db, tenantId, certificate.studentId);
  const template = await resolveTemplate(db, tenantId, certificate.certificateType, input.templateId ?? certificate.templateId ?? undefined);
  const { branding: tenantBranding, numbering: tenantNumbering } = await deps.loadBrandingConfig(tenantId);
  const branding = mergeBranding(tenantBranding, template?.brandingJson);
  const type = certificate.certificateType;

  let result: ResultProcessRow | null = null;
  if (GENERATABLE_TYPES.has(type)) {
    result = await latestResultProcess(db, tenantId, certificate.studentId);
  }

  const context: FieldContext = {
    student: {
      fullName: student.fullName,
      admissionNumber: student.admissionNumber,
      rollNumber: student.rollNumber,
      registrationNumber: student.registrationNumber,
      firstName: student.firstName,
      middleName: student.middleName,
      lastName: student.lastName,
      gender: student.gender,
      dateOfBirth: student.dateOfBirth,
      admittedOn: student.admittedOn,
      nationality: student.nationality,
      email: student.email,
      city: student.city,
      state: student.state,
    },
    program: student.program,
    campus: student.campus,
    batch: student.batch,
    certificate: {
      number: null,
      title: certificate.title,
      requestDate: certificate.requestDate.toISOString().slice(0, 10),
      type,
      status: certificate.status,
    },
    result,
    branding,
  };

  const sections = resolveCertificateSections(
    (template?.fieldConfigJson as Record<string, string> | null) ?? {},
    type,
    context,
  );

  const qrEnabled = template?.qrEnabled ?? true;
  const qrToken = randomBytes(24).toString('base64url');
  const publicBaseUrl = deps.publicBaseUrl.replace(/\/+$/, '');
  const verifyUrl = `${publicBaseUrl}/verify/certificate?token=${qrToken}`;

  const numbering = template?.numberingJson as CertificateNumbering | null;
  const prefix = resolveCertificatePrefix(numbering, tenantNumbering as { certificatePrefix?: string } | null);
  const tail = typeTail(type);
  const padding = resolvePadding(numbering);
  const start = typeof numbering?.start === 'number' ? numbering.start : 1;

  const now = deps.now ?? (() => new Date());

  const contentJson = {
    template: template ? { id: template.id, code: template.code, name: template.name } : null,
    certificate: {
      id: certificateId,
      number: null,
      title: certificate.title,
      requestDate: certificate.requestDate.toISOString(),
      type,
      status: 'GENERATED',
    },
    issuedTo: student.fullName,
    branding,
    fields: sections.fields,
    table: sections.table ?? null,
    summary: sections.summary ?? null,
    verifyUrl: qrEnabled ? verifyUrl : null,
    qrToken,
  } as unknown as Prisma.InputJsonValue;

  const { certificateNumber } = await allocateNumber(db, {
    tenantId,
    certificateId,
    prefix,
    tail,
    start,
    padding,
    templateId: template?.id ?? null,
    qrToken,
    contentJson,
    generatedAt: now(),
    generatedByUserId: actorUserId,
  });

  const title = certificate.title ?? certificateTitle(type);
  const fileName = `${certificateNumber}.pdf`;
  const storageKey = deps.storageKeyFor(tenantId, fileName);

  // Persist the PDF after the status row is committed so a crash cannot leave a PDF for a
  // certificate that never moved off REQUESTED.
  const pdf = buildCertificatePdf({
    title,
    certificateNumber,
    issuedTo: student.fullName,
    branding,
    fields: sections.fields,
    table: sections.table,
    summary: sections.summary,
    issuedDate: null,
    verifyUrl: qrEnabled ? verifyUrl : null,
    qrEnabled,
  });
  await deps.uploadPdf(tenantId, storageKey, pdf, 'application/pdf');
  await db.studentCertificate.update({ where: { id: certificateId }, data: { storageKey } });

  await db.certificateHistoryRow.create({
    data: {
      tenantId,
      certificateId,
      fromStatus: CertificateStatus.REQUESTED,
      toStatus: CertificateStatus.GENERATED,
      actorUserId,
      detailJson: { certificateNumber } as Prisma.InputJsonValue,
    },
  });
  await deps.recordAudit({
    tenantId,
    actorUserId,
    action: 'CERTIFICATE_GENERATED',
    entityType: 'StudentCertificate',
    entityId: certificateId,
    after: { certificateNumber, type, template: template?.code ?? null },
  });

  return { certificateId, certificateNumber, storageKey, title, certificateType: type };
}

async function assertStudent(
  db: TenantScopedPrismaClient,
  tenantId: string,
  studentId: string,
): Promise<StudentForCertificate> {
  const student = await db.student.findFirst({
    where: { id: studentId, tenantId, deletedAt: null },
    include: {
      program: { select: { id: true, code: true, name: true } },
      campus: { select: { id: true, name: true } },
      batch: { select: { id: true, name: true } },
    },
  });
  if (!student) {
    throw new CertificateGenerationError('Student not found for this certificate.');
  }
  return student as unknown as StudentForCertificate;
}

async function resolveTemplate(
  db: TenantScopedPrismaClient,
  tenantId: string,
  type: string,
  templateId?: string,
) {
  if (templateId) {
    const template = await db.certificateTemplate.findFirst({
      where: { id: templateId, tenantId, isActive: true },
    });
    if (!template) {
      throw new CertificateGenerationError('The chosen certificate template does not exist or is inactive.');
    }
    return template;
  }
  const fallback = await db.certificateTemplate.findFirst({
    where: { tenantId, certificateType: type as CertificateType, isActive: true },
    orderBy: [{ isDefault: 'desc' }, { updatedAt: 'asc' }],
  });
  return fallback ?? null;
}

async function latestResultProcess(
  db: TenantScopedPrismaClient,
  tenantId: string,
  studentId: string,
): Promise<ResultProcessRow | null> {
  const process = await db.resultProcess.findFirst({
    where: { tenantId, studentId, state: { in: ['PUBLISHED', 'LOCKED'] } },
    orderBy: { calculatedAt: 'desc' },
    include: {
      session: { select: { id: true, code: true, name: true } },
      calculations: {
        include: { subject: { include: { course: { select: { id: true, code: true, name: true, creditHours: true } } } } },
        orderBy: { createdAt: 'asc' },
      },
    },
  });
  if (!process) return null;
  return {
    sessionName: process.session?.name,
    sessionCode: process.session?.code,
    subjectCount: process.subjectCount,
    passedCount: process.passedCount,
    failedCount: process.failedCount,
    aggregatePercent: process.aggregatePercent,
    gpa: process.gpa,
    cgpa: process.cgpa,
    creditsAttempted: process.creditsAttempted,
    creditsEarned: process.creditsEarned,
    standing: process.standing,
    calculations: (process.calculations ?? []).map((c) => ({
      subjectCode: c.subject?.course?.code,
      subjectName: c.subject?.course?.name,
      creditHours: c.subject?.course?.creditHours,
      maxMarks: c.subject?.maxMarks ?? c.maxMarks,
      effectiveMarks: c.effectiveMarks,
      percentage: c.percentage,
      grade: c.grade,
      gradePoint: c.gradePoint,
      outcome: c.outcome,
    })),
  };
}

function mergeBranding(tenantBranding: unknown, templateBranding: unknown): CertificateBranding {
  const tenant = (tenantBranding ?? {}) as Record<string, unknown>;
  const template = (templateBranding ?? {}) as Record<string, unknown>;
  return {
    collegeName: (template.collegeName as string) ?? (tenant.collegeName as string) ?? null,
    tagline: (template.tagline as string) ?? (tenant.tagline as string) ?? null,
    watermark: (template.watermark as string) ?? (tenant.watermark as string) ?? null,
    signedBy: (template.signedBy as string) ?? (tenant.signedBy as string) ?? null,
    headerText: (template.headerText as string) ?? null,
    footerText: (template.footerText as string) ?? null,
    primaryColor: (template.primaryColor as string) ?? (tenant.primaryColor as string) ?? null,
    accentColor: (template.accentColor as string) ?? (tenant.accentColor as string) ?? null,
  };
}

/** Allocate a unique `prefix-tail-seq` number, retrying on a concurrent-issuance unique clash. */
async function allocateNumber(
  db: TenantScopedPrismaClient,
  params: {
    tenantId: string;
    certificateId: string;
    prefix: string;
    tail: string;
    start: number;
    padding: number;
    templateId: string | null;
    qrToken: string;
    contentJson: Prisma.InputJsonValue;
    generatedAt: Date;
    generatedByUserId: string;
  },
): Promise<{ certificateNumber: string; attempted: number }> {
  for (let attempt = 0; attempt < MAX_NUMBER_ATTEMPTS; attempt += 1) {
    const existing = await db.studentCertificate.findMany({
      where: { tenantId: params.tenantId, certificateNumber: { not: null } },
      select: { certificateNumber: true },
    });
    const sequence =
      highestSequence(existing.map((e) => e.certificateNumber as string), params.prefix, params.tail, params.start) + 1;
    const certificateNumber = formatCertificateNumber(params.prefix, params.tail, sequence, params.padding);

    try {
      await db.studentCertificate.update({
        where: { id: params.certificateId },
        data: {
          status: CertificateStatus.GENERATED,
          certificateNumber,
          templateId: params.templateId,
          qrToken: params.qrToken,
          contentJson: params.contentJson,
          generatedAt: params.generatedAt,
          generatedByUserId: params.generatedByUserId,
        },
      });
      return { certificateNumber, attempted: attempt + 1 };
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        continue;
      }
      throw error;
    }
  }
  throw new CertificateGenerationError('Could not allocate a unique certificate number; try again.', { retryable: true });
}
