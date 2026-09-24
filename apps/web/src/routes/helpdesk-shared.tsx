/**
 * Helpdesk / Feedback shared types & constants — mirrors the payloads returned by
 * `apps/api/src/modules/helpdesk`. Helpdesk is a tenant-wide operational resource (no campus/
 * department data-separation on reads), matching the inventory/library convention.
 */

export const HELPDESK_VIEW_PERMISSION = 'helpdesk.view';
export const HELPDESK_CREATE_PERMISSION = 'helpdesk.create';
export const HELPDESK_UPDATE_PERMISSION = 'helpdesk.update';
export const HELPDESK_DELETE_PERMISSION = 'helpdesk.delete';
export const HELPDESK_MANAGE_PERMISSION = 'helpdesk.manage';

export const TICKET_STATUSES = ['NEW', 'OPEN', 'IN_PROGRESS', 'PENDING', 'RESOLVED', 'CLOSED', 'REOPENED', 'CANCELLED'] as const;
export const TICKET_PRIORITIES = ['LOW', 'MEDIUM', 'HIGH', 'URGENT', 'CRITICAL'] as const;
export const TICKET_SOURCES = ['WEB', 'EMAIL', 'PHONE', 'WALK_IN', 'API', 'OTHER'] as const;
export const COMMENT_VISIBILITIES = ['PUBLIC', 'INTERNAL'] as const;

export const STATUS_COLORS: Record<string, string> = {
  NEW: '#2563eb',
  OPEN: '#3b82f6',
  IN_PROGRESS: '#7c3aed',
  PENDING: '#f59e0b',
  RESOLVED: '#15803d',
  CLOSED: '#6b7280',
  REOPENED: '#b91c1c',
  CANCELLED: '#6b7280',
};

export const PRIORITY_COLORS: Record<string, string> = {
  LOW: '#6b7280',
  MEDIUM: '#3b82f6',
  HIGH: '#f59e0b',
  URGENT: '#ea580c',
  CRITICAL: '#b91c1c',
};

export interface Paged<T> {
  items: T[];
  total: number;
  skip?: number;
  take?: number;
}

export interface LookupUser {
  id: string;
  fullName: string;
  email: string;
}

export interface LookupsPayload {
  departments: { id: string; code: string; name: string; campusId?: string | null }[];
  categories: { id: string; code: string; name: string; parentId?: string | null; defaultPriority: string; defaultDepartmentId?: string | null; slaPolicyId?: string | null; requiresApproval: boolean }[];
  slaPolicies: { id: string; code: string; name: string; priority?: string | null; departmentId?: string | null }[];
  campuses: { id: string; code: string; name: string }[];
  users: LookupUser[];
  ticketStatuses: string[];
  ticketPriorities: string[];
  ticketSources: string[];
  commentVisibilities: string[];
}

// ── Configuration ───────────────────────────────────────────────────────────

export interface DepartmentRow {
  id: string;
  code: string;
  name: string;
  description?: string | null;
  email?: string | null;
  campusId?: string | null;
  isActive: boolean;
  _count?: { tickets: number; categories: number };
}

export interface CategoryRow {
  id: string;
  code: string;
  name: string;
  description?: string | null;
  parentId?: string | null;
  defaultPriority: string;
  defaultDepartmentId?: string | null;
  slaPolicyId?: string | null;
  requiresApproval: boolean;
  isActive: boolean;
  sequenceOrder: number;
  defaultDepartment?: { id: string; name: string } | null;
  slaPolicy?: { id: string; name: string } | null;
  _count?: { tickets: number; children: number };
}

export interface SlaPolicyRow {
  id: string;
  code: string;
  name: string;
  description?: string | null;
  priority?: string | null;
  departmentId?: string | null;
  responseMinutes: number;
  resolutionMinutes: number;
  atRiskMinutes?: number | null;
  escalateToRoleCode?: string | null;
  escalateAfterMinutes?: number | null;
  isDefault: boolean;
  isActive: boolean;
  department?: { id: string; name: string } | null;
  _count?: { tickets: number; categories: number };
}

