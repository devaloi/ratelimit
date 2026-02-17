import { TokenBucketAlgorithm } from '../src/algorithms/token-bucket';
import type { Store, StoreEntry } from '../src/stores/types';
import { now, setMockedTime, advanceTime, resetMockedTime } from './helpers/time';

/**
 * In-memory store implementation for testing.
 */
class MockStore implements Store {
  private data = new Map<string, { entry: StoreEntry; expiresAt: number }>();
  private currentTime: () => number;

  constructor(getCurrentTime: () => number) {
    this.currentTime = getCurrentTime;
  }

  get(key: string): Promise<StoreEntry | null> {
    const record = this.data.get(key);
    if (!record) {
      return Promise.resolve(null);
    }
    // Check expiration
    if (record.expiresAt < this.currentTime()) {
      this.data.delete(key);
      return Promise.resolve(null);
    }
    return Promise.resolve(record.entry);
  }

  set(key: string, entry: StoreEntry, ttlMs: number): Promise<void> {
    this.data.set(key, {
      entry,
      expiresAt: this.currentTime() + ttlMs,
    });
    return Promise.resolve();
  }

  increment(_key: string, _field: keyof StoreEntry, _ttlMs: number): Promise<number> {
    // Not used by token bucket
    throw new Error('Not implemented');
  }

  delete(key: string): Promise<void> {
    this.data.delete(key);
    return Promise.resolve();
  }

  destroy(): Promise<void> {
    this.data.clear();
    return Promise.resolve();
  }
}

