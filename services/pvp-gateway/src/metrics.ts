type MetricTags = Record<string, string | number | boolean | null | undefined>;

const counters = new Map<string, number>();

function keyOf(name: string, tags?: MetricTags) {
  if (!tags || Object.keys(tags).length === 0) return name;
  const suffix = Object.entries(tags)
    .filter(([, value]) => value !== undefined)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => `${key}=${String(value)}`)
    .join(",");
  return `${name}{${suffix}}`;
}

export function incrementGatewayMetric(name: string, tags?: MetricTags) {
  const key = keyOf(name, tags);
  const next = (counters.get(key) ?? 0) + 1;
  counters.set(key, next);
  return next;
}

export function getGatewayMetric(name: string, tags?: MetricTags) {
  return counters.get(keyOf(name, tags)) ?? 0;
}
