import {
  LAST_EMAIL_STORAGE_KEY,
  TENANT_OPTIONS_STORAGE_KEY,
  findWorkspace,
  needsWorkspacePicker,
  readCachedWorkspaces,
  readLastEmail,
  workspaceLoginPath,
  writeCachedWorkspaces,
} from './tenant-workspace';
import type { TenantWorkspaceDto } from '@college-erp/types';

function memoryStorage(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial));
  return {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => void data.set(key, value),
    removeItem: (key: string) => void data.delete(key),
    dump: () => Object.fromEntries(data),
  };
}

const alpha: TenantWorkspaceDto = { slug: 'alpha', name: 'Alpha College', status: 'ACTIVE', isCurrent: true };
const beta: TenantWorkspaceDto = { slug: 'beta', name: 'Beta College', status: 'TRIAL', isCurrent: false };

describe('workspace cache', () => {
  it('round-trips workspaces', () => {
    const storage = memoryStorage();
    writeCachedWorkspaces([alpha, beta], storage);
    expect(readCachedWorkspaces(storage)).toEqual([alpha, beta]);
  });

  it('removes the key when the list becomes empty', () => {
    const storage = memoryStorage({ [TENANT_OPTIONS_STORAGE_KEY]: JSON.stringify([alpha]) });
    writeCachedWorkspaces([], storage);
    expect(storage.dump()).not.toHaveProperty(TENANT_OPTIONS_STORAGE_KEY);
  });

  it('drops malformed entries, unknown statuses and duplicate slugs', () => {
    const storage = memoryStorage({
      [TENANT_OPTIONS_STORAGE_KEY]: JSON.stringify([
        alpha,
        alpha,
        { slug: '', name: 'No slug', status: 'ACTIVE', isCurrent: false },
        { slug: 'ghost', name: 'Ghost', status: 'DELETED', isCurrent: false },
        { slug: 'no-name', status: 'ACTIVE', isCurrent: false },
        null,
      ]),
    });
    expect(readCachedWorkspaces(storage)).toEqual([alpha]);
  });

  it('fails closed on unreadable storage', () => {
    expect(readCachedWorkspaces(memoryStorage({ [TENANT_OPTIONS_STORAGE_KEY]: '{not json' }))).toEqual([]);
    expect(readCachedWorkspaces(memoryStorage({ [TENANT_OPTIONS_STORAGE_KEY]: '{"a":1}' }))).toEqual([]);
  });

  it('reads and trims the last email', () => {
    expect(readLastEmail(memoryStorage({ [LAST_EMAIL_STORAGE_KEY]: '  dean@alpha.edu ' }))).toBe('dean@alpha.edu');
    expect(readLastEmail(memoryStorage({ [LAST_EMAIL_STORAGE_KEY]: '   ' }))).toBeNull();
    expect(readLastEmail(memoryStorage())).toBeNull();
  });
});

describe('workspace selection helpers', () => {
  it('requires a picker only for more than one workspace', () => {
    expect(needsWorkspacePicker([])).toBe(false);
    expect(needsWorkspacePicker([alpha])).toBe(false);
    expect(needsWorkspacePicker([alpha, beta])).toBe(true);
  });

  it('finds a workspace by opaque slug and never defaults', () => {
    expect(findWorkspace([alpha, beta], 'beta')).toEqual(beta);
    expect(findWorkspace([alpha, beta], 'gamma')).toBeUndefined();
    expect(findWorkspace([alpha, beta], null)).toBeUndefined();
  });

  it('builds an encoded login path with the prefill email', () => {
    expect(workspaceLoginPath('beta', 'dean@alpha.edu')).toBe(
      '/login?tenant=beta&email=dean%40alpha.edu',
    );
    expect(workspaceLoginPath('beta', null)).toBe('/login?tenant=beta');
  });
});
