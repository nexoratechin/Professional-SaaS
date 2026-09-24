/**
 * Placements shared contracts between apps/api and apps/web. Plain data only
 * (no class-validator/NestJS decorators) so the package stays usable from the frontend.
 * The Prisma model names/enums in packages/database are the source of truth; the string
 * unions below mirror those schemas.
 */

// --- Enum unions (mirror @college-erp/database schema.prisma) ---

export type PlacementCompanyTypeDto =
  | 'MNC'
  | 'INDIAN_MNC'
  | 'STARTUP'
  | 'PSU'
  | 'CORPORATE'
  | 'SME'
  | 'GOVT_ORG'
  | 'NGO'
  | 'OTHER';

export type PlacementDriveModeDto = 'ON_CAMPUS' | 'OFF_CAMPUS' | 'VIRTUAL';

export type PlacementDriveStatusDto = 'DRAFT' | 'SCHEDULED' | 'ONGOING' | 'COMPLETED' | 'CANCELLED';

export type PlacementPositionTypeDto = 'FULL_TIME' | 'INTERNSHIP' | 'CONTRACT' | 'TRAINEE';

export type PlacementEligibilityStatusDto = 'PENDING' | 'ELIGIBLE' | 'NOT_ELIGIBLE' | 'EXEMPTED';

export type PlacementApplicationStatusDto = 'APPLIED' | 'SHORTLISTED' | 'REJECTED' | 'WITHDRAWN';

export type PlacementRoundTypeDto =
  | 'APTITUDE_TEST'
  | 'TECHNICAL_TEST'
  | 'PSYCHOMETRIC_TEST'
  | 'GROUP_DISCUSSION'
  | 'TECHNICAL_INTERVIEW'
  | 'HR_INTERVIEW'
  | 'MANAGERIAL_INTERVIEW'
  | 'CASE_STUDY'
  | 'OTHER';

export type PlacementRoundStatusDto = 'SCHEDULED' | 'COMPLETED' | 'CANCELLED';

export type PlacementRoundResultStatusDto = 'PENDING' | 'SELECTED' | 'REJECTED' | 'ON_HOLD' | 'ABSENT';

export type PlacementOfferStatusDto = 'ISSUED' | 'ACCEPTED' | 'DECLINED' | 'EXPIRED';

export type PlacementJoiningStatusDto = 'PENDING' | 'JOINED' | 'NOT_JOINED' | 'POSTPONED';

export type PlacementOutcomeStatusDto = 'PLACED' | 'NOT_PLACED' | 'OPTED_OUT' | 'UNREGISTERED';

// --- Shared embeds ---

import type { CampusLiteDto, DepartmentLiteDto } from './hr';

export interface ProgramLiteDto {
  id: string;
  name: string;
  code: string;
  department?: DepartmentLiteDto | null;
}

/** Minimal student row embedded in placement lists (also used to compute department stats). */
export interface StudentLiteDto {
  id: string;
  admissionNumber: string;
  fullName: string;
  email: string | null;
  primaryPhone: string | null;
  programId: string | null;
  batchId: string | null;
  academicYearId: string | null;
  program?: ProgramLiteDto | null;
  campus?: CampusLiteDto | null;
}

export interface AcademicYearLiteDto {
  id: string;
  name: string;
  code: string;
}

// --- Companies & contacts ---

export interface PlacementCompanyDto {
  id: string;
  code: string;
  name: string;
  companyType: PlacementCompanyTypeDto;
  industry: string | null;
  website: string | null;
  description: string | null;
  headquartersCity: string | null;
  city: string | null;
  state: string | null;
  country: string | null;
  isActive: boolean;
  updatedAt: string;
}

export interface PlacementCompanyListDto {
  data: PlacementCompanyDto[];
  total: number;
}

export interface PlacementContactDto {
  id: string;
  companyId: string;
  fullName: string;
  designation: string | null;
  email: string | null;
  phone: string | null;
  isPrimary: boolean;
  isActive: boolean;
  company?: { id: string; name: string } | null;
}

