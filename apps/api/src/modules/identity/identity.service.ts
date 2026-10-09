import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { AUDIT_ACTIONS, AUDIT_MODULES } from '@college-erp/auth';
import { IntegrationSecretCipher } from '@college-erp/integrations';
import type { IdentityProviderDto, IdentityProviderRoleMappingDto } from '@college-erp/types';
import type { IdentityProviderStatus } from '@college-erp/database';
import { AppConfigService } from '../../config/app-config.service';
import { TenantContextService } from '../../common/prisma/tenant-context.service';
import { TenantScopedPrismaService } from '../../common/prisma/tenant-scoped-prisma.service';
import { AuditService } from '../audit/audit.service';
import type {
  CreateIdentityProviderDto,
  CreateIdentityProviderRoleMappingDto,
  SetIdentityProviderSecretDto,
  UpdateIdentityProviderDto,
} from './dto/identity.dto';

type ProviderRow = {
  id: string;
  key: string;
  name: string;
  protocol: string;
  status: string;
  issuer: string;
  discoveryUrl: string | null;
  clientId: string;
  clientSecretEncrypted: string | null;
  scopes: string[];
  allowedEmailDomains: string[];
  autoProvisionUsers: boolean;
  defaultRoleId: string | null;
  enforceEmailVerified: boolean;
  createdAt: Date;
  updatedAt: Date;
  defaultRole?: { code: string } | null;
};

/**
 * Admin-facing identity-provider management (CRUD + role mappings). All access is tenant-scoped
 * through TenantScopedPrismaService, so a provider id from another tenant simply isn't found.
 * The client secret is write-only: stored encrypted via IntegrationSecretCipher and never included
 * in any returned view.
 */
@Injectable()
export class IdentityService {
  private readonly cipher: IntegrationSecretCipher;

  constructor(
    private readonly tenantPrisma: TenantScopedPrismaService,
    private readonly tenantContext: TenantContextService,
    private readonly auditService: AuditService,
    appConfig: AppConfigService,
  ) {
    this.cipher = new IntegrationSecretCipher(appConfig.get('INTEGRATION_SECRET_KEY'));
  }

  private tenantId(): string {
    const tenantId = this.tenantContext.tenantId;
    if (!tenantId) {
      throw new Error('Tenant context missing on an identity route.');
    }
    return tenantId;
  }

  // ── Providers ───────────────────────────────────────────────────────────────

  async list(): Promise<IdentityProviderDto[]> {
    const rows = (await this.tenantPrisma.client.identityProvider.findMany({
      include: { defaultRole: true },
      orderBy: { createdAt: 'desc' },
    })) as unknown as ProviderRow[];
    return rows.map((row) => this.toView(row));
  }

  async get(id: string): Promise<IdentityProviderDto> {
    return this.toView(await this.requireProvider(id));
  }

  async create(dto: CreateIdentityProviderDto, actorUserId: string): Promise<IdentityProviderDto> {
    await this.assertRoleBelongsToTenant(dto.defaultRoleId);

    const created = (await this.tenantPrisma.client.identityProvider.create({
      data: {
        tenantId: this.tenantId(),
        key: dto.key,
        name: dto.name,
        protocol: dto.protocol ?? 'OIDC',
        issuer: dto.issuer,
        discoveryUrl: dto.discoveryUrl ?? null,
        clientId: dto.clientId,
        clientSecretEncrypted: this.cipher.encrypt(dto.clientSecret),
        scopes: dto.scopes ?? ['openid', 'email', 'profile'],
        allowedEmailDomains: dto.allowedEmailDomains ?? [],
        autoProvisionUsers: dto.autoProvisionUsers ?? true,
        defaultRoleId: dto.defaultRoleId ?? null,
        enforceEmailVerified: dto.enforceEmailVerified ?? true,
        createdBy: actorUserId,
        updatedBy: actorUserId,
      },
      include: { defaultRole: true },
    })) as unknown as ProviderRow;

    await this.auditService.record({
      scope: 'TENANT',
      tenantId: this.tenantId(),
      actorType: 'USER',
      actorUserId,
      action: AUDIT_ACTIONS.IDENTITY_PROVIDER_CREATED,
      module: AUDIT_MODULES.IDENTITY,
      entityType: 'IdentityProvider',
      entityId: created.id,
      after: { key: created.key, name: created.name, issuer: created.issuer, clientId: created.clientId },
    });

    return this.toView(created);
  }

