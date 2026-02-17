import { SlidingWindowAlgorithm } from '../src/algorithms/sliding-window';
import type { Store, StoreEntry } from '../src/stores/types';
import { now, setMockedTime, advanceTime, resetMockedTime } from './helpers/time';

/**
 * Simple in-memory store for testing purposes.
 */
class MockStore implements Store {
  private data = new Map<string, { entry: StoreEntry; expiresAt: number }>();

  get(key: string): Promise<StoreEntry | null> {
    const item = this.data.get(key);
    if (!item) {
      return Promise.resolve(null);
    }
    if (item.expiresAt <= now()) {
      this.data.delete(key);
      return Promise.resolve(null);
    }
    return Promise.resolve(item.entry);
  }

  set(key: string, entry: StoreEntry, ttlMs: number): Promise<void> {
    this.data.set(key, {
      entry,
      expiresAt: now() + ttlMs,
    });
    return Promise.resolve();
  }

  increment(key: string, field: keyof StoreEntry, ttlMs: number): Promise<number> {
    return this.get(key).then((existing) => {
      const currentValue = (existing?.[field] as number) ?? 0;
      const newValue = currentValue + 1;
      this.data.set(key, {
        entry: { ...existing, [field]: newValue },
        expiresAt: now() + ttlMs,
      });
      return newValue;
    });
  }

  delete(key: string): Promise<void> {
    this.data.delete(key);
    return Promise.resolve();
  }

  destroy(): Promise<void> {
    this.data.clear();
    return Promise.resolve();
  }

  // Helper for tests to inspect store state
  getEntry(key: string): StoreEntry | undefined {
    return this.data.get(key)?.entry;
  }
}

