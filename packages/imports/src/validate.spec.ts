import { IMPORT_ENTITIES } from './registry';
import { autoMapHeaders, validateRows } from './validate';
import type { ImportContext } from './types';

function context(overrides: Partial<ImportContext> = {}): ImportContext {
  return {
    resolveRef: async () => new Map<string, string>(),
    existingKeys: async () => new Set<string>(),
    ...overrides,
  };
}

const students = IMPORT_ENTITIES.students;

describe('autoMapHeaders', () => {
  it('maps canonical headers case/space-insensitively', () => {
    const mapping = autoMapHeaders(students, ['admission no', 'First Name', 'LAST NAME', 'campus code']);
    expect(mapping).toEqual({
      'admission no': 'admissionNumber',
      'First Name': 'firstName',
      'LAST NAME': 'lastName',
      'campus code': 'campusId',
    });
  });
});

describe('validateRows', () => {
  const mapping = autoMapHeaders(students, ['Admission No', 'First Name', 'Last Name', 'Campus Code', 'Gender']);

  it('flags missing required values and unknown enums', async () => {
    const rows = [{ 'Admission No': '', 'First Name': 'A', 'Last Name': 'B', 'Campus Code': 'MAIN', Gender: 'ROBOT' }];
    const result = await validateRows(students, rows, mapping, context(), { duplicateStrategy: 'SKIP' });
    const row = result.rows[0]!;
    expect(row.status).toBe('INVALID');
    expect(row.issues.map((i) => i.code)).toEqual(expect.arrayContaining(['REQUIRED', 'INVALID_ENUM']));
  });

  it('resolves foreign keys and reports unknown codes', async () => {
    const ctx = context({
      resolveRef: async () => new Map([['MAIN', 'campus-1']]),
    });
    const rows = [
      { 'Admission No': 'A1', 'First Name': 'A', 'Last Name': 'B', 'Campus Code': 'MAIN', Gender: 'MALE' },
      { 'Admission No': 'A2', 'First Name': 'C', 'Last Name': 'D', 'Campus Code': 'NOPE', Gender: 'FEMALE' },
    ];
    const result = await validateRows(students, rows, mapping, ctx, { duplicateStrategy: 'SKIP' });
    expect(result.rows[0]!.mapped.campusId).toBe('campus-1');
    expect(result.rows[0]!.mapped.fullName).toBe('A B');
    expect(result.rows[1]!.status).toBe('INVALID');
    expect(result.rows[1]!.issues[0]!.code).toBe('REF_NOT_FOUND');
  });

  it('detects in-file and database duplicates', async () => {
    const ctx = context({
      resolveRef: async () => new Map([['MAIN', 'campus-1']]),
      existingKeys: async (keys) => new Set(keys.filter((k) => k === 'adm-db')),
    });
    const base = { 'First Name': 'A', 'Last Name': 'B', 'Campus Code': 'MAIN', Gender: 'MALE' };
    const rows = [
      { 'Admission No': 'adm-db', ...base },
      { 'Admission No': 'adm-new', ...base },
      { 'Admission No': 'adm-new', ...base },
    ];
    const result = await validateRows(students, rows, mapping, ctx, { duplicateStrategy: 'SKIP' });
    expect(result.rows[0]!.status).toBe('DUPLICATE');
    expect(result.rows[1]!.status).toBe('VALID');
    expect(result.rows[2]!.status).toBe('DUPLICATE');
  });

  it('applies the rupeesToCents transform and enum canonicalization', async () => {
    const fees = IMPORT_ENTITIES.fees;
    const feeMapping = autoMapHeaders(fees, ['Fee Head Code', 'Fee Head Name', 'Frequency', 'Default Amount']);
    const rows = [{ 'Fee Head Code': 'TUITION', 'Fee Head Name': 'Tuition', Frequency: 'per_term', 'Default Amount': '25,000.50' }];
    const result = await validateRows(fees, rows, feeMapping, context(), { duplicateStrategy: 'SKIP' });
    const mapped = result.rows[0]!.mapped;
    expect(mapped.frequency).toBe('PER_TERM');
    expect(mapped.defaultAmountCents).toBe(2500050);
  });

  it('reports required columns missing from the mapping', async () => {
    const partial = autoMapHeaders(students, ['First Name', 'Last Name']);
    const result = await validateRows(students, [], partial, context(), { duplicateStrategy: 'SKIP' });
    expect(result.summary.missingRequired).toContain('admissionNumber');
    expect(result.summary.missingRequired).toContain('campusId');
  });
});
