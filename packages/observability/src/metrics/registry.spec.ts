import { Counter, DEFAULT_HISTOGRAM_BUCKETS, Gauge, MetricsRegistry } from './registry';

describe('MetricsRegistry', () => {
  let registry: MetricsRegistry;

  beforeEach(() => {
    registry = new MetricsRegistry();
  });

  it('renders counters in Prometheus text format', () => {
    const counter = registry.counter('college_erp_http_requests_total', 'Total HTTP requests.', ['method', 'status']);
    counter.inc({ method: 'GET', status: '200' });
    counter.inc({ method: 'GET', status: '200' });
    counter.inc({ method: 'POST', status: '500' });

    const output = registry.render();
    expect(output).toContain('# HELP college_erp_http_requests_total Total HTTP requests.');
    expect(output).toContain('# TYPE college_erp_http_requests_total counter');
    expect(output).toContain('college_erp_http_requests_total{method="GET",status="200"} 2');
    expect(output).toContain('college_erp_http_requests_total{method="POST",status="500"} 1');
  });

  it('returns the same series instance for the same metric and counts per label set', () => {
    const counter = registry.counter('college_erp_x_total', 'x', ['a']);
    counter.inc({ a: 'one' });
    counter.inc({ a: 'two' }, 5);
    expect(counter.value({ a: 'one' })).toBe(1);
    expect(counter.value({ a: 'two' })).toBe(5);
  });

  it('casts missing label values to empty strings instead of failing', () => {
    const counter = registry.counter('college_erp_y_total', 'y', ['a', 'b']);
    counter.inc({ a: 'present' });
    expect(registry.render()).toContain('college_erp_y_total{a="present",b=""} 1');
  });

  it('escapes quotes and backslashes in label values', () => {
    const counter = registry.counter('college_erp_z_total', 'z', ['v']);
    counter.inc({ v: 'a"b\\c' });
    expect(registry.render()).toContain('college_erp_z_total{v="a\\"b\\\\c"} 1');
  });

  it('renders gauges with set/inc/dec', () => {
    const gauge = registry.gauge('college_erp_queue_backlog', 'Backlog.', ['queue']);
    gauge.set({ queue: 'emails' }, 10);
    gauge.inc({ queue: 'emails' }, 5);
    gauge.dec({ queue: 'emails' }, 3);
    expect(gauge.value({ queue: 'emails' })).toBe(12);
    expect(registry.render()).toContain('college_erp_queue_backlog{queue="emails"} 12');
  });

  it('renders histograms with cumulative buckets, sum and count', () => {
    const histogram = registry.histogram('college_erp_latency_seconds', 'Latency.', ['route'], [0.1, 1]);
    histogram.observe({ route: '/x' }, 0.05);
    histogram.observe({ route: '/x' }, 0.5);
    histogram.observe({ route: '/x' }, 5);

    const output = registry.render();
    expect(output).toContain('# TYPE college_erp_latency_seconds histogram');
    expect(output).toContain('college_erp_latency_seconds_bucket{route="/x",le="0.1"} 1');
    expect(output).toContain('college_erp_latency_seconds_bucket{route="/x",le="1"} 2');
    expect(output).toContain('college_erp_latency_seconds_bucket{route="/x",le="+Inf"} 3');
    expect(output).toContain('college_erp_latency_seconds_sum{route="/x"} 5.55');
    expect(output).toContain('college_erp_latency_seconds_count{route="/x"} 3');
  });

  it('reuses metric definitions when requested twice', () => {
    const first = registry.counter('college_erp_same_total', 'same', ['a']);
    const second = registry.counter('college_erp_same_total', 'same', ['a']);
    expect(first).toBe(second);
  });

  it('exposes direct Counter/Gauge constructors with stable behavior', () => {
    const counter = new Counter({ name: 'c_total', help: 'c', labelNames: [] });
    counter.inc();
    counter.inc({}, 4);
    expect(counter.value()).toBe(5);

    const gauge = new Gauge({ name: 'g', help: 'g', labelNames: [] });
    gauge.set({}, 1);
    gauge.inc();
    expect(gauge.value()).toBe(2);
    expect(DEFAULT_HISTOGRAM_BUCKETS.length).toBeGreaterThan(0);
  });
});
