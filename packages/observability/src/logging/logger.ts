import { inspect } from 'node:util';

/**
 * Structured logging core shared by the API and the worker.
 *
 * Two output formats:
 *  - `json` — one newline-delimited JSON object per record (production default). Every record
 *    carries level/time/service plus any structured fields (requestId, tenantId, userId, jobId,
 *    queue, durationMs, ...) so a log pipeline can index and filter without regex parsing.
 *  - `text` — compact human-readable lines for local development; identical record fields are
 *    appended as key=value pairs so information is never lost when reading a terminal.
 *
 * The class implements the subset of Nest's `LoggerService` interface Nest actually calls
 * (`log`/`error`/`warn`/`debug`/`verbose` + optional `setLogLevels`), so `app.useLogger(logger)`
 * routes every Nest internal log (bootstrap, guards, modules) through the same pipeline. It
 * deliberately does not import @nestjs/common: the package stays dependency-free and can be
 * consumed by plain scripts (packages/database's Prisma instrumentation) as well.
 */

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';
export type LogFormat = 'json' | 'text';

const LEVEL_PRIORITY: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };

export interface LogFields {
  requestId?: string;
  tenantId?: string;
  tenantSlug?: string;
  userId?: string;
  jobId?: string;
  queue?: string;
  durationMs?: number;
  statusCode?: number;
  method?: string;
  path?: string;
  route?: string;
  error?: { name: string; message: string; stack?: string };
  [key: string]: unknown;
}

export interface StructuredLoggerOptions {
  /** Shown on every record (`api`, `worker`, `database`, ...). */
  service: string;
  level?: LogLevel;
  format?: LogFormat;
  /** Extra fields merged into every record (e.g. build version). */
  fields?: LogFields;
}

interface LogRecord extends LogFields {
  level: LogLevel;
  time: string;
  service: string;
  message: string;
  context?: string;
}

export class StructuredLogger {
  private level: LogLevel;
  private readonly format: LogFormat;
  private readonly fields: LogFields;
  readonly service: string;

  constructor(options: StructuredLoggerOptions) {
    this.service = options.service;
    this.level = options.level ?? 'info';
    this.format = options.format ?? defaultFormat();
    this.fields = options.fields ?? {};
  }

  /** Nest calls this when LOG_LEVELS/app config narrows the enabled levels. Accepts Nest's level
   *  vocabulary (`log`/`verbose`/`fatal` included) and maps it onto the structured levels. */
  setLogLevels(levels: readonly string[]): void {
    const priorities = levels
      .map((level) => LEVEL_PRIORITY[nestLevelToStructured(level)])
      .filter((priority): priority is number => priority !== undefined)
      .sort((a, b) => a - b);
    this.setLevel(priorities.length > 0 ? priorityToLevel(priorities[0] as number) : 'info');
  }

  setLevel(level: LogLevel): void {
    this.level = level;
  }

  getLevel(): LogLevel {
    return this.level;
  }

  isLevelEnabled(level: LogLevel): boolean {
    return LEVEL_PRIORITY[level] >= LEVEL_PRIORITY[this.level];
  }

  /** Returns a logger that merges `fields` into every record (e.g. per-module context). */
  child(fields: LogFields): StructuredLogger {
    return new StructuredLogger({
      service: this.service,
      level: this.level,
      format: this.format,
      fields: { ...this.fields, ...fields },
    });
  }

  // ── Nest LoggerService-compatible surface ────────────────────────────────────────────────

  log(message: unknown, context?: string): void {
    this.emit('info', message, {}, context);
  }

  error(message: unknown, stack?: string, context?: string): void {
    this.emit('error', message, stack ? { error: normalizeError(message, stack) } : {}, context);
  }

  warn(message: unknown, context?: string): void {
    this.emit('warn', message, {}, context);
  }

  debug(message: unknown, context?: string): void {
    this.emit('debug', message, {}, context);
  }

  verbose(message: unknown, context?: string): void {
    this.emit('debug', message, {}, context);
  }

  // ── Structured surface ───────────────────────────────────────────────────────────────────

