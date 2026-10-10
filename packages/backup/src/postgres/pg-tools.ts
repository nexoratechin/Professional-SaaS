/**
 * Locating and running the PostgreSQL client tools (`pg_dump`, `pg_restore`, `psql`).
 *
 * The tools are external binaries on purpose: a logical dump produced by `pg_dump` is the
 * industry-standard, version-portable artifact, and this package must not grow a second
 * PostgreSQL driver dependency. Binaries are resolved from an explicit override
 * (`BACKUP_PG_DUMP_PATH`, ...), then `PATH`, then the standard Windows installation directory.
 *
 * Passwords never travel through argv: they are extracted from the connection URL and passed via
 * the `PGPASSWORD` environment variable, while the URL handed to the tools has its password
 * stripped. Every surfaced error/redacted URL is safe to log.
 */
import { spawn, spawnSync } from 'node:child_process';
import { createWriteStream, existsSync, readdirSync } from 'node:fs';
import { mkdir, unlink } from 'node:fs/promises';
import { dirname, join } from 'node:path';

export type PgBinaryName = 'pg_dump' | 'pg_restore' | 'psql';

export interface PgConnectionInfo {
  host: string;
  port: number;
  database: string;
  user: string;
  /** URL with the password removed — safe for argv and logs. */
  sanitizedUrl: string;
  password?: string;
  sslmode?: string;
}

/**
 * Query-string parameters libpq understands. Prisma-specific parameters (`schema`,
 * `connection_limit`, `pool_timeout`, `pgbouncer`, ...) are dropped: libpq rejects unknown URI
 * parameters, and none of them affect a dump/restore.
 */
const LIBPQ_URI_PARAMS = new Set([
  'sslmode',
  'sslrootcert',
  'sslcert',
  'sslkey',
  'sslpassword',
  'sslcrl',
  'sslcrldir',
  'connect_timeout',
  'application_name',
  'options',
  'channel_binding',
  'requirepeer',
  'target_session_attrs',
  'keepalives',
  'keepalives_idle',
  'keepalives_interval',
  'keepalives_count',
  'tcp_user_timeout',
  'passfile',
  'gssencmode',
]);

/** Strips the password from any connection URL so it can appear in logs/errors. */
export function redactDatabaseUrl(url: string): string {
  try {
    const parsed = new URL(url);
    if (!parsed.password) return url;
    parsed.password = '';
    return parsed.toString();
  } catch {
    return '<invalid database url>';
  }
}