  async update(id: string, dto: UpdateIdentityProviderDto, actorUserId: string): Promise<IdentityProviderDto> {
    const before = await this.requireProvider(id);
    if (dto.defaultRoleId !== undefined) {
      await this.assertRoleBelongsToTenant(dto.defaultRoleId);
    }

    const updated = (await this.tenantPrisma.client.identityProvider.update({
      where: { id },
      data: {
        name: dto.name,
        issuer: dto.issuer,
        discoveryUrl: dto.discoveryUrl === undefined ? undefined : dto.discoveryUrl || null,
        clientId: dto.clientId,
        scopes: dto.scopes,
        allowedEmailDomains: dto.allowedEmailDomains,
        autoProvisionUsers: dto.autoProvisionUsers,
        defaultRoleId: dto.defaultRoleId === undefined ? undefined : dto.defaultRoleId || null,
        enforceEmailVerified: dto.enforceEmailVerified,
        updatedBy: actorUserId,
      },
      include: { defaultRole: true },
    })) as unknown as ProviderRow;

    await this.auditService.record({
      scope: 'TENANT',
      tenantId: this.tenantId(),
      actorType: 'USER',
      actorUserId,
      action: AUDIT_ACTIONS.IDENTITY_PROVIDER_UPDATED,
      module: AUDIT_MODULES.IDENTITY,
      entityType: 'IdentityProvider',
      entityId: id,
      before: { name: before.name, issuer: before.issuer, clientId: before.clientId },
      after: { name: updated.name, issuer: updated.issuer, clientId: updated.clientId },
    });

    return this.toView(updated);
  }

  async setSecret(id: string, dto: SetIdentityProviderSecretDto, actorUserId: string): Promise<IdentityProviderDto> {
    await this.requireProvider(id);
    const updated = (await this.tenantPrisma.client.identityProvider.update({
      where: { id },
      data: { clientSecretEncrypted: this.cipher.encrypt(dto.clientSecret), updatedBy: actorUserId },
      include: { defaultRole: true },
    })) as unknown as ProviderRow;

    await this.auditService.record({
      scope: 'TENANT',
      tenantId: this.tenantId(),
      actorType: 'USER',
      actorUserId,
      action: AUDIT_ACTIONS.IDENTITY_PROVIDER_CREDENTIALS_UPDATED,
      module: AUDIT_MODULES.IDENTITY,
      entityType: 'IdentityProvider',
      entityId: id,
      // The secret value is never logged — only the fact that it changed.
      after: { clientSecretConfigured: true },
    });

    return this.toView(updated);
  }

  async changeStatus(id: string, status: IdentityProviderStatus, actorUserId: string): Promise<IdentityProviderDto> {
    const before = await this.requireProvider(id);
    if (status === 'ACTIVE' && !before.clientSecretEncrypted) {
      throw new BadRequestException('Set a client secret before activating this identity provider.');
    }

    const updated = (await this.tenantPrisma.client.identityProvider.update({
      where: { id },
      data: { status, updatedBy: actorUserId },
      include: { defaultRole: true },
    })) as unknown as ProviderRow;

    await this.auditService.record({
      scope: 'TENANT',
      tenantId: this.tenantId(),
      actorType: 'USER',
      actorUserId,
      action: AUDIT_ACTIONS.IDENTITY_PROVIDER_STATUS_CHANGED,
      module: AUDIT_MODULES.IDENTITY,
      entityType: 'IdentityProvider',
      entityId: id,
      before: { status: before.status },
      after: { status: updated.status },
    });

    return this.toView(updated);
  }

  async remove(id: string, actorUserId: string): Promise<void> {
    const before = await this.requireProvider(id);
    await this.tenantPrisma.client.identityProvider.delete({ where: { id } });

    await this.auditService.record({
      scope: 'TENANT',
      tenantId: this.tenantId(),
      actorType: 'USER',
      actorUserId,
      action: AUDIT_ACTIONS.IDENTITY_PROVIDER_DELETED,
      module: AUDIT_MODULES.IDENTITY,
      entityType: 'IdentityProvider',
      entityId: id,
      before: { key: before.key, name: before.name },
    });
  }

  // ── Role mappings ───────────────────────────────────────────────────────────

  async listRoleMappings(providerId: string): Promise<IdentityProviderRoleMappingDto[]> {
    await this.requireProvider(providerId);
    const rows = (await this.tenantPrisma.client.identityProviderRoleMapping.findMany({
      where: { identityProviderId: providerId },
      include: { role: true },
      orderBy: { createdAt: 'asc' },
    })) as unknown as Array<{
      id: string;
      identityProviderId: string;
      claimName: string;
      claimValue: string;
      roleId: string;
      createdAt: Date;
      role: { code: string; name: string } | null;
    }>;

    return rows.map((row) => ({
      id: row.id,
      identityProviderId: row.identityProviderId,
      claimName: row.claimName,
      claimValue: row.claimValue,
      roleId: row.roleId,
      roleCode: row.role?.code ?? null,
      roleName: row.role?.name ?? null,
      createdAt: row.createdAt.toISOString(),
    }));
  }

