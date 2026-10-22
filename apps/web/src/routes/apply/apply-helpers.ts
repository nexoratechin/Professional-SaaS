/** Pure helpers for the public /apply page — kept free of React so they can be unit tested. */

export interface PortalField {
  key: string;
  label: string;
  type: string;
  required: boolean;
  options?: string[];
  helpText?: string | null;
  placeholder?: string | null;
}

export interface PortalDocument {
  id: string;
  category: string;
  name: string;
  status: string;
  scanStatus: string | null;
  downloadable: boolean;
}

export interface PortalApplication {
  id: string;
  reference: string | null;
  status: string;
  editable: boolean;
  submittedAt: string | null;
  createdAt: string;
  session: { name?: string; publicSlug?: string | null };
  program: { offerId: string; name: string | null };
  applicant: { fullName: string; email: string | null; phone: string | null };
  documents: PortalDocument[];
  checklist: string[];
  missingDocuments: string[];
  offers: Array<{
    id: string;
    offerNumber: string;
    status: string;
    issuedAt: string;
    expiresAt: string;
    admissionFeeCents: number;
  }>;
  fee: {
    applicationFeeCents: number;
    admissionFeeCents: number;
    paid: boolean;
    receiptNumber: string | null;
    onlinePaymentAvailable: boolean;
    note: string;
  };
  consent: { acceptedAt: string | null; version: string | null; currentVersion: string };
  timeline: Array<{ eventType: string; title: string; description: string | null; at: string }>;
  verifiedContact: string;
}

export function formatMoney(cents: number | null | undefined): string {
  if (cents === null || cents === undefined) return '—';
  if (cents === 0) return 'No fee';
  return `₹${(cents / 100).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;
}

export function formatDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}

/** Field keys with no usable answer. Required-but-blank is what blocks submission. */
export function missingRequiredAnswers(fields: PortalField[], answers: Record<string, unknown>): string[] {
  return fields
    .filter((field) => field.required)
    .filter((field) => {
      const value = answers[field.key];
      if (Array.isArray(value)) return value.length === 0;
      return value === undefined || value === null || String(value).trim() === '';
    })
    .map((field) => field.key);
}

/** Checklist categories that have no usable uploaded file yet. */
export function missingDocumentCategories(checklist: string[], documents: PortalDocument[]): string[] {
  const usable = new Set(
    documents
      .filter((doc) => doc.downloadable && doc.status !== 'REJECTED' && doc.scanStatus !== 'INFECTED')
      .map((doc) => doc.category.toUpperCase()),
  );
  return checklist.map((entry) => entry.toUpperCase()).filter((category) => !usable.has(category));
}

export function humaniseCategory(category: string): string {
  return category
    .toLowerCase()
    .split(/[_\s-]+/)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

export function stepState(current: number, step: number): 'done' | 'current' | 'upcoming' {
  if (step < current) return 'done';
  if (step === current) return 'current';
  return 'upcoming';
}

/** Applicant tokens live per college slug so two tabs on different colleges never collide. */
export function applicantTokenKey(slug: string): string {
  return `admission-portal:${slug}:token`;
}
