/**
 * Turns persisted `tenant_databases` rows into routable connection targets.
 *
 * Shared by the API's per-request registration and the worker's startup/interval loader, so both
 * sides agree on exactly which stores are routable. A descriptor is only routable when its status
 * is READY and it carries an encrypted connection URL.
 */
import type { TenantDatabaseSecretCipher } from './cipher';
import type { TenantConnectionTarget, TenantDatabaseDescriptor } from './types';

/** The minimal shape needed to route — works with a full descriptor or a partial select. */
export type RoutableDescriptor = Pick<
  TenantDatabaseDescriptor,
  'tenantId' | 'mode' | 'status' | 'schemaName' | 'databaseName' | 'connectionUrlEncrypted'
>;

export function descriptorToTarget(
  descriptor: RoutableDescriptor,
  cipher: TenantDatabaseSecretCipher,
): TenantConnectionTarget | null {
  if (descriptor.mode === 'SHARED') return null;
  if (descriptor.status !== 'READY') return null;
  if (!descriptor.connectionUrlEncrypted) return null;
  return {
    tenantId: descriptor.tenantId,
    mode: descriptor.mode,
    connectionUrl: cipher.decrypt(descriptor.connectionUrlEncrypted),
    schemaName: descriptor.schemaName,
    databaseName: descriptor.databaseName,
  };
}

export function descriptorsToTargets(
  descriptors: readonly RoutableDescriptor[],
  cipher: TenantDatabaseSecretCipher,
): TenantConnectionTarget[] {
  const targets: TenantConnectionTarget[] = [];
  for (const descriptor of descriptors) {
    const target = descriptorToTarget(descriptor, cipher);
    if (target) targets.push(target);
  }
  return targets;
}
