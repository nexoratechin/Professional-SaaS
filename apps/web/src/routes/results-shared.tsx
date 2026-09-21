/**
 * Results module shared types & constants — mirrors the payloads returned by the
 * /results API (packages/apps/api/src/modules/results). Paged/useSessions are reused
 * from exams-shared because the results engine is built on top of exam sessions.
 */

export const PASS_MODES = ['PERCENTAGE', 'GRADE_POINT'] as const;
export const WEIGHTING_MODES = ['SIMPLE', 'CREDIT_WEIGHTED'] as const;
export const COMPONENT_KINDS = ['INTERNAL', 'THEORY', 'PRACTICAL', 'PROJECT', 'VIVA', 'OTHER'] as const;
export const RESULT_STATES = ['CALCULATED', 'PENDING_APPROVAL', 'APPROVED', 'PUBLISHED', 'LOCKED'] as const;
export const RESULT_STANDINGS = ['PASSED', 'FAILED', 'SUPPLEMENTARY'] as const;
export const BULK_PROCESS_ACTIONS = ['APPROVE', 'PUBLISH', 'UNPUBLISH', 'LOCK', 'UNLOCK'] as const;

export interface GradeBand {
  id: string;
  grade: string;
  minPercent: number;
  maxPercent: number;
  gradePoint: number;
  gradeDescription?: string | null;
}

export interface GradingSchemeRow {
  id: string;
  code: string;
  name: string;
  description?: string | null;
  passMode: string;
  minPassPercent?: number | null;
  minPassGradePoint?: number | null;
  weightingMode: string;
  gpaMax: number;
  graceEnabled: boolean;
  maxGraceMarks: number;
  graceToPassDiff: number;
  roundingDecimals: number;
  isDefault: boolean;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
  gradeScale?: GradeBand[];
}

export interface GracePolicy {
  enabled?: boolean;
  maxGraceMarks?: number;
  graceToPassDiff?: number;
}

export interface SessionResultConfig {
  sessionId: string;
  name: string;
  code: string;
  gradingSchemeId?: string | null;
  gradingScheme: GradingSchemeRow | null;
  gracePolicy: GracePolicy;
  resultsLockedAt?: string | null;
  resultPublishedAt?: string | null;
}

export interface AssessmentComponentRow {
  id: string;
  sessionId: string;
  subjectId?: string | null;
  code: string;
  name: string;
  kind: string;
  weightage: number;
  maxMarks: number;
  sortOrder: number;
  subject?: { course?: { code?: string | null; name?: string | null } | null } | null;
}

export interface ExamComponentMarkRow {
  id: string;
  registrationId: string;
  subjectId: string;
  componentId: string;
  studentId: string;
  marksObtained: number;
  remark?: string | null;
  component: { id: string; code: string; name: string; kind: string; weightage: number; maxMarks: number };
  registration: { id: string };
  student: { id: string; fullName: string; admissionNumber?: string | null; rollNumber?: string | null };
}

export interface ProcessStudent {
  id: string;
  fullName: string;
  admissionNumber?: string | null;
  rollNumber?: string | null;
}

export interface MarksEntryRow {
  registrationId: string;
  subjectId: string;
  studentId: string;
  student: { id: string; fullName: string; admissionNumber?: string | null; rollNumber?: string | null };
  subject: {
    id: string;
    maxMarks: number;
    passMarks: number;
    course: { id: string; code: string; name: string };
  };
}

export interface ResultProcessRow {
  id: string;
  sessionId: string;
  studentId: string;
  state: string;
  standing?: string | null;
  subjectCount?: number | null;
  passedCount?: number | null;
  failedCount?: number | null;
  totalRawMarks?: number | null;
  totalGraceMarks?: number | null;
  totalEffectiveMarks?: number | null;
  totalMaxMarks?: number | null;
  aggregatePercent?: number | null;
  creditsAttempted?: number | null;
  creditsEarned?: number | null;
  gpa?: number | null;
  cgpa?: number | null;
  calculationVersion: number;
  calculatedAt?: string | null;
  approvedAt?: string | null;
  publishedAt?: string | null;
  lockedAt?: string | null;
  student: ProcessStudent;
}

export interface ResultCalculationRow {
  id: string;
  subjectId: string;
  rawMarks?: number | null;
  graceApplied: number;
  effectiveMarks?: number | null;
  maxMarks: number;
  passMarks: number;
  percentage?: number | null;
  grade?: string | null;
  gradePoint?: number | null;
  outcome: string;
  calculatedAt?: string | null;
  subject: {
    courseId: string;
    maxMarks: number;
    passMarks: number;
    course: { id: string; code: string; name: string; creditHours?: number | null };
  };
}

export interface ResultProcessDetail extends ResultProcessRow {
  student: ProcessStudent & { programId?: string | null };
  calculations: ResultCalculationRow[];
}

export interface HistoryRow {
  id: string;
  sessionId: string;
  processId?: string | null;
  studentId?: string | null;
  event: string;
  fromState?: string | null;
  toState?: string | null;
  details?: unknown;
  actorUserId?: string | null;
  createdAt: string;
  student?: { id: string; fullName: string; admissionNumber?: string | null } | null;
}

export interface ExportPaper {
  courseCode: string;
  courseName: string;
  credits?: number | null;
  maxMarks: number;
  passMarks: number;
  rawMarks?: number | null;
  graceApplied: number;
  effectiveMarks?: number | null;
  percentage?: number | null;
  grade?: string | null;
  gradePoint?: number | null;
  outcome: string;
}

export interface ExportRow {
  studentId: string;
  admissionNumber?: string | null;
  fullName: string;
  state: string;
  standing?: string | null;
  subjectCount?: number | null;
  passedCount?: number | null;
  failedCount?: number | null;
  aggregatePercent?: number | null;
  creditsAttempted?: number | null;
  creditsEarned?: number | null;
  gpa?: number | null;
  cgpa?: number | null;
  calculationVersion: number;
  publishedAt?: string | null;
  papers: ExportPaper[];
}

export interface ExportResult {
  sessionCode: string;
  exportedAt: string;
  rows: ExportRow[];
}

export interface StudentSummaryProcess {
  id: string;
  state: string;
  standing?: string | null;
  subjectCount?: number | null;
  passedCount?: number | null;
  failedCount?: number | null;
  aggregatePercent?: number | null;
  creditsAttempted?: number | null;
  creditsEarned?: number | null;
  gpa?: number | null;
  cgpa?: number | null;
  calculationVersion: number;
  calculatedAt?: string | null;
  approvedAt?: string | null;
  publishedAt?: string | null;
  lockedAt?: string | null;
  session: { id: string; name: string; code: string; examType: string; termId?: string | null; programId?: string | null };
}

export interface StudentSummary {
  studentId: string;
  publishedProcessCount: number;
  totalCreditsAttempted: number;
  totalCreditsEarned: number;
  cgpa?: number | null;
  processes: StudentSummaryProcess[];
}