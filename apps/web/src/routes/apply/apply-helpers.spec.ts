import {
  formatMoney,
  humaniseCategory,
  missingDocumentCategories,
  missingRequiredAnswers,
  stepState,
} from './apply-helpers';

describe('apply helpers', () => {
  it('formats money in rupees, special-casing zero', () => {
    expect(formatMoney(0)).toBe('No fee');
    expect(formatMoney(150000)).toContain('1,500');
    expect(formatMoney(null)).toBe('—');
  });

  it('lists missing required answers, treating blank strings and empty arrays as missing', () => {
    const fields = [
      { key: 'a', label: 'A', type: 'TEXT', required: true },
      { key: 'b', label: 'B', type: 'TEXT', required: true },
      { key: 'c', label: 'C', type: 'MULTISELECT', required: true },
      { key: 'd', label: 'D', type: 'TEXT', required: false },
    ];
    expect(missingRequiredAnswers(fields, { b: 'x', c: [] })).toEqual(['a', 'c']);
  });

  it('ignores rejected, infected and file-less documents when checking the checklist', () => {
    const checklist = ['PHOTO', 'ID_PROOF', 'MARKSHEET_HIGHEST'];
    const documents = [
      { id: '1', category: 'PHOTO', name: 'p.jpg', status: 'PENDING', scanStatus: 'CLEAN', downloadable: true },
      { id: '2', category: 'ID_PROOF', name: 'i.pdf', status: 'REJECTED', scanStatus: 'CLEAN', downloadable: true },
      { id: '3', category: 'MARKSHEET_HIGHEST', name: 'm.pdf', status: 'PENDING', scanStatus: 'INFECTED', downloadable: false },
    ];
    expect(missingDocumentCategories(checklist, documents)).toEqual(['ID_PROOF', 'MARKSHEET_HIGHEST']);
  });

  it('humanises document categories', () => {
    expect(humaniseCategory('MARKSHEET_HIGHEST')).toBe('Marksheet Highest');
  });

  it('maps step position to visual state', () => {
    expect(stepState(2, 0)).toBe('done');
    expect(stepState(2, 2)).toBe('current');
    expect(stepState(2, 3)).toBe('upcoming');
  });
});
