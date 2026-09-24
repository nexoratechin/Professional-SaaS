/**
 * HR performance review service — self/supervisor/peer/committee review records with a DRAFT →
 * SUBMITTED → APPROVED → COMPLETED lifecycle (rejections return to DRAFT). Score is optional and
 * capped at 9.99 by the DTO; goals are a JSON document the UI owns the shape of.
 */
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { AUDIT_ACTIONS, AUDIT_MODULES, PERMISSION_KEYS as K, type AuthenticatedUser } from '@college-erp/auth';
import { TenantScopedPrismaService } from '../../common/prisma/tenant-scoped-prisma.service';
import { AuditService } from '../audit/audit.service';
import { HrService } from './hr.service';
import * as HrDto from './dto/hr.dto';

type Where = Record<string, unknown>;

@Injectable()
export class HrPerformanceService {
  constructor(
    private readonly tenantPrisma: TenantScopedPrismaService,
    private readonly auditService: AuditService,
    private readonly hr: HrService,
  ) {}

  async createReview(tenantId: string, user: AuthenticatedUser, dto: HrDto.CreatePerformanceReviewDto) {
    await this.hr.fetchScopedEmployee(tenantId, user.id, K.HR_CREATE, dto.employeeId);
    const review = await this.tenantPrisma.client.employeePerformanceReview.create({
      data: {
        tenantId,
        employeeId: dto.employeeId,
        reviewPeriodStart: dto.reviewPeriodStart ? new Date(dto.reviewPeriodStart) : undefined,
        reviewPeriodEnd: dto.reviewPeriodEnd ? new Date(dto.reviewPeriodEnd) : undefined,
        reviewType: dto.reviewType as 'SELF' | 'SUPERVISOR' | 'PEER' | 'COMMITTEE',
        score: dto.score ?? undefined,
        goals: (dto.goals ?? undefined) as Record<string, unknown> | undefined,
        achievements: dto.achievements,
        areasForImprovement: dto.areasForImprovement,
        overallComments: dto.overallComments,
        reviewerUserId: dto.reviewerUserId,
        createdBy: user.id,
      },
    });
    await this.audit(tenantId, user.id, AUDIT_ACTIONS.PERFORMANCE_REVIEW_CREATED, 'EmployeePerformanceReview', review.id, {
      employeeId: dto.employeeId,
      reviewType: review.reviewType,
    });
    return review;
  }

  async listReviews(tenantId: string, user: AuthenticatedUser, query: HrDto.QueryPerformanceReviewsDto) {
    const { where } = await this.hr.resolveEmployeeScope(tenantId, user.id, K.HR_VIEW);
    const clauses: Where[] = [];
    if (where) clauses.push({ employee: where });
    if (query.employeeId) clauses.push({ employeeId: query.employeeId });
    if (query.status) clauses.push({ status: query.status });
    if (query.reviewType) clauses.push({ reviewType: query.reviewType });

    const whereFinal: Where | undefined = clauses.length === 0 ? undefined : clauses.length === 1 ? clauses[0] : { AND: clauses };

    const [data, total] = await Promise.all([
      this.tenantPrisma.client.employeePerformanceReview.findMany({
        where: whereFinal ?? undefined,
        orderBy: { createdAt: 'desc' },
        skip: query.skip ?? 0,
        take: query.take ?? 50,
        include: {
          employee: { select: { id: true, employeeCode: true, firstName: true, lastName: true } },
          reviewerUser: { select: { id: true, email: true, fullName: true } },
        },
      }),
      this.tenantPrisma.client.employeePerformanceReview.count({ where: whereFinal ?? undefined }),
    ]);
    return { data, total };
  }

  async updateReview(tenantId: string, user: AuthenticatedUser, reviewId: string, dto: HrDto.UpdatePerformanceReviewDto) {
    const review = await this.reviewOrThrow(reviewId);
    await this.hr.fetchScopedEmployee(tenantId, user.id, K.HR_UPDATE, review.employeeId);
    if (review.status !== 'DRAFT') throw new BadRequestException('Only draft reviews can be edited.');

    const updated = await this.tenantPrisma.client.employeePerformanceReview.update({
      where: { id: reviewId },
      data: {
        ...(dto.reviewPeriodStart !== undefined ? { reviewPeriodStart: dto.reviewPeriodStart ? new Date(dto.reviewPeriodStart) : null } : {}),
        ...(dto.reviewPeriodEnd !== undefined ? { reviewPeriodEnd: dto.reviewPeriodEnd ? new Date(dto.reviewPeriodEnd) : null } : {}),
        ...(dto.reviewType !== undefined ? { reviewType: dto.reviewType as 'SELF' | 'SUPERVISOR' | 'PEER' | 'COMMITTEE' } : {}),
        ...(dto.score !== undefined ? { score: dto.score } : {}),
        ...(dto.goals !== undefined ? { goals: dto.goals as Record<string, unknown> } : {}),
        ...(dto.achievements !== undefined ? { achievements: dto.achievements } : {}),
        ...(dto.areasForImprovement !== undefined ? { areasForImprovement: dto.areasForImprovement } : {}),
        ...(dto.overallComments !== undefined ? { overallComments: dto.overallComments } : {}),
        ...(dto.reviewerUserId !== undefined ? { reviewerUserId: dto.reviewerUserId } : {}),
        updatedBy: user.id,
      },
    });
    await this.audit(tenantId, user.id, AUDIT_ACTIONS.PERFORMANCE_REVIEW_UPDATED, 'EmployeePerformanceReview', reviewId, dto);
    return updated;
  }

