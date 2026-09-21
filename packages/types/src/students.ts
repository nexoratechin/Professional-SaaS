/**
 * Student 360 shared contracts between apps/api and apps/web. Plain data only — no
 * class-validator/NestJS decorators here so this package stays usable from the frontend.
 * The Prisma model names/enums are the source of truth; these DTO strings mirror them.
 */

// --- Enum unions (mirror @college-erp/database schema.prisma) ---

export type StudentGenderDto = 'MALE' | 'FEMALE' | 'OTHER' | 'NOT_SPECIFIED';

export type BloodGroupDto =
  | 'A_POSITIVE'
  | 'A_NEGATIVE'
  | 'B_POSITIVE'
  | 'B_NEGATIVE'
  | 'AB_POSITIVE'
  | 'AB_NEGATIVE'
  | 'O_POSITIVE'
  | 'O_NEGATIVE'
  | 'UNKNOWN';

export type StudentStatusDto =
  | 'APPLICANT'
  | 'ADMITTED'
  | 'PROVISIONAL'
  | 'ENROLLED'
  | 'ACTIVE'
  | 'INACTIVE'
  | 'SUSPENDED'
  | 'WITHDRAWN'
  | 'GRADUATED'
  | 'ALUMNI';

export type GuardianKindDto = 'FATHER' | 'MOTHER' | 'GUARDIAN' | 'OTHER';

export type GuardianRoleDto = 'PRIMARY' | 'SECONDARY' | 'EMERGENCY';

export type StudentDocumentStatusDto = 'PENDING' | 'VERIFIED' | 'REJECTED';

export type AdmissionStatusDto =
  | 'APPLIED'
  | 'DOCUMENTS_VERIFIED'
  | 'OFFERED'
  | 'ACCEPTED'
  | 'ENROLLED'
  | 'CANCELLED'
  | 'REJECTED';

export type EnrollmentStatusDto = 'ACTIVE' | 'COMPLETED' | 'WITHDRAWN' | 'ON_HOLD' | 'SUSPENDED';

export type AttendanceStatusDto = 'PRESENT' | 'ABSENT' | 'LATE' | 'LEAVE';

export type FeeStatusDto = 'ISSUED' | 'PARTIALLY_PAID' | 'PAID' | 'OVERDUE' | 'WAIVED' | 'REFUNDED';

export type ExamTypeDto =
  | 'MID_TERM'
  | 'END_TERM'
  | 'UNIT_TEST'
  | 'PRACTICAL'
  | 'VIVA'
  | 'ANNUAL'
  | 'SUPPLEMENTARY'
  | 'OTHER';

export type ExamStatusDto = 'SCHEDULED' | 'IN_PROGRESS' | 'COMPLETED';

export type ResultOutcomeDto = 'PASS' | 'FAIL' | 'PASS_WITH_GRACE' | 'INCOMPLETE';

export type CertificateTypeDto =
  | 'BONAFIDE'
  | 'PROVISIONAL'
  | 'MIGRATION'
  | 'TRANSCRIPT'
  | 'TRANSFER_CERTIFICATE'
  | 'GRADE_CARD'
  | 'MARKSHEET'
  | 'CHARACTER_CERTIFICATE'
  | 'TESTIMONIAL'
  | 'OTHER';

export type CertificateStatusDto =
  | 'REQUESTED'
  | 'GENERATED'
  | 'APPROVED'
  | 'ISSUED'
  | 'REJECTED'
  | 'REVOKED';

export type LibraryLoanStatusDto = 'ISSUED' | 'RETURNED' | 'OVERDUE' | 'LOST';

export type HostelBookingStatusDto = 'REQUESTED' | 'ALLOCATED' | 'CHECKED_IN' | 'CHECKED_OUT' | 'CANCELLED';

export type TransportPassStatusDto = 'ACTIVE' | 'EXPIRED' | 'SUSPENDED' | 'CANCELLED';

