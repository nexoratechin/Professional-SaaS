/**
 * HR & Faculty Management shared contracts between apps/api and apps/web. Plain data only
 * (no class-validator/NestJS decorators) so the package stays usable from the frontend.
 * The Prisma model names/enums in packages/database are the source of truth; the string
 * unions below mirror those schemas.
 */

// --- Enum unions (mirror @college-erp/database schema.prisma) ---

export type EmployeeTypeDto = 'FACULTY' | 'STAFF' | 'ADMIN';

export type EmploymentTypeDto = 'FULL_TIME' | 'PART_TIME' | 'CONTRACT' | 'VISITING' | 'ADJUNCT' | 'INTERN';

export type EmployeeStatusDto = 'ACTIVE' | 'ON_LEAVE' | 'SUSPENDED' | 'RESIGNED' | 'RETIRED' | 'TERMINATED';

export type GenderDto = 'MALE' | 'FEMALE' | 'OTHER' | 'NOT_SPECIFIED';

export type JoiningStatusDto = 'PENDING' | 'ONBOARDED' | 'CONFIRMED' | 'CLOSED';

export type ExitTypeDto =
  | 'RESIGNATION'
  | 'RETIREMENT'
  | 'TERMINATION'
  | 'END_OF_CONTRACT'
  | 'MUTUAL_SEPARATION';

export type NoDueStatusDto = 'PENDING' | 'CLEARED' | 'DISPUTED';

export type EmployeeDocumentTypeDto =
  | 'APPOINTMENT_LETTER'
  | 'OFFER_LETTER'
  | 'ID_PROOF'
  | 'EDUCATIONAL_CERTIFICATE'
  | 'EXPERIENCE_LETTER'
  | 'PAYSLIP'
  | 'RELIEVING_LETTER'
  | 'NO_DUE_CERTIFICATE'
  | 'OTHER';

export type LeaveCategoryDto =
  | 'CASUAL'
  | 'SICK'
  | 'EARNED'
  | 'MATERNITY'
  | 'PATERNITY'
  | 'UNPAID'
  | 'HALF_DAY'
  | 'COMPENSATORY'
  | 'SPECIAL'
  | 'OTHER';

export type LeaveApplicationStatusDto = 'PENDING' | 'APPROVED' | 'REJECTED' | 'CANCELLED';

export type HalfDayOptionDto = 'FIRST_HALF' | 'SECOND_HALF';

export type PerformanceReviewTypeDto = 'SELF' | 'SUPERVISOR' | 'PEER' | 'COMMITTEE';

export type PerformanceReviewStatusDto = 'DRAFT' | 'SUBMITTED' | 'APPROVED' | 'COMPLETED' | 'REJECTED';

export type PayrollRunStatusDto = 'DRAFT' | 'PROCESSING' | 'PROCESSED' | 'APPROVED' | 'PAID' | 'CANCELLED';

export type PayrollRunLineStatusDto = 'DRAFT' | 'PROCESSED' | 'APPROVED' | 'PAID' | 'CANCELLED';

// --- Lookups ---

export interface CampusLiteDto {
  id: string;
  name: string;
}

export interface DepartmentLiteDto {
  id: string;
  name: string;
  campus?: CampusLiteDto | null;
}

export interface HrDesignationDto {
  id: string;
  name: string;
  code: string;
  rank: number;
  isActive: boolean;
}

export interface LeaveTypeDto {
  id: string;
  code: string;
  name: string;
  category: LeaveCategoryDto;
  color?: string | null;
  maxDaysPerYear?: number | null;
  isPaid: boolean;
  isActive: boolean;
  needsApproval?: boolean | null;
}

export interface HrUserLiteDto {
  id: string;
  email: string;
  fullName: string;
  status?: string;
}

export interface HrLookupsDto {
  campuses: CampusLiteDto[];
  departments: DepartmentLiteDto[];
  designations: HrDesignationDto[];
  leaveTypes: LeaveTypeDto[];
  terms: { id: string; name: string; code: string }[];
  users: HrUserLiteDto[];
  enums: Record<string, string[]>;
}

// --- Employees ---

