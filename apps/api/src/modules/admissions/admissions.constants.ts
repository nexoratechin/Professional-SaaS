/**
 * Admissions module constants: default dynamic application-form schema, default document
 * checklist, application/offer/receipt number prefixes, export columns, and the event-type
 * strings written to AdmissionActivity. Mirrors students.constants.ts.
 */

/** Default dynamic application-form fields. A TenantConfiguration `admissions` section can
 * supply additional fields; `answers` are stored on AdmissionApplication.data keyed by field.key.
 */
export const ADMISSION_FORM_FIELDS: Array<{
  key: string;
  label: string;
  type: 'TEXT' | 'NUMBER' | 'DATE' | 'SELECT' | 'MULTISELECT';
  required: boolean;
  options?: string[];
}> = [
  { key: 'caste', label: 'Caste / Community', type: 'SELECT', required: false, options: ['OC', 'BC', 'SC', 'ST', 'HUSC'] },
  { key: 'religion', label: 'Religion', type: 'TEXT', required: false },
  { key: 'motherTongue', label: 'Mother Tongue', type: 'TEXT', required: false },
  { key: 'aadhaarNumber', label: 'Aadhaar Number', type: 'TEXT', required: false },
  { key: 'previousSchool', label: 'Previous School / College', type: 'TEXT', required: false },
  { key: 'transportNeeded', label: 'Transport Required', type: 'SELECT', required: false, options: ['YES', 'NO'] },
  { key: 'hostelNeeded', label: 'Hostel Required', type: 'SELECT', required: false, options: ['YES', 'NO'] },
];

/** Default document checklist — session/program `requiredDocuments` override these. */
export const DEFAULT_DOCUMENT_CHECKLIST = [
  'PHOTO',
  'ID_PROOF',
  'MARKSHEET_HIGHEST',
  'TRANSFER_CERTIFICATE',
  'ADDRESS_PROOF',
] as const;

/** Prefixes used by the sequential-looking random-but-unique number generators. */
export const ADMISSION_NUMBER_PREFIX = 'ADM';
export const OFFER_NUMBER_PREFIX = 'OFF';
export const RECEIPT_NUMBER_PREFIX = 'RCP';

/** Event-type strings written to AdmissionActivity — free-form, documented here. */
export const ADMISSION_EVENTS = {
  ENQUIRY_CREATED: 'enquiry.created',
  ENQUIRY_UPDATED: 'enquiry.updated',
  ENQUIRY_CONVERTED: 'enquiry.converted',
  SESSION_CREATED: 'session.created',
  SESSION_UPDATED: 'session.updated',
  SESSION_CLOSED: 'session.closed',
  SESSION_MERIT_PUBLISHED: 'session.merit_published',
  PROGRAM_CREATED: 'program.created',
  PROGRAM_UPDATED: 'program.updated',
  APPLICATION_CREATED: 'application.created',
  APPLICATION_UPDATED: 'application.updated',
  APPLICATION_SUBMITTED: 'application.submitted',
  APPLICATION_CANCELLED: 'application.cancelled',
  DOCUMENT_UPLOADED: 'document.uploaded',
  DOCUMENT_UPDATED: 'document.updated',
  DOCUMENT_VERIFIED: 'document.verified',
  DOCUMENT_REJECTED: 'document.rejected',
  QUALIFICATION_CREATED: 'qualification.created',
  QUALIFICATION_UPDATED: 'qualification.updated',
  VERIFICATION_COMPLETED: 'verification.completed',
  MERIT_SCORED: 'merit.scored',
  COUNSELLING_SLOT_CREATED: 'counselling_slot.created',
  COUNSELLING_SLOT_UPDATED: 'counselling_slot.updated',
  COUNSELLING_BOOKED: 'counselling.booked',
  COUNSELLED: 'counselling.counselled',
  SELECTED: 'selection.selected',
  WAITLISTED: 'selection.waitlisted',
  OFFER_ISSUED: 'offer.issued',
  OFFER_ACCEPTED: 'offer.accepted',
  OFFER_DECLINED: 'offer.declined',
  FEE_PAID: 'fee.paid',
  ENROLLED: 'application.enrolled',
} as const;

export const ADMISSION_APPLICATION_EXPORT_COLUMNS = [
  'id',
  'applicationNumber',
  'fullName',
  'gender',
  'dateOfBirth',
  'email',
  'phone',
  'category',
  'campus',
  'program',
  'academicYear',
  'status',
  'meritScore',
  'meritRank',
  'submittedAt',
  'enrolledAt',
] as const;

export const ADMISSION_ENQUIRY_EXPORT_COLUMNS = [
  'id',
  'name',
  'email',
  'phone',
  'source',
  'program',
  'session',
  'convertedAt',
  'createdAt',
] as const;

export const ADMISSION_MERIT_EXPORT_COLUMNS = [
  'applicationNumber',
  'fullName',
  'program',
  'meritRank',
  'meritScore',
  'status',
] as const;

/** AdmissionApplication rows considered "live" for the pipeline funnel. */
export const PIPELINE_STATUS_ORDER = [
  'INITIATED',
  'SUBMITTED',
  'UNDER_VERIFICATION',
  'DOCUMENTS_VERIFIED',
  'MERIT_LISTED',
  'COUNSELLING_SCHEDULED',
  'COUNSELLED',
  'SELECTED',
  'OFFERED',
  'OFFER_ACCEPTED',
  'FEE_PAID',
  'ENROLLED',
  'WAITLISTED',
  'REJECTED',
  'CANCELLED',
] as const;