export type StudentHoldTypeDto = 'ACADEMIC' | 'FINANCIAL' | 'ADMINISTRATIVE' | 'DISCIPLINARY' | 'MEDICAL' | 'OTHER';

export type StudentHoldStatusDto = 'ACTIVE' | 'RESOLVED';

export type CommunicationTypeDto =
  | 'CALL'
  | 'EMAIL'
  | 'SMS'
  | 'WHATSAPP'
  | 'MEETING'
  | 'LETTER'
  | 'OTHER';

export type CommunicationDirectionDto = 'INBOUND' | 'OUTBOUND';

// --- References (compact) ---

export interface CampusRefDto {
  id: string;
  name: string;
  code: string;
}

export interface DepartmentRefDto {
  id: string;
  name: string;
  code: string;
}

export interface ProgramRefDto {
  id: string;
  name: string;
  code: string;
  departmentId?: string | null;
}

export interface AcademicYearRefDto {
  id: string;
  code: string;
  name?: string | null;
}

export interface TermRefDto {
  id: string;
  code: string;
}

export interface BatchRefDto {
  id: string;
  code: string;
}

export interface SectionRefDto {
  id: string;
  code: string;
}

// --- Sub-resource DTOs ---

export interface GuardianDto {
  id: string;
  studentId: string;
  name: string;
  kind: GuardianKindDto;
  role: GuardianRoleDto;
  phone: string | null;
  email: string | null;
  occupation: string | null;
  monthlyIncomeCents: number | null;
  address: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface StudentDocumentDto {
  id: string;
  studentId: string;
  category: string;
  documentName: string;
  storageKey: string | null;
  originalFilename: string | null;
  mimeType: string | null;
  sizeBytes: number | null;
  status: StudentDocumentStatusDto;
  verifiedAt: string | null;
  remarks: string | null;
  createdAt: string;
}

export interface StudentAdmissionDto {
  id: string;
  studentId: string;
  applicationNumber: string;
  program: ProgramRefDto;
  academicYear: AcademicYearRefDto | null;
  appliedAt: string;
  status: AdmissionStatusDto;
  mode: string | null;
  admissionFeeCents: number | null;
  remarks: string | null;
  createdAt: string;
}

export interface StudentAcademicRecordDto {
  id: string;
  studentId: string;
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
  verificationStatus: StudentDocumentStatusDto;
  remarks: string | null;
  createdAt: string;
}

export interface StudentEnrollmentDto {
  id: string;
  studentId: string;
  academicYear: AcademicYearRefDto;
  term: TermRefDto | null;
  program: ProgramRefDto;
  section: SectionRefDto | null;
  batch: BatchRefDto | null;
  rollNumber: string | null;
  semester: number | null;
  status: EnrollmentStatusDto;
  enrolledAt: string | null;
  completedAt: string | null;
  remarks: string | null;
  createdAt: string;
}

export interface StudentAttendanceDto {
  id: string;
  studentId: string;
  date: string;
  attendanceType: string;
  term: TermRefDto | null;
  subjectCode: string | null;
  subjectName: string | null;
  status: AttendanceStatusDto;
  remarks: string | null;
  createdAt: string;
}

export interface StudentPaymentDto {
  id: string;
  studentId: string;
  studentFeeId: string | null;
  receiptNumber: string;
  amountCents: number;
  currency: string;
  paymentDate: string;
  method: string;
  status: string;
  referenceNumber: string | null;
  remarks: string | null;
  createdAt: string;
}

export interface StudentFeeDto {
  id: string;
  studentId: string;
  term: TermRefDto | null;
  headCode: string;
  headName: string;
  amountCents: number;
  paidCents: number;
  waivedCents: number;
  status: FeeStatusDto;
  dueDate: string | null;
  remark: string | null;
  payments: StudentPaymentDto[];
  createdAt: string;
}

export interface StudentExamDto {
  id: string;
  studentId: string;
  name: string;
  examType: ExamTypeDto;
  term: TermRefDto | null;
  program: ProgramRefDto | null;
  section: SectionRefDto | null;
  startDate: string | null;
  endDate: string | null;
  status: ExamStatusDto;
  createdAt: string;
}

export interface StudentResultDto {
  id: string;
  studentId: string;
  examId: string | null;
  subjectCode: string;
  subjectName: string;
  maxMarks: number;
  obtainedMarks: number | null;
  grade: string | null;
  percentage: number | null;
  outcome: ResultOutcomeDto;
  publishedAt: string | null;
  remarks: string | null;
  createdAt: string;
}

export interface StudentCertificateDto {
  id: string;
  studentId: string;
  certificateType: CertificateTypeDto;
  certificateNumber: string | null;
  title: string | null;
  requestDate: string;
  status: CertificateStatusDto;
  templateId: string | null;
  template?: CertificateTemplateRefDto | null;
  qrToken: string | null;
  qrUrl: string | null;
  contentJson: unknown | null;
  storageKey: string | null;
  generatedAt: string | null;
  generatedByUserId: string | null;
  approvedAt: string | null;
  approvedByUserId: string | null;
  issuedAt: string | null;
  issuedByUserId: string | null;
  revokedAt: string | null;
  revokedByUserId: string | null;
  revokeReason: string | null;
  reissuedFromId: string | null;
  reissuedFrom?: StudentCertificateDto | null;
  reissues?: StudentCertificateDto[];
  remarks: string | null;
  history?: CertificateHistoryRowDto[];
  createdAt: string;
  updatedAt: string;
}

export interface CertificateTemplateRefDto {
  id: string;
  code: string;
  name: string;
  certificateType: CertificateTypeDto;
}

export interface CertificateHistoryRowDto {
  id: string;
  certificateId: string;
  fromStatus: CertificateStatusDto;
  toStatus: CertificateStatusDto;
  actorUserId: string | null;
  detail: unknown | null;
  createdAt: string;
}

export interface StudentLibraryLoanDto {
  id: string;
  studentId: string;
  itemTitle: string;
  itemAuthor: string | null;
  itemCode: string | null;
  itemType: string | null;
  borrowedAt: string;
  dueDate: string | null;
  returnedAt: string | null;
  status: LibraryLoanStatusDto;
  fineCents: number;
  remarks: string | null;
  createdAt: string;
}

export interface StudentHostelBookingDto {
  id: string;
  studentId: string;
  hostelName: string;
  roomNumber: string;
  bedNumber: string | null;
  allocationDate: string | null;
  checkInDate: string | null;
  checkOutDate: string | null;
  status: HostelBookingStatusDto;
  monthlyRentCents: number | null;
  remarks: string | null;
  createdAt: string;
}

export interface StudentTransportPassDto {
  id: string;
  studentId: string;
  routeCode: string | null;
  routeName: string;
  pickupPoint: string | null;
  dropPoint: string | null;
  vehicleNumber: string | null;
  periodStart: string;
  periodEnd: string | null;
  status: TransportPassStatusDto;
  amountCents: number | null;
  remarks: string | null;
  createdAt: string;
}

export interface StudentHoldDto {
  id: string;
  studentId: string;
  type: StudentHoldTypeDto;
  reason: string;
  placedOn: string;
  status: StudentHoldStatusDto;
  liftedOn: string | null;
  remarks: string | null;
  createdAt: string;
}

export interface StudentStatusHistoryDto {
  id: string;
  studentId: string;
  fromStatus: StudentStatusDto | null;
  toStatus: StudentStatusDto;
  reason: string | null;
  changedAt: string;
}

export interface StudentCommunicationDto {
  id: string;
  studentId: string;
  type: CommunicationTypeDto;
  direction: CommunicationDirectionDto;
  subject: string | null;
  body: string;
  sentAt: string;
  recipientType: string;
  recipientName: string | null;
  remarks: string | null;
  createdAt: string;
}

export interface StudentActivityDto {
  id: string;
  studentId: string;
  eventType: string;
  title: string;
  description: string | null;
  entityType: string | null;
  entityId: string | null;
  occurredAt: string;
}

/** Timeline entry = union of activity rows and status transitions (titled consistently). */
export interface StudentTimelineEntryDto {
  id: string;
  kind: 'activity' | 'status_change';
  title: string;
  description: string | null;
  eventType: string | null;
  occurredAt: string;
  fromStatus?: StudentStatusDto | null;
  toStatus?: StudentStatusDto | null;
}

// --- Student root DTOs ---

export interface StudentAddressDto {
  line1: string | null;
  line2: string | null;
  city: string | null;
  state: string | null;
  postalCode: string | null;
  country: string | null;
}

export interface StudentSummaryDto {
  id: string;
  admissionNumber: string;
  rollNumber: string | null;
  registrationNumber: string | null;
  fullName: string;
  firstName: string;
  middleName: string | null;
  lastName: string;
  gender: StudentGenderDto;
  dateOfBirth: string | null;
  email: string | null;
  primaryPhone: string | null;
  status: StudentStatusDto;
  campus: CampusRefDto;
  program: ProgramRefDto | null;
  batch: BatchRefDto | null;
  section: SectionRefDto | null;
  academicYear: AcademicYearRefDto | null;
  yearOfAdmission: number | null;
  admittedOn: string | null;
  profilePhotoUrl: string | null;
  hasActiveHolds: boolean;
  activeHoldCount: number;
  outstandingCents: number;
  createdAt: string;
}

export interface StudentDetailDto extends StudentSummaryDto {
  bloodGroup: BloodGroupDto;
  nationality: string | null;
  category: string | null;
  alternateEmail: string | null;
  alternatePhone: string | null;
  currentAddress: StudentAddressDto;
  permanentAddress: StudentAddressDto;
  updatedAt: string;
  guardians: GuardianDto[];
  documents: StudentDocumentDto[];
  admissions: StudentAdmissionDto[];
  academicRecords: StudentAcademicRecordDto[];
  enrollments: StudentEnrollmentDto[];
  attendance: StudentAttendanceDto[];
  fees: StudentFeeDto[];
  payments: StudentPaymentDto[];
  exams: StudentExamDto[];
  results: StudentResultDto[];
  certificates: StudentCertificateDto[];
  libraryLoans: StudentLibraryLoanDto[];
  hostelBookings: StudentHostelBookingDto[];
  transportPasses: StudentTransportPassDto[];
  holds: StudentHoldDto[];
  statusHistory: StudentStatusHistoryDto[];
  communications: StudentCommunicationDto[];
}

export interface StudentListDto {
  data: StudentSummaryDto[];
  total: number;
}

export interface StudentQueryDto {
  search?: string;
  status?: StudentStatusDto | StudentStatusDto[];
  campusId?: string;
  programId?: string;
  departmentId?: string;
  sectionId?: string;
  batchId?: string;
  academicYearId?: string;
  yearOfAdmission?: number;
  skip?: number;
  take?: number;
  sortBy?: 'createdAt' | 'fullName' | 'admissionNumber' | 'yearOfAdmission';
  sortOrder?: 'asc' | 'desc';
}

export interface StudentExportRowDto {
  id: string;
  admissionNumber: string;
  rollNumber: string | null;
  fullName: string;
  firstName: string;
  middleName: string | null;
  lastName: string;
  gender: string;
  dateOfBirth: string | null;
  email: string | null;
  primaryPhone: string | null;
  status: string;
  campus: string;
  program: string | null;
  batch: string | null;
  section: string | null;
  academicYear: string | null;
  yearOfAdmission: number | null;
  admittedOn: string | null;
}