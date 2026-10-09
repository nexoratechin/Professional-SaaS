/**
 * A minimal, dependency-free Prometheus-compatible metrics registry.
 *
 * Why not prom-client: this package is shared by the API, the worker and packages/database, and is
 * deliberately dependency-free so instrumentation cannot create a cycle or a version conflict.
 * The registry implements exactly the Prometheus text exposition format (v0.0.4) — counters,
 * gauges and cumulative histograms — which is understood by Prometheus, VictoriaMetrics, Grafana
 * Agent, OpenTelemetry collectors and (via a plain HTTP scrape) every mainstream monitoring
 * pipeline. All metric names are prefixed `college_erp_`.
 */

export type LabelValue = string | number;
export type Labels = Record<string, LabelValue | undefined>;

interface MetricDefinition {
  name: string;
  help: string;
  labelNames: readonly string[];
}

interface CounterSeries {
  labels: Record<string, string>;
  value: number;
}

interface GaugeSeries {
  labels: Record<string, string>;
  value: number;
}

interface HistogramSeries {
  labels: Record<string, string>;
  bucketCounts: number[];
  sum: number;
  count: number;
}

export class Counter {
  private readonly series = new Map<string, CounterSeries>();

  constructor(readonly definition: MetricDefinition) {}

  inc(labels: Labels = {}, amount = 1): void {
    const key = seriesKey(this.definition.labelNames, labels);
    const existing = this.series.get(key);
    if (existing) {
      existing.value += amount;
      return;
    }
    this.series.set(key, { labels: normalizeLabels(this.definition.labelNames, labels), value: amount });
  }

  value(labels: Labels = {}): number {
    return this.series.get(seriesKey(this.definition.labelNames, labels))?.value ?? 0;
  }

  entries(): Array<{ labels: Record<string, string>; value: number }> {
    return [...this.series.values()].map((entry) => ({ labels: entry.labels, value: entry.value }));
  }
}

export class Gauge {
  private readonly series = new Map<string, GaugeSeries>();

  constructor(readonly definition: MetricDefinition) {}

  set(labels: Labels, value: number): void {
    const key = seriesKey(this.definition.labelNames, labels);
    const existing = this.series.get(key);
    if (existing) {
      existing.value = value;
      return;
    }
    this.series.set(key, { labels: normalizeLabels(this.definition.labelNames, labels), value });
  }

  inc(labels: Labels = {}, amount = 1): void {
    this.set(labels, this.value(labels) + amount);
  }

  dec(labels: Labels = {}, amount = 1): void {
    this.set(labels, this.value(labels) - amount);
  }

  value(labels: Labels = {}): number {
    return this.series.get(seriesKey(this.definition.labelNames, labels))?.value ?? 0;
  }

  entries(): Array<{ labels: Record<string, string>; value: number }> {
    return [...this.series.values()].map((entry) => ({ labels: entry.labels, value: entry.value }));
  }
}

export const DEFAULT_HISTOGRAM_BUCKETS = [
  0.001, 0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10, 30,
] as const;

export class Histogram {
  private readonly series = new Map<string, HistogramSeries>();

  constructor(
    readonly definition: MetricDefinition,
    readonly buckets: readonly number[] = DEFAULT_HISTOGRAM_BUCKETS,
  ) {}

  observe(labels: Labels, value: number): void {
    const key = seriesKey(this.definition.labelNames, labels);
    let entry = this.series.get(key);
    if (!entry) {
      entry = {
        labels: normalizeLabels(this.definition.labelNames, labels),
        bucketCounts: new Array(this.buckets.length).fill(0),
        sum: 0,
        count: 0,
      };
      this.series.set(key, entry);
    }
    entry.sum += value;
    entry.count += 1;
    for (let i = 0; i < this.buckets.length; i++) {
      // Increment only the first matching bucket; render() accumulates them into the
      // Prometheus-cumulative `le` series. Values beyond the last bucket are represented by
      // the +Inf bucket only via `count`.
      if (value <= (this.buckets[i] as number)) {
        (entry.bucketCounts[i] as number) += 1;
        break;
      }
    }
  }

  entries(): Array<{ labels: Record<string, string>; bucketCounts: number[]; sum: number; count: number }> {
    return [...this.series.values()].map((entry) => ({
      labels: entry.labels,
      bucketCounts: entry.bucketCounts,
      sum: entry.sum,
      count: entry.count,
    }));
  }
}

export class MetricsRegistry {
  private readonly counters = new Map<string, Counter>();
  private readonly gauges = new Map<string, Gauge>();
  private readonly histograms = new Map<string, Histogram>();

