/**
 * Locating and running the MySQL client tools (`mysqldump`, `mysql`).
 *
 * The tools are external binaries on purpose: a logical dump produced by `mysqldump` is the
 * industry-standard, version-portable artifact, and this package must not grow a second MySQL
 * driver dependency. Binaries are resolved from an explicit override
 * (`BACKUP_MYSQLDUMP_PATH`, `BACKUP_MYSQL_PATH`), then `PATH`, then the standard Windows
 * installation directory.
 *
 * Passwords never travel through argv: they are extracted from the connection URL and passed via
 * the `MYSQL_PWD` environment variable, while the connection details handed to the tools are kept
 * out of logs. Every surfaced error/redacted URL is safe to log.
 */
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { commandExists, redactDatabaseUrl, resolveCommand } from '../tools';

export type MysqlBinaryName = 'mysqldump' | 'mysql';

export interface MysqlConnectionInfo {
  host: string;
  port: number;
  database: string;
  user: string;
  /** URL with the password removed — safe for logs. */
  sanitizedUrl: string;
  password?: string;
  /** MySQL `--ssl-mode` value (e.g. `REQUIRED`), when the URL requested TLS. */
  sslMode?: string;
}

/**
 * Query-string parameters meaningful to the MySQL client. Prisma-specific parameters
 * (`connection_limit`, `pool_timeout`, ...) are dropped: the client rejects unknown options and
 * none of them affect a dump/restore.
 */
const MYSQL_URL_PARAMS = new Set(['ssl-mode', 'sslmode', 'ssl-ca', 'ssl-cert', 'ssl-key']);

/** Parses a MySQL connection URL into argv-safe parts for the client tools. */
export function parseDatabaseUrl(url: string): MysqlConnectionInfo {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(`DATABASE_URL is not a valid URL: ${redactDatabaseUrl(url)}`);
  }
  if (parsed.protocol !== 'mysql:') {
    throw new Error(`DATABASE_URL must use the mysql:// scheme (got "${parsed.protocol}//").`);
  }
  const database = decodeURIComponent(parsed.pathname.replace(/^\//, ''));
  if (!database) {
    throw new Error('DATABASE_URL must include a database name.');
  }
  const user = parsed.username ? decodeURIComponent(parsed.username) : '';
  const password = parsed.password ? decodeURIComponent(parsed.password) : undefined;

  const sslMode = parsed.searchParams.get('ssl-mode') ?? parsed.searchParams.get('sslmode') ?? undefined;
  const params = new URLSearchParams();
  for (const [key, value] of parsed.searchParams) {
    if (MYSQL_URL_PARAMS.has(key)) params.append(key, value);
  }
  const search = params.toString();
  const auth = user ? `${encodeURIComponent(user)}@` : '';
  const sanitizedUrl = `mysql://${auth}${parsed.host}/${encodeURIComponent(database)}${search ? `?${search}` : ''}`;

  return {
    host: parsed.hostname,
    port: Number(parsed.port || 3306),
    database,
    user,
    sanitizedUrl,
    ...(password ? { password } : {}),
    ...(sslMode ? { sslMode } : {}),
  };
}

/** Env for the client tools: MYSQL_PWD when the URL carried one, otherwise inherit. */
export function mysqlToolEnv(connection: MysqlConnectionInfo): NodeJS.ProcessEnv {
  return connection.password ? { ...process.env, MYSQL_PWD: connection.password } : { ...process.env };
}

/** Connection argv shared by `mysqldump` and `mysql` (never contains the password). */
export function mysqlConnectionArgs(connection: MysqlConnectionInfo): string[] {
  return [
    '--host',
    connection.host,
    '--port',
    String(connection.port),
    ...(connection.user ? ['--user', connection.user] : []),
    ...(connection.sslMode ? ['--ssl-mode', connection.sslMode.toUpperCase()] : []),
  ];
}

/** Standard Windows install locations, newest major version first. */
function windowsCandidates(name: MysqlBinaryName): string[] {
  if (process.platform !== 'win32') return [];
  const roots = [process.env.ProgramFiles, process.env['ProgramFiles(x86)'], 'C:\\Program Files']
    .filter((root): root is string => Boolean(root))
    .map((root) => join(root, 'MySQL'));
  const candidates: string[] = [];
  for (const root of roots) {
    if (!existsSync(root)) continue;
    let versions: string[];
    try {
      versions = readdirSync(root)
        .filter((entry) => /^MySQL Server \d/.test(entry))
        .sort((a, b) => Number.parseInt(b.replace(/^MySQL Server /, ''), 10) - Number.parseInt(a.replace(/^MySQL Server /, ''), 10));
    } catch {
      continue;
    }
    for (const version of versions) {
      candidates.push(join(root, version, 'bin', `${name}.exe`));
    }
  }
  return candidates;
}

/**
 * Resolves one client binary. An explicit override must work — a typo there should fail loudly at
 * configuration time rather than silently fall back to another installation. Returns null when the
 * tool cannot be found (callers decide whether that is a skip or a hard error).
 */
export function resolveMysqlBinary(name: MysqlBinaryName, explicitPath?: string): string | null {
  if (explicitPath && explicitPath.trim()) {
    return resolveCommand(name, explicitPath);
  }
  if (commandExists(name)) return name;
  for (const candidate of windowsCandidates(name)) {
    if (existsSync(candidate)) return candidate;
  }
  return null;
}
