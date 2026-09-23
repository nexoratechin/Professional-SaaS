/**
 * Library service — full catalog (categories/publishers/authors/books), physical copies with
 * barcode/QR identity + inventory history, members, circulation on the shared
 * StudentLibraryLoan table (issue / renew / return / mark-lost), reservations with holds,
 * fines (overdue / lost / damage), per-tenant config, tenant-wide reports and the overdue /
 * reservation-expiry sweeps. Reads are member-scoped via the library grants exactly like the
 * exams module; every mutation lands an audit event (module 'library') and borrower-facing
 * events raise in-app notifications through the shared NotificationsService.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */

import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, type PrismaClient } from '@college-erp/database';
import { AUDIT_ACTIONS, AUDIT_MODULES } from '@college-erp/auth';
import { TenantScopedPrismaService } from '../../common/prisma/tenant-scoped-prisma.service';
import { AuditService } from '../audit/audit.service';
import { PermissionsService } from '../rbac/permissions.service';
import { NotificationsService } from '../notifications/notifications.service';
import { libraryFineScopeFilter, libraryLoanScopeFilter, libraryMemberWhereInput, libraryReservationScopeFilter } from './library-scope';
import { nextLibrarySeriesNumber } from './library-sequences';
import { code128SvgDataUrl, qrDataUrl } from './barcode';
import {
  AddLibraryCopiesDto,
  AssignReservationCopyDto,
  CancelReservationDto,
  CirculationReportDto,
  CreateLibraryAuthorDto,
  CreateLibraryBookDto,
  CreateLibraryCategoryDto,
  CreateLibraryMemberDto,
  CreateLibraryPublisherDto,
  CreateReservationDto,
  IssueLoanDto,
  ListBooksQueryDto,
  ListCopiesQueryDto,
  ListFinesQueryDto,
  ListLoansQueryDto,
  ListMembersQueryDto,
  ListReservationsQueryDto,
  ListTransactionsQueryDto,
  MarkLoanLostDto,
  PayFineDto,
  RenewLoanDto,
  ReturnLoanDto,
  SetLibraryCopyStatusDto,
  SetLibraryMemberStatusDto,
  UpdateLibraryAuthorDto,
  UpdateLibraryBookDto,
  UpdateLibraryCategoryDto,
  UpdateLibraryConfigDto,
  UpdateLibraryCopyDto,
  UpdateLibraryMemberDto,
  UpdateLibraryPublisherDto,
  WaiveFineDto,
} from './dto/library.dto';

type Client = PrismaClient;

const DAY_MS = 24 * 60 * 60 * 1000;
const MANUAL_COPY_STATUSES = ['AVAILABLE', 'DAMAGED', 'LOST', 'WITHDRAWN'];
const ACTIVE_LOAN_STATUSES = ['ISSUED', 'OVERDUE'];

function addDays(base: Date, days: number): Date {
  return new Date(base.getTime() + days * DAY_MS);
}

function daysLate(due: Date, asOf: Date): number {
  return Math.max(0, Math.ceil((asOf.getTime() - due.getTime()) / DAY_MS));
}

@Injectable()
export class LibraryService {
  private readonly logger = new Logger(LibraryService.name);

  constructor(
    private readonly tenantPrisma: TenantScopedPrismaService,
    private readonly auditService: AuditService,
    private readonly permissionsService: PermissionsService,
    private readonly notifications: NotificationsService,
  ) {}

  private get db(): Client {
    return this.tenantPrisma.client as unknown as Client;
  }

  // ── Shared helpers ────────────────────────────────────────────────────────

  private async grants(tenantId: string, userId: string) {
    return this.permissionsService.getScopeGrantsFor(tenantId, userId, 'library.view');
  }

  private async memberScope(tenantId: string, userId: string) {
    return libraryMemberWhereInput(await this.grants(tenantId, userId), userId);
  }

  private async loanScope(tenantId: string, userId: string) {
    return libraryLoanScopeFilter(await this.grants(tenantId, userId), userId);
  }

  private async reservationScope(tenantId: string, userId: string) {
    return libraryReservationScopeFilter(await this.grants(tenantId, userId), userId);
  }

  private async fineScope(tenantId: string, userId: string) {
    return libraryFineScopeFilter(await this.grants(tenantId, userId), userId);
  }

  private async audit(tenantId: string, userId: string, action: string, entityType: string, entityId: string | undefined, extra?: { before?: unknown; after?: unknown }) {
    await this.auditService.record({
      scope: 'TENANT',
      tenantId,
      actorType: 'USER',
      actorUserId: userId,
      action,
      module: AUDIT_MODULES.LIBRARY,
      entityType,
      entityId,
      before: extra?.before,
      after: extra?.after,
    });
  }

  private async notifyMember(tenantId: string, member: { userId?: string | null; student?: { userId?: string | null } | null }, subject: string, body: string) {
    const recipientUserId = member.userId ?? member.student?.userId;
    if (recipientUserId) {
      await this.notifications.sendSystem(tenantId, { recipientUserId, subject, body });
    }
  }

  private async ensureConfig(tenantId: string) {
    const existing = await this.db.libraryConfig.findFirst({ where: { tenantId } });
    if (existing) return existing;
    return this.db.libraryConfig.create({ data: { tenantId } });
  }

  private async assertNoActiveLoanForCopy(copyId: string, message: string) {
    const active = await this.db.studentLibraryLoan.findFirst({
      where: { copyId, status: { in: ACTIVE_LOAN_STATUSES as any } },
      select: { id: true },
    });
    if (active) throw new BadRequestException(message);
  }

  /** Creates or re-syncs the running overdue fine for a loan (sweep + return both call this)
   * and returns the fine row when one exists. */
  private async syncOverdueFine(
    tx: Prisma.TransactionClient,
    tenantId: string,
    loan: { id: string; memberId: string; dueDate: Date | null },
    ratePerDayCents: number,
    asOf: Date,
  ): Promise<{ id: string; amountCents: number } | null> {
    if (!loan.dueDate) return null;
    const lateDays = daysLate(loan.dueDate, asOf);
    const amountCents = lateDays * ratePerDayCents;
    if (amountCents <= 0) return null;
    // Pending OVERDUE fine on this loan is upserted to the current running amount.
    const fine = await tx.libraryFine.findFirst({
      where: { tenantId, loanId: loan.id, type: 'OVERDUE', status: 'PENDING' },
    });
    if (fine) {
      await tx.libraryFine.update({ where: { id: fine.id }, data: { amountCents } });
      return { id: fine.id, amountCents };
    }
    const created = await tx.libraryFine.create({
      data: {
        tenant: { connect: { id: tenantId } },
        loan: { connect: { id: loan.id } },
        member: { connect: { id: loan.memberId } },
        type: 'OVERDUE',
        amountCents,
        reason: `Overdue ${lateDays} day(s)`,
      },
    });
    return { id: created.id, amountCents };
  }

  // ── Lookups & config ──────────────────────────────────────────────────────

  async lookups(tenantId: string) {
    const [categories, publishers, authors, config] = await Promise.all([
      this.db.libraryCategory.findMany({ where: { deletedAt: null }, orderBy: { name: 'asc' }, select: { id: true, code: true, name: true, parentId: true } }),
      this.db.libraryPublisher.findMany({ where: { deletedAt: null }, orderBy: { name: 'asc' }, select: { id: true, code: true, name: true } }),
      this.db.libraryAuthor.findMany({ where: { deletedAt: null }, orderBy: { fullName: 'asc' }, select: { id: true, code: true, fullName: true } }),
      this.ensureConfig(tenantId),
    ]);
    return {
      categories,
      publishers,
      authors,
      config,
      memberTypes: ['STUDENT', 'FACULTY', 'STAFF', 'OTHER'],
      memberStatuses: ['ACTIVE', 'INACTIVE', 'SUSPENDED', 'CLOSED'],
      copyStatuses: ['AVAILABLE', 'ISSUED', 'RESERVED', 'LOST', 'DAMAGED', 'WITHDRAWN'],
      copyConditions: ['NEW', 'GOOD', 'FAIR', 'POOR', 'DAMAGED'],
      reservationStatuses: ['WAITING', 'READY', 'FULFILLED', 'CANCELLED', 'EXPIRED'],
      fineTypes: ['OVERDUE', 'LOST', 'DAMAGE', 'OTHER'],
      fineStatuses: ['PENDING', 'PAID', 'WAIVED'],
      loanStatuses: ['ISSUED', 'RETURNED', 'OVERDUE', 'LOST'],
    };
  }

  async getConfig(tenantId: string) {
    return this.ensureConfig(tenantId);
  }

