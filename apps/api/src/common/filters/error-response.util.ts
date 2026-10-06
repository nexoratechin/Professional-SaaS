import { HttpException, HttpStatus } from '@nestjs/common';
import { STATUS_CODES } from 'node:http';

export const ERROR_CODES = {
  VALIDATION_FAILED: 'VALIDATION_FAILED',
  VALUE_TOO_LONG: 'VALUE_TOO_LONG',
  VALUE_TOO_SHORT: 'VALUE_TOO_SHORT',
  VALUE_SHOULD_BE_STRING: 'VALUE_SHOULD_BE_STRING',
  VALUE_SHOULD_BE_NUMBER: 'VALUE_SHOULD_BE_NUMBER',
  VALUE_SHOULD_BE_INTEGER: 'VALUE_SHOULD_BE_INTEGER',
  VALUE_SHOULD_BE_BOOLEAN: 'VALUE_SHOULD_BE_BOOLEAN',
  VALUE_SHOULD_BE_ENUM: 'VALUE_SHOULD_BE_ENUM',
  VALUE_SHOULD_NOT_BE_EMPTY: 'VALUE_SHOULD_NOT_BE_EMPTY',
  VALUE_SHOULD_BE_ARRAY: 'VALUE_SHOULD_BE_ARRAY',
  VALUE_SHOULD_BE_OBJECT: 'VALUE_SHOULD_BE_OBJECT',
  VALUE_SHOULD_BE_DATE: 'VALUE_SHOULD_BE_DATE',
  VALUE_SHOULD_BE_URL: 'VALUE_SHOULD_BE_URL',
  VALUE_SHOULD_BE_EMAIL: 'VALUE_SHOULD_BE_EMAIL',
  VALUE_SHOULD_BE_UUID: 'VALUE_SHOULD_BE_UUID',
} as const;

export type ErrorCode = keyof typeof ERROR_CODES;

/** class-validator constraint name → platform error code. The actual constraint keys that reach
 *  the API (isNotEmpty, isInt, maxLength, …) differ from the code names, so this table owns the
 *  mapping instead of hoping a camelCase transform lands on the right constant. */
const CONSTRAINT_TO_ERROR_CODE: Record<string, string> = {
  isNotEmpty: ERROR_CODES.VALUE_SHOULD_NOT_BE_EMPTY,
  isString: ERROR_CODES.VALUE_SHOULD_BE_STRING,
  isNumber: ERROR_CODES.VALUE_SHOULD_BE_NUMBER,
  isInt: ERROR_CODES.VALUE_SHOULD_BE_INTEGER,
  isBoolean: ERROR_CODES.VALUE_SHOULD_BE_BOOLEAN,
  isEnum: ERROR_CODES.VALUE_SHOULD_BE_ENUM,
  isArray: ERROR_CODES.VALUE_SHOULD_BE_ARRAY,
  isObject: ERROR_CODES.VALUE_SHOULD_BE_OBJECT,
  isDate: ERROR_CODES.VALUE_SHOULD_BE_DATE,
  isUrl: ERROR_CODES.VALUE_SHOULD_BE_URL,
  isEmail: ERROR_CODES.VALUE_SHOULD_BE_EMAIL,
  isUuid: ERROR_CODES.VALUE_SHOULD_BE_UUID,
  maxLength: ERROR_CODES.VALUE_TOO_LONG,
  minLength: ERROR_CODES.VALUE_TOO_SHORT,
};

/** Maps a class-validator constraint name to a stable machine-readable error code. Kept in the
 *  platform so the frontend and API clients can branch behavior (e.g. inline field errors) on a
 *  code instead of parsing human-readable strings. Known constraints map to the VALUE_* family;
 *  anything else falls back to a deterministic CONSTRAINT_<NAME> code. */
export function validationErrorCode(constraint: string): string {
  const direct = CONSTRAINT_TO_ERROR_CODE[constraint];
  if (direct) return direct;
  return `CONSTRAINT_${constraint.replace(/([a-z0-9])([A-Z])/g, '$1_$2').toUpperCase()}`;
}

export interface ErrorEnvelope {
  statusCode: number;
  error: string;
  code: string;
  message: string | string[];
  details?: unknown;
  requestId?: string;
  path?: string;
  method?: string;
  timestamp: string;
}