export interface EmployeeListItemDto {
  id: string;
  employeeCode: string;
  honorific?: string | null;
  firstName: string;
  middleName?: string | null;
  lastName: string;
  fullName: string;
  employeeType: EmployeeTypeDto;
  employmentType: EmploymentTypeDto;
  employmentStatus: EmployeeStatusDto;
  departmentId: string | null;
  campusId: string | null;
  userId: string | null;
  phone?: string | null;
  email?: string | null;
  joinDate?: string | null;
  exitDate?: string | null;
  createdAt: string;
  deletedAt?: string | null;
  department?: DepartmentLiteDto | null;
  designation?: HrDesignationDto | null;
  campus?: CampusLiteDto | null;
  user?: HrUserLiteDto | null;
}

export interface EmployeeListDto {
  data: EmployeeListItemDto[];
  total: number;
}

export interface EmployeeDetailDto extends EmployeeListItemDto {
  gender?: GenderDto | null;
  dateOfBirth?: string | null;
  personalEmail?: string | null;
  alternatePhone?: string | null;
  addressLine1?: string | null;
  addressLine2?: string | null;
  city?: string | null;
  state?: string | null;
  postalCode?: string | null;
  country?: string | null;
  bankAccountNumber?: string | null;
  bankIfsc?: string | null;
  uanNumber?: string | null;
  qualification?: string | null;
  specialization?: string | null;
  notes?: string | null;
  deletedAt?: string | null;
  joinings: EmployeeJoiningDto[];
  exits: EmployeeExitDto[];
  documents: EmployeeDocumentDto[];
  workloads: FacultyWorkloadDto[];
  salaryStructures: SalaryStructureDto[];
  leaveApplications: LeaveApplicationLiteDto[];
  reviews: PerformanceReviewDto[];
}

// --- Joining / Exit / Documents ---

export interface EmployeeJoiningDto {
  id: string;
  joiningStatus?: string | null;
  effectiveDate?: string | null;
  probationMonths?: number | null;
  confirmationDate?: string | null;
  remarks?: string | null;
  joinType?: string | null;
  interviewDate?: string | null;
  releaseDate?: string | null;
  offerDate?: string | null;
  offerStatus?: string | null;
  expectedJoinDate?: string | null;
  actualJoinDate?: string | null;
  status: JoiningStatusDto;
  notes?: string | null;
  createdAt: string;
}

export interface EmployeeExitDto {
  id: string;
  exitType: ExitTypeDto;
  effectiveDate?: string | null;
  lastWorkingDate?: string | null;
  noticePeriodDays?: number | null;
  relievingDate?: string | null;
  reason?: string | null;
  noDueStatus: NoDueStatusDto;
  noDueClearedAt?: string | null;
  settlementAmount?: number | null;
  remarks?: string | null;
  createdAt: string;
}

export interface EmployeeDocumentDto {
  id: string;
  documentType: EmployeeDocumentTypeDto;
  title?: string | null;
  fileName?: string | null;
  fileKey?: string | null;
  mimeType?: string | null;
  sizeBytes?: number | null;
  isVerified: boolean;
  verifiedByUserId?: string | null;
  verifiedAt?: string | null;
  uploadedByUserId?: string | null;
  createdAt: string;
}

export interface EmployeeDocumentUploadResponseDto {
  document: EmployeeDocumentDto;
  uploadUrl: string;
}

export interface EmployeeDocumentDownloadResponseDto {
  document: EmployeeDocumentDto;
  downloadUrl: string;
}

// --- Workload / Timetable / Attendance ---

export interface FacultyWorkloadDto {
  id: string;
  workloadType?: string | null;
  title?: string | null;
  termId: string;
  courseName?: string | null;
  courseCode?: string | null;
  courseCount?: number | null;
  sections?: number | null;
  hoursPerWeek?: number | null;
  creditHours?: number | null;
  isActive: boolean;
  createdAt: string;
  term?: { id: string; name: string; code: string } | null;
}

export interface HrTimetableEntryDto {
  id: string;
  dayOfWeek: number;
  date?: string | null;
  isSubstitute: boolean;
  status?: string | null;
  period?: { id: string; sequence: number; startTime: string; endTime: string; isBreak: boolean } | null;
  courseOffering?: { id: string; course: { id: string; code: string; name: string } } | null;
  section?: {
    id: string;
    name: string;
    program: { id: string; name?: string | null; code?: string | null; department: { id: string; name: string } | null };
  } | null;
}

export interface HrAttendanceRowDto {
  id: string;
  date: string;
  status: 'PRESENT' | 'ABSENT' | 'LATE' | 'LEAVE';
  markedBy?: string | null;
  course?: { id: string; code: string; name: string } | null;
}