  async updateConfig(tenantId: string, userId: string, dto: UpdateLibraryConfigDto) {
    const before = await this.ensureConfig(tenantId);
    const row = await this.db.libraryConfig.update({
      where: { id: before.id },
      data: {
        defaultLoanDays: dto.defaultLoanDays ?? before.defaultLoanDays,
        maxLoansPerMember: dto.maxLoansPerMember ?? before.maxLoansPerMember,
        renewalLimit: dto.renewalLimit ?? before.renewalLimit,
        overdueFinePerDayCents: dto.overdueFinePerDayCents ?? before.overdueFinePerDayCents,
        reservationHoldDays: dto.reservationHoldDays ?? before.reservationHoldDays,
        updatedBy: userId,
      },
    });
    await this.audit(tenantId, userId, AUDIT_ACTIONS.LIBRARY_CONFIG_UPDATED, 'LibraryConfig', row.id, {
      before,
      after: row,
    });
    return row;
  }

  // ── Categories ────────────────────────────────────────────────────────────

  async listCategories(_tenantId: string) {
    return this.db.libraryCategory.findMany({
      where: { deletedAt: null },
      orderBy: { name: 'asc' },
      include: { _count: { select: { books: true } } },
    });
  }

  async createCategory(tenantId: string, userId: string, dto: CreateLibraryCategoryDto) {
    await this.assertCategoryCodeFree(tenantId, dto.code);
    const row = await this.db.libraryCategory.create({
      data: {
        tenant: { connect: { id: tenantId } },
        code: dto.code,
        name: dto.name,
        description: dto.description,
        parent: dto.parentId ? { connect: { id: dto.parentId } } : undefined,
        createdBy: userId,
      },
    });
    await this.audit(tenantId, userId, AUDIT_ACTIONS.LIBRARY_CATEGORY_CREATED, 'LibraryCategory', row.id, { after: row });
    return row;
  }

  async updateCategory(tenantId: string, userId: string, id: string, dto: UpdateLibraryCategoryDto) {
    const before = await this.findCategory(tenantId, id);
    if (dto.parentId === id) throw new BadRequestException('A category cannot be its own parent.');
    if (dto.code && dto.code !== before.code) await this.assertCategoryCodeFree(tenantId, dto.code);
    const row = await this.db.libraryCategory.update({
      where: { id },
      data: {
        code: dto.code ?? before.code,
        name: dto.name ?? before.name,
        description: dto.description ?? before.description,
        parentId: dto.parentId ?? before.parentId,
        updatedBy: userId,
      },
    });
    await this.audit(tenantId, userId, AUDIT_ACTIONS.LIBRARY_CATEGORY_UPDATED, 'LibraryCategory', id, { before, after: row });
    return row;
  }

  async deleteCategory(tenantId: string, userId: string, id: string) {
    const before = await this.findCategory(tenantId, id);
    const row = await this.db.libraryCategory.update({ where: { id }, data: { deletedAt: new Date(), updatedBy: userId } });
    await this.audit(tenantId, userId, AUDIT_ACTIONS.LIBRARY_CATEGORY_DELETED, 'LibraryCategory', id, { before, after: row });
    return row;
  }

  private async findCategory(tenantId: string, id: string) {
    const row = await this.db.libraryCategory.findFirst({ where: { id, deletedAt: null } });
    if (!row) throw new NotFoundException('Library category not found.');
    return row;
  }

  private async assertCategoryCodeFree(tenantId: string, code: string) {
    const existing = await this.db.libraryCategory.findFirst({ where: { code } });
    if (existing) throw new ConflictException(`Category code '${code}' already exists.`);
  }

  // ── Publishers ────────────────────────────────────────────────────────────

  async listPublishers(_tenantId: string) {
    return this.db.libraryPublisher.findMany({ where: { deletedAt: null }, orderBy: { name: 'asc' }, include: { _count: { select: { books: true } } } });
  }

  async createPublisher(tenantId: string, userId: string, dto: CreateLibraryPublisherDto) {
    await this.assertPublisherCodeFree(tenantId, dto.code);
    const row = await this.db.libraryPublisher.create({
      data: {
        tenant: { connect: { id: tenantId } },
        code: dto.code,
        name: dto.name,
        addressLine: dto.addressLine,
        city: dto.city,
        country: dto.country ?? 'India',
        phone: dto.phone,
        email: dto.email,
        website: dto.website,
        createdBy: userId,
      },
    });
    await this.audit(tenantId, userId, AUDIT_ACTIONS.LIBRARY_PUBLISHER_CREATED, 'LibraryPublisher', row.id, { after: row });
    return row;
  }

  async updatePublisher(tenantId: string, userId: string, id: string, dto: UpdateLibraryPublisherDto) {
    const before = await this.findPublisher(tenantId, id);
    if (dto.code && dto.code !== before.code) await this.assertPublisherCodeFree(tenantId, dto.code);
    const row = await this.db.libraryPublisher.update({
      where: { id },
      data: {
        code: dto.code ?? before.code,
        name: dto.name ?? before.name,
        addressLine: dto.addressLine ?? before.addressLine,
        city: dto.city ?? before.city,
        country: dto.country ?? before.country,
        phone: dto.phone ?? before.phone,
        email: dto.email ?? before.email,
        website: dto.website ?? before.website,
        updatedBy: userId,
      },
    });
    await this.audit(tenantId, userId, AUDIT_ACTIONS.LIBRARY_PUBLISHER_UPDATED, 'LibraryPublisher', id, { before, after: row });
    return row;
  }

  async deletePublisher(tenantId: string, userId: string, id: string) {
    const before = await this.findPublisher(tenantId, id);
    const row = await this.db.libraryPublisher.update({ where: { id }, data: { deletedAt: new Date(), updatedBy: userId } });
    await this.audit(tenantId, userId, AUDIT_ACTIONS.LIBRARY_PUBLISHER_DELETED, 'LibraryPublisher', id, { before, after: row });
    return row;
  }

  private async findPublisher(tenantId: string, id: string) {
    const row = await this.db.libraryPublisher.findFirst({ where: { id, deletedAt: null } });
    if (!row) throw new NotFoundException('Library publisher not found.');
    return row;
  }

  private async assertPublisherCodeFree(tenantId: string, code: string) {
    const existing = await this.db.libraryPublisher.findFirst({ where: { code } });
    if (existing) throw new ConflictException(`Publisher code '${code}' already exists.`);
  }

  // ── Authors ───────────────────────────────────────────────────────────────

  private fullName(firstName: string, lastName?: string): string {
    return lastName ? `${firstName} ${lastName}` : firstName;
  }

  async listAuthors(_tenantId: string) {
    return this.db.libraryAuthor.findMany({ where: { deletedAt: null }, orderBy: { fullName: 'asc' }, include: { _count: { select: { bookLinks: true } } } });
  }

  async createAuthor(tenantId: string, userId: string, dto: CreateLibraryAuthorDto) {
    await this.assertAuthorCodeFree(tenantId, dto.code);
    const row = await this.db.libraryAuthor.create({
      data: {
        tenant: { connect: { id: tenantId } },
        code: dto.code,
        firstName: dto.firstName,
        lastName: dto.lastName ?? null,
        fullName: this.fullName(dto.firstName, dto.lastName),
        bio: dto.bio,
        createdBy: userId,
      },
    });
    await this.audit(tenantId, userId, AUDIT_ACTIONS.LIBRARY_AUTHOR_CREATED, 'LibraryAuthor', row.id, { after: row });
    return row;
  }

  async updateAuthor(tenantId: string, userId: string, id: string, dto: UpdateLibraryAuthorDto) {
    const before = await this.findAuthor(tenantId, id);
    if (dto.code && dto.code !== before.code) await this.assertAuthorCodeFree(tenantId, dto.code);
    const firstName = dto.firstName ?? before.firstName;
    const lastName = dto.lastName ?? before.lastName;
    const row = await this.db.libraryAuthor.update({
      where: { id },
      data: {
        code: dto.code ?? before.code,
        firstName,
        lastName,
        fullName: this.fullName(firstName, lastName ?? undefined),
        bio: dto.bio ?? before.bio,
        updatedBy: userId,
      },
    });
    await this.audit(tenantId, userId, AUDIT_ACTIONS.LIBRARY_AUTHOR_UPDATED, 'LibraryAuthor', id, { before, after: row });
    return row;
  }

  async deleteAuthor(tenantId: string, userId: string, id: string) {
    const before = await this.findAuthor(tenantId, id);
    const row = await this.db.libraryAuthor.update({ where: { id }, data: { deletedAt: new Date(), updatedBy: userId } });
    await this.audit(tenantId, userId, AUDIT_ACTIONS.LIBRARY_AUTHOR_DELETED, 'LibraryAuthor', id, { before, after: row });
    return row;
  }

  private async findAuthor(tenantId: string, id: string) {
    const row = await this.db.libraryAuthor.findFirst({ where: { id, deletedAt: null } });
    if (!row) throw new NotFoundException('Library author not found.');
    return row;
  }

  private async assertAuthorCodeFree(tenantId: string, code: string) {
    const existing = await this.db.libraryAuthor.findFirst({ where: { code } });
    if (existing) throw new ConflictException(`Author code '${code}' already exists.`);
  }

  // ── Books ─────────────────────────────────────────────────────────────────