interface ErrorContext {
  requestId?: string;
  path?: string;
  method?: string;
}

interface HttpExceptionResponseLike {
  statusCode?: number;
  message?: string | string[];
  error?: string;
  code?: string;
  details?: unknown;
}

/** Extracts the individual field messages from a class-validator constraint map so `details`
 *  can carry structured per-property validation failures. Only properties that actually carry
 *  constraints are emitted (nested container objects just prefix their children) so consumers
 *  get a flat, leaf-oriented list: [{ property, value, constraints }]. */
export function validationErrorDetails(validationErrors: unknown[]): Array<{
  property: string;
  value?: unknown;
  constraints?: Record<string, string>;
}> {
  const rows: Array<{ property: string; value?: unknown; constraints?: Record<string, string> }> = [];

  const walk = (errors: unknown[], prefix: string): void => {
    for (const raw of errors) {
      const entry = raw as {
        property?: string;
        value?: unknown;
        constraints?: Record<string, string>;
        children?: unknown[];
      };
      if (!entry) continue;
      const property = entry.property ?? 'unknown';
      const fullProperty = prefix ? `${prefix}.${property}` : property;
      if (entry.constraints && Object.keys(entry.constraints).length > 0) {
        rows.push({ property: fullProperty, value: entry.value, constraints: entry.constraints });
      }
      if (Array.isArray(entry.children) && entry.children.length > 0) {
        walk(entry.children, fullProperty);
      }
    }
  };

  walk(validationErrors, '');
  return rows;
}

/**
 * Single source of truth for the REST error envelope used by EVERY route via
 * HttpExceptionFilter. Guarantees the same JSON shape for validation failures, thrown
 * HttpExceptions, cross-tenant isolation violations and unexpected 500s.
 */
export function buildErrorEnvelope(
  statusCode: number,
  rawMessage: string | string[] | Record<string, unknown> | undefined,
  context: ErrorContext = {},
): ErrorEnvelope {
  let message: string | string[] | Record<string, unknown> | undefined = rawMessage;
  let error = STATUS_CODES[statusCode] ?? 'Unknown Error';
  let code = `HTTP_${statusCode}`;
  let details: unknown;

  // Nest wraps a thrown HttpException's payload — and ValidationPipe field failures — in
  // `{ statusCode, message, error, ... }`. Unwrap it so the envelope is flat and consistent.
  if (typeof message === 'object' && message !== null && !Array.isArray(message)) {
    const payload = message as HttpExceptionResponseLike;
    const payloadMessage = payload.message;
    if (typeof payloadMessage === 'string') {
      message = payloadMessage;
    } else if (Array.isArray(payloadMessage)) {
      message = payloadMessage.length === 1 ? payloadMessage[0] : payloadMessage;
      details = payloadMessage;
    } else if (payloadMessage === undefined) {
      message = payload.error ?? error;
    }
    if (payload.error) error = payload.error;
    if (payload.code) code = payload.code;
    if (payload.details !== undefined) details = payload.details;
  }

  // ValidationPipe fails with 400 and an array of constraint messages → give it the stable code
  // every SPA integrates on, with per-field details riding along.
  if (statusCode === HttpStatus.BAD_REQUEST && Array.isArray(message)) {
    code = ERROR_CODES.VALIDATION_FAILED;
  }

  if (message === undefined) message = STATUS_CODES[statusCode] ?? 'Unknown Error';

  return {
    statusCode,
    error,
    code,
    message: message as string | string[],
    ...(details !== undefined ? { details } : {}),
    ...(context.requestId ? { requestId: context.requestId } : {}),
    ...(context.path ? { path: context.path } : {}),
    ...(context.method ? { method: context.method } : {}),
    timestamp: new Date().toISOString(),
  };
}

/** Optional hook for HttpExceptions carrying a *custom* machine code (e.g. a service that wants
 *  `code: "DUPLICATE_ADMISSION_NUMBER"` on a 409). Include `code` in the exception's response. */
export function exceptionErrorCode(exception: HttpException): string | undefined {
  const response = exception.getResponse();
  if (typeof response === 'object' && response !== null) {
    return (response as HttpExceptionResponseLike).code;
  }
  return undefined;
}