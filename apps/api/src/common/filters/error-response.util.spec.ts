import { BadRequestException, ConflictException, HttpException } from '@nestjs/common';
import {
  buildErrorEnvelope,
  exceptionErrorCode,
  validationErrorCode,
  validationErrorDetails,
} from './error-response.util';

describe('buildErrorEnvelope', () => {
  it('builds a flat envelope for a plain string message', () => {
    const envelope = buildErrorEnvelope(404, 'Student not found.', { requestId: 'req-1', path: '/students', method: 'GET' });
    expect(envelope).toEqual({
      statusCode: 404,
      error: 'Not Found',
      code: 'HTTP_404',
      message: 'Student not found.',
      requestId: 'req-1',
      path: '/students',
      method: 'GET',
      timestamp: expect.any(String),
    });
  });

  it('unwraps the Nest payload object shape thrown by HttpException', () => {
    const exception = new BadRequestException('name must not be empty');
    const response = exception.getResponse();
    const envelope = buildErrorEnvelope(400, typeof response === 'object' ? (response as Record<string, unknown>) : undefined);
    expect(envelope.statusCode).toBe(400);
    expect(envelope.code).toBe('HTTP_400');
    expect(envelope.message).toBe('name must not be empty');
  });

  it('normalizes validation failures to VALIDATION_FAILED with per-field details', () => {
    const exception = new BadRequestException([
      'firstName must not be empty',
      'email must be an email',
      'campusId must be a string',
    ]);
    const response = exception.getResponse();
    const envelope = buildErrorEnvelope(
      400,
      typeof response === 'object' ? (response as Record<string, unknown>) : undefined,
    );
    expect(envelope.code).toBe('VALIDATION_FAILED');
    expect(envelope.message).toEqual(['firstName must not be empty', 'email must be an email', 'campusId must be a string']);
    expect(envelope.details).toEqual([
      'firstName must not be empty',
      'email must be an email',
      'campusId must be a string',
    ]);
  });

  it('keeps a single validation message as a string', () => {
    const exception = new BadRequestException(['name must not be empty']);
    const response = exception.getResponse() as Record<string, unknown>;
    const envelope = buildErrorEnvelope(400, response);
    expect(envelope.message).toBe('name must not be empty');
    expect(envelope.details).toEqual(['name must not be empty']);
  });

  it('honors a custom code and details passed through the exception payload', () => {
    const custom = new ConflictException({ code: 'DUPLICATE_ADMISSION_NUMBER', message: 'admission number in use', details: { admissionNumber: 'B2024-001' } });
    const response = custom.getResponse();
    const envelope = buildErrorEnvelope(409, typeof response === 'object' ? (response as Record<string, unknown>) : undefined);
    expect(envelope.code).toBe('DUPLICATE_ADMISSION_NUMBER');
    expect(envelope.message).toBe('admission number in use');
    expect(envelope.details).toEqual({ admissionNumber: 'B2024-001' });
  });

  it('never leaks undefined or empty fields', () => {
    const envelope = buildErrorEnvelope(500, 'Internal server error');
    expect(envelope.statusCode).toBe(500);
    expect(envelope.error).toBe('Internal Server Error');
    expect(envelope).not.toHaveProperty('requestId');
    expect(envelope).not.toHaveProperty('path');
    expect(envelope).not.toHaveProperty('details');
  });
});

describe('exceptionErrorCode', () => {
  it('returns the custom code from an HttpException payload', () => {
    const exception = new ConflictException({ code: 'FEE_DUPLICATE', message: 'duplicate' });
    expect(exceptionErrorCode(exception)).toBe('FEE_DUPLICATE');
  });

  it('returns undefined for plain-string exceptions', () => {
    expect(exceptionErrorCode(new HttpException('nope', 400))).toBeUndefined();
  });
});

describe('validationErrorCode', () => {
  it('maps class-validator constraints to stable snake_case codes', () => {
    expect(validationErrorCode('isNotEmpty')).toBe('VALUE_SHOULD_NOT_BE_EMPTY');
    expect(validationErrorCode('isInt')).toBe('VALUE_SHOULD_BE_INTEGER');
    expect(validationErrorCode('matches')).toBe('CONSTRAINT_MATCHES');
  });
});

describe('validationErrorDetails', () => {
  it('flattens nested child errors with dotted property paths', () => {
    const details = validationErrorDetails([
      {
        property: 'firstName',
        value: '',
        constraints: { isNotEmpty: 'firstName should not be empty' },
      },
      {
        property: 'guardians',
        value: [],
        children: [{ property: 'name', value: '', constraints: { isString: 'name must be a string' } }],
      },
    ]) as Array<{ property: string }>;
    expect(details).toHaveLength(2);
    expect(details[0]).toMatchObject({ property: 'firstName' });
    expect(details[1]).toMatchObject({ property: 'guardians.name' });
  });
});