  private bookInclude = {
    category: { select: { id: true, name: true } },
    publisher: { select: { id: true, name: true } },
    authors: { include: { author: { select: { id: true, fullName: true } } } },
    copies: { select: { id: true, status: true, barcode: true, accessionNumber: true } },
  } as const;

  async listBooks(tenantId: string, query: ListBooksQueryDto) {
    const where: Prisma.LibraryBookWhereInput = {
      deletedAt: null,
      ...(query.categoryId ? { categoryId: query.categoryId } : {}),
      ...(query.publisherId ? { publisherId: query.publisherId } : {}),
      ...(query.authorId ? { authors: { some: { authorId: query.authorId } } } : {}),
      ...(query.isActive !== undefined ? { isActive: query.isActive } : {}),
      ...(query.search
        ? {
            OR: [
              { title: { contains: query.search, mode: 'insensitive' } },
              { isbn: { contains: query.search, mode: 'insensitive' } },
            ],
          }
        : {}),
    };
    const [items, total] = await Promise.all([
      this.db.libraryBook.findMany({
        where,
        include: this.bookInclude,
        orderBy: { createdAt: 'desc' },
        skip: query.skip ?? 0,
        take: query.take ?? 20,
      }),
      this.db.libraryBook.count({ where }),
    ]);
    return { items, total };
  }

  async getBook(tenantId: string, id: string) {
    const row = await this.db.libraryBook.findFirst({ where: { id, deletedAt: null }, include: this.bookInclude });
    if (!row) throw new NotFoundException('Library book not found.');
    return row;
  }

  async createBook(tenantId: string, userId: string, dto: CreateLibraryBookDto) {
    const category = await this.db.libraryCategory.findFirst({ where: { id: dto.categoryId, deletedAt: null } });
    if (!category) throw new NotFoundException('Category not found.');
    const authorIds = [...new Set(dto.authorIds ?? [])];
    if (authorIds.length) {
      const authors = await this.db.libraryAuthor.count({ where: { id: { in: authorIds }, deletedAt: null } });
      if (authors !== authorIds.length) throw new BadRequestException('One or more author ids are invalid.');
    }
    const row = await this.db.$transaction(async (tx) => {
      const book = await tx.libraryBook.create({
        data: {
          tenant: { connect: { id: tenantId } },
          isbn: dto.isbn,
          title: dto.title,
          subtitle: dto.subtitle,
          language: dto.language ?? 'English',
          edition: dto.edition,
          pageCount: dto.pageCount,
          publicationYear: dto.publicationYear,
          description: dto.description,
          coverStorageKey: dto.coverStorageKey,
          category: { connect: { id: dto.categoryId } },
          publisher: dto.publisherId ? { connect: { id: dto.publisherId } } : undefined,
          replacementCostCents: dto.replacementCostCents,
          maxLoanDays: dto.maxLoanDays ?? 14,
          isActive: dto.isActive ?? true,
          createdBy: userId,
        },
      });
      for (const authorId of authorIds) {
        await tx.libraryBookAuthor.create({
          data: { tenant: { connect: { id: tenantId } }, book: { connect: { id: book.id } }, author: { connect: { id: authorId } } },
        });
      }
      return book;
    });
    await this.audit(tenantId, userId, AUDIT_ACTIONS.LIBRARY_BOOK_CREATED, 'LibraryBook', row.id, { after: { title: row.title, authorIds } });
    return this.getBook(tenantId, row.id);
  }

  async updateBook(tenantId: string, userId: string, id: string, dto: UpdateLibraryBookDto) {
    const before = await this.findBook(tenantId, id);
    if (dto.categoryId) {
      const category = await this.db.libraryCategory.findFirst({ where: { id: dto.categoryId, deletedAt: null } });
      if (!category) throw new NotFoundException('Category not found.');
    }
    const authorIds = dto.authorIds !== undefined ? [...new Set(dto.authorIds)] : undefined;
    if (authorIds?.length) {
      const authors = await this.db.libraryAuthor.count({ where: { id: { in: authorIds }, deletedAt: null } });
      if (authors !== authorIds.length) throw new BadRequestException('One or more author ids are invalid.');
    }

    const row = await this.db.$transaction(async (tx) => {
      const book = await tx.libraryBook.update({
        where: { id },
        data: {
          isbn: dto.isbn ?? before.isbn,
          title: dto.title ?? before.title,
          subtitle: dto.subtitle ?? before.subtitle,
          language: dto.language ?? before.language,
          edition: dto.edition ?? before.edition,
          pageCount: dto.pageCount ?? before.pageCount,
          publicationYear: dto.publicationYear ?? before.publicationYear,
          description: dto.description ?? before.description,
          coverStorageKey: dto.coverStorageKey ?? before.coverStorageKey,
          categoryId: dto.categoryId ?? before.categoryId,
          publisherId: dto.publisherId ?? before.publisherId,
          replacementCostCents: dto.replacementCostCents ?? before.replacementCostCents,
          maxLoanDays: dto.maxLoanDays ?? before.maxLoanDays,
          isActive: dto.isActive ?? before.isActive,
          updatedBy: userId,
        },
      });
      if (authorIds) {
        await tx.libraryBookAuthor.deleteMany({ where: { bookId: id } });
        for (const authorId of authorIds) {
          await tx.libraryBookAuthor.create({
            data: { tenant: { connect: { id: tenantId } }, book: { connect: { id } }, author: { connect: { id: authorId } } },
          });
        }
      }
      return book;
    });
    await this.audit(tenantId, userId, AUDIT_ACTIONS.LIBRARY_BOOK_UPDATED, 'LibraryBook', id, { before, after: row });
    return this.getBook(tenantId, id);
  }

  async deleteBook(tenantId: string, userId: string, id: string) {
    const before = await this.findBook(tenantId, id);
    const row = await this.db.libraryBook.update({ where: { id }, data: { deletedAt: new Date(), updatedBy: userId } });
    await this.audit(tenantId, userId, AUDIT_ACTIONS.LIBRARY_BOOK_DELETED, 'LibraryBook', id, { before, after: row });
    return row;
  }

  private async findBook(tenantId: string, id: string) {
    const row = await this.db.libraryBook.findFirst({ where: { id, deletedAt: null } });
    if (!row) throw new NotFoundException('Library book not found.');
    return row;
  }

  // ── Copies ────────────────────────────────────────────────────────────────

  async listCopies(tenantId: string, query: ListCopiesQueryDto) {
    const where: Prisma.LibraryCopyWhereInput = {
      ...(query.bookId ? { bookId: query.bookId } : {}),
      ...(query.status ? { status: query.status as any } : {}),
      ...(query.condition ? { condition: query.condition as any } : {}),
      ...(query.search
        ? {
            OR: [
              { barcode: { contains: query.search, mode: 'insensitive' } },
              { accessionNumber: { contains: query.search, mode: 'insensitive' } },
            ],
          }
        : {}),
    };
    const [items, total] = await Promise.all([
      this.db.libraryCopy.findMany({
        where,
        include: {
          book: { select: { id: true, title: true, isbn: true, category: { select: { name: true } } } },
          loans: {
            where: { status: { in: ACTIVE_LOAN_STATUSES as any } },
            select: { id: true, dueDate: true, member: { select: { id: true, fullName: true } } },
            take: 1,
            orderBy: { borrowedAt: 'desc' },
          },
        },
        orderBy: { createdAt: 'desc' },
        skip: query.skip ?? 0,
        take: query.take ?? 20,
      }),
      this.db.libraryCopy.count({ where }),
    ]);
    return { items, total };
  }

  async getCopy(tenantId: string, id: string) {
    const row = await this.db.libraryCopy.findFirst({
      where: { id },
      include: {
        book: { include: { category: { select: { id: true, name: true } }, authors: { include: { author: { select: { id: true, fullName: true } } } } } },
        loans: { where: { status: { in: ACTIVE_LOAN_STATUSES as any } }, include: { member: { select: { id: true, fullName: true, memberNumber: true } } }, orderBy: { borrowedAt: 'desc' } },
      },
    });
    if (!row) throw new NotFoundException('Library copy not found.');
    return row;
  }