  counter(name: string, help: string, labelNames: readonly string[] = []): Counter {
    return getOrCreate(this.counters, name, () => new Counter({ name, help, labelNames }));
  }

  gauge(name: string, help: string, labelNames: readonly string[] = []): Gauge {
    return getOrCreate(this.gauges, name, () => new Gauge({ name, help, labelNames }));
  }

  histogram(name: string, help: string, labelNames: readonly string[], buckets?: readonly number[]): Histogram {
    return getOrCreate(
      this.histograms,
      name,
      () => new Histogram({ name, help, labelNames }, buckets ?? DEFAULT_HISTOGRAM_BUCKETS),
    );
  }

  /** Prometheus text exposition (v0.0.4). Deterministically ordered for tests/diffs. */
  render(): string {
    const lines: string[] = [];
    const names = [
      ...this.counters.keys(),
      ...this.gauges.keys(),
      ...this.histograms.keys(),
    ].sort();

    for (const name of names) {
      const counter = this.counters.get(name);
      if (counter) {
        lines.push(`# HELP ${name} ${escapeHelp(counter.definition.help)}`);
        lines.push(`# TYPE ${name} counter`);
        for (const entry of sortEntries(counter.entries())) {
          lines.push(`${name}${formatLabels(entry.labels)} ${formatNumber(entry.value)}`);
        }
        continue;
      }
      const gauge = this.gauges.get(name);
      if (gauge) {
        lines.push(`# HELP ${name} ${escapeHelp(gauge.definition.help)}`);
        lines.push(`# TYPE ${name} gauge`);
        for (const entry of sortEntries(gauge.entries())) {
          lines.push(`${name}${formatLabels(entry.labels)} ${formatNumber(entry.value)}`);
        }
        continue;
      }
      const histogram = this.histograms.get(name);
      if (histogram) {
        lines.push(`# HELP ${name} ${escapeHelp(histogram.definition.help)}`);
        lines.push(`# TYPE ${name} histogram`);
        for (const entry of sortEntries(histogram.entries())) {
          let cumulative = 0;
          for (let i = 0; i < histogram.buckets.length; i++) {
            cumulative += entry.bucketCounts[i] as number;
            const le = formatNumber(histogram.buckets[i] as number);
            lines.push(
              `${name}_bucket${formatLabels({ ...entry.labels, le })} ${formatNumber(cumulative)}`,
            );
          }
          lines.push(`${name}_bucket${formatLabels({ ...entry.labels, le: '+Inf' })} ${formatNumber(entry.count)}`);
          lines.push(`${name}_sum${formatLabels(entry.labels)} ${formatNumber(entry.sum)}`);
          lines.push(`${name}_count${formatLabels(entry.labels)} ${formatNumber(entry.count)}`);
        }
      }
    }

    return lines.length > 0 ? `${lines.join('\n')}\n` : '';
  }

  reset(): void {
    this.counters.clear();
    this.gauges.clear();
    this.histograms.clear();
  }
}

/** Registry used by the instrumentation helpers in metrics/instrumentation.ts. */
export const defaultRegistry = new MetricsRegistry();

function getOrCreate<T>(map: Map<string, T>, name: string, create: () => T): T {
  const existing = map.get(name);
  if (existing) return existing;
  const created = create();
  map.set(name, created);
  return created;
}

function normalizeLabels(labelNames: readonly string[], labels: Labels): Record<string, string> {
  const normalized: Record<string, string> = {};
  for (const labelName of labelNames) {
    const value = labels[labelName];
    normalized[labelName] = value === undefined ? '' : String(value);
  }
  return normalized;
}

function seriesKey(labelNames: readonly string[], labels: Labels): string {
  return labelNames.map((name) => `${name}=${String(labels[name] ?? '')}`).join('\u0001');
}

function formatLabels(labels: Record<string, string>): string {
  const entries = Object.entries(labels);
  if (entries.length === 0) return '';
  const rendered = entries.map(([key, value]) => `${key}="${escapeLabelValue(value)}"`);
  return `{${rendered.join(',')}}`;
}

function escapeLabelValue(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n');
}

function escapeHelp(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/\n/g, '\\n');
}

/** Prometheus text format wants plain decimal notation; JS may otherwise emit 1e-7. */
function formatNumber(value: number): string {
  if (!Number.isFinite(value)) return value > 0 ? '+Inf' : value < 0 ? '-Inf' : 'NaN';
  if (Number.isInteger(value)) return String(value);
  return value.toFixed(6).replace(/0+$/, '').replace(/\.$/, '');
}

function sortEntries<T extends { labels: Record<string, string> }>(entries: T[]): T[] {
  return entries.sort((a, b) => formatLabels(a.labels).localeCompare(formatLabels(b.labels)));
}