/** Parses a PostgreSQL connection URL into argv-safe parts for the client tools. */
export function parseDatabaseUrl(url: string): PgConnectionInfo {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(`DATABASE_URL is not a valid URL: ${redactDatabaseUrl(url)}`);
  }
  if (parsed.protocol !== 'postgresql:' && parsed.protocol !== 'postgres:') {
    throw new Error(`DATABASE_URL must use the postgresql:// scheme (got "${parsed.protocol}//").`);
  }
  const database = decodeURIComponent(parsed.pathname.replace(/^\//, ''));
  if (!database) {
    throw new Error('DATABASE_URL must include a database name.');
  }
  const user = parsed.username ? decodeURIComponent(parsed.username) : '';
  const password = parsed.password ? decodeURIComponent(parsed.password) : undefined;

  const params = new URLSearchParams();
  for (const [key, value] of parsed.searchParams) {
    if (LIBPQ_URI_PARAMS.has(key)) params.append(key, value);
  }
  const search = params.toString();
  const auth = user ? `${encodeURIComponent(user)}@` : '';
  const sanitizedUrl = `postgresql://${auth}${parsed.host}/${encodeURIComponent(database)}${search ? `?${search}` : ''}`;

  return {
    host: parsed.hostname,
    port: Number(parsed.port || 5432),
    database,
    user,
    sanitizedUrl,
    ...(password ? { password } : {}),
    ...(parsed.searchParams.get('sslmode') ? { sslmode: parsed.searchParams.get('sslmode') as string } : {}),
  };
}

/** Env for the client tools: PGPASSWORD when the URL carried one, otherwise inherit. */
export function pgToolEnv(connection: PgConnectionInfo): NodeJS.ProcessEnv {
  return connection.password ? { ...process.env, PGPASSWORD: connection.password } : { ...process.env };
}

/** `where` on Windows, `which` elsewhere. */
export function commandExists(command: string): boolean {
  const lookup = process.platform === 'win32' ? 'where' : 'which';
  try {
    const result = spawnSync(lookup, [command], { stdio: 'ignore' });
    return result.status === 0;
  } catch {
    return false;
  }
}

/** Standard Windows install locations, newest major version first. */
function windowsCandidates(name: PgBinaryName): string[] {
  if (process.platform !== 'win32') return [];
  const roots = [process.env.ProgramFiles, process.env['ProgramFiles(x86)'], 'C:\\Program Files']
    .filter((root): root is string => Boolean(root))
    .map((root) => join(root, 'PostgreSQL'));
  const candidates: string[] = [];
  for (const root of roots) {
    if (!existsSync(root)) continue;
    let versions: string[];
    try {
      versions = readdirSync(root)
        .filter((entry) => /^\d+/.test(entry))
        .sort((a, b) => Number.parseInt(b, 10) - Number.parseInt(a, 10));
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
export function resolvePgBinary(name: PgBinaryName, explicitPath?: string): string | null {
  if (explicitPath && explicitPath.trim()) {
    return resolveCommand(name, explicitPath);
  }
  if (commandExists(name)) return name;
  for (const candidate of windowsCandidates(name)) {
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

/**
 * Resolves any executable: explicit override (must work), then `PATH`. Used by both the PostgreSQL
 * tools and `redis-cli`.
 */
export function resolveCommand(name: string, explicitPath?: string): string | null {
  if (explicitPath && explicitPath.trim()) {
    const probe = spawnSync(explicitPath, ['--version'], { encoding: 'utf8' });
    if (probe.error || probe.status !== 0) {
      throw new Error(
        `Configured path for ${name} "${explicitPath}" is not executable: ${
          probe.error?.message ?? ((probe.stderr || '').trim() || `exit code ${probe.status}`)
        }`,
      );
    }
    return explicitPath;
  }
  return commandExists(name) ? name : null;
}

export interface RunCommandOptions {
  env?: NodeJS.ProcessEnv;
  timeoutMs?: number;
  cwd?: string;
  /** Resolve instead of reject on a non-zero exit code. */
  allowNonZero?: boolean;
}

export interface RunCommandResult {
  exitCode: number;
  stdout: string;
  stderr: string;
  durationMs: number;
}

const MAX_CAPTURED_OUTPUT = 64 * 1024;

function appendBounded(current: string, chunk: Buffer | string): string {
  if (current.length >= MAX_CAPTURED_OUTPUT) return current;
  return (current + chunk.toString()).slice(0, MAX_CAPTURED_OUTPUT);
}

export class ProcessError extends Error {
  constructor(
    message: string,
    readonly command: string,
    readonly exitCode: number | null,
    readonly stderr: string,
  ) {
    super(message);
    this.name = 'ProcessError';
  }
}

/** Runs a command to completion with timeout, bounded output capture and redacted failures. */
export function runCommand(
  command: string,
  args: readonly string[],
  options: RunCommandOptions = {},
): Promise<RunCommandResult> {
  return new Promise((resolve, reject) => {
    const startedAt = Date.now();
    const child = spawn(command, [...args], {
      env: options.env ?? process.env,
      cwd: options.cwd,
      windowsHide: true,
    });
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    const timeout =
      options.timeoutMs && options.timeoutMs > 0
        ? setTimeout(() => {
            timedOut = true;
            child.kill('SIGKILL');
          }, options.timeoutMs)
        : undefined;
    child.stdout?.on('data', (chunk: Buffer) => {
      stdout = appendBounded(stdout, chunk);
    });
    child.stderr?.on('data', (chunk: Buffer) => {
      stderr = appendBounded(stderr, chunk);
    });
    child.on('error', (error) => {
      if (timeout) clearTimeout(timeout);
      reject(new ProcessError(`${command} failed to start: ${error.message}`, command, null, stderr));
    });
    child.on('close', (code) => {
      if (timeout) clearTimeout(timeout);
      const durationMs = Date.now() - startedAt;
      if (timedOut) {
        reject(new ProcessError(`${command} timed out after ${options.timeoutMs}ms.`, command, code, stderr));
        return;
      }
      if (code !== 0 && !options.allowNonZero) {
        reject(
          new ProcessError(
            `${command} exited with code ${code}: ${stderr.trim() || stdout.trim() || '(no output)'}`,
            command,
            code,
            stderr,
          ),
        );
        return;
      }
      resolve({ exitCode: code ?? 0, stdout, stderr, durationMs });
    });
  });
}

export interface RunToFileOptions {
  outputPath: string;
  env?: NodeJS.ProcessEnv;
  timeoutMs?: number;
}

/**
 * Streams a command's stdout into a file (dumps can be gigabytes — they must never be buffered in
 * memory). A failed run leaves no partial archive behind.
 */
export async function runCommandToFile(
  command: string,
  args: readonly string[],
  options: RunToFileOptions,
): Promise<{ stderr: string; durationMs: number }> {
  await mkdir(dirname(options.outputPath), { recursive: true });
  return new Promise((resolve, reject) => {
    const startedAt = Date.now();
    const child = spawn(command, [...args], {
      env: options.env ?? process.env,
      windowsHide: true,
    });
    const output = createWriteStream(options.outputPath);
    let stderr = '';
    let timedOut = false;
    const timeout =
      options.timeoutMs && options.timeoutMs > 0
        ? setTimeout(() => {
            timedOut = true;
            child.kill('SIGKILL');
          }, options.timeoutMs)
        : undefined;
    const fail = async (error: Error) => {
      if (timeout) clearTimeout(timeout);
      output.destroy();
      await unlink(options.outputPath).catch(() => undefined);
      reject(error);
    };
    child.stdout?.pipe(output);
    child.stderr?.on('data', (chunk: Buffer) => {
      stderr = appendBounded(stderr, chunk);
    });
    child.on('error', (error) => {
      void fail(new ProcessError(`${command} failed to start: ${error.message}`, command, null, stderr));
    });
    output.on('error', (error) => {
      child.kill('SIGKILL');
      void fail(new ProcessError(`Failed to write ${options.outputPath}: ${error.message}`, command, null, stderr));
    });
    child.on('close', (code) => {
      if (timeout) clearTimeout(timeout);
      if (timedOut) {
        void fail(new ProcessError(`${command} timed out after ${options.timeoutMs}ms.`, command, code, stderr));
        return;
      }
      if (code !== 0) {
        void fail(
          new ProcessError(
            `${command} exited with code ${code}: ${stderr.trim() || '(no output)'}`,
            command,
            code,
            stderr,
          ),
        );
        return;
      }
      // 'close' can fire before the write stream flushed; wait for the file handle to close.
      output.end(() => resolve({ stderr, durationMs: Date.now() - startedAt }));
    });
  });
}

/** `pg_dump --version` / `pg_restore --version`, or null when the tool cannot be probed. */
export async function getBinaryVersion(binary: string): Promise<string | null> {
  try {
    const result = await runCommand(binary, ['--version'], { timeoutMs: 10_000 });
    return result.stdout.trim() || result.stderr.trim() || null;
  } catch {
    return null;
  }
}