  /** Preferred entry point for first-party code: log a message plus machine-readable fields. */
  emit(level: LogLevel, message: unknown, fields: LogFields = {}, context?: string): void {
    if (!this.isLevelEnabled(level)) return;

    const base = typeof message === 'object' && message !== null ? (message as LogFields) : undefined;
    const record: LogRecord = {
      level,
      time: new Date().toISOString(),
      service: this.service,
      message: base ? String(base.message ?? base.error ?? '') : String(message),
      ...this.fields,
      ...(base ?? {}),
      ...fields,
    };
    if (context) record.context = context;

    const line = this.format === 'json' ? JSON.stringify(record) : formatText(record);
    // Errors/warnings go to stderr so container log routing can split severity streams;
    // everything else goes to stdout.
    if (level === 'error' || level === 'warn') process.stderr.write(`${line}\n`);
    else process.stdout.write(`${line}\n`);
  }
}

function defaultFormat(): LogFormat {
  return process.env.NODE_ENV === 'production' ? 'json' : 'text';
}

/** Coerces an untrusted env string to a LogLevel (falls back when unset/invalid). */
export function parseLogLevel(value: string | undefined, fallback: LogLevel = 'info'): LogLevel {
  return value === 'debug' || value === 'info' || value === 'warn' || value === 'error' ? value : fallback;
}

/** Coerces LOG_FORMAT; returns undefined when unset so NODE_ENV decides. */
export function parseLogFormat(value: string | undefined): LogFormat | undefined {
  return value === 'json' || value === 'text' ? value : undefined;
}

function priorityToLevel(priority: number): LogLevel {
  if (priority >= LEVEL_PRIORITY.error) return 'error';
  if (priority >= LEVEL_PRIORITY.warn) return 'warn';
  if (priority >= LEVEL_PRIORITY.info) return 'info';
  return 'debug';
}

/** Maps Nest's logger vocabulary onto the structured levels. */
function nestLevelToStructured(level: string): LogLevel {
  switch (level) {
    case 'error':
    case 'fatal':
      return 'error';
    case 'warn':
      return 'warn';
    case 'verbose':
      return 'debug';
    case 'log':
      return 'info';
    case 'debug':
      return 'debug';
    default:
      return 'info';
  }
}

function normalizeError(message: unknown, stack?: string): { name: string; message: string; stack?: string } {
  if (message instanceof Error) {
    return { name: message.name, message: message.message, ...(message.stack ? { stack: message.stack } : {}) };
  }
  return { name: 'Error', message: String(message), ...(stack ? { stack } : {}) };
}

/** Renders a record as a single readable line: `time [LEVEL] [context] message key=value ...`. */
function formatText(record: LogRecord): string {
  const { level, time, service, message, context, error, ...rest } = record;
  const parts = [time, `[${level.toUpperCase()}]`, context ? `[${context}]` : `[${service}]`, message];
  for (const [key, value] of Object.entries(rest)) {
    if (value === undefined || value === null || value === '') continue;
    parts.push(`${key}=${formatValue(value)}`);
  }
  if (error) {
    parts.push(`error="${error.name}: ${error.message}"`);
    if (error.stack) parts.push(`stack="${error.stack.split('\n').slice(0, 4).join(' | ')}"`);
  }
  return parts.join(' ');
}

function formatValue(value: unknown): string {
  if (typeof value === 'string') return /\s/.test(value) ? JSON.stringify(value) : value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return inspect(value, { depth: 2, breakLength: Infinity });
}

// ── Process-wide singleton ─────────────────────────────────────────────────────────────────

let globalLogger: StructuredLogger | undefined;

export interface ConfigureObservabilityOptions {
  service: string;
  level?: LogLevel;
  format?: LogFormat;
  version?: string;
  environment?: string;
}

/** Called once at bootstrap (API main.ts / worker main.ts). Also re-exported init for tests. */
export function configureObservability(options: ConfigureObservabilityOptions): StructuredLogger {
  globalLogger = new StructuredLogger({
    service: options.service,
    level: options.level,
    format: options.format,
    fields: {
      ...(options.version ? { version: options.version } : {}),
      ...(options.environment ? { environment: options.environment } : {}),
    },
  });
  return globalLogger;
}

/** Returns the configured logger, or a lazily-created default when none was configured (libraries). */
export function getLogger(): StructuredLogger {
  if (!globalLogger) {
    globalLogger = new StructuredLogger({ service: 'app' });
  }
  return globalLogger;
}
