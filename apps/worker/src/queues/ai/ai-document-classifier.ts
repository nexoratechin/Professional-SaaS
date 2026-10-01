/**
 * Deterministic document classifier and field extractor for the AI/OCR worker.
 *
 * ## Why there is no model here
 *
 * The whole module is built so that classification works with `AI_PROVIDER=none`: a document's
 * category is derived from signals the platform already has — its filename, its title, its mime
 * type, and (when an OCR endpoint is configured) its extracted text — matched against the tenant's
 * **own** `DocumentType` rows. That ordering matters. A tenant's configured types are the only
 * labels the rest of the platform understands, so a match against them can carry a real
 * `suggestedTypeId`; the built-in vocabulary below is only a fallback *label* for tenants who have
 * not configured a type for something, and carries no id because inventing one would point at a
 * document type that does not exist.
 *
 * ## What "confidence" means
 *
 * Confidence is a property of the *evidence*, not of a model's self-report: a token that appears in
 * the filename or title is strong evidence (someone named the file that way), a token that appears
 * only in the body text is weak (many documents mention many things). The score is deliberately
 * conservative — only a near-complete filename match approaches the auto-accept threshold — because
 * the cost of a wrong auto-accept is a reviewer never looking, while the cost of a false negative is
 * one row in a queue.
 *
 * The functions are pure and dependency-free so they can be replayed against fixtures; a routing
 * regression here is a test, not a production incident.
 */

/** The tenant's configured document type, as much of it as classification needs. */
export interface ClassificationTypeOption {
  id: string;
  code: string;
  name: string;
}

export interface ClassificationInput {
  originalFilename: string;
  documentTitle: string;
  mimeType: string;
  /** Extracted OCR/parse text; the empty string when no extractor ran or it found nothing. */
  text: string;
}

export interface ClassificationOutcome {
  /** Set only when the match was against the tenant's own `DocumentType` rows. */
  suggestedTypeId: string | null;
  /** A tenant `DocumentType.code`, a built-in label, or null when nothing matched. */
  suggestedCategory: string | null;
  /** 0..1, by the evidence-strength rules described above. */
  confidence: number;
}

/** Words too common to be evidence of anything. Both names and filenames are full of them. */
const STOPWORDS = new Set([
  'the', 'and', 'for', 'with', 'from', 'document', 'documents', 'documenttype', 'type', 'copy',
  'scan', 'scanned', 'file', 'files', 'final', 'new', 'old', 'img', 'image', 'page', 'pdf', 'doc',
  'docx', 'jpg', 'jpeg', 'png', 'upload', 'uploaded',
]);

/** Only the head of a long document is scanned for keywords — a 200-page PDF's first pages decide. */
const MAX_TEXT_SCAN = 200_000;

export function classifyDocument(
  input: ClassificationInput,
  types: readonly ClassificationTypeOption[],
): ClassificationOutcome {
  const text = normalizeForMatching(input.text.slice(0, MAX_TEXT_SCAN));
  // Filename and title are joined because both are human-chosen labels for the same file, and both
  // are normalized so a keyword cannot hide behind a separator (`marksheet_sem4.pdf` must still read
  // as containing the word "marksheet").
  const signals = normalizeForMatching([input.originalFilename, input.documentTitle].filter(Boolean).join(' '));

  const fromTenant = bestTenantType(signals, text, types);
  if (fromTenant) {
    return { suggestedTypeId: fromTenant.type.id, suggestedCategory: fromTenant.type.code, confidence: fromTenant.confidence };
  }

  const fromBuiltIn = bestBuiltInCategory(signals, text);
  if (fromBuiltIn) {
    return { suggestedTypeId: null, suggestedCategory: fromBuiltIn.category, confidence: fromBuiltIn.confidence };
  }

  return { suggestedTypeId: null, suggestedCategory: null, confidence: 0 };
}

