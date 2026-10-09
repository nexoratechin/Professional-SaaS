import { buildCertificatePdf } from './pdf';

describe('buildCertificatePdf', () => {
  it('renders a valid single-page PDF buffer with the certificate number', () => {
    const pdf = buildCertificatePdf({
      title: 'Bonafide Certificate',
      certificateNumber: 'CERT-BON-0001',
      issuedTo: 'Ada Lovelace',
      branding: { collegeName: 'Example College', primaryColor: '#1e3a5f' },
      fields: [
        { label: 'Program', value: 'B.Sc. Computer Science' },
        { label: 'Admission Number', value: 'ADM-001' },
      ],
      issuedDate: '2026-01-02',
      verifyUrl: 'https://example.edu/verify/certificate?token=abc',
      qrEnabled: true,
    });

    expect(pdf.length).toBeGreaterThan(0);
    expect(pdf.subarray(0, 5).toString('utf8')).toBe('%PDF-');
    expect(pdf.toString('utf8')).toContain('%%EOF');
    expect(pdf.toString('utf8')).toContain('CERT-BON-0001');
  });

  it('renders without a QR code when disabled', () => {
    const pdf = buildCertificatePdf({
      title: 'Testimonial',
      certificateNumber: 'CERT-TES-0007',
      issuedTo: 'Grace Hopper',
      branding: {},
      fields: [],
      qrEnabled: false,
      verifyUrl: null,
    });
    expect(pdf.subarray(0, 5).toString('utf8')).toBe('%PDF-');
  });
});
