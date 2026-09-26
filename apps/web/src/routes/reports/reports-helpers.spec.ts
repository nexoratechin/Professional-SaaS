import {
  clearDependentReportFilters,
  createEmptyReportFilters,
  isRunPollable,
  normalizeReportOptions,
  runStatusLabel,
  serializeReportFilters,
  validateScheduleDraft,
} from './reports-helpers';

describe('report filter helpers', () => {
  it('serializes only non-empty supported values', () => {
    const filters = { ...createEmptyReportFilters(), campusId: 'c1', status: 'ACTIVE', search: '   ' };
    expect(serializeReportFilters(filters, ['campusId', 'status', 'search'])).toEqual({ campusId: 'c1', status: 'ACTIVE' });
  });

  it('clears dependent filters when a parent changes', () => {
    const filters = { ...createEmptyReportFilters(), campusId: 'c1', departmentId: 'd1', programId: 'p1' };
    expect(clearDependentReportFilters(filters, 'campusId')).toMatchObject({ departmentId: '', programId: '' });
  });
});

describe('report options and run helpers', () => {
  it('normalizes campus/department/program/section options', () => {
    const options = normalizeReportOptions({
      campus: [{ id: 'c1', name: 'Main' }],
      department: [{ id: 'd1', name: 'Science' }],
      program: [{ id: 'p1', name: 'BSc' }],
      sections: [{ id: 's1', name: 'A' }],
    });
    expect(options.campus[0]).toMatchObject({ id: 'c1', label: 'Main' });
    expect(options.sections[0]).toMatchObject({ id: 's1', label: 'A' });
  });

  it('polls queued and running runs only', () => {
    expect(isRunPollable('QUEUED')).toBe(true);
    expect(isRunPollable('RUNNING')).toBe(true);
    expect(isRunPollable('COMPLETED')).toBe(false);
    expect(runStatusLabel('FAILED')).toBe('Failed');
  });
});

describe('schedule draft validation', () => {
  const base = {
    name: 'Daily fees',
    reportType: 'FEES',
    savedReportId: '',
    templateId: '',
    frequency: 'WEEKLY' as const,
    time: '08:00',
    timezone: 'Asia/Kolkata',
    format: 'CSV',
    isActive: true,
    dayOfWeek: 1,
    dayOfMonth: null,
  };

  it('requires a weekly day and a valid time', () => {
    expect(validateScheduleDraft(base)).toBeNull();
    expect(validateScheduleDraft({ ...base, dayOfWeek: null })).toBe('Select a day of the week.');
    expect(validateScheduleDraft({ ...base, time: '25:00' })).toBe('Enter a valid time.');
  });
});