/**
 * The tenant type whose name/code tokens are best represented in the available evidence.
 *
 * Returns null when nothing matched at all, rather than the least-bad candidate: "no match" is a
 * real answer that sends the row to a human, and forcing a pick would hide that the tenant has no
 * type for this document.
 */
function bestTenantType(
  signals: string,
  text: string,
  types: readonly ClassificationTypeOption[],
): { type: ClassificationTypeOption; confidence: number } | null {
  let best: { type: ClassificationTypeOption; confidence: number } | null = null;

  for (const type of types) {
    const tokens = new Set([...tokenize(type.name), ...tokenize(type.code)]);
    if (tokens.size === 0) continue;

    let weight = 0;
    let strongHits = 0;
    for (const token of tokens) {
      if (signals.includes(token)) {
        weight += 3;
        strongHits += 1;
      } else if (text.includes(token)) {
        weight += 1;
      }
    }
    if (weight === 0) continue;

    const coverage = strongHits / tokens.size;
    const confidence = round2(clamp01(0.35 + 0.5 * coverage + Math.min(weight, 9) * 0.02));
    if (!best || confidence > best.confidence) best = { type, confidence };
  }

  return best;
}

/**
 * Built-in labels for tenants with no configured type for the document.
 *
 * Order is not significant — every entry is scored and the strongest wins — but the list is kept
 * short and college-specific on purpose. A generic "OTHER" that matches everything would auto-fill
 * every review queue with a useless label.
 */
const BUILT_IN_CATEGORIES: ReadonlyArray<{ category: string; patterns: readonly RegExp[] }> = [
  { category: 'MARKSHEET', patterns: [/\bmarks?\s*sheet\b/, /\bgrade\s*card\b/, /\bmark\s*list\b/, /\bmarks?\s+statement\b/] },
  { category: 'TRANSCRIPT', patterns: [/\btranscript\b/, /\bconsolidated\s+marks?\b/] },
  { category: 'DEGREE_CERTIFICATE', patterns: [/\bdegree\b/, /\bconvocation\b/, /\bgraduation\b/] },
  { category: 'TRANSFER_CERTIFICATE', patterns: [/\btransfer\s+certificate\b/, /\bmigration\s+certificate\b/] },
  { category: 'BONAFIDE_CERTIFICATE', patterns: [/\bbonafide\b/, /\bbona\s+fide\b/] },
  { category: 'INCOME_CERTIFICATE', patterns: [/\bincome\s+certificate\b/] },
  { category: 'CASTE_CERTIFICATE', patterns: [/\bcaste\s+certificate\b/, /\bcategory\s+certificate\b/] },
  { category: 'ID_PROOF', patterns: [/\baadhaar\b/, /\baadhar\b/, /\bpan\s+card\b/, /\bid\s*proof\b/, /\bpassport\b/, /\bvoter\s+id\b/] },
  { category: 'FEE_RECEIPT', patterns: [/\bfee\s+receipt\b/, /\bpayment\s+receipt\b/, /\breceipt\s+no\b/, /\bfee\s+paid\b/] },
  { category: 'ADMISSION_FORM', patterns: [/\badmission\s+form\b/, /\bapplication\s+form\b/, /\benrol?ment\s+form\b/] },
  { category: 'MEDICAL_RECORD', patterns: [/\bmedical\b/, /\bprescription\b/, /\bdiagnosis\b/, /\bfitness\s+certificate\b/] },
  { category: 'PHOTOGRAPH', patterns: [/\bphotograph\b/, /\bpassport\s+photo\b/, /\bphoto\s+id\b/] },
];

function bestBuiltInCategory(signals: string, text: string): { category: string; confidence: number } | null {
  let best: { category: string; confidence: number } | null = null;

  for (const entry of BUILT_IN_CATEGORIES) {
    for (const pattern of entry.patterns) {
      // Strong when the human named the file/title that way; weak when only the body mentions it.
      const confidence = pattern.test(signals) ? 0.6 : pattern.test(text) ? 0.45 : 0;
      if (confidence > 0 && (!best || confidence > best.confidence)) {
        best = { category: entry.category, confidence };
      }
    }
  }

  return best;
}

