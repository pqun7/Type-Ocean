type MetricTags = Record<string, string | number | boolean | null | undefined>;

const counters = new Map<string, number>();
const gauges = new Map<string, number>();
const histograms = new Map<
  string,
  {
    name: string;
    tags?: MetricTags;
    buckets: number[];
    counts: number[];
    sum: number;
    count: number;
  }
>();

function keyOf(name: string, tags?: MetricTags) {
  if (!tags || Object.keys(tags).length === 0) return name;
  const suffix = Object.entries(tags)
    .filter(([, value]) => value !== undefined)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => `${key}=${String(value)}`)
    .join(",");
  return `${name}{${suffix}}`;
}

function tagsOfKey(key: string) {
  const braceIndex = key.indexOf("{");
  if (braceIndex === -1) {
    return { name: key, labels: "" };
  }

  const name = key.slice(0, braceIndex);
  const rawLabels = key.slice(braceIndex + 1, -1);
  const labels = rawLabels
    .split(",")
    .filter(Boolean)
    .map((entry) => {
      const [label, ...valueParts] = entry.split("=");
      const value = valueParts.join("=");
      return `${label}="${String(value).replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"`;
    })
    .join(",");

  return { name, labels };
}

export function incrementGatewayMetric(name: string, tags?: MetricTags, amount = 1) {
  const key = keyOf(name, tags);
  const next = (counters.get(key) ?? 0) + amount;
  counters.set(key, next);
  return next;
}

export function getGatewayMetric(name: string, tags?: MetricTags) {
  return counters.get(keyOf(name, tags)) ?? 0;
}

export function setGatewayGauge(name: string, value: number, tags?: MetricTags) {
  gauges.set(keyOf(name, tags), value);
  return value;
}

export function getGatewayGauge(name: string, tags?: MetricTags) {
  return gauges.get(keyOf(name, tags)) ?? 0;
}

export function observeGatewayHistogram(name: string, value: number, buckets: number[], tags?: MetricTags) {
  const normalizedBuckets = Array.from(new Set(buckets.filter((bucket) => Number.isFinite(bucket)).sort((a, b) => a - b)));
  const key = keyOf(name, tags);
  const existing = histograms.get(key) ?? {
    name,
    tags,
    buckets: normalizedBuckets,
    counts: new Array(normalizedBuckets.length).fill(0),
    sum: 0,
    count: 0,
  };

  if (existing.buckets.length !== normalizedBuckets.length || existing.buckets.some((bucket, index) => bucket !== normalizedBuckets[index])) {
    throw new Error(`Histogram buckets changed for ${name}`);
  }

  existing.count += 1;
  existing.sum += value;
  for (let index = 0; index < existing.buckets.length; index += 1) {
    if (value <= existing.buckets[index]!) {
      existing.counts[index] = (existing.counts[index] ?? 0) + 1;
    }
  }

  histograms.set(key, existing);
}

export function resetGatewayMetrics() {
  counters.clear();
  gauges.clear();
  histograms.clear();
}

export function listGatewayMetrics() {
  return Array.from(counters.entries())
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => ({ key, value }));
}

export function renderGatewayMetrics() {
  const lines: string[] = [];

  for (const { key, value } of listGatewayMetrics()) {
    const { name, labels } = tagsOfKey(key);
    lines.push(`# TYPE ${name} counter`);
    lines.push(labels ? `${name}{${labels}} ${value}` : `${name} ${value}`);
  }

  for (const [key, value] of Array.from(gauges.entries()).sort(([left], [right]) => left.localeCompare(right))) {
    const { name, labels } = tagsOfKey(key);
    lines.push(`# TYPE ${name} gauge`);
    lines.push(labels ? `${name}{${labels}} ${value}` : `${name} ${value}`);
  }

  for (const [key, histogram] of Array.from(histograms.entries()).sort(([left], [right]) => left.localeCompare(right))) {
    const { name, labels } = tagsOfKey(key);
    lines.push(`# TYPE ${name} histogram`);

    for (let index = 0; index < histogram.buckets.length; index += 1) {
      const bucket = histogram.buckets[index]!;
      const bucketLabels = labels ? `${labels},le="${bucket}"` : `le="${bucket}"`;
      lines.push(`${name}_bucket{${bucketLabels}} ${histogram.counts[index] ?? 0}`);
    }

    const infLabels = labels ? `${labels},le="+Inf"` : `le="+Inf"`;
    lines.push(`${name}_bucket{${infLabels}} ${histogram.count}`);
    lines.push(labels ? `${name}_sum{${labels}} ${histogram.sum}` : `${name}_sum ${histogram.sum}`);
    lines.push(labels ? `${name}_count{${labels}} ${histogram.count}` : `${name}_count ${histogram.count}`);
  }

  return lines.join("\n");
}
