/**
 * Library controller — catalog (categories/publishers/authors/books), copies with barcode/QR
 * and inventory history, members, circulation (issue/renew/return/mark-lost + sweeps),
 * reservations, fines, config, lookups and reports. Guards follow the feature-module
 * convention; static sub-routes are declared before parameter routes so NestJS never treats
 * 'lookups'/'sweep'/'summary' etc. as an :id.
 */
import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { FEATURE_KEYS, PERMISSION_KEYS as K, type AuthenticatedUser } from '@college-erp/auth';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequireFeature } from '../../common/decorators/require-feature.decorator';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { FeatureFlagsGuard } from '../../common/guards/feature-flag.guard';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { TenantMatchGuard } from '../../common/guards/tenant-match.guard';
import { TenantContextService } from '../../common/prisma/tenant-context.service';
import { LibraryService } from './library.service';
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

@ApiTags('library')
@Controller('library')
@UseGuards(JwtAuthGuard, TenantMatchGuard, PermissionsGuard, FeatureFlagsGuard)
@RequireFeature(FEATURE_KEYS.LIBRARY)
export class LibraryController {
  constructor(
    private readonly libraryService: LibraryService,
    private readonly tenantContext: TenantContextService,
  ) {}

  private tid(): string {
    return this.tenantContext.tenantId as string;
  }

  // ── Lookups & config ──────────────────────────────────────────────────────

  @Get('lookups')
  @RequirePermission(K.LIBRARY_VIEW)
  lookups() {
    return this.libraryService.lookups(this.tid());
  }

  @Get('config')
  @RequirePermission(K.LIBRARY_VIEW)
  getConfig() {
    return this.libraryService.getConfig(this.tid());
  }

  @Put('config')
  @RequirePermission(K.LIBRARY_MANAGE)
  updateConfig(@Body() dto: UpdateLibraryConfigDto, @CurrentUser() user: AuthenticatedUser) {
    return this.libraryService.updateConfig(this.tid(), user.id, dto);
  }

  // ── Categories ────────────────────────────────────────────────────────────

  @Get('categories')
  @RequirePermission(K.LIBRARY_VIEW)
  listCategories() {
    return this.libraryService.listCategories(this.tid());
  }

  @Post('categories')
  @RequirePermission(K.LIBRARY_CREATE)
  createCategory(@Body() dto: CreateLibraryCategoryDto, @CurrentUser() user: AuthenticatedUser) {
    return this.libraryService.createCategory(this.tid(), user.id, dto);
  }

  @Patch('categories/:id')
  @RequirePermission(K.LIBRARY_UPDATE)
  updateCategory(@Param('id') id: string, @Body() dto: UpdateLibraryCategoryDto, @CurrentUser() user: AuthenticatedUser) {
    return this.libraryService.updateCategory(this.tid(), user.id, id, dto);
  }

  @Delete('categories/:id')
  @RequirePermission(K.LIBRARY_DELETE)
  deleteCategory(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.libraryService.deleteCategory(this.tid(), user.id, id);
  }

  // ── Publishers ────────────────────────────────────────────────────────────

  @Get('publishers')
  @RequirePermission(K.LIBRARY_VIEW)
  listPublishers() {
    return this.libraryService.listPublishers(this.tid());
  }

  @Post('publishers')
  @RequirePermission(K.LIBRARY_CREATE)
  createPublisher(@Body() dto: CreateLibraryPublisherDto, @CurrentUser() user: AuthenticatedUser) {
    return this.libraryService.createPublisher(this.tid(), user.id, dto);
  }

  @Patch('publishers/:id')
  @RequirePermission(K.LIBRARY_UPDATE)
  updatePublisher(@Param('id') id: string, @Body() dto: UpdateLibraryPublisherDto, @CurrentUser() user: AuthenticatedUser) {
    return this.libraryService.updatePublisher(this.tid(), user.id, id, dto);
  }

  @Delete('publishers/:id')
  @RequirePermission(K.LIBRARY_DELETE)
  deletePublisher(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.libraryService.deletePublisher(this.tid(), user.id, id);
  }

  // ── Authors ───────────────────────────────────────────────────────────────

  @Get('authors')
  @RequirePermission(K.LIBRARY_VIEW)
  listAuthors() {
    return this.libraryService.listAuthors(this.tid());
  }

  @Post('authors')
  @RequirePermission(K.LIBRARY_CREATE)
  createAuthor(@Body() dto: CreateLibraryAuthorDto, @CurrentUser() user: AuthenticatedUser) {
    return this.libraryService.createAuthor(this.tid(), user.id, dto);
  }

  @Patch('authors/:id')
  @RequirePermission(K.LIBRARY_UPDATE)
  updateAuthor(@Param('id') id: string, @Body() dto: UpdateLibraryAuthorDto, @CurrentUser() user: AuthenticatedUser) {
    return this.libraryService.updateAuthor(this.tid(), user.id, id, dto);
  }

  @Delete('authors/:id')
  @RequirePermission(K.LIBRARY_DELETE)
  deleteAuthor(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.libraryService.deleteAuthor(this.tid(), user.id, id);
  }