export interface PlacementContactListDto {
  data: PlacementContactDto[];
  total: number;
}

// --- Drives & positions ---

export interface PlacementPositionDto {
  id: string;
  driveId: string;
  title: string;
  positionType: PlacementPositionTypeDto;
  location: string | null;
  openings: number | null;
  description: string | null;
  minCgpa: number | null;
  minPercentage: number | null;
  maxBacklogs: number | null;
  packageCents: number | null;
  packageNotes: string | null;
  isActive: boolean;
  _count?: { applications: number };
}

export interface PlacementDriveDto {
  id: string;
  code: string;
  title: string;
  description: string | null;
  mode: PlacementDriveModeDto;
  status: PlacementDriveStatusDto;
  driveDate: string | null;
  applicationDeadline: string | null;
  venue: string | null;
  coordinatorContactId: string | null;
  eligibilityNotes: string | null;
  company:
    | {
        id: string;
        name: string;
        code: string;
        companyType: PlacementCompanyTypeDto;
      }
    | null;
  positions: PlacementPositionDto[];
  _count?: {
    positions: number;
    applications: number;
    rounds: number;
    selections: number;
    offers: number;
  };
  updatedAt: string;
}

export interface PlacementDriveListDto {
  data: PlacementDriveDto[];
  total: number;
}

// --- Eligibility ---

export interface PlacementEligibilityDto {
  id: string;
  driveId: string;
  positionId: string;
  studentId: string;
  status: PlacementEligibilityStatusDto;
  criteriaSnapshot: unknown;
  studentSnapshot: unknown;
  remarks: string | null;
  evaluatedByUserId: string | null;
  evaluatedAt: string | null;
  student?: StudentLiteDto | null;
  position?: { id: string; title: string } | null;
}

export interface PlacementEligibilityListDto {
  data: PlacementEligibilityDto[];
  total: number;
}

export interface PlacementEligibilityEvaluationResultDto {
  eligible: number;
  notEligible: number;
  exempted: number;
  skipped: number;
  details: Array<{
    studentId: string;
    fullName: string | null;
    admissionNumber: string | null;
    status: PlacementEligibilityStatusDto;
    reason: string | null;
  }>;
}

// --- Resumes ---

export interface PlacementResumeDto {
  id: string;
  studentId: string;
  title: string;
  fileKey: string;
  contentType: string | null;
  sizeBytes: number | null;
  isPrimary: boolean;
  uploadedByUserId: string | null;
  student?: StudentLiteDto | null;
}

export interface PlacementResumeListDto {
  data: PlacementResumeDto[];
  total: number;
}

export interface PlacementResumeUploadResponseDto extends PlacementResumeDto {
  uploadUrl: string;
  key: string;
}

// --- Applications ---

export interface PlacementApplicationDto {
  id: string;
  driveId: string;
  positionId: string;
  studentId: string;
  resumeId: string | null;
  status: PlacementApplicationStatusDto;
  appliedAt: string;
  shortlistedAt: string | null;
  rejectedAt: string | null;
  withdrawnAt: string | null;
  remarks: string | null;
  updatedAt: string;
  drive?: { id: string; title: string } | null;
  position?: PlacementPositionDto | null;
  student?: StudentLiteDto | null;
  selection?: { id: string; selectedAt: string } | null;
}

export interface PlacementApplicationListDto {
  data: PlacementApplicationDto[];
  total: number;
}

// --- Rounds & results ---

export interface PlacementRoundDto {
  id: string;
  driveId: string;
  sequence: number;
  roundType: PlacementRoundTypeDto;
  title: string | null;
  scheduledAt: string | null;
  locationOrLink: string | null;
  status: PlacementRoundStatusDto;
  notes: string | null;
  _count?: { results: number };
}

export interface PlacementRoundListDto {
  data: PlacementRoundDto[];
  total: number;
}

