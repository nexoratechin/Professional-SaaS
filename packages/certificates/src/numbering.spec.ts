import {
  formatCertificateNumber,
  highestSequence,
  resolveCertificatePrefix,
  resolvePadding,
  typeTail,
} from './numbering';

describe('certificate numbering', () => {
  it('formats a padded prefix-tail-sequence number', () => {
    expect(formatCertificateNumber('CERT', 'TRA', 42, 4)).toBe('CERT-TRA-0042');
  });

  it('resolves the prefix from template first, then tenant config, then default', () => {
    expect(resolveCertificatePrefix({ prefix: 'abc' }, { certificatePrefix: 'xyz' })).toBe('ABC');
    expect(resolveCertificatePrefix(null, { certificatePrefix: 'xyz' })).toBe('XYZ');
    expect(resolveCertificatePrefix(null, null)).toBe('CERT');
  });

  it('finds the highest existing sequence for a chain, ignoring other chains', () => {
    const existing = ['CERT-TRA-0001', 'CERT-TRA-0009', 'CERT-BON-0050', 'CERT-TRA-0003'];
    expect(highestSequence(existing, 'CERT', 'TRA', 1)).toBe(9);
  });

  it('returns start - 1 when the chain is empty', () => {
    expect(highestSequence([], 'CERT', 'TRA', 5)).toBe(4);
  });

  it('clamps padding to a sane range and maps unknown types to CUS', () => {
    expect(resolvePadding({ padding: 99 })).toBe(4);
    expect(resolvePadding({ padding: 6 })).toBe(6);
    expect(typeTail('NOT_A_TYPE')).toBe('CUS');
    expect(typeTail('MARKSHEET')).toBe('MAR');
  });
});