  async addCopies(tenantId: string, userId: string, bookId: string, dto: AddLibraryCopiesDto) {
    await this.findBook(tenantId, bookId);
    const count = dto.count ?? 1;
    if (count > 1 && (dto.barcode || dto.accessionNumber)) {
      throw new BadRequestException('barcode/accessionNumber apply to single-copy adds only; use count for bulk.');
    }

    const created = await this.db.$transaction(async (tx) => {
      const rows = [];
      for (let i = 0; i < count; i++) {
        const barcode = dto.barcode ?? (await nextLibrarySeriesNumber(tx, tenantId, 'COPY', 'LB'));
        const accessionNumber = dto.accessionNumber ?? (await nextLibrarySeriesNumber(tx, tenantId, 'COPY', 'AC'));
        await this.assertCopyKeysFree(tenantId, barcode, accessionNumber);
        const acqDate = dto.acquisitionDate ? new Date(dto.acquisitionDate) : undefined;
        const copy = await tx.libraryCopy.create({
          data: {
            tenant: { connect: { id: tenantId } },
            book: { connect: { id: bookId } },
            barcode,
            accessionNumber,
            shelfLocation: dto.shelfLocation,
            acquisitionType: dto.acquisitionType,
            acquisitionDate: acqDate,
            purchasePriceCents: dto.purchasePriceCents,
            condition: (dto.condition ?? 'NEW') as any,
            status: 'AVAILABLE' as any,
            notes: dto.notes,
            createdBy: userId,
          },
        });
        await tx.libraryTransaction.create({
          data: {
            tenant: { connect: { id: tenantId } },
            copy: { connect: { id: copy.id } },
            type: 'ADDED',
            actorUserId: userId,
            notes: dto.notes,
            metadata: { acquisitionType: dto.acquisitionType ?? null, purchasePriceCents: dto.purchasePriceCents ?? null },
          },
        });
        rows.push(copy);
      }
      return rows;
    });

    const first = created[0];
    await this.audit(tenantId, userId, AUDIT_ACTIONS.LIBRARY_COPY_ADDED, 'LibraryCopy', first?.id, {
      after: { count: created.length, bookId },
    });
    return created.length === 1 ? created[0] : { items: created, total: created.length };
  }

  private async assertCopyKeysFree(tenantId: string, barcode: string, accessionNumber: string) {
    const existing = await this.db.libraryCopy.findFirst({ where: { OR: [{ barcode }, { accessionNumber }] } });
    if (existing) {
      throw new ConflictException(
        existing.barcode === barcode
          ? `A copy with barcode '${barcode}' already exists.`
          : `A copy with accession number '${accessionNumber}' already exists.`,
      );
    }
  }

  async updateCopy(tenantId: string, userId: string, id: string, dto: UpdateLibraryCopyDto) {
    const before = await this.findCopy(tenantId, id);
    const row = await this.db.libraryCopy.update({
      where: { id },
      data: {
        shelfLocation: dto.shelfLocation ?? before.shelfLocation,
        condition: (dto.condition ?? before.condition) as any,
        notes: dto.notes ?? before.notes,
        updatedBy: userId,
      },
    });
    await this.audit(tenantId, userId, AUDIT_ACTIONS.LIBRARY_COPY_UPDATED, 'LibraryCopy', id, { before, after: row });
    return row;
  }

  async setCopyStatus(tenantId: string, userId: string, id: string, dto: SetLibraryCopyStatusDto) {
    const copy = await this.findCopy(tenantId, id);
    if (!MANUAL_COPY_STATUSES.includes(dto.status)) {
      throw new BadRequestException(`Status '${dto.status}' cannot be set manually (use circulation actions).`);
    }
    if (dto.status === copy.status) return copy;
    await this.assertNoActiveLoanForCopy(id, 'Copy has an active loan; use return or mark-lost instead.');

    const row = await this.db.$transaction(async (tx) => {
      const updated = await tx.libraryCopy.update({
        where: { id },
        data: { status: dto.status as any, notes: dto.notes ?? copy.notes, updatedBy: userId },
      });
      await tx.libraryTransaction.create({
        data: {
          tenant: { connect: { id: tenantId } },
          copy: { connect: { id } },
          type: (dto.status === 'AVAILABLE' ? 'ADDED' : dto.status) as any,
          actorUserId: userId,
          notes: dto.notes ?? `Status changed to ${dto.status}`,
        },
      });
      return updated;
    });
    await this.audit(tenantId, userId, AUDIT_ACTIONS.LIBRARY_COPY_UPDATED, 'LibraryCopy', id, { before: copy, after: row });
    return row;
  }

  async getCopyBarcode(tenantId: string, id: string) {
    const copy = await this.db.libraryCopy.findFirst({
      where: { id },
      include: { book: { select: { id: true, title: true } } },
    });
    if (!copy) throw new NotFoundException('Library copy not found.');
    const [code128, qr] = await Promise.all([code128SvgDataUrl(copy.barcode), qrDataUrl(tenantId, copy.barcode)]);
    return { copyId: copy.id, barcode: copy.barcode, accessionNumber: copy.accessionNumber, bookTitle: copy.book.title, code128, qr };
  }

  async listTransactions(tenantId: string, query: ListTransactionsQueryDto) {
    const where: Prisma.LibraryTransactionWhereInput = query.copyId ? { copyId: query.copyId } : {};
    const [items, total] = await Promise.all([
      this.db.libraryTransaction.findMany({
        where,
        include: {
          copy: { select: { id: true, barcode: true, book: { select: { id: true, title: true } } } },
          member: { select: { id: true, fullName: true, memberNumber: true } },
        },
        orderBy: { occurredAt: 'desc' },
        skip: query.skip ?? 0,
        take: query.take ?? 20,
      }),
      this.db.libraryTransaction.count({ where }),
    ]);
    return { items, total };
  }

  private async findCopy(tenantId: string, id: string) {
    const row = await this.db.libraryCopy.findFirst({ where: { id } });
    if (!row) throw new NotFoundException('Library copy not found.');
    return row;
  }

  // ── Members ───────────────────────────────────────────────────────────────

  async listMembers(tenantId: string, userId: string, query: ListMembersQueryDto) {
    const scope = await this.memberScope(tenantId, userId);
    const where: Prisma.LibraryMemberWhereInput = {
      ...(scope ? { AND: [scope] } : {}),
      deletedAt: null,
      ...(query.status ? { status: query.status as any } : {}),
      ...(query.memberType ? { memberType: query.memberType as any } : {}),
      ...(query.studentId ? { studentId: query.studentId } : {}),
      ...(query.search
        ? {
            OR: [
              { fullName: { contains: query.search, mode: 'insensitive' } },
              { memberNumber: { contains: query.search, mode: 'insensitive' } },
              { email: { contains: query.search, mode: 'insensitive' } },
            ],
          }
        : {}),
    };
    const [items, total] = await Promise.all([
      this.db.libraryMember.findMany({
        where,
        include: {
          student: { select: { id: true, fullName: true, admissionNumber: true, rollNumber: true } },
          user: { select: { id: true, fullName: true, email: true } },
          loans: { where: { status: { in: ACTIVE_LOAN_STATUSES as any } }, select: { id: true } },
        },
        orderBy: { fullName: 'asc' },
        skip: query.skip ?? 0,
        take: query.take ?? 20,
      }),
      this.db.libraryMember.count({ where }),
    ]);
    return { items: items.map(({ loans, ...member }) => ({ ...member, activeLoanCount: loans.length })), total };
  }

  async getMember(tenantId: string, userId: string, id: string) {
    const scope = await this.memberScope(tenantId, userId);
    const row = await this.db.libraryMember.findFirst({
      where: { id, deletedAt: null, ...(scope ? { AND: [scope] } : {}) },
      include: {
        student: { select: { id: true, fullName: true, admissionNumber: true, rollNumber: true } },
        user: { select: { id: true, fullName: true, email: true } },
        loans: {
          orderBy: { borrowedAt: 'desc' },
          include: {
            copy: { select: { id: true, barcode: true, book: { select: { id: true, title: true } } } },
            fines: { select: { id: true, type: true, amountCents: true, paidCents: true, status: true } },
          },
        },
        reservations: {
          orderBy: { reservedAt: 'desc' },
          include: { book: { select: { id: true, title: true } }, copy: { select: { id: true, barcode: true } } },
        },
        fines: { where: { status: 'PENDING' }, select: { id: true, type: true, amountCents: true, paidCents: true } },
      },
    });
    if (!row) throw new NotFoundException('Library member not found.');
    const activeLoanCount = row.loans.filter((loan) => ACTIVE_LOAN_STATUSES.includes(loan.status)).length;
    return { ...row, activeLoanCount };
  }

  async createMember(tenantId: string, userId: string, dto: CreateLibraryMemberDto) {
    if (!dto.studentId && !dto.userId && !dto.fullName) {
      throw new BadRequestException('Provide studentId/userId or fullName to create a member.');
    }
    let student: { id: string; fullName: string; email: string | null } | null = null;
    if (dto.studentId) {
      student = await this.db.student.findFirst({ where: { id: dto.studentId }, select: { id: true, fullName: true, email: true } });
      if (!student) throw new NotFoundException('Student not found.');
      const existing = await this.db.libraryMember.findFirst({ where: { studentId: dto.studentId } });
      if (existing) throw new ConflictException('A library member already exists for this student.');
    }
    let user: { id: string; fullName: string; email: string | null } | null = null;
    if (dto.userId) {
      user = await this.db.user.findFirst({ where: { id: dto.userId }, select: { id: true, fullName: true, email: true } });
      if (!user) throw new NotFoundException('User not found.');
    }
    if (dto.memberType === 'STUDENT' && !dto.studentId) {
      throw new BadRequestException('STUDENT members require a studentId.');
    }
    if ((dto.memberType === 'FACULTY' || dto.memberType === 'STAFF') && !dto.userId) {
      throw new BadRequestException(`${dto.memberType} members require a userId.`);
    }

    const fullName = dto.fullName ?? student?.fullName ?? user?.fullName ?? 'Unknown';
    const memberNumber = dto.memberNumber ?? (await nextLibrarySeriesNumber(this.db, tenantId, 'MEMBER', 'LM'));
    const row = await this.db.libraryMember.create({
      data: {
        tenant: { connect: { id: tenantId } },
        memberNumber,
        student: dto.studentId ? { connect: { id: dto.studentId } } : student ? { connect: { id: student.id } } : undefined,
        user: dto.userId ? { connect: { id: dto.userId } } : user ? { connect: { id: user.id } } : undefined,
        fullName,
        email: dto.email ?? student?.email ?? user?.email ?? null,
        phone: dto.phone,
        memberType: (dto.memberType ?? 'STUDENT') as any,
        maxLoans: dto.maxLoans,
        membershipStart: dto.membershipStart ? new Date(dto.membershipStart) : dto.studentId ? new Date() : null,
        membershipEnd: dto.membershipEnd ? new Date(dto.membershipEnd) : null,
        notes: dto.notes,
        createdBy: userId,
      },
    });
    await this.audit(tenantId, userId, AUDIT_ACTIONS.LIBRARY_MEMBER_CREATED, 'LibraryMember', row.id, { after: row });
    return row;
  }

