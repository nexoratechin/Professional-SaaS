/**
 * Bulk import throughput — the CSV parse/serialize core every admission/student import goes
 * through. Builds a 20k-row file, parses it back and checks correctness plus a generous budget.
 */
import { parseCsv, rowsToCsv } from './csv';

const ROWS = 20_000;
const HEADERS = ['admissionNumber', 'fullName', 'email'] as const;
const BUDGET_MS = 5_000;

function bigCsv(): { rows: Array<Record<string, unknown>>; text: string } {
  const rows = Array.from({ length: ROWS }, (_, i) => ({
    admissionNumber: `A${i}`,
    fullName: `Student ${i}`,
    email: `student${i}@example.com`,
  }));
  return { rows, text: rowsToCsv(rows, HEADERS) };
}

describe('bulk import CSV performance', () => {
  it('serializes then parses 20k records within budget, losslessly', () => {
    const { rows, text } = bigCsv();
    const start = Date.now();
    const parsed = parseCsv(text);
    const elapsed = Date.now() - start;

    expect(parsed.headers).toEqual([...HEADERS]);
    expect(parsed.rows).toHaveLength(ROWS);
    expect(parsed.rows[0]).toEqual({ admissionNumber: 'A0', fullName: 'Student 0', email: 'student0@example.com' });
    expect(parsed.rows[ROWS - 1]).toEqual({
      admissionNumber: `A${ROWS - 1}`,
      fullName: `Student ${ROWS - 1}`,
      email: `student${ROWS - 1}@example.com`,
    });
    expect(parsed.rows).toHaveLength(rows.length);
    expect(elapsed).toBeLessThan(BUDGET_MS);
  });

  it('escapes commas/quotes/newlines without corrupting the record boundary', () => {
    const tricky = [
      { admissionNumber: 'A1', fullName: 'Doe, John', email: 'a@example.com' },
      { admissionNumber: 'A2', fullName: 'Quote" Name', email: 'b@example.com' },
      { admissionNumber: 'A3', fullName: 'Line\nBreak', email: 'c@example.com' },
    ];
    const parsed = parseCsv(rowsToCsv(tricky, HEADERS));
    expect(parsed.rows).toHaveLength(3);
    expect(parsed.rows[0]!.fullName).toBe('Doe, John');
    expect(parsed.rows[1]!.fullName).toBe('Quote" Name');
    expect(parsed.rows[2]!.fullName).toBe('Line\nBreak');
  });
});