export interface PlacementRoundResultDto {
  id: string;
  roundId: string;
  applicationId: string;
  result: PlacementRoundResultStatusDto;
  score: number | null;
  feedback: string | null;
  assessedByUserId: string | null;
  assessedAt: string | null;
  application?: PlacementApplicationDto | null;
}

// --- Selections, offers, joining ---

export interface PlacementSelectionDto {
  id: string;
  driveId: string;
  positionId: string;
  applicationId: string;
  studentId: string;
  selectedByUserId: string | null;
  selectedAt: string;
  notes: string | null;
  student?: StudentLiteDto | null;
  position?: { id: string; title: string } | null;
}

export interface PlacementSelectionListDto {
  data: PlacementSelectionDto[];
  total: number;
}

export interface PlacementOfferDto {
  id: string;
  driveId: string;
  positionId: string;
  applicationId: string;
  selectionId: string | null;
  studentId: string;
  offerLetterNumber: string;
  packageCents: number | null;
  joiningLocation: string | null;
  status: PlacementOfferStatusDto;
  issuedAt: string;
  acceptedAt: string | null;
  declinedAt: string | null;
  expiryDate: string | null;
  notes: string | null;
  student?: StudentLiteDto | null;
  position?: { id: string; title: string } | null;
  joining?: PlacementJoiningDto | null;
}

export interface PlacementOfferListDto {
  data: PlacementOfferDto[];
  total: number;
}

export interface PlacementJoiningDto {
  id: string;
  offerId: string;
  expectedJoiningDate: string | null;
  actualJoiningDate: string | null;
  joiningLocation: string | null;
  status: PlacementJoiningStatusDto;
  remarks: string | null;
  offer?: { id: string; offerLetterNumber: string } | null;
  student?: StudentLiteDto | null;
}

export interface PlacementJoiningListDto {
  data: PlacementJoiningDto[];
  total: number;
}

// --- Outcomes & statistics ---

export interface PlacementOutcomeDto {
  id: string;
  academicYearId: string | null;
  studentId: string;
  driveId: string | null;
  positionId: string | null;
  offerId: string | null;
  outcomeStatus: PlacementOutcomeStatusDto;
  finalPackageCents: number | null;
  placedAt: string | null;
  declaredByUserId: string | null;
  remarks: string | null;
  student?: StudentLiteDto | null;
  drive?: { id: string; title: string } | null;
  offer?: { id: string; offerLetterNumber: string } | null;
  academicYear?: AcademicYearLiteDto | null;
}

export interface PlacementOutcomeListDto {
  data: PlacementOutcomeDto[];
  total: number;
}

export interface PlacementDepartmentAnalyticsDto {
  departmentId: string;
  departmentName: string;
  programId: string | null;
  programName: string | null;
  totalStudents: number;
  placed: number;
  optedOut: number;
  notPlaced: number;
  placementRate: number | null;
  averagePackageCents: number | null;
  highestPackageCents: number | null;
  lowestPackageCents: number | null;
}

export interface PlacementStatisticsDto {
  totalCompanies: number;
  totalDrives: number;
  totalPositions: number;
  totalApplications: number;
  shortlistedCandidates: number;
  selectedCandidates: number;
  offersIssued: number;
  offersAccepted: number;
  joined: number;
  placedStudents: number;
  eligibleStudents: number;
  drivesByStatus: Record<string, number>;
  averagePackageCents: number | null;
  highestPackageCents: number | null;
  lowestPackageCents: number | null;
  departmentAnalytics: PlacementDepartmentAnalyticsDto[];
  recentOutcomes: PlacementOutcomeDto[];
}

export interface PlacementReportDto {
  generatedAt: string;
  academicYear?: AcademicYearLiteDto | null;
  drive?: PlacementDriveDto | null;
  totalEligible: number;
  totalApplied: number;
  totalShortlisted: number;
  totalSelected: number;
  totalOffers: number;
  offersAccepted: number;
  joined: number;
  placed: number;
  departmentAnalytics: PlacementDepartmentAnalyticsDto[];
  outcomes: PlacementOutcomeDto[];
}