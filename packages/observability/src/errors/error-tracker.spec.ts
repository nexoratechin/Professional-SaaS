import { ErrorTracker } from './error-tracker';
import type { TrackedErrorEvent } from './types';

describe('ErrorTracker', () => {
  it('captures an error, fingerprints it and notifies sinks once per dedupe window', () => {
    const seen: TrackedErrorEvent[] = [];
    const tracker = new ErrorTracker({ source: 'api', dedupeMs: 60_000 });
    tracker.addSink((event) => {
      seen.push(event);
    });

    // The same error instance stands in for "the same bug hit by consecutive requests" — its
    // fingerprint (name + message + throw-site stack) is stable across occurrences.
    const boom = new Error('boom');
    const first = tracker.capture(boom, { route: '/students/:id' });
    const second = tracker.capture(boom, { route: '/students/:id' });

    expect(seen).toHaveLength(1);
    expect(first?.fingerprint).toMatch(/^[0-9a-f]{32}$/);
    expect(first?.source).toBe('api');
    expect(second).toBeNull();
  });

  it('re-captures once the dedupe window lapses', async () => {
    const seen: TrackedErrorEvent[] = [];
    const tracker = new ErrorTracker({ source: 'api', dedupeMs: 5 });
    tracker.addSink((event) => {
      seen.push(event);
    });
    const boom = new Error('boom');
    tracker.capture(boom);
    await new Promise((resolve) => setTimeout(resolve, 10));
    tracker.capture(boom);
    expect(seen).toHaveLength(2);
  });

  it('does nothing when disabled', () => {
    const seen: TrackedErrorEvent[] = [];
    const tracker = new ErrorTracker({ source: 'api', enabled: false });
    tracker.addSink((event) => {
      seen.push(event);
    });
    expect(tracker.capture(new Error('boom'))).toBeNull();
    expect(seen).toHaveLength(0);
  });

  it('swallows sink failures', () => {
    const tracker = new ErrorTracker({ source: 'api' });
    tracker.addSink(() => {
      throw new Error('sink exploded');
    });
    expect(() => tracker.capture(new Error('boom'))).not.toThrow();
  });

  it('bounds remembered fingerprints', () => {
    const tracker = new ErrorTracker({ source: 'api', maxFingerprints: 2, dedupeMs: 60_000 });
    const one = new Error('one');
    const two = new Error('two');
    const three = new Error('three');
    tracker.capture(one);
    tracker.capture(two);
    tracker.capture(three);
    // 'one' was evicted → capturing it again emits (not deduped).
    expect(tracker.capture(one)).not.toBeNull();
  });
});