// --- Leave ---

export interface LeaveBalanceDto {
  id: string;
  employeeId: string;
  leaveTypeId: string;
  year: number;
  openingBalance: number;
  creditedDays: number;
  availedDays: number;
  adjustedDays: number;
  closingBalance: number;
  leaveType?: LeaveTypeDto | null;
}

export interface LeaveBalanceListDto {
  data: LeaveBalanceDto[];
  total: number;
}

export interface LeaveApplicationDto {
  id: string;
  employeeId: string;
  leaveTypeId: string;
  fromDate: string;
  toDate: string;
  durationDays: number;
  halfDayOption?: HalfDayOptionDto | null;
  reason?: string | null;
  status: LeaveApplicationStatusDto;
  decidedByUserId?: string | null;
  decidedAt?: string | null;
  decisionNote?: string | null;
  createdAt: string;
  employee?: { id: string; employeeCode: string; firstName: string; lastName: string } | null;
  leaveType?: { id: string; code: string; name: string; category: LeaveCategoryDto } | null;
  approvedByUser?: HrUserLiteDto | null;
}

export interface LeaveApplicationLiteDto {
  id: string;
  leaveTypeId: string;
  fromDate: string;
  toDate: string;
  durationDays: number;
  status: LeaveApplicationStatusDto;
  leaveType?: { id: string; code: string; name: string } | null;
}

export interface LeaveApplicationListDto {
  data: LeaveApplicationDto[];
  total: number;
}

// --- Performance ---

export interface PerformanceReviewDto {
  id: string;
  employeeId: string;
  reviewType?: PerformanceReviewTypeDto | null;
  reviewPeriodStart?: string | null;
  reviewPeriodEnd?: string | null;
  score?: number | null;
  achievements?: string | null;
  areasForImprovement?: string | null;
  overallComments?: string | null;
  reviewerUserId?: string | null;
  status: PerformanceReviewStatusDto;
  submittedAt?: string | null;
  approvedAt?: string | null;
  completedAt?: string | null;
  createdAt: string;
}

export interface PerformanceReviewListDto {
  data: PerformanceReviewDto[];
  total: number;
}

// --- Salary & Payroll ---

export interface SalaryHeadDto {
  head?: string;
  amount: number;
}

export interface SalaryStructureDto {
  id: string;
  employeeId: string;
  effectiveFrom?: string | null;
  effectiveTo?: string | null;
  basicAmount: number;
  hraAmount: number;
  allowances?: unknown;
  deductions?: unknown;
  grossAmount: number;
  netAmount: number;
  isActive: boolean;
  createdAt: string;
}

export interface SalaryStructureListDto {
  data: SalaryStructureDto[];
  total: number;
}

export interface PayrollRunDto {
  id: string;
  month: number;
  year: number;
  title?: string | null;
  status: PayrollRunStatusDto;
  processedByUserId?: string | null;
  approvedByUserId?: string | null;
  createdAt: string;
}

export interface PayrollRunListDto {
  data: PayrollRunDto[];
  total: number;
}

export interface PayrollRunDetailDto extends PayrollRunDto {
  lines: PayrollRunLineDto[];
  totals: {
    gross: number;
    deductions: number;
    net: number;
  };
}

export interface PayrollRunLineDto {
  id: string;
  employeeId: string;
  salaryStructureId?: string | null;
  grossAmount: number;
  totalDeductions: number;
  netAmount: number;
  earnings?: unknown;
  deductions?: unknown;
  status: PayrollRunLineStatusDto;
  employee?: { id: string; employeeCode: string; firstName: string; lastName: string } | null;
}

export interface PayslipDto {
  id: string;
  run: { id: string; month: number; year: number; title?: string | null; status: PayrollRunStatusDto };
  payslipDocument?: EmployeeDocumentDto | null;
}

export interface MyPayslipsDto {
  data: PayslipDto[];
  total: number;
}

// --- Overview / Reports ---

export interface HrOverviewDto {
  headcount: number;
  byDepartment: { departmentId: string | null; departmentName: string | null; count: number }[];
  byStatus: { employmentStatus: EmployeeStatusDto; _count: { _all: number } }[];
  pendingLeaves: number;
  activeWorkloadHoursPerWeek: number;
  payroll: { paidLines: number; paidNetTotal: number; paidGrossTotal: number };
}