  async submitReview(tenantId: string, user: AuthenticatedUser, reviewId: string) {
    const review = await this.reviewOrThrow(reviewId);
    await this.hr.fetchScopedEmployee(tenantId, user.id, K.HR_UPDATE, review.employeeId);
    if (review.status !== 'DRAFT' && review.status !== 'REJECTED') throw new BadRequestException('Only draft or rejected reviews can be submitted.');

    const updated = await this.tenantPrisma.client.employeePerformanceReview.update({
      where: { id: reviewId },
      data: { status: 'SUBMITTED', reviewedAt: new Date(), updatedBy: user.id },
    });
    await this.audit(tenantId, user.id, AUDIT_ACTIONS.PERFORMANCE_REVIEW_SUBMITTED, 'EmployeePerformanceReview', reviewId, {
      employeeId: review.employeeId,
    });
    return updated;
  }

  async approveReview(tenantId: string, user: AuthenticatedUser, reviewId: string) {
    const review = await this.reviewOrThrow(reviewId);
    await this.hr.fetchScopedEmployee(tenantId, user.id, K.HR_UPDATE, review.employeeId);
    if (review.status !== 'SUBMITTED') throw new BadRequestException('Only submitted reviews can be approved.');

    const updated = await this.tenantPrisma.client.employeePerformanceReview.update({
      where: { id: reviewId },
      data: { status: 'APPROVED', reviewedAt: new Date(), updatedBy: user.id },
    });
    await this.audit(tenantId, user.id, AUDIT_ACTIONS.PERFORMANCE_REVIEW_APPROVED, 'EmployeePerformanceReview', reviewId, {
      employeeId: review.employeeId,
    });
    return updated;
  }

  async rejectReview(tenantId: string, user: AuthenticatedUser, reviewId: string) {
    const review = await this.reviewOrThrow(reviewId);
    await this.hr.fetchScopedEmployee(tenantId, user.id, K.HR_UPDATE, review.employeeId);
    if (review.status !== 'SUBMITTED') throw new BadRequestException('Only submitted reviews can be rejected.');

    const updated = await this.tenantPrisma.client.employeePerformanceReview.update({
      where: { id: reviewId },
      data: { status: 'REJECTED', reviewedAt: new Date(), updatedBy: user.id },
    });
    await this.audit(tenantId, user.id, AUDIT_ACTIONS.PERFORMANCE_REVIEW_REJECTED, 'EmployeePerformanceReview', reviewId, {
      employeeId: review.employeeId,
    });
    return updated;
  }

  async completeReview(tenantId: string, user: AuthenticatedUser, reviewId: string) {
    const review = await this.reviewOrThrow(reviewId);
    await this.hr.fetchScopedEmployee(tenantId, user.id, K.HR_UPDATE, review.employeeId);
    if (review.status !== 'APPROVED') throw new BadRequestException('Only approved reviews can be completed.');

    const updated = await this.tenantPrisma.client.employeePerformanceReview.update({
      where: { id: reviewId },
      data: { status: 'COMPLETED', updatedBy: user.id },
    });
    await this.audit(tenantId, user.id, AUDIT_ACTIONS.PERFORMANCE_REVIEW_COMPLETED, 'EmployeePerformanceReview', reviewId, {
      employeeId: review.employeeId,
    });
    return updated;
  }

  private async reviewOrThrow(id: string) {
    const review = await this.tenantPrisma.client.employeePerformanceReview.findFirst({
      where: { id },
      include: { employee: { select: { id: true } } },
    });
    if (!review) throw new NotFoundException('Review not found.');
    return review;
  }

  private async audit(tenantId: string, actorUserId: string, action: string, entityType: string, entityId: string, after?: unknown): Promise<void> {
    await this.auditService.record({
      scope: 'TENANT',
      tenantId,
      actorType: 'USER',
      actorUserId,
      action,
      module: AUDIT_MODULES.HR,
      entityType,
      entityId,
      after,
    });
  }
}