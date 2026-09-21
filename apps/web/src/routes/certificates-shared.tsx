/**
 * Certificates module shared types & constants — mirrors the payloads returned by the
 * certificates API (`apps/api/src/modules/certificates`). Template config travels as free-form
 * JSON (field map, branding, numbering), so the listed shapes stay intentionally loose.
 */

export const CERTIFICATE_TYPES = [
  'BONAFIDE',
  'PROVISIONAL',
  'MIGRATION',
  'TRANSCRIPT',
  'TRANSFER_CERTIFICATE',
  'GRADE_CARD',
  'MARKSHEET',
  'CHARACTER_CERTIFICATE',
  'TESTIMONIAL',
  'OTHER',
] as const;

export const CERTIFICATE_STATUSES = ['REQUESTED', 'GENERATED', 'APPROVED', 'ISSUED', 'REJECTED', 'REVOKED'] as const;

export const CERTIFICATES_VIEW_PERMISSION = 'certificates.view';
export const CERTIFICATES_CREATE_PERMISSION = 'certificates.create';
export const CERTIFICATES_APPROVE_PERMISSION = 'certificates.approve';
export const CERTIFICATES_EXPORT_PERMISSION = 'certificates.export';
export const CERTIFICATES_MANAGE_PERMISSION = 'certificates.manage';

export interface Paged<T> {
  items: T[];
  total: number;
}

export interface CertificateNumberingConfig {
  prefix?: string;
  start?: number;
  padding?: number;
}

export interface CertificateTemplateRow {
  id: string;
  code: string;
  name: string;
  certificateType: string;
  fieldConfigJson: Record<string, string> | null;
  brandingJson: Record<string, unknown> | null;
  numberingJson: CertificateNumberingConfig | null;
  qrEnabled: boolean;
  isDefault: boolean;
  isActive: boolean;
  createdBy?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CertificateHistoryRow {
  id: string;
  fromStatus: string;
  toStatus: string;
  actorUserId?: string | null;
  detailJson?: Record<string, unknown> | null;
  createdAt: string;
}

export interface CertificateRow {
  id: string;
  certificateType: string;
  certificateNumber: string | null;
  title: string | null;
  requestDate: string;
  status: string;
  qrToken: string | null;
  storageKey: string | null;
  generatedAt?: string | null;
  approvedAt?: string | null;
  issuedAt?: string | null;
  revokeReason?: string | null;
  rejectReason?: string | null;
  templateId?: string | null;
  template?: { id: string; code: string; name: string; certificateType: string } | null;
  student?: { id: string; fullName: string; admissionNumber: string | null; rollNumber: string | null };
  reissuedFrom?: { id: string; certificateNumber: string | null; status: string } | null;
  history?: CertificateHistoryRow[];
}

export interface CertificateDetail extends CertificateRow {
  template: { id: string; code: string; name: string; certificateType: string } | null;
  history: CertificateHistoryRow[];
}

export interface DownloadUrlResult {
  certificateId: string;
  certificateNumber: string | null;
  downloadUrl: string;
}