  async updateMember(tenantId: string, userId: string, id: string, dto: UpdateLibraryMemberDto) {
    const before = await this.findMember(tenantId, id);
    const row = await this.db.libraryMember.update({
      where: { id },
      data: {
        fullName: dto.fullName ?? before.fullName,
        email: dto.email ?? before.email,
        phone: dto.phone ?? before.phone,
        memberType: (dto.memberType ?? before.memberType) as any,
        maxLoans: dto.maxLoans ?? before.maxLoans,
        membershipStart: dto.membershipStart ? new Date(dto.membershipStart) : before.membershipStart,
        membershipEnd: dto.membershipEnd ? new Date(dto.membershipEnd) : before.membershipEnd,
        notes: dto.notes ?? before.notes,
        updatedBy: userId,
      },
    });
    await this.audit(tenantId, userId, AUDIT_ACTIONS.LIBRARY_MEMBER_UPDATED, 'LibraryMember', id, { before, after: row });
    return row;
  }

  async setMemberStatus(tenantId: string, userId: string, id: string, dto: SetLibraryMemberStatusDto) {
    const before = await this.findMember(tenantId, id);
    if (dto.status === 'CLOSED') {
      const active = await this.db.studentLibraryLoan.count({ where: { memberId: id, status: { in: ACTIVE_LOAN_STATUSES as any } } });
      if (active) throw new BadRequestException('Member has active loans; return them before closing the membership.');
    }
    const row = await this.db.libraryMember.update({ where: { id }, data: { status: dto.status as any, updatedBy: userId } });
    await this.audit(tenantId, userId, AUDIT_ACTIONS.LIBRARY_MEMBER_UPDATED, 'LibraryMember', id, { before, after: row });
    return row;
  }

  async deleteMember(tenantId: string, userId: string, id: string) {
    const before = await this.findMember(tenantId, id);
    const active = await this.db.studentLibraryLoan.count({ where: { memberId: id, status: { in: ACTIVE_LOAN_STATUSES as any } } });
    if (active) throw new BadRequestException('Member has active loans; return them before archiving the membership.');
    const row = await this.db.libraryMember.update({ where: { id }, data: { deletedAt: new Date(), updatedBy: userId } });
    await this.audit(tenantId, userId, AUDIT_ACTIONS.LIBRARY_MEMBER_DELETED, 'LibraryMember', id, { before, after: row });
    return row;
  }

  private async findMember(tenantId: string, id: string) {
    const row = await this.db.libraryMember.findFirst({ where: { id, deletedAt: null } });
    if (!row) throw new NotFoundException('Library member not found.');
    return row;
  }

  // ── Circulation: loans ────────────────────────────────────────────────────

  async listLoans(tenantId: string, userId: string, query: ListLoansQueryDto) {
    const scope = await this.loanScope(tenantId, userId);
    const clauses: Prisma.StudentLibraryLoanWhereInput[] = [];
    if (scope) clauses.push(scope);
    if (query.status) clauses.push({ status: query.status as any });
    if (query.memberId) clauses.push({ memberId: query.memberId });
    if (query.copyId) clauses.push({ copyId: query.copyId });
    if (query.overdueOnly) {
      clauses.push({ status: { in: ACTIVE_LOAN_STATUSES as any }, dueDate: { lt: new Date() } });
    }
    if (query.search) {
      clauses.push({
        OR: [
          { itemTitle: { contains: query.search, mode: 'insensitive' } },
          { itemCode: { contains: query.search, mode: 'insensitive' } },
          { member: { OR: [{ fullName: { contains: query.search, mode: 'insensitive' } }, { memberNumber: { contains: query.search, mode: 'insensitive' } }] } },
        ],
      });
    }
    const where: Prisma.StudentLibraryLoanWhereInput = clauses.length ? { AND: clauses } : {};
    const [items, total] = await Promise.all([
      this.db.studentLibraryLoan.findMany({
        where,
        include: {
          member: { select: { id: true, fullName: true, memberNumber: true } },
          student: { select: { id: true, fullName: true, admissionNumber: true } },
          copy: { select: { id: true, barcode: true, accessionNumber: true, book: { select: { id: true, title: true } } } },
          fines: { select: { id: true, type: true, amountCents: true, paidCents: true, status: true } },
        },
        orderBy: { borrowedAt: 'desc' },
        skip: query.skip ?? 0,
        take: query.take ?? 20,
      }),
      this.db.studentLibraryLoan.count({ where }),
    ]);
    return { items, total };
  }

  async getLoan(tenantId: string, userId: string, id: string) {
    const scope = await this.loanScope(tenantId, userId);
    const row = await this.db.studentLibraryLoan.findFirst({
      where: { id, ...(scope ? { AND: [scope] } : {}) },
      include: {
        member: { select: { id: true, fullName: true, memberNumber: true } },
        student: { select: { id: true, fullName: true, admissionNumber: true } },
        copy: { select: { id: true, barcode: true, accessionNumber: true, condition: true, status: true, book: { select: { id: true, title: true, replacementCostCents: true } } } },
        fines: { select: { id: true, type: true, amountCents: true, paidCents: true, status: true, reason: true, paidAt: true, waivedAt: true } },
      },
    });
    if (!row) throw new NotFoundException('Library loan not found.');
    return row;
  }

  async issueLoan(tenantId: string, userId: string, dto: IssueLoanDto) {
    const member = await this.db.libraryMember.findFirst({
      where: { id: dto.memberId, deletedAt: null },
      include: { student: { select: { userId: true } }, user: { select: { id: true } } },
    });
    if (!member) throw new NotFoundException('Library member not found.');
    if (member.status !== 'ACTIVE') throw new BadRequestException(`Member is ${member.status}.`);

    const copy = await this.db.libraryCopy.findFirst({
      where: { id: dto.copyId },
      include: { book: { select: { id: true, title: true, maxLoanDays: true } } },
    });
    if (!copy) throw new NotFoundException('Library copy not found.');
    if (copy.status !== 'AVAILABLE') throw new BadRequestException(`Copy is ${copy.status} and cannot be issued.`);

    const config = await this.ensureConfig(tenantId);
    const activeCount = await this.db.studentLibraryLoan.count({ where: { memberId: member.id, status: { in: ACTIVE_LOAN_STATUSES as any } } });
    const cap = member.maxLoans ?? config.maxLoansPerMember;
    if (activeCount >= cap) throw new BadRequestException(`Member already holds ${activeCount} active loan(s) (limit ${cap}).`);

    const borrowedAt = new Date();
    const dueDate = dto.dueDate ? new Date(dto.dueDate) : addDays(borrowedAt, copy.book.maxLoanDays ?? config.defaultLoanDays);
    const book = copy.book;

    const row = await this.db.$transaction(async (tx) => {
      const loanData: Prisma.StudentLibraryLoanCreateInput = {
        tenant: { connect: { id: tenantId } },
        member: { connect: { id: member.id } },
        copy: { connect: { id: copy.id } },
        itemTitle: book.title,
        itemCode: copy.barcode,
        itemType: 'BOOK',
        borrowedAt,
        dueDate,
        createdBy: userId,
      };
      if (member.studentId) loanData.student = { connect: { id: member.studentId } };
      const created = await tx.studentLibraryLoan.create({ data: loanData });
      await tx.libraryCopy.update({ where: { id: copy.id }, data: { status: 'ISSUED', updatedBy: userId } });
      await tx.libraryTransaction.create({
        data: { tenant: { connect: { id: tenantId } }, copy: { connect: { id: copy.id } }, loan: { connect: { id: created.id } }, member: { connect: { id: member.id } }, type: 'ISSUED', actorUserId: userId },
      });
      // Fulfil a matching waiting/ready reservation on issue.
      const reservation = await tx.libraryReservation.findFirst({
        where: { bookId: book.id, memberId: member.id, status: { in: ['WAITING', 'READY'] } },
        orderBy: { reservedAt: 'asc' },
      });
      if (reservation) {
        await tx.libraryReservation.update({ where: { id: reservation.id }, data: { status: 'FULFILLED', fulfilledAt: new Date() } });
        await tx.libraryTransaction.create({
          data: { tenant: { connect: { id: tenantId } }, copy: { connect: { id: copy.id } }, loan: { connect: { id: created.id } }, member: { connect: { id: member.id } }, type: 'FULFILLED', actorUserId: userId },
        });
      }
      return created;
    });

    await this.audit(tenantId, userId, AUDIT_ACTIONS.STUDENT_LIBRARY_LOAN_ISSUED, 'StudentLibraryLoan', row.id, {
      after: { memberId: member.id, copyId: copy.id, dueDate: dueDate.toISOString() },
    });
    await this.notifyMember(tenantId, member, 'Library loan issued', `"${book.title}" (${copy.barcode}) due on ${dueDate.toISOString().slice(0, 10)}.`);
    return this.getLoan(tenantId, userId, row.id);
  }

