/**
 * Health probe primitives shared by the API and the worker.
 *
 * Every dependency probe is raced against a timeout so a hung dependency (TCP connect to a dead
 * host, a pool in a bad state) cannot wedge the readiness endpoint — a readiness check that never
 * answers is indistinguishable from a dead process to a load balancer.
 */

export class ProbeTimeoutError extends Error {
  constructor(label: string, timeoutMs: number) {
    super(`${label} probe timed out after ${timeoutMs}ms`);
    this.name = 'ProbeTimeoutError';
  }
}

export interface ProbeResult {
  ok: boolean;
  latencyMs: number;
  error?: string;
}

export async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new ProbeTimeoutError(label, timeoutMs)), timeoutMs);
        timer.unref?.();
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/** Runs `fn` with a timeout and reports {ok, latencyMs, error} — never throws. */
export async function probe(fn: () => Promise<unknown>, timeoutMs = 3_000, label = 'dependency'): Promise<ProbeResult> {
  const started = process.hrtime.bigint();
  try {
    await withTimeout(fn(), timeoutMs, label);
    return { ok: true, latencyMs: elapsedMs(started) };
  } catch (error) {
    return {
      ok: false,
      latencyMs: elapsedMs(started),
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

function elapsedMs(startedAt: bigint): number {
  return Number(process.hrtime.bigint() - startedAt) / 1e6;
}
