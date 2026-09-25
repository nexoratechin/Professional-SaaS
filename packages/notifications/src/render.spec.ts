import { extractTemplateVariables, renderTemplate } from './render';

describe('renderTemplate', () => {
  it('replaces declared variables', () => {
    const result = renderTemplate('Hi {{name}}, your fee of {{amount}} is due on {{date}}.', {
      name: 'Aarav',
      amount: 25000,
      date: '2026-10-01',
    });
    expect(result.text).toBe('Hi Aarav, your fee of 25000 is due on 2026-10-01.');
    expect(result.missingVariables).toEqual([]);
  });

  it('tolerates whitespace inside the braces', () => {
    expect(renderTemplate('Hello {{ name }}!', { name: 'Priya' }).text).toBe('Hello Priya!');
  });

  it('reports missing variables and leaves them intact in the output', () => {
    const result = renderTemplate('Dear {{fullName}}, your roll is {{rollNumber}}.', { rollNumber: 'R42' });
    expect(result.text).toBe('Dear {{fullName}}, your roll is R42.');
    expect(result.missingVariables).toEqual(['fullName']);
  });

  it('supports dotted variable names', () => {
    expect(renderTemplate('{{student.fullName}} scored {{marks}}%', { 'student.fullName': 'Aarav', marks: 91 }).text).toBe(
      'Aarav scored 91%',
    );
  });

  it('treats zero and false as provided values', () => {
    expect(renderTemplate('{{count}} {{flag}}', { count: 0, flag: false }).text).toBe('0 false');
  });
});

describe('extractTemplateVariables', () => {
  it('lists declared variables in first-appearance order, deduplicated', () => {
    expect(extractTemplateVariables('{{a}} then {{b}} then {{ a }} again')).toEqual(['a', 'b']);
  });

  it('returns an empty array for a template with no variables', () => {
    expect(extractTemplateVariables('plain text')).toEqual([]);
  });
});