  async renewLoan(tenantId: string, userId: string, id: string, dto: RenewLoanDto) {
    const scope = await this.loanScope(tenantId, userId);
    const loan = await this.db.studentLibraryLoan.findFirst({
      where: { id, status: { in: ACTIVE_LOAN_STATUSES as any }, ...(scope ? { AND: [scope] } : {}) },
      include: { member: { include: { student: { select: { userId: true } }, user: { select: { id: true } } } } },
    });
    if (!loan) throw new NotFoundException('Active library loan not found.');
    const config = await this.ensureConfig(tenantId);
    if (loan.renewalCount >= config.renewalLimit) throw new BadRequestException(`Renewal limit (${config.renewalLimit}) reached.`);

    const base = loan.dueDate ?? loan.borrowedAt;
    const newDueDate = addDays(base, dto.days ?? config.defaultLoanDays);
    const row = await this.db.$transaction(async (tx) => {
      const updated = await tx.studentLibraryLoan.update({
        where: { id },
        data: { dueDate: newDueDate, renewalCount: { increment: 1 }, lastRenewedAt: new Date(), updatedBy: userId },
      });
      await tx.libraryTransaction.create({
        data: { tenant: { connect: { id: tenantId } }, copy: { connect: { id: loan.copyId as string } }, loan: { connect: { id } }, member: { connect: { id: loan.memberId as string } }, type: 'RENEWED', actorUserId: userId, metadata: { newDueDate: newDueDate.toISOString() } },
      });
      return updated;
    });
    await this.audit(tenantId, userId, AUDIT_ACTIONS.LIBRARY_LOAN_RENEWED, 'StudentLibraryLoan', id, {
      before: { dueDate: base.toISOString(), renewalCount: loan.renewalCount },
      after: row,
    });
    if (loan.member) {
      await this.notifyMember(tenantId, loan.member, 'Library loan renewed', `Loan now due on ${newDueDate.toISOString().slice(0, 10)}.`);
    }
    return this.getLoan(tenantId, userId, id);
  }

  async returnLoan(tenantId: string, userId: string, id: string, dto: ReturnLoanDto) {
    const scope = await this.loanScope(tenantId, userId);
    const loan = await this.db.studentLibraryLoan.findFirst({
      where: { id, ...(scope ? { AND: [scope] } : {}) },
      include: {
        copy: { select: { id: true, status: true, condition: true, book: { select: { replacementCostCents: true, title: true } } } },
        member: { include: { student: { select: { userId: true } }, user: { select: { id: true } } } },
      },
    });
    if (!loan) throw new NotFoundException('Library loan not found.');
    if (loan.status === 'RETURNED') throw new BadRequestException('Loan is already returned.');

    const returnedAt = dto.returnedAt ? new Date(dto.returnedAt) : new Date();
    const config = await this.ensureConfig(tenantId);
    const isDamaged = dto.condition === 'DAMAGED' || dto.condition === 'POOR';

    const row = await this.db.$transaction(async (tx) => {
      // Finalize the overdue fine (upsert recomputes the running amount at the return moment).
      let overdueFine: { id: string; amountCents: number } | null = null;
      if (loan.memberId && loan.dueDate && returnedAt.getTime() > loan.dueDate.getTime() && config.overdueFinePerDayCents > 0) {
        overdueFine = await this.syncOverdueFine(tx, tenantId, { id: loan.id, memberId: loan.memberId, dueDate: loan.dueDate }, config.overdueFinePerDayCents, returnedAt);
      }

      if (loan.memberId && isDamaged && loan.copy && loan.copy.book.replacementCostCents) {
        await tx.libraryFine.create({
          data: {
            tenant: { connect: { id: tenantId } },
            loan: { connect: { id: loan.id } },
            member: { connect: { id: loan.memberId } },
            type: 'DAMAGE',
            amountCents: loan.copy.book.replacementCostCents,
            reason: `Copy returned ${dto.condition}`,
          },
        });
      }

      const updated = await tx.studentLibraryLoan.update({
        where: { id },
        data: {
          status: 'RETURNED',
          returnedAt,
          returnCondition: dto.condition ?? null,
          returnedById: userId,
          fineCents: (overdueFine?.amountCents ?? 0) + (isDamaged && loan.copy?.book.replacementCostCents ? loan.copy.book.replacementCostCents : 0),
          remarks: dto.remarks ?? loan.remarks,
          updatedBy: userId,
        },
      });

      if (loan.copy) {
        const copyData: { status: any; condition?: any; updatedBy: string } = {
          status: 'AVAILABLE',
          updatedBy: userId,
        };
        if (dto.condition) {
          const matches = ['NEW', 'GOOD', 'FAIR', 'POOR', 'DAMAGED'].includes(dto.condition);
          if (matches) copyData.condition = dto.condition;
        }
        if (isDamaged) copyData.status = 'DAMAGED';
        await tx.libraryCopy.update({ where: { id: loan.copy.id }, data: copyData });
        await tx.libraryTransaction.create({
          data: { tenant: { connect: { id: tenantId } }, copy: { connect: { id: loan.copy.id } }, loan: { connect: { id } }, member: loan.memberId ? { connect: { id: loan.memberId } } : undefined, type: isDamaged ? 'DAMAGED' : 'RETURNED', actorUserId: userId, notes: dto.condition },
        });
      }

      return { loan: updated };
    });

    await this.audit(tenantId, userId, AUDIT_ACTIONS.STUDENT_LIBRARY_LOAN_RETURNED, 'StudentLibraryLoan', id, {
      before: { status: loan.status },
      after: { status: 'RETURNED', condition: dto.condition ?? null, fineCents: row.loan.fineCents },
    });
    if (loan.member) {
      await this.notifyMember(tenantId, loan.member, 'Library loan returned', `Copy ${loan.copy?.book.title ?? 'item'} returned.`);
    }
    return row.loan;
  }

  async markLoanLost(tenantId: string, userId: string, id: string, dto: MarkLoanLostDto) {
    const scope = await this.loanScope(tenantId, userId);
    const loan = await this.db.studentLibraryLoan.findFirst({
      where: { id, status: { in: ACTIVE_LOAN_STATUSES as any }, ...(scope ? { AND: [scope] } : {}) },
      include: {
        copy: { select: { id: true, status: true, book: { select: { title: true, replacementCostCents: true } } } },
        member: { include: { student: { select: { userId: true } }, user: { select: { id: true } } } },
      },
    });
    if (!loan) throw new NotFoundException('Active library loan not found.');
    if (!loan.copy) throw new BadRequestException('Legacy quick loans cannot be marked lost here.');

    const replacementCents = loan.copy.book.replacementCostCents ?? 0;
    const row = await this.db.$transaction(async (tx) => {
      const updated = await tx.studentLibraryLoan.update({
        where: { id },
        data: { status: 'LOST', remarks: dto.remarks ?? loan.remarks, returnedAt: new Date(), updatedBy: userId },
      });
      await tx.libraryCopy.update({ where: { id: loan.copy!.id }, data: { status: 'LOST', updatedBy: userId } });
      if (replacementCents > 0) {
        await tx.libraryFine.create({
          data: {
            tenant: { connect: { id: tenantId } },
            loan: { connect: { id } },
            member: { connect: { id: loan.memberId as string } },
            type: 'LOST',
            amountCents: replacementCents,
            reason: dto.remarks ?? `Copy marked lost (${loan.copy!.book.title})`,
          },
        });
      }
      await tx.libraryTransaction.create({
        data: { tenant: { connect: { id: tenantId } }, copy: { connect: { id: loan.copy!.id } }, loan: { connect: { id } }, member: loan.memberId ? { connect: { id: loan.memberId } } : undefined, type: 'LOST', actorUserId: userId, notes: dto.remarks },
      });
      return updated;
    });
    await this.audit(tenantId, userId, AUDIT_ACTIONS.LIBRARY_LOAN_MARKED_LOST, 'StudentLibraryLoan', id, { before: { status: loan.status }, after: row });
    if (loan.member) {
      await this.notifyMember(tenantId, loan.member, 'Loan marked lost', `Copy of "${loan.copy.book.title}" was marked lost${replacementCents ? ` — ${replacementCents / 100} replacement fine assessed` : ''}.`);
    }
    return row;
  }