  async createRoleMapping(
    providerId: string,
    dto: CreateIdentityProviderRoleMappingDto,
    actorUserId: string,
  ): Promise<IdentityProviderRoleMappingDto> {
    await this.requireProvider(providerId);
    await this.assertRoleBelongsToTenant(dto.roleId);

    const existing = await this.tenantPrisma.client.identityProviderRoleMapping.findFirst({
      where: { identityProviderId: providerId, claimName: dto.claimName ?? 'groups', claimValue: dto.claimValue },
    });
    if (existing) {
      throw new ConflictException('A mapping for that claim value already exists on this provider.');
    }

    const created = (await this.tenantPrisma.client.identityProviderRoleMapping.create({
      data: {
        tenantId: this.tenantId(),
        identityProviderId: providerId,
        claimName: dto.claimName ?? 'groups',
        claimValue: dto.claimValue,
        roleId: dto.roleId,
        createdBy: actorUserId,
      },
      include: { role: true },
    })) as unknown as {
      id: string;
      identityProviderId: string;
      claimName: string;
      claimValue: string;
      roleId: string;
      createdAt: Date;
      role: { code: string; name: string } | null;
    };

    await this.auditService.record({
      scope: 'TENANT',
      tenantId: this.tenantId(),
      actorType: 'USER',
      actorUserId,
      action: AUDIT_ACTIONS.IDENTITY_ROLE_MAPPING_CREATED,
      module: AUDIT_MODULES.IDENTITY,
      entityType: 'IdentityProviderRoleMapping',
      entityId: created.id,
      after: { claimName: created.claimName, claimValue: created.claimValue, roleId: created.roleId },
    });

    return {
      id: created.id,
      identityProviderId: created.identityProviderId,
      claimName: created.claimName,
      claimValue: created.claimValue,
      roleId: created.roleId,
      roleCode: created.role?.code ?? null,
      roleName: created.role?.name ?? null,
      createdAt: created.createdAt.toISOString(),
    };
  }

  async deleteRoleMapping(providerId: string, mappingId: string, actorUserId: string): Promise<void> {
    await this.requireProvider(providerId);
    const mapping = await this.tenantPrisma.client.identityProviderRoleMapping.findFirst({
      where: { id: mappingId, identityProviderId: providerId },
    });
    if (!mapping) {
      throw new NotFoundException('Role mapping not found.');
    }
    await this.tenantPrisma.client.identityProviderRoleMapping.delete({ where: { id: mappingId } });

    await this.auditService.record({
      scope: 'TENANT',
      tenantId: this.tenantId(),
      actorType: 'USER',
      actorUserId,
      action: AUDIT_ACTIONS.IDENTITY_ROLE_MAPPING_DELETED,
      module: AUDIT_MODULES.IDENTITY,
      entityType: 'IdentityProviderRoleMapping',
      entityId: mappingId,
      before: { claimName: mapping.claimName, claimValue: mapping.claimValue, roleId: mapping.roleId },
    });
  }

  // ── Helpers ─────────────────────────────────────────────────────────────────

  private async requireProvider(id: string): Promise<ProviderRow> {
    const provider = (await this.tenantPrisma.client.identityProvider.findFirst({
      where: { id },
      include: { defaultRole: true },
    })) as unknown as ProviderRow | null;
    if (!provider) {
      throw new NotFoundException('Identity provider not found.');
    }
    return provider;
  }

  private async assertRoleBelongsToTenant(roleId: string | null | undefined): Promise<void> {
    if (!roleId) {
      return;
    }
    const role = await this.tenantPrisma.client.role.findFirst({ where: { id: roleId } });
    if (!role) {
      throw new NotFoundException('Role not found.');
    }
  }

  private toView(row: ProviderRow): IdentityProviderDto {
    return {
      id: row.id,
      key: row.key,
      name: row.name,
      protocol: row.protocol as IdentityProviderDto['protocol'],
      status: row.status as IdentityProviderDto['status'],
      issuer: row.issuer,
      discoveryUrl: row.discoveryUrl,
      clientId: row.clientId,
      hasClientSecret: Boolean(row.clientSecretEncrypted),
      scopes: row.scopes,
      allowedEmailDomains: row.allowedEmailDomains,
      autoProvisionUsers: row.autoProvisionUsers,
      defaultRoleId: row.defaultRoleId,
      defaultRoleCode: row.defaultRole?.code ?? null,
      enforceEmailVerified: row.enforceEmailVerified,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }
}
