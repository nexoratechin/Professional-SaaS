/**
 * Process + executable helpers shared by the backup tooling (MySQL client tools, redis-cli).
 *
 * These are deliberately dependency-free wrappers over `child_process` so the package can shell
 * out to the same industry-standard client binaries operators already have on PATH, without
 * growing a database driver dependency. Output is bounded, runs are time-limited, and failures
 * are surfaced as redacted `ProcessError`s.
 */
import { spawn, spawnSync } from 'node:child_process';
import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, unlink } from 'node:fs/promises';
import { dirname } from 'node:path';

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

/**
 * Resolves any executable: explicit override (must work), then `PATH`. Used by both the MySQL
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

export interface RunWithInputOptions {
  /** File piped into the command's stdin (e.g. a SQL dump into the `mysql` client). */
  inputPath: string;
  env?: NodeJS.ProcessEnv;
  timeoutMs?: number;
}

/**
 * Runs a command with a file piped through stdin. Used to restore a SQL dump — the file is streamed,
 * never buffered, so multi-gigabyte restores stay within a bounded footprint.
 */
export async function runCommandWithInput(
  command: string,
  args: readonly string[],
  options: RunWithInputOptions,
): Promise<RunCommandResult> {
  return new Promise((resolve, reject) => {
    const startedAt = Date.now();
    const child = spawn(command, [...args], {
      env: options.env ?? process.env,
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    const input = createReadStream(options.inputPath);
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
    const cleanup = () => {
      if (timeout) clearTimeout(timeout);
      input.destroy();
    };
    child.stdout?.on('data', (chunk: Buffer) => {
      stdout = appendBounded(stdout, chunk);
    });
    child.stderr?.on('data', (chunk: Buffer) => {
      stderr = appendBounded(stderr, chunk);
    });
    input.on('error', (error) => {
      cleanup();
      child.kill('SIGKILL');
      reject(new ProcessError(`Failed to read ${options.inputPath}: ${error.message}`, command, null, stderr));
    });
    child.on('error', (error) => {
      cleanup();
      reject(new ProcessError(`${command} failed to start: ${error.message}`, command, null, stderr));
    });
    child.on('close', (code) => {
      cleanup();
      const durationMs = Date.now() - startedAt;
      if (timedOut) {
        reject(new ProcessError(`${command} timed out after ${options.timeoutMs}ms.`, command, code, stderr));
        return;
      }
      if (code !== 0) {
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
    input.pipe(child.stdin!);
  });
}

/** `<binary> --version`, or null when the tool cannot be probed. */
export async function getBinaryVersion(binary: string): Promise<string | null> {
  try {
    const result = await runCommand(binary, ['--version'], { timeoutMs: 10_000 });
    return result.stdout.trim() || result.stderr.trim() || null;
  } catch {
    return null;
  }
}
