/** Shared admission-lifecycle contracts between apps/api and apps/web. Plain data only —
 * no class-validator/NestJS decorators, so this package stays usable from the frontend.
 * Shapes mirror the Prisma models in packages/database (admissions section). */

export type AdmissionSessionStatus = 'OPEN' | 'CLOSED';
export type AdmissionProgramStatus = 'OPEN' | 'CLOSED' | 'FULL';
export type AdmissionApplicationStatus =
  | 'INITIATED'
  | 'SUBMITTED'
  | 'UNDER_VERIFICATION'
  | 'DOCUMENTS_VERIFIED'
  | 'MERIT_LISTED'
  | 'COUNSELLING_SCHEDULED'
  | 'COUNSELLED'
  | 'SELECTED'
  | 'OFFERED'
  | 'OFFER_ACCEPTED'
  | 'FEE_PAID'
  | 'ENROLLED'
  | 'WAITLISTED'
  | 'REJECTED'
  | 'CANCELLED';
export type AdmissionOfferStatus = 'ISSUED' | 'ACCEPTED' | 'DECLINED' | 'EXPIRED';
export type StudentDocumentStatus = 'PENDING' | 'VERIFIED' | 'REJECTED';

export interface AdmissionSessionDto {
  id: string;
  tenantId: string;
  code: string;
  name: string;
  academicYearId: string;
  academicYear?: { id: string; code: string; name: string } | null;
  startAt: string;
  endAt: string;
  applicationFeeCents: number;
  admissionFeeCents: number;
  status: AdmissionSessionStatus;
  requiredDocuments: string[] | null;
  source: string | null;
  meritPublishedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface AdmissionProgramOfferDto {
  id: string;
  tenantId: string;
  sessionId: string;
  programId: string;
  program?: { id: string; code: string; name: string } | null;
  seats: number;
  filledSeats: number;
  applicationFeeCents: number;
  admissionFeeCents: number;
  tuitionFeeCents: number;
  requiredDocuments: string[] | null;
  status: AdmissionProgramStatus;
  createdAt: string;
  updatedAt: string;
}

export interface AdmissionEnquiryDto {
  id: string;
  tenantId: string;
  sessionId: string | null;
  session?: { id: string; code: string; name: string } | null;
  programId: string | null;
  program?: { id: string; code: string; name: string } | null;
  name: string;
  email: string | null;
  phone: string | null;
  source: string;
  message: string | null;
  followUpAt: string | null;
  convertedToApplicationId: string | null;
  convertedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface AdmissionApplicationDto {
  id: string;
  tenantId: string;
  applicationNumber: string;
  sessionId: string;
  session?: AdmissionSessionDto | null;
  admissionProgramId: string;
  admissionProgram?: AdmissionProgramOfferDto | null;
  campusId: string;
  campus?: { id: string; code: string; name: string } | null;
  academicYearId: string;
  academicYear?: { id: string; code: string; name: string } | null;
  enquiryId: string | null;
  firstName: string;
  middleName: string | null;
  lastName: string;
  fullName: string;
  gender: 'MALE' | 'FEMALE' | 'OTHER' | 'NOT_SPECIFIED';
  dateOfBirth: string | null;
  email: string | null;
  phone: string | null;
  category: string | null;
  nationality: string | null;
  addressLine1: string | null;
  addressLine2: string | null;
  city: string | null;
  state: string | null;
  postalCode: string | null;
  country: string | null;
  guardian: Record<string, unknown> | null;
  data: Record<string, unknown> | null;
  remarks: string | null;
  status: AdmissionApplicationStatus;
  submittedAt: string | null;
  rejectedReason: string | null;
  meritScore: number | null;
  meritRank: number | null;
  counsellingSlotId: string | null;
  counsellingSlot?: { id: string; date: string; venue: string | null } | null;
  counselledAt: string | null;
  selectedAt: string | null;
  feePaidAt: string | null;
  feeReceiptNumber: string | null;
  enrolledStudentId: string | null;
  enrolledAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface AdmissionApplicationDetailDto extends AdmissionApplicationDto {
  documents: AdmissionDocumentDto[];
  qualifications: AdmissionQualificationDto[];
  offers: AdmissionOfferDto[];
  payments: AdmissionFeePaymentDto[];
  activities: AdmissionActivityDto[];
  program?: AdmissionProgramOfferDto | null;
}

export interface AdmissionDocumentDto {
  id: string;
  applicationId: string;
  category: string;
  documentName: string;
  storageKey: string | null;
  originalFilename: string | null;
  mimeType: string | null;
  sizeBytes: number | null;
  status: StudentDocumentStatus;
  verifiedAt: string | null;
  verifiedBy: string | null;
  remarks: string | null;
  uploadedBy: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface AdmissionQualificationDto {
  id: string;
  applicationId: string;
  institution: string;
  board: string | null;
  degree: string | null;
  yearOfPassing: number | null;
  percentage: number | null;
  gpa: number | null;
  grade: string | null;
  marksObtained: number | null;
  marksOutOf: number | null;
  rank: string | null;
  isHighestQualification: boolean;
  verificationStatus: StudentDocumentStatus;
  remarks: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface AdmissionCounsellingSlotDto {
  id: string;
  sessionId: string;
  programId: string | null;
  date: string;
  venue: string | null;
  capacity: number;
  bookedCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface AdmissionOfferDto {
  id: string;
  applicationId: string;
  offerNumber: string;
  admissionFeeCents: number;
  issuedAt: string;
  expiresAt: string;
  status: AdmissionOfferStatus;
  acceptedAt: string | null;
  declinedAt: string | null;
  remarks: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface AdmissionFeePaymentDto {
  id: string;
  applicationId: string;
  amountCents: number;
  currency: string;
  paymentDate: string;
  method: 'CARD' | 'UPI' | 'BANK_TRANSFER' | 'CASH' | 'OFFLINE';
  status: 'PENDING' | 'SUCCEEDED' | 'FAILED' | 'REFUNDED';
  referenceNumber: string | null;
  receiptNumber: string;
  remarks: string | null;
  recordedByUserId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface AdmissionActivityDto {
  id: string;
  applicationId: string;
  eventType: string;
  title: string;
  description: string | null;
  entityType: string | null;
  entityId: string | null;
  occurredAt: string;
  actorUserId: string | null;
}

/** Merged list responses (skip/take pagination, matching the students module). */
export interface AdmissionApplicationListDto {
  data: AdmissionApplicationDto[];
  total: number;
}

export interface AdmissionEnquiryListDto {
  data: AdmissionEnquiryDto[];
  total: number;
}

/** The default dynamic application-form definition served by GET /admissions/form-definition.
 * `data` answers on applications map 1:1 onto these field keys. */
export interface AdmissionFormField {
  key: string;
  label: string;
  type: 'TEXT' | 'NUMBER' | 'DATE' | 'SELECT' | 'MULTISELECT';
  required: boolean;
  options?: string[];
}

export interface AdmissionFormDefinitionDto {
  sessionId: string;
  fields: AdmissionFormField[];
  documentChecklist: string[];
  applicationFeeCents: number;
  admissionFeeCents: number;
}

/** Pipeline report — applicant counts grouped by lifecycle stage for a session. */
export interface AdmissionPipelineReportDto {
  sessionId: string;
  programme: 'Total' | 'PerProgram';
  byStage: Record<string, number>;
  byStatus: Record<string, number>;
  total: number;
  enquiries: number;
  conversions: number;
  seats: number;
  filled: number;
  perProgram: Array<{
    programId: string;
    programName: string;
    seats: number;
    filledSeats: number;
    applications: number;
    enrolled: number;
  }>;
}

/** Dashboard summary for GET /admissions/dashboard. */
export interface AdmissionDashboardDto {
  activeSessions: number;
  totalEnquiries: number;
  applications: {
    total: number;
    submitted: number;
    verified: number;
    meritListed: number;
    selected: number;
    offered: number;
    feePaid: number;
    enrolled: number;
    rejected: number;
  };
  seats: { total: number; filled: number };
  recentApplications: AdmissionApplicationDto[];
}

export interface AdmissionSessionReportDto {
  id: string;
  code: string;
  name: string;
  status: AdmissionSessionStatus;
  applications: number;
  enrolled: number;
  seats: number;
  filledSeats: number;
  meritPublishedAt: string | null;
}

export interface AdmissionMeritEntryDto {
  applicationId: string;
  applicationNumber: string;
  fullName: string;
  programName: string;
  meritScore: number | null;
  meritRank: number | null;
  status: AdmissionApplicationStatus;
}

export interface AdmissionMeritReportDto {
  sessionId: string;
  publishedAt: string | null;
  entries: AdmissionMeritEntryDto[];
}