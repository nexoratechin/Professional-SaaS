import { parseCsvToRows, rowsToCsv } from './org-csv';

describe('organization CSV helpers', () => {
  const FIELDS = ['code', 'name', 'campus', 'description', 'capacity', 'isActive'];

  describe('parseCsvToRows', () => {
    it('parses header + data rows, coercing booleans and ints', () => {
      const rows = parseCsvToRows('code,name,capacity,isActive\nC1,Main Campus,10,true\nC2,North Campus,25,false', FIELDS);
      expect(rows).toEqual([
        { code: 'C1', name: 'Main Campus', capacity: 10, isActive: true },
        { code: 'C2', name: 'North Campus', capacity: 25, isActive: false },
      ]);
    });

    it('handles quoted fields containing commas and double quotes', () => {
      const rows = parseCsvToRows('code,name,description\nD1,"Engineering, ""Core""","Handles the ""dept"""', FIELDS);
      expect(rows[0]).toMatchObject({
        code: 'D1',
        name: 'Engineering, "Core"',
        description: 'Handles the "dept"',
      });
    });

    it('maps headers case-insensitively and ignores unknown columns', () => {
      const rows = parseCsvToRows('CODE,Name,unknown_col\nX1,Alpha,oops', FIELDS);
      expect(rows[0]).toMatchObject({ code: 'X1', name: 'Alpha' });
    });

    it('returns [] for empty input', () => {
      expect(parseCsvToRows('', FIELDS)).toEqual([]);
      expect(parseCsvToRows('code,name\n', FIELDS)).toEqual([]);
    });

    it('handles CRLF line endings', () => {
      const rows = parseCsvToRows('code,name\r\nA1,One\r\nA2,Two', FIELDS);
      expect(rows).toHaveLength(2);
      expect(rows[1]).toMatchObject({ code: 'A2', name: 'Two' });
    });
  });

  describe('rowsToCsv', () => {
    it('serializes rows in the given column order, quoting when needed', () => {
      const csv = rowsToCsv(
        [
          { code: 'C1', name: 'Main, Campus', campus: null, description: undefined, capacity: 5, isActive: true },
          { code: 'C2', name: 'Plain', campus: null, description: undefined, capacity: 0, isActive: false },
        ],
        FIELDS,
      );
      expect(csv.split('\n')[0]).toBe('code,name,campus,description,capacity,isActive');
      expect(csv.split('\n')[1]).toBe('C1,"Main, Campus",,,5,true');
      expect(csv.split('\n')[2]).toBe('C2,Plain,,,0,false');
    });

    it('round-trips through parseCsvToRows', () => {
      const csv = rowsToCsv(
        [{ code: 'D1', name: 'A, "quoted", name', campus: null, description: undefined, capacity: 3, isActive: true }],
        FIELDS,
      );
      const parsed = parseCsvToRows(csv, FIELDS);
      expect(parsed[0]).toMatchObject({ code: 'D1', name: 'A, "quoted", name', capacity: 3, isActive: true });
    });
  });
});