  // ── Books ─────────────────────────────────────────────────────────────────

  @Get('books')
  @RequirePermission(K.LIBRARY_VIEW)
  listBooks(@Query() query: ListBooksQueryDto) {
    return this.libraryService.listBooks(this.tid(), query);
  }

  @Post('books')
  @RequirePermission(K.LIBRARY_CREATE)
  createBook(@Body() dto: CreateLibraryBookDto, @CurrentUser() user: AuthenticatedUser) {
    return this.libraryService.createBook(this.tid(), user.id, dto);
  }

  @Get('books/:id')
  @RequirePermission(K.LIBRARY_VIEW)
  getBook(@Param('id') id: string) {
    return this.libraryService.getBook(this.tid(), id);
  }

  @Patch('books/:id')
  @RequirePermission(K.LIBRARY_UPDATE)
  updateBook(@Param('id') id: string, @Body() dto: UpdateLibraryBookDto, @CurrentUser() user: AuthenticatedUser) {
    return this.libraryService.updateBook(this.tid(), user.id, id, dto);
  }

  @Delete('books/:id')
  @RequirePermission(K.LIBRARY_DELETE)
  deleteBook(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.libraryService.deleteBook(this.tid(), user.id, id);
  }

  // ── Copies ────────────────────────────────────────────────────────────────

  @Get('copies')
  @RequirePermission(K.LIBRARY_VIEW)
  listCopies(@Query() query: ListCopiesQueryDto) {
    return this.libraryService.listCopies(this.tid(), query);
  }

  @Post('books/:bookId/copies')
  @RequirePermission(K.LIBRARY_CREATE)
  addCopies(@Param('bookId') bookId: string, @Body() dto: AddLibraryCopiesDto, @CurrentUser() user: AuthenticatedUser) {
    return this.libraryService.addCopies(this.tid(), user.id, bookId, dto);
  }

  @Get('copies/:id')
  @RequirePermission(K.LIBRARY_VIEW)
  getCopy(@Param('id') id: string) {
    return this.libraryService.getCopy(this.tid(), id);
  }

  @Patch('copies/:id')
  @RequirePermission(K.LIBRARY_UPDATE)
  updateCopy(@Param('id') id: string, @Body() dto: UpdateLibraryCopyDto, @CurrentUser() user: AuthenticatedUser) {
    return this.libraryService.updateCopy(this.tid(), user.id, id, dto);
  }

  @Post('copies/:id/status')
  @RequirePermission(K.LIBRARY_UPDATE)
  setCopyStatus(@Param('id') id: string, @Body() dto: SetLibraryCopyStatusDto, @CurrentUser() user: AuthenticatedUser) {
    return this.libraryService.setCopyStatus(this.tid(), user.id, id, dto);
  }

  @Get('copies/:id/barcode')
  @RequirePermission(K.LIBRARY_VIEW)
  copyBarcode(@Param('id') id: string) {
    return this.libraryService.getCopyBarcode(this.tid(), id);
  }

  @Get('copies/:id/transactions')
  @RequirePermission(K.LIBRARY_VIEW)
  copyTransactions(@Param('id') id: string, @Query() query: ListTransactionsQueryDto) {
    return this.libraryService.listTransactions(this.tid(), { ...query, copyId: id });
  }

  // ── Members ───────────────────────────────────────────────────────────────

  @Get('members')
  @RequirePermission(K.LIBRARY_VIEW)
  listMembers(@Query() query: ListMembersQueryDto, @CurrentUser() user: AuthenticatedUser) {
    return this.libraryService.listMembers(this.tid(), user.id, query);
  }

  @Post('members')
  @RequirePermission(K.LIBRARY_CREATE)
  createMember(@Body() dto: CreateLibraryMemberDto, @CurrentUser() user: AuthenticatedUser) {
    return this.libraryService.createMember(this.tid(), user.id, dto);
  }

  @Get('members/:id')
  @RequirePermission(K.LIBRARY_VIEW)
  getMember(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.libraryService.getMember(this.tid(), user.id, id);
  }

  @Patch('members/:id')
  @RequirePermission(K.LIBRARY_UPDATE)
  updateMember(@Param('id') id: string, @Body() dto: UpdateLibraryMemberDto, @CurrentUser() user: AuthenticatedUser) {
    return this.libraryService.updateMember(this.tid(), user.id, id, dto);
  }

  @Post('members/:id/status')
  @RequirePermission(K.LIBRARY_UPDATE)
  setMemberStatus(@Param('id') id: string, @Body() dto: SetLibraryMemberStatusDto, @CurrentUser() user: AuthenticatedUser) {
    return this.libraryService.setMemberStatus(this.tid(), user.id, id, dto);
  }

  @Delete('members/:id')
  @RequirePermission(K.LIBRARY_DELETE)
  deleteMember(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.libraryService.deleteMember(this.tid(), user.id, id);
  }

  // ── Circulation: loans ────────────────────────────────────────────────────

