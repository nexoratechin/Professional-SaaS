import { classifyDocument, extractStructuredFields, type ClassificationTypeOption } from './ai-document-classifier';

const TRANSCRIPT: ClassificationTypeOption = { id: 't1', code: 'TRANSCRIPT', name: 'Transcript' };
const MARKSHEET: ClassificationTypeOption = { id: 't2', code: 'MARKSHEET', name: 'Marksheet' };

describe('classifyDocument', () => {
  it('matches a tenant DocumentType from the filename and reports a real type id', () => {
    const outcome = classifyDocument(
      { originalFilename: 'final_transcript_2026.pdf', documentTitle: '', mimeType: 'application/pdf', text: '' },
      [TRANSCRIPT, MARKSHEET],
    );
    expect(outcome.suggestedTypeId).toBe('t1');
    expect(outcome.suggestedCategory).toBe('TRANSCRIPT');
    // A near-complete filename match is strong evidence, so this must clear a 0.9 auto-accept bar.
    expect(outcome.confidence).toBeGreaterThanOrEqual(0.9);
  });

  it('matches on body text only with materially lower confidence than a filename match', () => {
    const filenameOutcome = classifyDocument(
      { originalFilename: 'marksheet.pdf', documentTitle: '', mimeType: 'application/pdf', text: '' },
      [MARKSHEET],
    );
    const textOutcome = classifyDocument(
      { originalFilename: 'scan001.pdf', documentTitle: 'Admission documents', mimeType: 'application/pdf', text: 'this is my marksheet' },
      [MARKSHEET],
    );
    expect(textOutcome.suggestedTypeId).toBe('t2');
    expect(textOutcome.confidence).toBeGreaterThan(0);
    expect(textOutcome.confidence).toBeLessThan(filenameOutcome.confidence);
    // A body-only mention must not be strong enough to auto-accept itself.
    expect(textOutcome.confidence).toBeLessThan(0.9);
  });

  it('falls back to a built-in label with no type id when the tenant has no matching type', () => {
    const outcome = classifyDocument(
      { originalFilename: 'marksheet_sem4.pdf', documentTitle: '', mimeType: 'application/pdf', text: '' },
      [],
    );
    expect(outcome.suggestedTypeId).toBeNull();
    expect(outcome.suggestedCategory).toBe('MARKSHEET');
    expect(outcome.confidence).toBeGreaterThan(0);
  });

  it('prefers the tenant type over a built-in label for the same document', () => {
    const outcome = classifyDocument(
      { originalFilename: 'aadhaar_student_id.pdf', documentTitle: '', mimeType: 'application/pdf', text: '' },
      [{ id: 't9', code: 'STUDENT_ID', name: 'Student ID' }],
    );
    // Both the tenant's "Student ID" and the built-in ID_PROOF ("aadhaar") match this filename; the
    // tenant's own type must win, because only it can carry a usable documentTypeId.
    expect(outcome.suggestedTypeId).toBe('t9');
    expect(outcome.suggestedCategory).toBe('STUDENT_ID');
  });

  it('returns an empty outcome when there is neither a match nor any text', () => {
    const outcome = classifyDocument(
      { originalFilename: 'img_0042.jpg', documentTitle: '', mimeType: 'image/jpeg', text: '' },
      [],
    );
    expect(outcome).toEqual({ suggestedTypeId: null, suggestedCategory: null, confidence: 0 });
  });

  it('does not match a type whose name is entirely stopwords', () => {
    // "Document Copy" carries no distinguishing signal; matching it would auto-label everything.
    const outcome = classifyDocument(
      { originalFilename: 'document copy.pdf', documentTitle: '', mimeType: 'application/pdf', text: '' },
      [{ id: 't3', code: 'DOC', name: 'Document Copy' }],
    );
    expect(outcome.suggestedTypeId).toBeNull();
    expect(outcome.suggestedCategory).toBeNull();
  });
});

describe('extractStructuredFields', () => {
  it('pulls emails, dates, amounts and phone numbers out of OCR text', () => {
    const fields = extractStructuredFields(
      'Contact student@example.com or +919876543210 on 12/05/2024. Amount Rs. 1,200.00 due.',
    );
    expect(fields?.['emails']).toEqual(['student@example.com']);
    expect(fields?.['dates']).toEqual(['12/05/2024']);
    expect(fields?.['amounts']).toEqual(['Rs. 1,200.00']);
    expect(fields?.['phones']).toEqual(['+919876543210']);
  });

  it('returns null when there is nothing structurally unambiguous to report', () => {
    expect(extractStructuredFields('')).toBeNull();
    expect(extractStructuredFields('This document has no identifiers at all.')).toBeNull();
  });

  it('caps each field so a long document cannot turn the row into a data dump', () => {
    const fields = extractStructuredFields(
      'a@x.com b@x.com c@x.com d@x.com 1/1/2020 2/2/2020 3/3/2020 4/4/2020 5/5/2020 6/6/2020',
    );
    expect((fields?.['emails'] as string[]).length).toBeLessThanOrEqual(3);
    expect((fields?.['dates'] as string[]).length).toBeLessThanOrEqual(5);
  });
});