// ── Tickets ─────────────────────────────────────────────────────────────────

export interface TicketRow {
  id: string;
  ticketNumber: string;
  subject: string;
  status: string;
  priority: string;
  source: string;
  createdAt: string;
  responseDueAt?: string | null;
  resolutionDueAt?: string | null;
  firstRespondedAt?: string | null;
  resolvedAt?: string | null;
  escalationLevel: number;
  satisfactionScore?: number | null;
  category: { id: string; name: string };
  department?: { id: string; name: string } | null;
  slaPolicy?: { id: string; name: string } | null;
  assignedToUserId?: string | null;
  requesterUserId?: string | null;
  requesterName?: string | null;
  _count?: { comments: number; attachments: number; escalations: number };
}

export interface CommentRow {
  id: string;
  body: string;
  visibility: string;
  isResolutionNote: boolean;
  authorUserId?: string | null;
  createdAt: string;
  attachments?: { id: string; filename: string; documentId: string }[];
}

export interface AttachmentRow {
  id: string;
  documentId: string;
  filename: string;
  mimeType: string;
  sizeBytes?: number | null;
  createdAt: string;
}

export interface HistoryRow {
  id: string;
  event: string;
  actorUserId?: string | null;
  actorType: string;
  fromValue?: string | null;
  toValue?: string | null;
  note?: string | null;
  createdAt: string;
}

export interface EscalationRow {
  id: string;
  reason: string;
  level: number;
  toUserId?: string | null;
  toRoleCode?: string | null;
  note?: string | null;
  createdAt: string;
}

export interface TicketDetail extends TicketRow {
  description: string;
  tags: string[];
  resolutionSummary?: string | null;
  satisfactionComment?: string | null;
  satisfactionSubmittedAt?: string | null;
  escalatedAt?: string | null;
  reopenedCount: number;
  closedAt?: string | null;
  cancelledAt?: string | null;
  comments: CommentRow[];
  attachments: AttachmentRow[];
  history: HistoryRow[];
  escalations: EscalationRow[];
  feedback: { id: string; score: number; comment?: string | null; createdAt: string }[];
}

// ── Reports ─────────────────────────────────────────────────────────────────

export interface SummaryReport {
  tenantId: string;
  total: number;
  open: number;
  overdue: number;
  unassigned: number;
  resolved: number;
  byStatus: Record<string, number>;
  byPriority: Record<string, number>;
  avgResolutionMinutes: number | null;
  avgFirstResponseMinutes: number | null;
  satisfactionAverage: number | null;
  feedbackCount: number;
  slaComplianceRate: number;
}

export interface DepartmentReport {
  departmentId: string | null;
  name: string;
  code?: string | null;
  total: number;
  open: number;
  resolved: number;
  byStatus: Record<string, number>;
  satisfactionAverage: number | null;
}

export interface CategoryReport {
  categoryId: string;
  name: string;
  code?: string | null;
  total: number;
  open: number;
  resolved: number;
}

export interface AgentReport {
  assignedToUserId: string | null;
  name: string;
  email?: string | null;
  total: number;
  open: number;
  resolved: number;
  satisfactionAverage: number | null;
}

export interface TrendReport {
  from: string;
  to: string;
  days: { date: string; created: number; resolved: number }[];
}

export interface SatisfactionReport {
  average: number | null;
  totalResponses: number;
  distribution: Record<string, number>;
  recentComments: { id: string; score: number; comment?: string | null; createdAt: string; ticket?: { ticketNumber: string; subject: string } | null }[];
}

export function fmtDateTime(value?: string | null): string {
  if (!value) return '—';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleString();
}

export function minutesLabel(minutes: number | null | undefined): string {
  if (minutes == null) return '—';
  if (minutes < 60) return `${Math.round(minutes)}m`;
  if (minutes < 60 * 24) return `${(minutes / 60).toFixed(1)}h`;
  return `${(minutes / (60 * 24)).toFixed(1)}d`;
}
