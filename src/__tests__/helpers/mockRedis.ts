/**
 * Production-ready Redis mock for comprehensive testing
 */
class MockRedis {
  private store: Map<string, { value: string; ttl?: number; expires?: number }> = new Map();
  private connectionStatus: 'connected' | 'disconnected' | 'error' = 'connected';

  // Basic Redis operations
  async get(key: string): Promise<string | null> {
    if (this.connectionStatus === 'error') {
      throw new Error('Redis connection failed');
    }

    const item = this.store.get(key);
    if (!item) return null;

    // Check TTL expiration
    if (item.expires && Date.now() > item.expires) {
      this.store.delete(key);
      return null;
    }

    return item.value;
  }

  async set(key: string, value: string): Promise<string> {
    if (this.connectionStatus === 'error') {
      throw new Error('Redis connection failed');
    }

    this.store.set(key, { value });
    return 'OK';
  }

  async setEx(key: string, seconds: number, value: string): Promise<string> {
    if (this.connectionStatus === 'error') {
      throw new Error('Redis connection failed');
    }

    const expires = Date.now() + (seconds * 1000);
    this.store.set(key, { value, ttl: seconds, expires });
    return 'OK';
  }

  async del(key: string): Promise<number> {
    if (this.connectionStatus === 'error') {
      throw new Error('Redis connection failed');
    }

    const existed = this.store.has(key);
    this.store.delete(key);
    return existed ? 1 : 0;
  }

  async exists(key: string): Promise<number> {
    if (this.connectionStatus === 'error') {
      throw new Error('Redis connection failed');
    }

    const item = this.store.get(key);
    if (!item) return 0;

    // Check TTL expiration
    if (item.expires && Date.now() > item.expires) {
      this.store.delete(key);
      return 0;
    }

    return 1;
  }

  async ttl(key: string): Promise<number> {
    if (this.connectionStatus === 'error') {
      throw new Error('Redis connection failed');
    }

    const item = this.store.get(key);
    if (!item || !item.expires) return -1;

    const remaining = Math.floor((item.expires - Date.now()) / 1000);
    return remaining > 0 ? remaining : -2;
  }

  // Pattern-based operations
  async keys(pattern: string): Promise<string[]> {
    if (this.connectionStatus === 'error') {
      throw new Error('Redis connection failed');
    }

    const regex = new RegExp(pattern.replace(/\*/g, '.*'));
    return Array.from(this.store.keys()).filter(key => regex.test(key));
  }

  // Batch operations for performance testing
  async mget(...keys: string[]): Promise<(string | null)[]> {
    if (this.connectionStatus === 'error') {
      throw new Error('Redis connection failed');
    }

    return Promise.all(keys.map(key => this.get(key)));
  }

  async mset(keyValuePairs: Record<string, string>): Promise<string> {
    if (this.connectionStatus === 'error') {
      throw new Error('Redis connection failed');
    }

    Object.entries(keyValuePairs).forEach(([key, value]) => {
      this.store.set(key, { value });
    });
    return 'OK';
  }

  // Connection simulation
  setConnectionStatus(status: 'connected' | 'disconnected' | 'error') {
    this.connectionStatus = status;
  }

  isConnected(): boolean {
    return this.connectionStatus === 'connected';
  }

  // Test utilities
  clear(): void {
    this.store.clear();
  }

  size(): number {
    return this.store.size;
  }

  getAll(): Record<string, { value: string; ttl?: number; expires?: number }> {
    const result: Record<string, { value: string; ttl?: number; expires?: number }> = {};
    for (const [key, item] of this.store.entries()) {
      result[key] = item;
    }
    return result;
  }

  // Simulate network latency
  async withLatency<T>(operation: () => Promise<T>, delay: number = 10): Promise<T> {
    await new Promise(resolve => setTimeout(resolve, delay));
    return operation();
  }

  // Performance testing methods
  simulateSlowResponse(delay: number = 1000): void {
    const originalGet = this.get.bind(this);
    this.get = async (key: string) => {
      await new Promise(resolve => setTimeout(resolve, delay));
      return originalGet(key);
    };
  }

  // Circuit breaker simulation
  private failureCount = 0;
  private isCircuitOpen = false;

  simulateCircuitBreaker(failureThreshold: number = 3): void {
    const originalGet = this.get.bind(this);
    this.get = async (key: string) => {
      if (this.isCircuitOpen) {
        throw new Error('Circuit breaker is open');
      }

      try {
        const result = await originalGet(key);
        this.failureCount = 0; // Reset on success
        return result;
      } catch (error) {
        this.failureCount++;
        if (this.failureCount >= failureThreshold) {
          this.isCircuitOpen = true;
          setTimeout(() => {
            this.isCircuitOpen = false;
            this.failureCount = 0;
          }, 5000); // Reset after 5 seconds
        }
        throw error;
      }
    };
  }
}

// Create singleton instance
const mockRedis = new MockRedis();

// Export both the class and instance
export { MockRedis };
export default mockRedis;

// Jest setup utilities
export const setupRedisMocks = () => {
  return {
    mockSuccessfulOperation: () => {
      mockRedis.setConnectionStatus('connected');
      mockRedis.clear();
    },
    mockConnectionFailure: () => {
      mockRedis.setConnectionStatus('error');
    },
    mockSlowResponse: (delay: number = 1000) => {
      mockRedis.simulateSlowResponse(delay);
    },
    mockCircuitBreaker: (threshold: number = 3) => {
      mockRedis.simulateCircuitBreaker(threshold);
    },
    cleanup: () => {
      mockRedis.setConnectionStatus('connected');
      mockRedis.clear();
    }
  };
};