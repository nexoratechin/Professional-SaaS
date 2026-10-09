/**
 * Report-generation throughput. Renders a large tabular result to CSV and Excel in-process and
 * checks both correctness and a (deliberately generous) wall-clock budget so a pathological
 * O(n^2) regression trips the test without being flaky on slow CI.
 */
import { renderReport } from './export';
import { getReportCatalog } from './catalog';
import type { ReportResult } from './types';

const ROWS = 20_000;
const BUDGET_MS = 5_000;

function bigResult(): ReportResult {
  const columns = [
    { key: 'studentId', label: 'Student', format: 'text' as const },
    { key: 'amount', label: 'Amount', format: 'currency' as const },
    { key: 'attendance', label: 'Attendance', format: 'percent' as const },
  ];
  const rows = Array.from({ length: ROWS }, (_, i) => ({
    studentId: `STU-${i}`,
    amount: i * 100,
    attendance: (i % 100) + 0.5,
  }));
  return {
    definition: getReportCatalog()[0]!,
    columns,
    rows,
    summary: { total: ROWS },
    rowCount: ROWS,
    totalCount: ROWS,
    truncated: false,
    generatedAt: '2026-09-25T00:00:00.000Z',
    filters: {},
  };
}

describe('report generation performance', () => {
  it('renders a 20k-row CSV within budget and emits every row', () => {
    const result = bigResult();
    const start = Date.now();
    const rendered = renderReport('CSV', result);
    const elapsed = Date.now() - start;

    expect(rendered.extension).toBe('csv');
    // safeFileBase() lowercases + slugifies the definition key.
    expect(rendered.fileName).toMatch(/^[a-z0-9-]+-2026-09-25\.csv$/);
    // Header + 20k rows (+ trailing newline).
    expect(rendered.buffer.toString('utf8').split('\r\n').filter(Boolean)).toHaveLength(ROWS + 1);
    expect(elapsed).toBeLessThan(BUDGET_MS);
  });

  it('renders a 20k-row Excel workbook within budget and escapes XML', () => {
    const result = bigResult();
    result.rows[0] = { studentId: '<script>', amount: 1, attendance: 1 };
    const start = Date.now();
    const rendered = renderReport('EXCEL', result);
    const elapsed = Date.now() - start;

    const xml = rendered.buffer.toString('utf8');
    expect(xml).toContain('&lt;script&gt;');
    expect(xml).not.toContain('<script>');
    expect(elapsed).toBeLessThan(BUDGET_MS);
  });
});