  /** Flags loans past their due date as OVERDUE and maintains their running overdue fine. */
  async sweepOverdue(tenantId: string, userId: string) {
    const config = await this.ensureConfig(tenantId);
    const now = new Date();
    const overdue = await this.db.studentLibraryLoan.findMany({
      where: { status: { in: ACTIVE_LOAN_STATUSES as any }, dueDate: { lt: now } },
      select: { id: true, memberId: true, dueDate: true },
    });
    let swept = 0;
    for (const loan of overdue) {
      swept += await this.db.$transaction(async (tx) => {
        await tx.studentLibraryLoan.update({ where: { id: loan.id }, data: { status: 'OVERDUE' } });
        if (loan.memberId && config.overdueFinePerDayCents > 0) {
          await this.syncOverdueFine(tx, tenantId, { id: loan.id, memberId: loan.memberId, dueDate: loan.dueDate }, config.overdueFinePerDayCents, now);
        }
        return 1;
      });
    }
    await this.audit(tenantId, userId, AUDIT_ACTIONS.LIBRARY_FINE_ASSESSED, 'StudentLibraryLoan', undefined, { after: { swept, at: now.toISOString() } });
    return { swept, at: now.toISOString() };
  }

  // ── Reservations ──────────────────────────────────────────────────────────

  async listReservations(tenantId: string, userId: string, query: ListReservationsQueryDto) {
    const scope = await this.reservationScope(tenantId, userId);
    const where: Prisma.LibraryReservationWhereInput = {
      ...(scope ? { AND: [scope] } : {}),
      ...(query.status ? { status: query.status as any } : {}),
      ...(query.memberId ? { memberId: query.memberId } : {}),
      ...(query.bookId ? { bookId: query.bookId } : {}),
    };
    const [items, total] = await Promise.all([
      this.db.libraryReservation.findMany({
        where,
        include: {
          book: { select: { id: true, title: true } },
          copy: { select: { id: true, barcode: true } },
          member: { select: { id: true, fullName: true, memberNumber: true } },
        },
        orderBy: { reservedAt: 'desc' },
        skip: query.skip ?? 0,
        take: query.take ?? 20,
      }),
      this.db.libraryReservation.count({ where }),
    ]);
    return { items, total };
  }

  async createReservation(tenantId: string, userId: string, dto: CreateReservationDto) {
    const member = await this.db.libraryMember.findFirst({
      where: { id: dto.memberId, deletedAt: null },
      include: { student: { select: { userId: true } }, user: { select: { id: true } } },
    });
    if (!member) throw new NotFoundException('Library member not found.');
    if (member.status !== 'ACTIVE') throw new BadRequestException(`Member is ${member.status}.`);
    const book = await this.db.libraryBook.findFirst({ where: { id: dto.bookId, deletedAt: null }, select: { id: true, title: true } });
    if (!book) throw new NotFoundException('Library book not found.');

    const existing = await this.db.libraryReservation.findFirst({
      where: { memberId: member.id, bookId: book.id, status: { in: ['WAITING', 'READY'] } },
    });
    if (existing) throw new ConflictException('Member already has an active reservation for this book.');

    const config = await this.ensureConfig(tenantId);
    // If a copy is free right now, the reservation is immediately ready for pickup.
    const availableCopy = await this.db.libraryCopy.findFirst({
      where: { bookId: book.id, status: 'AVAILABLE' },
      select: { id: true },
      orderBy: { accessionNumber: 'asc' },
    });

    const row = await this.db.$transaction(async (tx) => {
      const reservation = await tx.libraryReservation.create({
        data: {
          tenant: { connect: { id: tenantId } },
          book: { connect: { id: book.id } },
          member: { connect: { id: member.id } },
          copy: availableCopy ? { connect: { id: availableCopy.id } } : undefined,
          status: availableCopy ? ('READY' as any) : ('WAITING' as any),
          holdUntil: availableCopy ? addDays(new Date(), config.reservationHoldDays) : null,
          notes: dto.notes,
          createdBy: userId,
        },
      });
      if (availableCopy) {
        await tx.libraryCopy.update({ where: { id: availableCopy.id }, data: { status: 'RESERVED', updatedBy: userId } });
        await tx.libraryTransaction.create({
          data: { tenant: { connect: { id: tenantId } }, copy: { connect: { id: availableCopy.id } }, member: { connect: { id: member.id } }, type: 'READY', actorUserId: userId, notes: `Held for ${member.fullName}` },
        });
        await tx.libraryTransaction.create({
          data: { tenant: { connect: { id: tenantId } }, copy: { connect: { id: availableCopy.id } }, member: { connect: { id: member.id } }, type: 'RESERVED', actorUserId: userId, metadata: { bookId: book.id, status: 'READY' } },
        });
      }
      return reservation;
    });

    await this.audit(tenantId, userId, AUDIT_ACTIONS.LIBRARY_RESERVATION_CREATED, 'LibraryReservation', row.id, {
      after: { bookId: book.id, status: row.status, copyId: row.copyId ?? null },
    });
    await this.notifyMember(
      tenantId,
      member,
      'Reservation ready',
      availableCopy
        ? `"${book.title}" is on hold for you — pick it up within ${config.reservationHoldDays} day(s).`
        : `You are next in line for "${book.title}".`,
    );
    return row;
  }

  async cancelReservation(tenantId: string, userId: string, id: string, dto: CancelReservationDto) {
    const reservation = await this.db.libraryReservation.findFirst({ where: { id } });
    if (!reservation) throw new NotFoundException('Reservation not found.');
    if (reservation.status === 'FULFILLED' || reservation.status === 'CANCELLED' || reservation.status === 'EXPIRED') {
      throw new BadRequestException(`Reservation is already ${reservation.status.toLowerCase()}.`);
    }
    const row = await this.db.$transaction(async (tx) => {
      const updated = await tx.libraryReservation.update({
        where: { id },
        data: { status: 'CANCELLED', cancelledBy: userId, cancelledAt: new Date(), notes: dto.notes ?? reservation.notes },
      });
      if (reservation.copyId) {
        await tx.libraryCopy.update({ where: { id: reservation.copyId }, data: { status: 'AVAILABLE', updatedBy: userId } });
        await tx.libraryTransaction.create({
          data: { tenant: { connect: { id: tenantId } }, copy: { connect: { id: reservation.copyId } }, member: { connect: { id: reservation.memberId } }, type: 'CANCELLED', actorUserId: userId },
        });
      }
      return updated;
    });
    await this.audit(tenantId, userId, AUDIT_ACTIONS.LIBRARY_RESERVATION_CANCELLED, 'LibraryReservation', id, {
      before: { status: reservation.status },
      after: row,
    });
    return row;
  }

  async assignReservationCopy(tenantId: string, userId: string, id: string, dto: AssignReservationCopyDto) {
    const reservation = await this.db.libraryReservation.findFirst({ where: { id } });
    if (!reservation) throw new NotFoundException('Reservation not found.');
    if (reservation.status !== 'WAITING') throw new BadRequestException('Only WAITING reservations can be assigned a copy.');

    const copy = await this.db.libraryCopy.findFirst({ where: { id: dto.copyId, bookId: reservation.bookId } });
    if (!copy) throw new NotFoundException('Copy not found for this book.');
    if (copy.status !== 'AVAILABLE') throw new BadRequestException(`Copy is ${copy.status}.`);

    const config = await this.ensureConfig(tenantId);
    const row = await this.db.$transaction(async (tx) => {
      const updated = await tx.libraryReservation.update({
        where: { id },
        data: { copyId: copy.id, status: 'READY', holdUntil: addDays(new Date(), config.reservationHoldDays) },
      });
      await tx.libraryCopy.update({ where: { id: copy.id }, data: { status: 'RESERVED', updatedBy: userId } });
      await tx.libraryTransaction.create({
        data: { tenant: { connect: { id: tenantId } }, copy: { connect: { id: copy.id } }, member: { connect: { id: reservation.memberId } }, type: 'READY', actorUserId: userId },
      });
      return updated;
    });
    await this.audit(tenantId, userId, AUDIT_ACTIONS.LIBRARY_RESERVATION_CREATED, 'LibraryReservation', id, { after: row });
    return row;
  }

