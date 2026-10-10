import { assessRedisRecovery, parseRedisPersistenceInfo, redisCliConnection } from './redis-recovery';

const INFO = [
  '# Persistence',
  'loading:0',
  'rdb_changes_since_last_save:17',
  'rdb_bgsave_in_progress:0',
  'rdb_last_save_time:1791500000',
  'rdb_last_bgsave_status:ok',
  'aof_enabled:1',
  'aof_rewrite_in_progress:0',
  'aof_last_write_status:ok',
  'appendfsync:everysec',
  'used_memory_human:12.50M',
  'role:master',
  'redis_version:7.2.5',
].join('\r\n');

describe('parseRedisPersistenceInfo', () => {
  it('parses the persistence fields we depend on', () => {
    const info = parseRedisPersistenceInfo(INFO);
    expect(info).toMatchObject({
      rdbEnabled: true,
      appendOnlyEnabled: true,
      appendFsync: 'everysec',
      rdbLastSaveTime: 1791500000,
      rdbLastBgsaveStatus: 'ok',
      rdbBgsaveInProgress: false,
      aofLastWriteStatus: 'ok',
      loading: false,
      role: 'master',
      redisVersion: '7.2.5',
    });
  });

  it('treats missing fields as unknown rather than crashing', () => {
    const info = parseRedisPersistenceInfo('');
    expect(info.rdbEnabled).toBe(false);
    expect(info.appendOnlyEnabled).toBe(false);
    expect(info.rdbLastSaveTime).toBeNull();
  });
});

describe('assessRedisRecovery', () => {
  const now = new Date('2026-10-09T12:00:00Z');

  it('passes when persistence is on and the last save is fresh', () => {
    const info = parseRedisPersistenceInfo(
      INFO.replace('1791500000', String(Math.floor(now.getTime() / 1000) - 300)),
    );
    const assessment = assessRedisRecovery(info, { now, maxAgeMs: 6 * 60 * 60 * 1000 });
    expect(assessment.ok).toBe(true);
    expect(assessment.ageSeconds).toBe(300);
  });

  it('fails when persistence is disabled entirely', () => {
    const info = parseRedisPersistenceInfo('aof_enabled:0');
    const assessment = assessRedisRecovery(info, { now, maxAgeMs: 6 * 60 * 60 * 1000 });
    expect(assessment.ok).toBe(false);
    expect(assessment.reasons.join(' ')).toMatch(/Neither AOF nor RDB/);
  });

  it('fails when the last save is older than the RPO budget', () => {
    const info = parseRedisPersistenceInfo(INFO.replace('1791500000', '1700000000'));
    const assessment = assessRedisRecovery(info, { now, maxAgeMs: 6 * 60 * 60 * 1000 });
    expect(assessment.ok).toBe(false);
    expect(assessment.reasons.join(' ')).toMatch(/Last RDB save is/);
  });

  it('fails when the last background save reported an error', () => {
    const info = parseRedisPersistenceInfo(
      INFO.replace('rdb_last_bgsave_status:ok', 'rdb_last_bgsave_status:err').replace(
        '1791500000',
        String(Math.floor(now.getTime() / 1000) - 60),
      ),
    );
    const assessment = assessRedisRecovery(info, { now, maxAgeMs: 6 * 60 * 60 * 1000 });
    expect(assessment.ok).toBe(false);
    expect(assessment.reasons.join(' ')).toMatch(/background RDB save failed/);
  });
});

describe('redisCliConnection', () => {
  it('moves the password to REDISCLI_AUTH input and redacts the URL', () => {
    const connection = redisCliConnection('redis://default:redis-secret@redis:6379/0');
    expect(connection.password).toBe('redis-secret');
    expect(connection.sanitizedUrl).not.toContain('redis-secret');
  });

  it('handles URLs without credentials', () => {
    const connection = redisCliConnection('redis://localhost:6379');
    expect(connection.password).toBeUndefined();
    expect(connection.sanitizedUrl).toBe('redis://localhost:6379');
  });
});
