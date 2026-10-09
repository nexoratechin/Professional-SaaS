import { createHash } from 'node:crypto';

/**
 * Stable error fingerprinting: groups occurrences of the same bug across requests/replicas even
 * when the message embeds volatile values (ids, numbers, emails). Used by the error tracker for
 * dedupe and by SystemErrorEvent persistence (one row per fingerprint, count incremented).
 */
export function fingerprintError(error: unknown, extra?: string): string {
  const name = error instanceof Error ? error.name : typeof error;
  const rawMessage = error instanceof Error ? error.message : String(error);
  const normalizedMessage = normalizeVolatile(rawMessage);
  // Only the throw site (first frame) is fingerprint material: it is identical for every
  // occurrence of the same bug regardless of which caller/route hit it, while caller frames would
  // over-split. Full stacks are still stored on the event itself.
  const stackHead =
    error instanceof Error && error.stack
      ? (error.stack.split('\n')[1] ?? '').trim()
      : '';
  const material = [name, normalizedMessage, stackHead, extra ?? ''].join('|');
  return createHash('sha256').update(material).digest('hex').slice(0, 32);
}

/** Replaces ids/uuids/numbers so "User 123 not found" and "User 456 not found" collapse. */
export function normalizeVolatile(message: string): string {
  return message
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, '<uuid>')
    .replace(/\b[a-z0-9_-]{20,}\b/gi, '<token>')
    .replace(/\b\d+(\.\d+)?\b/g, '<n>');
}
