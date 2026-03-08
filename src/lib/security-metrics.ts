type MetricTags = Record<string, string | number | boolean | null | undefined>;

type MetricStore = Map<string, number>;

function getStore(): MetricStore {
  const scope = globalThis as typeof globalThis & { __typeSpaceSecurityMetrics?: MetricStore };
  if (!scope.__typeSpaceSecurityMetrics) {
    scope.__typeSpaceSecurityMetrics = new Map<string, number>();
  }
  return scope.__typeSpaceSecurityMetrics;
}

function buildKey(name: string, tags?: MetricTags) {
  if (!tags || Object.keys(tags).length === 0) return name;

  const suffix = Object.entries(tags)
    .filter(([, value]) => value !== undefined)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => `${key}=${String(value)}`)
    .join(",");

  return `${name}{${suffix}}`;
}

export function incrementSecurityMetric(name: string, tags?: MetricTags) {
  const store = getStore();
  const key = buildKey(name, tags);
  const next = (store.get(key) ?? 0) + 1;
  store.set(key, next);
  return next;
}

export function getSecurityMetric(name: string, tags?: MetricTags) {
  return getStore().get(buildKey(name, tags)) ?? 0;
}