  @Get('loans')
  @RequirePermission(K.LIBRARY_VIEW)
  listLoans(@Query() query: ListLoansQueryDto, @CurrentUser() user: AuthenticatedUser) {
    return this.libraryService.listLoans(this.tid(), user.id, query);
  }

  @Post('loans')
  @RequirePermission(K.LIBRARY_CREATE)
  issueLoan(@Body() dto: IssueLoanDto, @CurrentUser() user: AuthenticatedUser) {
    return this.libraryService.issueLoan(this.tid(), user.id, dto);
  }

  @Post('loans/sweep-overdue')
  @RequirePermission(K.LIBRARY_MANAGE)
  sweepOverdue(@CurrentUser() user: AuthenticatedUser) {
    return this.libraryService.sweepOverdue(this.tid(), user.id);
  }

  @Get('loans/:id')
  @RequirePermission(K.LIBRARY_VIEW)
  getLoan(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.libraryService.getLoan(this.tid(), user.id, id);
  }

  @Patch('loans/:id/renew')
  @RequirePermission(K.LIBRARY_UPDATE)
  renewLoan(@Param('id') id: string, @Body() dto: RenewLoanDto, @CurrentUser() user: AuthenticatedUser) {
    return this.libraryService.renewLoan(this.tid(), user.id, id, dto);
  }

  @Post('loans/:id/return')
  @RequirePermission(K.LIBRARY_UPDATE)
  returnLoan(@Param('id') id: string, @Body() dto: ReturnLoanDto, @CurrentUser() user: AuthenticatedUser) {
    return this.libraryService.returnLoan(this.tid(), user.id, id, dto);
  }

  @Post('loans/:id/mark-lost')
  @RequirePermission(K.LIBRARY_MANAGE)
  markLoanLost(@Param('id') id: string, @Body() dto: MarkLoanLostDto, @CurrentUser() user: AuthenticatedUser) {
    return this.libraryService.markLoanLost(this.tid(), user.id, id, dto);
  }

  // ── Reservations ──────────────────────────────────────────────────────────

  @Get('reservations')
  @RequirePermission(K.LIBRARY_VIEW)
  listReservations(@Query() query: ListReservationsQueryDto, @CurrentUser() user: AuthenticatedUser) {
    return this.libraryService.listReservations(this.tid(), user.id, query);
  }

  @Post('reservations')
  @RequirePermission(K.LIBRARY_CREATE)
  createReservation(@Body() dto: CreateReservationDto, @CurrentUser() user: AuthenticatedUser) {
    return this.libraryService.createReservation(this.tid(), user.id, dto);
  }

  @Post('reservations/expire-sweep')
  @RequirePermission(K.LIBRARY_MANAGE)
  expireReservations(@CurrentUser() user: AuthenticatedUser) {
    return this.libraryService.expireReservations(this.tid(), user.id);
  }

  @Post('reservations/:id/ready')
  @RequirePermission(K.LIBRARY_UPDATE)
  assignReservationCopy(@Param('id') id: string, @Body() dto: AssignReservationCopyDto, @CurrentUser() user: AuthenticatedUser) {
    return this.libraryService.assignReservationCopy(this.tid(), user.id, id, dto);
  }

  @Post('reservations/:id/cancel')
  @RequirePermission(K.LIBRARY_UPDATE)
  cancelReservation(@Param('id') id: string, @Body() dto: CancelReservationDto, @CurrentUser() user: AuthenticatedUser) {
    return this.libraryService.cancelReservation(this.tid(), user.id, id, dto);
  }

  // ── Fines ─────────────────────────────────────────────────────────────────

  @Get('fines')
  @RequirePermission(K.LIBRARY_VIEW)
  listFines(@Query() query: ListFinesQueryDto, @CurrentUser() user: AuthenticatedUser) {
    return this.libraryService.listFines(this.tid(), user.id, query);
  }

  @Post('fines/:id/pay')
  @RequirePermission(K.LIBRARY_MANAGE)
  payFine(@Param('id') id: string, @Body() dto: PayFineDto, @CurrentUser() user: AuthenticatedUser) {
    return this.libraryService.payFine(this.tid(), user.id, id, dto);
  }

  @Post('fines/:id/waive')
  @RequirePermission(K.LIBRARY_MANAGE)
  waiveFine(@Param('id') id: string, @Body() dto: WaiveFineDto, @CurrentUser() user: AuthenticatedUser) {
    return this.libraryService.waiveFine(this.tid(), user.id, id, dto);
  }

  // ── Reports ───────────────────────────────────────────────────────────────

  @Get('reports/summary')
  @RequirePermission(K.LIBRARY_VIEW)
  summary() {
    return this.libraryService.summary(this.tid());
  }

  @Get('reports/circulation')
  @RequirePermission(K.LIBRARY_VIEW)
  circulationReport(@Query() query: CirculationReportDto) {
    return this.libraryService.circulationReport(this.tid(), query);
  }

  @Get('reports/inventory')
  @RequirePermission(K.LIBRARY_VIEW)
  inventoryReport() {
    return this.libraryService.inventoryReport(this.tid());
  }
}