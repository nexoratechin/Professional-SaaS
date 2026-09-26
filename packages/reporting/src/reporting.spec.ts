import { executeReport, EXPORT_LIMIT_DEFAULT, getReportCatalog, renderReport, resolveScope } from './index';
import { calculateNextRunAt } from './schedule';
import type { ReportPrisma } from './types';

describe('reporting catalog', () => {
  it('exposes the ten operational report types', () => {
    const catalog = getReportCatalog();
    expect(catalog).toHaveLength(10);
    expect(new Set(catalog.map((entry) => entry.reportType)).size).toBe(10);
    for (const entry of catalog) {
      expect(entry.columns.length).toBeGreaterThan(0);
      expect(entry.sourcePermission).toContain('.view');
    }
  });
});

describe('scope resolution', () => {
  it('denies access when no grants exist', () => {
    expect(resolveScope('STUDENTS', []).allowed).toBe(false);
  });

  it('allows global and narrows campus grants', () => {
    expect(resolveScope('STUDENTS', [{ scopeType: 'GLOBAL' }]).allowed).toBe(true);
    const scoped = resolveScope('STUDENTS', [{ scopeType: 'CAMPUS', campusId: 'campus-1' }]);
    expect(scoped.allowed).toBe(true);
    expect(scoped.clause).toEqual({ campusId: 'campus-1' });
  });
});

describe('csv export', () => {
  it('protects against spreadsheet formula injection and escaping', () => {
    const result = {
      definition: getReportCatalog()[0]!,
      columns: [{ key: 'name', label: 'Name' }],
      rows: [{ name: '=cmd|calc' }, { name: 'A, "quoted"' }],
      summary: {},
      rowCount: 2,
      totalCount: 2,
      truncated: false,
      generatedAt: '2026-09-25T00:00:00.000Z',
      filters: {},
    };
    const csv = renderReport('CSV', result).buffer.toString('utf8');
    expect(csv).toContain("'=cmd|calc");
    expect(csv).toContain('"A, ""quoted"""');
  });
});

describe('executeReport', () => {
  it('queries the matching delegate and maps rows', async () => {
    const findMany = jest.fn().mockResolvedValue([
      {
        id: 's1',
        admissionNumber: 'A1',
        rollNumber: 'R1',
        fullName: 'Asha',
        status: 'ACTIVE',
        admittedOn: new Date('2026-01-01T00:00:00.000Z'),
        campus: { name: 'Main' },
      },
    ]);
    const count = jest.fn().mockResolvedValue(1);
    const prisma = {
      admissionApplication: { findMany: jest.fn(), count: jest.fn() },
      student: { findMany, count },
      studentAttendance: { findMany: jest.fn(), count: jest.fn() },
      studentFee: { findMany: jest.fn(), count: jest.fn() },
      examSession: { findMany: jest.fn(), count: jest.fn() },
      placementOutcome: { findMany: jest.fn(), count: jest.fn() },
      studentLibraryLoan: { findMany: jest.fn(), count: jest.fn() },
      studentHostelBooking: { findMany: jest.fn(), count: jest.fn() },
      studentTransportPass: { findMany: jest.fn(), count: jest.fn() },
      inventoryStockItem: { findMany: jest.fn(), count: jest.fn() },
    } as unknown as ReportPrisma;

    const result = await executeReport(prisma, 'STUDENTS', { search: 'Asha' }, [{ scopeType: 'GLOBAL' }]);
    expect(findMany).toHaveBeenCalledTimes(1);
    expect(result.rows[0]).toMatchObject({ fullName: 'Asha', status: 'ACTIVE' });
    expect(result.totalCount).toBe(1);
  });

  it('caps export volume', async () => {
    const findMany = jest.fn().mockResolvedValue([]);
    const count = jest.fn().mockResolvedValue(0);
    const prisma = {
      admissionApplication: { findMany: jest.fn(), count: jest.fn() },
      student: { findMany, count },
      studentAttendance: { findMany: jest.fn(), count: jest.fn() },
      studentFee: { findMany: jest.fn(), count: jest.fn() },
      examSession: { findMany: jest.fn(), count: jest.fn() },
      placementOutcome: { findMany: jest.fn(), count: jest.fn() },
      studentLibraryLoan: { findMany: jest.fn(), count: jest.fn() },
      studentHostelBooking: { findMany: jest.fn(), count: jest.fn() },
      studentTransportPass: { findMany: jest.fn(), count: jest.fn() },
      inventoryStockItem: { findMany: jest.fn(), count: jest.fn() },
    } as unknown as ReportPrisma;
    await executeReport(prisma, 'STUDENTS', {}, [{ scopeType: 'GLOBAL' }], { mode: 'export' });
    expect(findMany.mock.calls[0]?.[0]).toMatchObject({ take: EXPORT_LIMIT_DEFAULT });
  });
});

describe('schedule calculation', () => {
  it('returns the next daily occurrence in UTC', () => {
    const from = new Date('2026-09-25T05:00:00.000Z');
    const next = calculateNextRunAt({ frequency: 'DAILY', timeOfDay: '08:00', timezone: 'UTC' }, from);
    expect(next.toISOString()).toBe('2026-09-25T08:00:00.000Z');
  });

  it('returns the next weekly occurrence on the requested weekday', () => {
    const from = new Date('2026-09-25T09:00:00.000Z'); // Friday
    const next = calculateNextRunAt({ frequency: 'WEEKLY', timeOfDay: '08:00', timezone: 'UTC', dayOfWeek: 1 }, from);
    expect(next.toISOString()).toBe('2026-09-28T08:00:00.000Z');
  });
});