  async expireReservations(tenantId: string, userId: string) {
    const expired = await this.db.libraryReservation.findMany({
      where: { status: 'READY', holdUntil: { lt: new Date() } },
      select: { id: true, copyId: true, memberId: true },
    });
    for (const reservation of expired) {
      await this.db.$transaction(async (tx) => {
        await tx.libraryReservation.update({ where: { id: reservation.id }, data: { status: 'EXPIRED' } });
        if (reservation.copyId) {
          await tx.libraryCopy.update({ where: { id: reservation.copyId }, data: { status: 'AVAILABLE' } });
          await tx.libraryTransaction.create({
            data: { tenant: { connect: { id: tenantId } }, copy: { connect: { id: reservation.copyId } }, member: { connect: { id: reservation.memberId } }, type: 'CANCELLED', actorUserId: userId, notes: 'Hold expired' },
          });
        }
      });
    }
    await this.audit(tenantId, userId, AUDIT_ACTIONS.LIBRARY_RESERVATION_CANCELLED, 'LibraryReservation', undefined, {
      after: { expired: expired.length, at: new Date().toISOString() },
    });
    return { expired: expired.length, at: new Date().toISOString() };
  }

  // ── Fines ─────────────────────────────────────────────────────────────────

  async listFines(tenantId: string, userId: string, query: ListFinesQueryDto) {
    const scope = await this.fineScope(tenantId, userId);
    const where: Prisma.LibraryFineWhereInput = {
      ...(scope ? { AND: [scope] } : {}),
      ...(query.status ? { status: query.status as any } : {}),
      ...(query.type ? { type: query.type as any } : {}),
      ...(query.memberId ? { memberId: query.memberId } : {}),
    };
    const [items, total] = await Promise.all([
      this.db.libraryFine.findMany({
        where,
        include: {
          member: { select: { id: true, fullName: true, memberNumber: true } },
          loan: {
            select: { id: true, itemTitle: true, itemCode: true, copy: { select: { barcode: true, book: { select: { title: true } } } } },
          },
        },
        orderBy: { createdAt: 'desc' },
        skip: query.skip ?? 0,
        take: query.take ?? 20,
      }),
      this.db.libraryFine.count({ where }),
    ]);
    return { items, total };
  }

  async payFine(tenantId: string, userId: string, id: string, dto: PayFineDto) {
    const scope = await this.fineScope(tenantId, userId);
    const fine = await this.db.libraryFine.findFirst({ where: { id, ...(scope ? { AND: [scope] } : {}) } });
    if (!fine) throw new NotFoundException('Fine not found.');
    if (fine.status !== 'PENDING') throw new BadRequestException(`Fine is already ${fine.status.toLowerCase()}.`);

    const amount = dto.amountCents ?? fine.amountCents - fine.paidCents;
    const newPaid = fine.paidCents + amount;
    if (newPaid > fine.amountCents) throw new BadRequestException('Payment exceeds the fine balance.');

    const row = await this.db.libraryFine.update({
      where: { id },
      data: {
        paidCents: newPaid,
        status: newPaid >= fine.amountCents ? 'PAID' : 'PENDING',
        paidAt: newPaid >= fine.amountCents ? new Date() : fine.paidAt,
        paidByUserId: userId,
      },
    });
    await this.audit(tenantId, userId, AUDIT_ACTIONS.LIBRARY_FINE_PAID, 'LibraryFine', id, {
      before: { paidCents: fine.paidCents, status: fine.status },
      after: row,
    });
    return row;
  }

  async waiveFine(tenantId: string, userId: string, id: string, dto: WaiveFineDto) {
    const scope = await this.fineScope(tenantId, userId);
    const fine = await this.db.libraryFine.findFirst({ where: { id, ...(scope ? { AND: [scope] } : {}) } });
    if (!fine) throw new NotFoundException('Fine not found.');
    if (fine.status !== 'PENDING') throw new BadRequestException(`Fine is already ${fine.status.toLowerCase()}.`);

    const row = await this.db.libraryFine.update({
      where: { id },
      data: { status: 'WAIVED', waivedAt: new Date(), waivedByUserId: userId, reason: dto.reason ?? fine.reason },
    });
    await this.audit(tenantId, userId, AUDIT_ACTIONS.LIBRARY_FINE_WAIVED, 'LibraryFine', id, { before: fine, after: row });
    return row;
  }

  // ── Reports ───────────────────────────────────────────────────────────────

  async summary(_tenantId: string) {
    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);
    const now = new Date();

    const [
      totalBooks,
      totalCopies,
      availableCopies,
      reservedCopies,
      damagedCopies,
      lostCopies,
      withdrawnCopies,
      activeLoans,
      overdueLoans,
      activeMembers,
      pendingFinesAgg,
      waitingReservations,
      todayIssued,
      todayReturned,
    ] = await Promise.all([
      this.db.libraryBook.count({ where: { deletedAt: null } }),
      this.db.libraryCopy.count(),
      this.db.libraryCopy.count({ where: { status: 'AVAILABLE' } }),
      this.db.libraryCopy.count({ where: { status: 'RESERVED' } }),
      this.db.libraryCopy.count({ where: { status: 'DAMAGED' } }),
      this.db.libraryCopy.count({ where: { status: 'LOST' } }),
      this.db.libraryCopy.count({ where: { status: 'WITHDRAWN' } }),
      this.db.studentLibraryLoan.count({ where: { status: { in: ACTIVE_LOAN_STATUSES as any } } }),
      this.db.studentLibraryLoan.count({ where: { status: { in: ACTIVE_LOAN_STATUSES as any }, dueDate: { lt: now } } }),
      this.db.libraryMember.count({ where: { status: 'ACTIVE', deletedAt: null } }),
      this.db.libraryFine.aggregate({ where: { status: 'PENDING' }, _sum: { amountCents: true, paidCents: true } }),
      this.db.libraryReservation.count({ where: { status: { in: ['WAITING', 'READY'] } } }),
      this.db.studentLibraryLoan.count({ where: { borrowedAt: { gte: startOfToday } } }),
      this.db.studentLibraryLoan.count({ where: { returnedAt: { gte: startOfToday } } }),
    ]);

    const pendingFinesCents = Math.max(0, (pendingFinesAgg._sum.amountCents ?? 0) - (pendingFinesAgg._sum.paidCents ?? 0));
    return {
      totalBooks,
      totalCopies,
      availableCopies,
      reservedCopies,
      damagedCopies,
      lostCopies,
      withdrawnCopies,
      issuedCopies: activeLoans,
      overdueLoans,
      activeMembers,
      pendingFinesCents,
      waitingReservations,
      todayIssued,
      todayReturned,
    };
  }

  async circulationReport(tenantId: string, dto: CirculationReportDto) {
    const days = dto.days ?? 30;
    const limit = dto.limit ?? 10;
    const since = addDays(new Date(), -days);
    const grouped = await this.db.studentLibraryLoan.groupBy({
      by: ['copyId'],
      where: { copyId: { not: null }, borrowedAt: { gte: since } },
      _count: { _all: true },
      orderBy: { _count: { copyId: 'desc' } },
      take: limit * 3,
    });
    const copyIds = grouped.map((g) => g.copyId as string);
    const copies = copyIds.length
      ? await this.db.libraryCopy.findMany({
          where: { id: { in: copyIds } },
          select: { id: true, book: { select: { id: true, title: true } } },
        })
      : [];
    const byBook = new Map<string, { bookId: string; title: string; issues: number }>();
    for (const g of grouped) {
      const copy = copies.find((c) => c.id === g.copyId);
      const key = copy?.book.id ?? 'unknown';
      const entry = byBook.get(key) ?? { bookId: key, title: copy?.book.title ?? 'Legacy copy', issues: 0 };
      entry.issues += g._count._all;
      byBook.set(key, entry);
    }
    const totalIssued = grouped.reduce((n, g) => n + g._count._all, 0);
    return { days, totalIssued, topBooks: [...byBook.values()].sort((a, b) => b.issues - a.issues).slice(0, limit) };
  }

  async inventoryReport(_tenantId: string) {
    const byStatusRaw = await this.db.libraryCopy.groupBy({ by: ['status'], _count: { _all: true } });
    const byStatus = Object.fromEntries(byStatusRaw.map((r) => [r.status, r._count._all]));
    const grouped = await this.db.libraryCopy.groupBy({
      by: ['bookId'],
      _count: { _all: true },
      orderBy: { _count: { bookId: 'asc' } },
    });
    const bookIds = grouped.map((g) => g.bookId);
    const books = bookIds.length
      ? await this.db.libraryBook.findMany({
          where: { id: { in: bookIds }, deletedAt: null },
          select: { id: true, title: true, category: { select: { id: true, name: true } } },
        })
      : [];
    const bookMap = new Map(books.map((b) => [b.id, b]));
    const byCategory = new Map<string, { categoryId: string; categoryName: string; books: number; copies: number }>();
    for (const g of grouped) {
      const book = bookMap.get(g.bookId);
      const key = book?.category.id ?? 'uncategorized';
      const entry = byCategory.get(key) ?? {
        categoryId: key,
        categoryName: book?.category.name ?? 'Uncategorized',
        books: 0,
        copies: 0,
      };
      entry.books += book ? 1 : 0;
      entry.copies += g._count._all;
      byCategory.set(key, entry);
    }
    return { byStatus, byCategory: [...byCategory.values()].sort((a, b) => b.copies - a.copies) };
  }
}