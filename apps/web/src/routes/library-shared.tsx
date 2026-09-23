/**
 * Library module shared types & constants — mirrors the payloads returned by the library API
 * (`apps/api/src/modules/library`). June 2026: the module reuses the existing
 * StudentLibraryLoan table for circulation, so loan/fine/transaction shapes below include the
 * legacy free-form fields (itemTitle/itemAuthor/itemCode/itemType) alongside the catalog links.
 */

export const LIBRARY_VIEW_PERMISSION = 'library.view';
export const LIBRARY_CREATE_PERMISSION = 'library.create';
export const LIBRARY_UPDATE_PERMISSION = 'library.update';
export const LIBRARY_DELETE_PERMISSION = 'library.delete';
export const LIBRARY_MANAGE_PERMISSION = 'library.manage';
export const LIBRARY_BARCODE_ENTITLEMENT = 'library.barcode';

export interface Paged<T> {
  items: T[];
  total: number;
}

export interface LookupOption {
  id: string;
  code: string;
  name: string;
}

export interface CategoryOption {
  id: string;
  code: string;
  name: string;
  parentId?: string | null;
}

export interface LookupsPayload {
  categories: CategoryOption[];
  publishers: LookupOption[];
  authors: { id: string; code: string; fullName: string }[];
  config: LibraryConfig;
  memberTypes: string[];
  memberStatuses: string[];
  copyStatuses: string[];
  copyConditions: string[];
  reservationStatuses: string[];
  fineTypes: string[];
  fineStatuses: string[];
  loanStatuses: string[];
}

export interface LibraryConfig {
  id: string;
  defaultLoanDays: number;
  maxLoansPerMember: number;
  renewalLimit: number;
  overdueFinePerDayCents: number;
  reservationHoldDays: number;
}

// ── Catalog ─────────────────────────────────────────────────────────────────

export interface CategoryRow {
  id: string;
  code: string;
  name: string;
  description?: string | null;
  parentId?: string | null;
  createdAt: string;
  updatedAt: string;
  _count?: { books: number };
}

export interface PublisherRow {
  id: string;
  code: string;
  name: string;
  addressLine?: string | null;
  city?: string | null;
  country?: string | null;
  phone?: string | null;
  email?: string | null;
  website?: string | null;
  createdAt: string;
  updatedAt: string;
  _count?: { books: number };
}

export interface AuthorRow {
  id: string;
  code: string;
  firstName: string;
  lastName?: string | null;
  fullName: string;
  bio?: string | null;
  createdAt: string;
  updatedAt: string;
  _count?: { bookLinks: number };
}

export interface BookAuthorLink {
  author: { id: string; fullName: string };
}