// ---------------------------------------------------------------------------
// Structured field extraction
// ---------------------------------------------------------------------------

const EMAIL_PATTERN = /[\w.+-]+@[\w-]+\.[\w.-]+/g;
const DATE_PATTERN = /\b\d{4}-\d{2}-\d{2}\b|\b\d{1,2}[/.-]\d{1,2}[/.-]\d{2,4}\b/g;
const AMOUNT_PATTERN = /(?:₹|rs\.?|inr|\$|usd)\s?\d[\d,]*(?:\.\d{1,2})?/gi;
/**
 * Ten-digit phone, optionally prefixed by a country code.
 *
 * The digit-boundary guards matter: `\b` alone would let this match ten digits *inside* a twelve-digit
 * Aadhaar or account number, which would put a student's government id into `extractedFields` under
 * the wrong name. `(?<!\d)`/`(?!\d)` make a partial match impossible.
 */
const PHONE_PATTERN = /(?<!\d)(?:\+\d{1,3}[\s-]?)?\d{10}(?!\d)/g;

/** Per-field caps, so a contract or a timetable cannot turn `extractedFields` into a data dump. */
const FIELD_CAPS = { emails: 3, dates: 5, amounts: 5, phones: 3 } as const;

/**
 * Pulls a few high-precision, structurally unambiguous fields out of OCR text.
 *
 * Deliberately not a general entity extractor: each pattern below is one that either matches
 * exactly or does not, so a field in the output is evidence rather than a guess. Names and
 * addresses are the valuable fields a reviewer would want and are exactly the ones a regex cannot
 * find reliably, so they are left to the human — filling `extractedFields` with a wrong name would
 * be worse than leaving it empty.
 */
export function extractStructuredFields(text: string): Record<string, unknown> | null {
  if (!text) return null;

  const fields: Record<string, unknown> = {};
  const emails = uniqueMatches(text, EMAIL_PATTERN, FIELD_CAPS.emails);
  const dates = uniqueMatches(text, DATE_PATTERN, FIELD_CAPS.dates);
  const amounts = uniqueMatches(text, AMOUNT_PATTERN, FIELD_CAPS.amounts);
  const phones = uniqueMatches(text, PHONE_PATTERN, FIELD_CAPS.phones);

  if (emails.length > 0) fields['emails'] = emails;
  if (dates.length > 0) fields['dates'] = dates;
  if (amounts.length > 0) fields['amounts'] = amounts;
  if (phones.length > 0) fields['phones'] = phones;

  return Object.keys(fields).length > 0 ? fields : null;
}

/** Case-insensitive dedupe that keeps the first spelling and caps the result length. */
function uniqueMatches(text: string, pattern: RegExp, cap: number): string[] {
  const found: string[] = [];
  const seen = new Set<string>();
  // `pattern` is reused across documents, so reset `lastIndex` rather than trusting a fresh object
  // — a leaked index silently skips the first match of the next file.
  pattern.lastIndex = 0;
  for (const match of text.matchAll(pattern)) {
    const value = match[0].trim();
    const key = value.toLowerCase();
    if (!value || seen.has(key)) continue;
    seen.add(key);
    found.push(value);
    if (found.length >= cap) break;
  }
  return found;
}

function tokenize(value: string): string[] {
  return value
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((token) => token.length >= 3 && !STOPWORDS.has(token));
}

/**
 * Lower-cases and turns every run of non-alphanumeric characters into a single space.
 *
 * Matching on the raw string made the built-in patterns separator-sensitive: `\bmarks?\s*sheet\b`
 * failed against `marksheet_sem4.pdf` because `_` is a word character, so the trailing `\b` never
 * matched. Normalizing first means a keyword is found wherever it appears, regardless of the
 * punctuation the uploader happened to use.
 */
function normalizeForMatching(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}