describe('SlidingWindowAlgorithm', () => {
  let store: MockStore;
  let algorithm: SlidingWindowAlgorithm;

  const BASE_TIME = 1000000;
  const WINDOW_MS = 10000; // 10 seconds
  const LIMIT = 3;

  beforeEach(() => {
    setMockedTime(BASE_TIME);
    store = new MockStore();
    algorithm = new SlidingWindowAlgorithm(store, {
      limit: LIMIT,
      windowMs: WINDOW_MS,
      getCurrentTime: now,
    });
  });

  afterEach(async () => {
    await algorithm.destroy();
    resetMockedTime();
  });

  describe('requests within limit', () => {
    it('should allow first request', async () => {
      const result = await algorithm.consume('test-key');

      expect(result.allowed).toBe(true);
      expect(result.limit).toBe(LIMIT);
      expect(result.remaining).toBe(2);
      expect(result.retryAfter).toBeUndefined();
    });

    it('should allow multiple requests up to the limit', async () => {
      const result1 = await algorithm.consume('test-key');
      expect(result1.allowed).toBe(true);
      expect(result1.remaining).toBe(2);

      advanceTime(100);
      const result2 = await algorithm.consume('test-key');
      expect(result2.allowed).toBe(true);
      expect(result2.remaining).toBe(1);

      advanceTime(100);
      const result3 = await algorithm.consume('test-key');
      expect(result3.allowed).toBe(true);
      expect(result3.remaining).toBe(0);
    });

    it('should track separate keys independently', async () => {
      await algorithm.consume('key-1');
      await algorithm.consume('key-1');

      const result1 = await algorithm.consume('key-1');
      expect(result1.remaining).toBe(0);

      const result2 = await algorithm.consume('key-2');
      expect(result2.allowed).toBe(true);
      expect(result2.remaining).toBe(2);
    });
  });

  describe('requests over limit', () => {
    it('should reject request when limit is exceeded', async () => {
      // Use up all allowed requests
      await algorithm.consume('test-key');
      advanceTime(100);
      await algorithm.consume('test-key');
      advanceTime(100);
      await algorithm.consume('test-key');

      // Fourth request should be rejected
      advanceTime(100);
      const result = await algorithm.consume('test-key');

      expect(result.allowed).toBe(false);
      expect(result.remaining).toBe(0);
      expect(result.retryAfter).toBeDefined();
      expect(result.retryAfter).toBeGreaterThan(0);
    });

    it('should provide correct retryAfter value', async () => {
      // First request at BASE_TIME
      await algorithm.consume('test-key');
      advanceTime(1000); // +1 second
      await algorithm.consume('test-key');
      advanceTime(1000); // +2 seconds
      await algorithm.consume('test-key');

      // Now at BASE_TIME + 2000, try another request
      advanceTime(1000); // +3 seconds
      const result = await algorithm.consume('test-key');

      expect(result.allowed).toBe(false);
      // Oldest timestamp is at BASE_TIME, expires at BASE_TIME + 10000
      // Current time is BASE_TIME + 3000
      // retryAfter should be ceil((10000 - 3000) / 1000) = 7 seconds
      expect(result.retryAfter).toBe(7);
    });
  });

  describe('sliding window behavior', () => {
    it('should clean up old timestamps and allow new requests', async () => {
      // Make 3 requests - use up the limit
      await algorithm.consume('test-key');
      advanceTime(100);
      await algorithm.consume('test-key');
      advanceTime(100);
      await algorithm.consume('test-key');

      // Verify we're at the limit
      advanceTime(100);
      const resultAtLimit = await algorithm.consume('test-key');
      expect(resultAtLimit.allowed).toBe(false);

      // Advance time past the window for the first request
      advanceTime(WINDOW_MS); // Move past the window

      // Now the oldest request should have expired, allowing a new one
      const result = await algorithm.consume('test-key');
      expect(result.allowed).toBe(true);
    });

    it('should correctly trim timestamps older than window', async () => {
      // Make requests at different times
      await algorithm.consume('test-key'); // at BASE_TIME
      advanceTime(3000);
      await algorithm.consume('test-key'); // at BASE_TIME + 3000
      advanceTime(3000);
      await algorithm.consume('test-key'); // at BASE_TIME + 6000

      // Jump forward so first timestamp is outside window
      advanceTime(5000); // Now at BASE_TIME + 11000

      // First timestamp (BASE_TIME) should be outside window
      // Window start: BASE_TIME + 11000 - 10000 = BASE_TIME + 1000
      // Only timestamps > BASE_TIME + 1000 should remain

      const result = await algorithm.consume('test-key');
      expect(result.allowed).toBe(true);
      // 2 old timestamps remain (at +3000 and +6000), plus new one = 3
      expect(result.remaining).toBe(0);
    });

    it('should handle requests spread across window boundary', async () => {
      // Make 2 requests early in the window
      await algorithm.consume('test-key'); // at BASE_TIME
      advanceTime(1000);
      await algorithm.consume('test-key'); // at BASE_TIME + 1000

      // Advance to near the end of the window for first request
      advanceTime(8500); // Now at BASE_TIME + 9500

      // Make another request - still within limits
      const result1 = await algorithm.consume('test-key');
      expect(result1.allowed).toBe(true);
      expect(result1.remaining).toBe(0);

      // Advance just past the first request's window
      advanceTime(600); // Now at BASE_TIME + 10100

      // First request timestamp is now outside window
      // Should allow a new request
      const result2 = await algorithm.consume('test-key');
      expect(result2.allowed).toBe(true);
      expect(result2.remaining).toBe(0);
    });

    it('should progressively allow requests as old ones expire', async () => {
      // Fill up the limit with 1-second gaps
      await algorithm.consume('test-key'); // t=0
      advanceTime(1000);
      await algorithm.consume('test-key'); // t=1s
      advanceTime(1000);
      await algorithm.consume('test-key'); // t=2s

      // Advance to t=10.5s (just past first request's window)
      advanceTime(8500);

      const result1 = await algorithm.consume('test-key');
      expect(result1.allowed).toBe(true);

      // Advance to t=11.5s (past second request's window)
      advanceTime(1000);

      const result2 = await algorithm.consume('test-key');
      expect(result2.allowed).toBe(true);
    });
  });

  describe('reset', () => {
    it('should clear all timestamps for a key', async () => {
      // Make some requests
      await algorithm.consume('test-key');
      await algorithm.consume('test-key');
      await algorithm.consume('test-key');

      // Reset the key
      await algorithm.reset('test-key');

      // Should be able to make requests again as if fresh
      const result = await algorithm.consume('test-key');
      expect(result.allowed).toBe(true);
      expect(result.remaining).toBe(2);
    });

    it('should only reset the specified key', async () => {
      await algorithm.consume('key-1');
      await algorithm.consume('key-1');
      await algorithm.consume('key-2');

      await algorithm.reset('key-1');

      // key-1 should be fresh
      const result1 = await algorithm.consume('key-1');
      expect(result1.remaining).toBe(2);

      // key-2 should be unaffected
      const result2 = await algorithm.consume('key-2');
      expect(result2.remaining).toBe(1);
    });
  });

  describe('resetAt calculation', () => {
    it('should return correct resetAt for allowed requests', async () => {
      const result = await algorithm.consume('test-key');

      // resetAt should be when the oldest timestamp in window expires
      const expectedResetAt = new Date(BASE_TIME + WINDOW_MS);
      expect(result.resetAt).toEqual(expectedResetAt);
    });

    it('should return correct resetAt based on oldest timestamp', async () => {
      await algorithm.consume('test-key'); // at BASE_TIME
      advanceTime(2000);
      await algorithm.consume('test-key'); // at BASE_TIME + 2000

      const result = await algorithm.consume('test-key');

      // Oldest timestamp is BASE_TIME, so resetAt should be BASE_TIME + WINDOW_MS
      const expectedResetAt = new Date(BASE_TIME + WINDOW_MS);
      expect(result.resetAt).toEqual(expectedResetAt);
    });
  });

  describe('edge cases', () => {
    it('should handle limit of 1', async () => {
      const singleLimitAlgo = new SlidingWindowAlgorithm(store, {
        limit: 1,
        windowMs: WINDOW_MS,
        getCurrentTime: now,
      });

      const result1 = await singleLimitAlgo.consume('test-key');
      expect(result1.allowed).toBe(true);
      expect(result1.remaining).toBe(0);

      const result2 = await singleLimitAlgo.consume('test-key');
      expect(result2.allowed).toBe(false);

      await singleLimitAlgo.destroy();
    });

    it('should handle very short window', async () => {
      const shortWindowAlgo = new SlidingWindowAlgorithm(store, {
        limit: 2,
        windowMs: 100, // 100ms window
        getCurrentTime: now,
      });

      await shortWindowAlgo.consume('test-key');
      await shortWindowAlgo.consume('test-key');

      // Should be at limit
      const result1 = await shortWindowAlgo.consume('test-key');
      expect(result1.allowed).toBe(false);

      // Advance past window
      advanceTime(150);

      const result2 = await shortWindowAlgo.consume('test-key');
      expect(result2.allowed).toBe(true);

      await shortWindowAlgo.destroy();
    });

    it('should handle non-existent key on reset', async () => {
      // Should not throw
      await expect(algorithm.reset('non-existent-key')).resolves.not.toThrow();
    });
  });
});