export interface BookRow {
  id: string;
  isbn?: string | null;
  title: string;
  subtitle?: string | null;
  language: string;
  edition?: string | null;
  pageCount?: number | null;
  publicationYear?: number | null;
  description?: string | null;
  coverStorageKey?: string | null;
  category: { id: string; name: string };
  publisher: { id: string; name: string } | null;
  authors: BookAuthorLink[];
  copies: { id: string; status: string; barcode: string; accessionNumber: string }[];
  replacementCostCents?: number | null;
  maxLoanDays: number;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

// ── Copies ──────────────────────────────────────────────────────────────────

export interface CopyActiveLoan {
  id: string;
  dueDate: string | null;
  member: { id: string; fullName: string; memberNumber: string } | null;
}

export interface CopyRow {
  id: string;
  bookId: string;
  barcode: string;
  accessionNumber: string;
  shelfLocation?: string | null;
  acquisitionType?: string | null;
  acquisitionDate?: string | null;
  purchasePriceCents?: number | null;
  status: string;
  condition: string;
  notes?: string | null;
  createdAt: string;
  updatedAt: string;
  book: { id: string; title: string; isbn: string | null; category: { name: string } };
  loans?: CopyActiveLoan[];
}

export interface CopyBarcodePayload {
  copyId: string;
  barcode: string;
  accessionNumber: string;
  bookTitle: string;
  code128: string;
  qr: string;
}

export interface TransactionRow {
  id: string;
  type: string;
  copyId?: string | null;
  memberId?: string | null;
  loanId?: string | null;
  occurredAt: string;
  actorUserId?: string | null;
  notes?: string | null;
  metadata?: Record<string, unknown> | null;
  createdAt: string;
  copy: { id: string; barcode: string; book: { id: string; title: string } } | null;
  member: { id: string; fullName: string; memberNumber: string } | null;
}

export interface FineRef {
  id: string;
  type: string;
  amountCents: number;
  paidCents: number;
  status: string;
}

// ── Members ─────────────────────────────────────────────────────────────────

export interface MemberRow {
  id: string;
  memberNumber: string;
  fullName: string;
  email?: string | null;
  phone?: string | null;
  memberType: string;
  status: string;
  maxLoans?: number | null;
  studentId?: string | null;
  userId?: string | null;
  membershipStart?: string | null;
  membershipEnd?: string | null;
  notes?: string | null;
  activeLoanCount?: number;
  student?: { id: string; fullName: string; admissionNumber: string | null; rollNumber: string | null } | null;
  user?: { id: string; fullName: string; email: string } | null;
  createdAt: string;
  updatedAt: string;
}

export interface LoanRef {
  id: string;
  itemTitle: string;
  status: string;
  borrowedAt: string;
  dueDate: string | null;
  returnedAt?: string | null;
  fineCents: number;
  copy?: { id: string; barcode: string; book: { id: string; title: string } } | null;
  fines?: FineRef[];
}

export interface ReservationRef {
  id: string;
  status: string;
  reservedAt: string;
  holdUntil?: string | null;
  book: { id: string; title: string };
  copy?: { id: string; barcode: string } | null;
}

export interface MemberDetail extends MemberRow {
  loans: LoanRef[];
  reservations: ReservationRef[];
  fines: FineRef[];
}

// ── Circulation ─────────────────────────────────────────────────────────────

export interface LoanRow {
  id: string;
  itemTitle: string;
  itemAuthor?: string | null;
  itemCode?: string | null;
  itemType?: string | null;
  copyId?: string | null;
  memberId?: string | null;
  studentId?: string | null;
  borrowedAt: string;
  dueDate: string | null;
  returnedAt?: string | null;
  status: string;
  renewalCount: number;
  lastRenewedAt?: string | null;
  returnCondition?: string | null;
  returnedById?: string | null;
  fineCents: number;
  remarks?: string | null;
  createdAt: string;
  updatedAt: string;
  member: { id: string; fullName: string; memberNumber: string } | null;
  student?: { id: string; fullName: string; admissionNumber: string } | null;
  copy?: { id: string; barcode: string; accessionNumber: string; book: { id: string; title: string } } | null;
  fines?: FineRef[];
}

export interface LoanDetail extends LoanRow {
  copy?: {
    id: string;
    barcode: string;
    accessionNumber: string;
    condition: string;
    status: string;
    book: { id: string; title: string; replacementCostCents: number | null };
  } | null;
  fines?: (FineRef & { reason?: string | null; paidAt?: string | null; waivedAt?: string | null })[];
}

// ── Reservations ────────────────────────────────────────────────────────────

export interface ReservationRow {
  id: string;
  bookId: string;
  memberId: string;
  copyId?: string | null;
  status: string;
  reservedAt: string;
  holdUntil?: string | null;
  fulfilledAt?: string | null;
  cancelledAt?: string | null;
  cancelledBy?: string | null;
  notes?: string | null;
  createdAt: string;
  book: { id: string; title: string };
  copy: { id: string; barcode: string } | null;
  member: { id: string; fullName: string; memberNumber: string };
}

// ── Fines ───────────────────────────────────────────────────────────────────

export interface FineRow {
  id: string;
  type: string;
  amountCents: number;
  paidCents: number;
  status: string;
  reason?: string | null;
  paidAt?: string | null;
  waivedAt?: string | null;
  paidByUserId?: string | null;
  waivedByUserId?: string | null;
  createdAt: string;
  member: { id: string; fullName: string; memberNumber: string };
  loan?: {
    id: string;
    itemTitle: string;
    itemCode: string | null;
    copy?: { barcode: string; book: { title: string } } | null;
  } | null;
}

// ── Reports ─────────────────────────────────────────────────────────────────

export interface LibrarySummary {
  totalBooks: number;
  totalCopies: number;
  availableCopies: number;
  reservedCopies: number;
  damagedCopies: number;
  lostCopies: number;
  withdrawnCopies: number;
  issuedCopies: number;
  overdueLoans: number;
  activeMembers: number;
  pendingFinesCents: number;
  waitingReservations: number;
  todayIssued: number;
  todayReturned: number;
}

export interface CirculationReport {
  days: number;
  totalIssued: number;
  topBooks: { bookId: string; title: string; issues: number }[];
}

export interface InventoryReport {
  byStatus: Record<string, number>;
  byCategory: { categoryId: string; categoryName: string; books: number; copies: number }[];
}