import { parseCsv, parseCsvGrid, rowsToCsv } from './csv';

describe('csv', () => {
  it('parses quoted fields, embedded commas and newlines', () => {
    const text = 'name,note\r\n"Sharma, Aarav","line1\nline2"\r\n"O""Brien",plain';
    const { headers, rows } = parseCsv(text);
    expect(headers).toEqual(['name', 'note']);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toEqual({ name: 'Sharma, Aarav', note: 'line1\nline2' });
    expect(rows[1]).toEqual({ name: 'O"Brien', note: 'plain' });
  });

  it('ignores blank trailing rows and a BOM', () => {
    const grid = parseCsvGrid('\uFEFFa,b\n1,2\n\n');
    expect(grid).toEqual([
      ['a', 'b'],
      ['1', '2'],
    ]);
  });

  it('serializes and round-trips values containing separators', () => {
    const csv = rowsToCsv([{ a: 'x,y', b: 'q"z' }], ['a', 'b']);
    const { rows } = parseCsv(csv);
    expect(rows[0]).toEqual({ a: 'x,y', b: 'q"z' });
  });
});