describe('TokenBucketAlgorithm', () => {
  let store: MockStore;
  let algorithm: TokenBucketAlgorithm;

  beforeEach(() => {
    // Start with a fixed time
    setMockedTime(1000000);
    store = new MockStore(now);
  });

  afterEach(async () => {
    await algorithm?.destroy();
    resetMockedTime();
  });

  describe('constructor validation', () => {
    it('should throw if capacity is 0', () => {
      expect(() => {
        new TokenBucketAlgorithm(store, {
          capacity: 0,
          refillRate: 1,
          getCurrentTime: now,
        });
      }).toThrow('Token bucket capacity must be > 0');
    });

    it('should throw if capacity is negative', () => {
      expect(() => {
        new TokenBucketAlgorithm(store, {
          capacity: -5,
          refillRate: 1,
          getCurrentTime: now,
        });
      }).toThrow('Token bucket capacity must be > 0');
    });

    it('should throw if refillRate is 0', () => {
      expect(() => {
        new TokenBucketAlgorithm(store, {
          capacity: 10,
          refillRate: 0,
          getCurrentTime: now,
        });
      }).toThrow('Token bucket refillRate must be > 0');
    });

    it('should throw if refillRate is negative', () => {
      expect(() => {
        new TokenBucketAlgorithm(store, {
          capacity: 10,
          refillRate: -1,
          getCurrentTime: now,
        });
      }).toThrow('Token bucket refillRate must be > 0');
    });
  });

  describe('basic functionality', () => {
    beforeEach(() => {
      algorithm = new TokenBucketAlgorithm(store, {
        capacity: 5,
        refillRate: 1, // 1 token per second
        getCurrentTime: now,
      });
    });

    it('should allow first request with full bucket', async () => {
      const result = await algorithm.consume('test-key');

      expect(result.allowed).toBe(true);
      expect(result.limit).toBe(5);
      expect(result.remaining).toBe(4);
    });

    it('should return correct resetAt time', async () => {
      const result = await algorithm.consume('test-key');

      // After consuming 1 token, we have 4 remaining
      // Need 1 token to be full, at 1 token/second = 1 second
      const expectedResetAt = now() + 1000;
      expect(result.resetAt.getTime()).toBe(expectedResetAt);
    });

    it('should decrement tokens on each request', async () => {
      const result1 = await algorithm.consume('test-key');
      const result2 = await algorithm.consume('test-key');
      const result3 = await algorithm.consume('test-key');

      expect(result1.remaining).toBe(4);
      expect(result2.remaining).toBe(3);
      expect(result3.remaining).toBe(2);
    });

    it('should track separate keys independently', async () => {
      await algorithm.consume('key-a');
      await algorithm.consume('key-a');
      const resultA = await algorithm.consume('key-a');

      const resultB = await algorithm.consume('key-b');

      expect(resultA.remaining).toBe(2);
      expect(resultB.remaining).toBe(4);
    });
  });

  describe('burst handling - up to capacity', () => {
    beforeEach(() => {
      algorithm = new TokenBucketAlgorithm(store, {
        capacity: 10,
        refillRate: 2, // 2 tokens per second
        getCurrentTime: now,
      });
    });

    it('should allow burst up to full capacity', async () => {
      // Make 10 requests immediately (burst)
      const results = [];
      for (let i = 0; i < 10; i++) {
        results.push(await algorithm.consume('burst-key'));
      }

      // All 10 should be allowed
      expect(results.every((r) => r.allowed)).toBe(true);
      expect(results[0].remaining).toBe(9);
      expect(results[9].remaining).toBe(0);
    });

    it('should deny request after burst exhausts capacity', async () => {
      // Exhaust all 10 tokens
      for (let i = 0; i < 10; i++) {
        await algorithm.consume('burst-key');
      }

      // 11th request should be denied
      const result = await algorithm.consume('burst-key');

      expect(result.allowed).toBe(false);
      expect(result.remaining).toBe(0);
      expect(result.retryAfter).toBeDefined();
    });

    it('should provide correct retryAfter when denied', async () => {
      // Exhaust all tokens
      for (let i = 0; i < 10; i++) {
        await algorithm.consume('burst-key');
      }

      const result = await algorithm.consume('burst-key');

      // With refillRate of 2 tokens/second, need 0.5 seconds for 1 token
      // Math.ceil(0.5) = 1 second
      expect(result.retryAfter).toBe(1);
    });
  });

  describe('steady rate at refill speed', () => {
    beforeEach(() => {
      algorithm = new TokenBucketAlgorithm(store, {
        capacity: 5,
        refillRate: 1, // 1 token per second
        getCurrentTime: now,
      });
    });

    it('should allow requests at exactly refill rate indefinitely', async () => {
      // First request uses one token (4 remaining)
      let result = await algorithm.consume('steady-key');
      expect(result.allowed).toBe(true);

      // Make requests at exactly 1 per second (matching refill rate)
      for (let i = 0; i < 10; i++) {
        advanceTime(1000); // 1 second
        result = await algorithm.consume('steady-key');
        expect(result.allowed).toBe(true);
      }
    });

    it('should maintain stable token count at steady rate', async () => {
      // Drain to a specific level first
      await algorithm.consume('steady-key'); // 4 remaining
      await algorithm.consume('steady-key'); // 3 remaining
      await algorithm.consume('steady-key'); // 2 remaining

      // Now go at steady rate
      advanceTime(1000); // +1 token = 3
      const result1 = await algorithm.consume('steady-key'); // -1 = 2
      expect(result1.remaining).toBe(2);

      advanceTime(1000); // +1 token = 3
      const result2 = await algorithm.consume('steady-key'); // -1 = 2
      expect(result2.remaining).toBe(2);

      advanceTime(1000); // +1 token = 3
      const result3 = await algorithm.consume('steady-key'); // -1 = 2
      expect(result3.remaining).toBe(2);
    });
  });

  describe('recovery after drain', () => {
    beforeEach(() => {
      algorithm = new TokenBucketAlgorithm(store, {
        capacity: 5,
        refillRate: 2, // 2 tokens per second
        getCurrentTime: now,
      });
    });

    it('should refill tokens over time', async () => {
      // Exhaust all tokens
      for (let i = 0; i < 5; i++) {
        await algorithm.consume('drain-key');
      }

      // Verify denied
      let result = await algorithm.consume('drain-key');
      expect(result.allowed).toBe(false);

      // Wait 1 second (2 tokens refilled at 2/sec)
      advanceTime(1000);

      result = await algorithm.consume('drain-key');
      expect(result.allowed).toBe(true);
      expect(result.remaining).toBe(1); // 2 refilled - 1 consumed = 1
    });

    it('should fully recover after sufficient time', async () => {
      // Exhaust all tokens
      for (let i = 0; i < 5; i++) {
        await algorithm.consume('drain-key');
      }

      // Wait enough time to fully refill (5 tokens at 2/sec = 2.5 seconds)
      advanceTime(3000); // 3 seconds to be safe

      const result = await algorithm.consume('drain-key');
      expect(result.allowed).toBe(true);
      expect(result.remaining).toBe(4); // Full bucket (5) minus 1 consumed
    });

    it('should partially recover based on elapsed time', async () => {
      // Exhaust all tokens
      for (let i = 0; i < 5; i++) {
        await algorithm.consume('drain-key');
      }

      // Wait 0.5 seconds (1 token refilled at 2/sec)
      advanceTime(500);

      const result = await algorithm.consume('drain-key');
      expect(result.allowed).toBe(true);
      expect(result.remaining).toBe(0); // 1 refilled - 1 consumed = 0
    });
  });

  describe('bucket never exceeds capacity', () => {
    beforeEach(() => {
      algorithm = new TokenBucketAlgorithm(store, {
        capacity: 5,
        refillRate: 10, // Fast refill: 10 tokens per second
        getCurrentTime: now,
      });
    });

    it('should cap tokens at capacity even after long idle period', async () => {
      // Use one token
      await algorithm.consume('cap-key');

      // Wait a very long time (much more than needed to refill)
      advanceTime(60000); // 1 minute

      const result = await algorithm.consume('cap-key');
      expect(result.allowed).toBe(true);
      expect(result.remaining).toBe(4); // Capped at 5, minus 1 = 4
    });

    it('should not accumulate tokens beyond capacity', async () => {
      // Drain half the bucket
      await algorithm.consume('cap-key'); // 4
      await algorithm.consume('cap-key'); // 3
      await algorithm.consume('cap-key'); // 2

      // Wait long enough to "overfill" if not capped
      advanceTime(10000); // 10 seconds at 10/sec = 100 tokens theoretically

      const result = await algorithm.consume('cap-key');
      expect(result.allowed).toBe(true);
      expect(result.remaining).toBe(4); // Still capped at 5 - 1 = 4
    });
  });

  describe('reset functionality', () => {
    beforeEach(() => {
      algorithm = new TokenBucketAlgorithm(store, {
        capacity: 5,
        refillRate: 1,
        getCurrentTime: now,
      });
    });

    it('should reset bucket to full capacity', async () => {
      // Exhaust all tokens
      for (let i = 0; i < 5; i++) {
        await algorithm.consume('reset-key');
      }

      // Verify denied
      let result = await algorithm.consume('reset-key');
      expect(result.allowed).toBe(false);

      // Reset the bucket
      await algorithm.reset('reset-key');

      // Should now have full capacity
      result = await algorithm.consume('reset-key');
      expect(result.allowed).toBe(true);
      expect(result.remaining).toBe(4); // Full (5) - 1 = 4
    });

    it('should only affect the specified key', async () => {
      // Drain both keys
      for (let i = 0; i < 5; i++) {
        await algorithm.consume('key-a');
        await algorithm.consume('key-b');
      }

      // Reset only key-a
      await algorithm.reset('key-a');

      const resultA = await algorithm.consume('key-a');
      const resultB = await algorithm.consume('key-b');

      expect(resultA.allowed).toBe(true);
      expect(resultB.allowed).toBe(false);
    });
  });

  describe('edge cases', () => {
    it('should handle fractional token accumulation', async () => {
      algorithm = new TokenBucketAlgorithm(store, {
        capacity: 10,
        refillRate: 0.5, // 0.5 tokens per second (1 token per 2 seconds)
        getCurrentTime: now,
      });

      // Exhaust all tokens
      for (let i = 0; i < 10; i++) {
        await algorithm.consume('frac-key');
      }

      // Wait 1 second (only 0.5 tokens)
      advanceTime(1000);
      let result = await algorithm.consume('frac-key');
      expect(result.allowed).toBe(false);

      // Wait another 1 second (total 0.5 + 0.5 = 1 token, but previous consume was denied so we have 0.5 tokens still)
      // Actually the denied request didn't consume, so we have 0.5 tokens
      // Need total 2 seconds from empty to get 1 token
      advanceTime(1000);
      result = await algorithm.consume('frac-key');
      expect(result.allowed).toBe(true);
    });

    it('should handle very high refill rate', async () => {
      algorithm = new TokenBucketAlgorithm(store, {
        capacity: 100,
        refillRate: 1000, // 1000 tokens per second
        getCurrentTime: now,
      });

      // Exhaust all tokens
      for (let i = 0; i < 100; i++) {
        await algorithm.consume('high-rate-key');
      }

      // Wait just 10ms (should add 10 tokens)
      advanceTime(10);

      const result = await algorithm.consume('high-rate-key');
      expect(result.allowed).toBe(true);
      expect(result.remaining).toBe(9); // 10 refilled - 1 consumed
    });

    it('should handle retryAfter correctly with low refill rate', async () => {
      algorithm = new TokenBucketAlgorithm(store, {
        capacity: 2,
        refillRate: 0.1, // 0.1 tokens per second (1 token per 10 seconds)
        getCurrentTime: now,
      });

      // Exhaust all tokens
      await algorithm.consume('slow-key');
      await algorithm.consume('slow-key');

      const result = await algorithm.consume('slow-key');
      expect(result.allowed).toBe(false);
      // Need 1 token at 0.1 tokens/second = 10 seconds
      expect(result.retryAfter).toBe(10);
    });

    it('should handle concurrent keys without interference', async () => {
      algorithm = new TokenBucketAlgorithm(store, {
        capacity: 3,
        refillRate: 1,
        getCurrentTime: now,
      });

      // Interleave requests across multiple keys
      await algorithm.consume('key-1');
      await algorithm.consume('key-2');
      await algorithm.consume('key-1');
      await algorithm.consume('key-3');
      await algorithm.consume('key-2');
      await algorithm.consume('key-1'); // key-1 now at 0

      const result1 = await algorithm.consume('key-1');
      const result2 = await algorithm.consume('key-2');
      const result3 = await algorithm.consume('key-3');

      expect(result1.allowed).toBe(false); // key-1 exhausted
      expect(result2.allowed).toBe(true); // key-2 has 1 remaining → 0 after
      expect(result3.allowed).toBe(true); // key-3 has 2 remaining → 1 after
      expect(result3.remaining).toBe(1);
    });
  });

  describe('destroy', () => {
    it('should clean up store resources', async () => {
      algorithm = new TokenBucketAlgorithm(store, {
        capacity: 5,
        refillRate: 1,
        getCurrentTime: now,
      });

      await algorithm.consume('some-key');

      // Should not throw
      await expect(algorithm.destroy()).resolves.toBeUndefined();
    });
  });
});
