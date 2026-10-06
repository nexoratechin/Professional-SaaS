import { parseTabularFile, buildTemplateFile, serializeTabularFile } from './workbook';
import { readXlsx, writeXlsx } from './xlsx';
import { IMPORT_ENTITIES } from './registry';

describe('xlsx codec', () => {
  it('round-trips a grid through writeXlsx/readXlsx', () => {
    const grid = [
      ['Code', 'Name', 'Amount'],
      ['A-1', 'Widget, large', '1250'],
      ['A-2', 'Quote "test"', '0'],
    ];
    const parsed = readXlsx(writeXlsx(grid));
    expect(parsed[0]).toEqual(grid[0]);
    expect(parsed[1]).toEqual(grid[1]);
    expect(parsed[2]).toEqual(grid[2]);
  });

  it('parses an XLSX template built for an entity', () => {
    const entity = IMPORT_ENTITIES.students;
    const { buffer, fileName } = buildTemplateFile(entity, 'XLSX');
    expect(fileName).toBe('students-import-template.xlsx');
    const parsed = parseTabularFile(buffer, 'XLSX');
    expect(parsed.headers).toContain('Admission No');
    expect(parsed.headers).toContain('Campus Code');
    expect(parsed.rows.length).toBeGreaterThan(0);
  });

  it('serializes generic rows to csv', () => {
    const buffer = serializeTabularFile('CSV', ['a', 'b'], [{ a: '1', b: 'two, three' }]);
    expect(buffer.toString('utf8')).toBe('a,b\r\n1,"two, three"');
  });
});
