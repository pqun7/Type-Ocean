export type UserCacheOptions = {
  ttlMs: number;
  maxEntries: number;
};

type UserCacheEntry<T> = {
  data: T;
  expiresAt: number;
};

/**
 * Small in-memory cache with TTL and LRU-style eviction via Map insertion order.
 * This keeps the contract simple so we can later swap backing storage (e.g. Redis).
 */
export class UserCache<T> {
  private readonly ttlMs: number;
  private readonly maxEntries: number;
  private readonly entries = new Map<string, UserCacheEntry<T>>();

  constructor(options: UserCacheOptions) {
    this.ttlMs = Math.max(1_000, options.ttlMs);
    this.maxEntries = Math.max(1, options.maxEntries);
  }

  get(key: string): T | null {
    const now = Date.now();
    const existing = this.entries.get(key);
    if (!existing) return null;

    if (existing.expiresAt <= now) {
      this.entries.delete(key);
      return null;
    }

    // Move to end to mark as recently used.
    this.entries.delete(key);
    this.entries.set(key, existing);
    return existing.data;
  }

  set(key: string, value: T) {
    const entry: UserCacheEntry<T> = {
      data: value,
      expiresAt: Date.now() + this.ttlMs,
    };

    if (this.entries.has(key)) {
      this.entries.delete(key);
    }

    this.entries.set(key, entry);
    this.evictIfNeeded(Date.now());
  }

  invalidate(key: string) {
    this.entries.delete(key);
  }

  async getOrLoad(key: string, loader: () => Promise<T>): Promise<T> {
    const cached = this.get(key);
    if (cached) return cached;

    const loaded = await loader();
    this.set(key, loaded);
    return loaded;
  }

  clearExpired(now = Date.now()) {
    for (const [key, entry] of this.entries) {
      if (entry.expiresAt <= now) {
        this.entries.delete(key);
      }
    }
  }

  size() {
    return this.entries.size;
  }

  private evictIfNeeded(now: number) {
    this.clearExpired(now);
    while (this.entries.size > this.maxEntries) {
      const oldestKey = this.entries.keys().next().value;
      if (!oldestKey) break;
      this.entries.delete(oldestKey);
    }
  }
}
