import { Body, Controller, Get, Param, Patch, Post, Query, Res, UseGuards } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import type { AuthenticatedPlatformUser, AuthenticatedUser } from '@college-erp/auth';
import { CurrentPlatformUser } from '../../common/decorators/current-platform-user.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PlatformAuthGuard } from '../../common/guards/platform-auth.guard';
import { TenantMatchGuard } from '../../common/guards/tenant-match.guard';
import { TenantContextService } from '../../common/prisma/tenant-context.service';
import { AddSupportTicketCommentDto } from './dto/add-support-ticket-comment.dto';
import { AssignSupportTicketDto } from './dto/assign-support-ticket.dto';
import { CreateSupportTicketDto } from './dto/create-support-ticket.dto';
import { ListSupportTicketsDto } from './dto/list-support-tickets.dto';
import { ListTenantSupportTicketsDto } from './dto/list-tenant-support-tickets.dto';
import { UpdateSupportTicketDto } from './dto/update-support-ticket.dto';
import { SupportTicketsService } from './support-tickets.service';

/** Deliberately no @RequirePermission on the tenant-side routes — "raise/view/comment on my own
 * support ticket" needs nothing beyond being an authenticated tenant user (see this service's
 * doc comment for why ownership, not a new RBAC permission, is the boundary). Platform-side
 * status/assignment changes require PLATFORM_ADMIN or PLATFORM_SUPPORT (any authenticated
 * platform user — support staff ARE the users of this feature). */
@ApiTags('support')
@Controller()
export class SupportTicketsController {
  constructor(
    private readonly supportTickets: SupportTicketsService,
    private readonly tenantContext: TenantContextService,
  ) {}

  // --- Platform side ----------------------------------------------------------------------

  @Get('platform/support/tickets')
  @UseGuards(PlatformAuthGuard)
  async listForPlatform(@Query() query: ListSupportTicketsDto, @Res({ passthrough: true }) res: Response) {
    const { data, total } = await this.supportTickets.listForPlatform(query);
    res.setHeader('X-Total-Count', String(total));
    return data;
  }

  @Post('platform/support/tickets')
  @UseGuards(PlatformAuthGuard)
  createByPlatformUser(@Body() dto: CreateSupportTicketDto, @CurrentPlatformUser() platformUser: AuthenticatedPlatformUser) {
    return this.supportTickets.createByPlatformUser(dto, platformUser.id);
  }

  @Get('platform/support/tickets/:id')
  @UseGuards(PlatformAuthGuard)
  get(@Param('id') id: string) {
    return this.supportTickets.get(id);
  }

  @Patch('platform/support/tickets/:id')
  @UseGuards(PlatformAuthGuard)
  updateStatus(
    @Param('id') id: string,
    @Body() dto: UpdateSupportTicketDto,
    @CurrentPlatformUser() platformUser: AuthenticatedPlatformUser,
  ) {
    return this.supportTickets.updateStatus(id, dto, platformUser.id);
  }

  @Post('platform/support/tickets/:id/assign')
  @UseGuards(PlatformAuthGuard)
  assign(
    @Param('id') id: string,
    @Body() dto: AssignSupportTicketDto,
    @CurrentPlatformUser() platformUser: AuthenticatedPlatformUser,
  ) {
    return this.supportTickets.assign(id, dto.platformUserId, platformUser.id);
  }

  @Post('platform/support/tickets/:id/comments')
  @UseGuards(PlatformAuthGuard)
  commentAsPlatformUser(
    @Param('id') id: string,
    @Body() dto: AddSupportTicketCommentDto,
    @CurrentPlatformUser() platformUser: AuthenticatedPlatformUser,
  ) {
    return this.supportTickets.addCommentAsPlatformUser(id, dto, platformUser.id);
  }

  // --- Tenant self-service ------------------------------------------------------------------

  @Get('tenant/support/tickets')
  @UseGuards(JwtAuthGuard, TenantMatchGuard)
  async listOwnForTenant(
    @Query() query: ListTenantSupportTicketsDto,
    @CurrentUser() user: AuthenticatedUser,
    @Res({ passthrough: true }) res: Response,
  ) {
    const { data, total } = await this.supportTickets.listOwnForTenant(this.tenantContext.tenantId as string, user.id, query);
    res.setHeader('X-Total-Count', String(total));
    return data;
  }

  @Post('tenant/support/tickets')
  @UseGuards(JwtAuthGuard, TenantMatchGuard)
  createForTenant(@Body() dto: CreateSupportTicketDto, @CurrentUser() user: AuthenticatedUser) {
    return this.supportTickets.createForTenant(this.tenantContext.tenantId as string, dto, user.id);
  }

  @Get('tenant/support/tickets/:id')
  @UseGuards(JwtAuthGuard, TenantMatchGuard)
  getOwnForTenant(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.supportTickets.getOwnForTenant(this.tenantContext.tenantId as string, user.id, id);
  }

  @Post('tenant/support/tickets/:id/comments')
  @UseGuards(JwtAuthGuard, TenantMatchGuard)
  commentAsTenantUser(
    @Param('id') id: string,
    @Body() dto: AddSupportTicketCommentDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.supportTickets.addCommentAsTenantUser(this.tenantContext.tenantId as string, id, dto, user.id);
  }
}
