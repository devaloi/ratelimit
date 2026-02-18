import { FixedWindowAlgorithm } from '../src/algorithms/fixed-window';
import type { Store, StoreEntry } from '../src/stores/types';
import { now, setMockedTime, advanceTime, resetMockedTime } from './helpers/time';

/**
 * Simple in-memory store mock for testing.
 */
class MockStore implements Store {
  private data = new Map<string, { entry: StoreEntry; expiresAt: number }>();

  get(key: string): Promise<StoreEntry | null> {
    const item = this.data.get(key);
    if (!item) {
      return Promise.resolve(null);
    }
    if (now() >= item.expiresAt) {
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
    const item = this.data.get(key);
    let entry: StoreEntry;
    let expiresAt: number;

    if (!item || now() >= item.expiresAt) {
      // Create new entry
      entry = {};
      (entry as Record<string, number>)[field] = 1;
      expiresAt = now() + ttlMs;
    } else {
      // Increment existing
      entry = item.entry;
      const currentValue = (entry[field] as number) ?? 0;
      (entry as Record<string, number>)[field] = currentValue + 1;
      expiresAt = item.expiresAt;
    }

    this.data.set(key, { entry, expiresAt });
    return Promise.resolve(entry[field] as number);
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

describe('FixedWindowAlgorithm', () => {
  let store: MockStore;
  let algorithm: FixedWindowAlgorithm;
  const BASE_TIME = 1000000000000; // Fixed base timestamp for testing
  const WINDOW_MS = 60000; // 1 minute window
  const LIMIT = 5;

  beforeEach(() => {
    store = new MockStore();
    setMockedTime(BASE_TIME);
    algorithm = new FixedWindowAlgorithm({
      limit: LIMIT,
      windowMs: WINDOW_MS,
      store,
      getCurrentTime: now,
    });
  });

  afterEach(async () => {
    resetMockedTime();
    await algorithm.destroy();
  });

  describe('requests within limit', () => {
    it('should allow first request', async () => {
      const result = await algorithm.consume('user:1');

      expect(result.allowed).toBe(true);
      expect(result.limit).toBe(LIMIT);
      expect(result.remaining).toBe(4);
    });

    it('should allow requests up to the limit', async () => {
      for (let i = 0; i < LIMIT; i++) {
        const result = await algorithm.consume('user:1');
        expect(result.allowed).toBe(true);
        expect(result.remaining).toBe(LIMIT - i - 1);
      }
    });

    it('should track different keys independently', async () => {
      // Use all requests for user:1
      for (let i = 0; i < LIMIT; i++) {
        await algorithm.consume('user:1');
      }

      // user:2 should still have full quota
      const result = await algorithm.consume('user:2');
      expect(result.allowed).toBe(true);
      expect(result.remaining).toBe(4);
    });
  });

  describe('requests over limit', () => {
    it('should reject requests over the limit', async () => {
      // Exhaust the limit
      for (let i = 0; i < LIMIT; i++) {
        await algorithm.consume('user:1');
      }

      // Next request should be rejected
      const result = await algorithm.consume('user:1');

      expect(result.allowed).toBe(false);
      expect(result.remaining).toBe(0);
      expect(result.retryAfter).toBeDefined();
    });

    it('should provide correct retryAfter value', async () => {
      // Start at exact window boundary, then advance 30 seconds
      const windowStart = Math.floor(BASE_TIME / WINDOW_MS) * WINDOW_MS;
      setMockedTime(windowStart + 30000);

      // Exhaust the limit
      for (let i = 0; i < LIMIT; i++) {
        await algorithm.consume('user:1');
      }

      const result = await algorithm.consume('user:1');

      expect(result.allowed).toBe(false);
      // Should be 30 seconds until window reset (60 - 30 = 30)
      expect(result.retryAfter).toBe(30);
    });

    it('should continue rejecting requests while over limit', async () => {
      // Exhaust the limit
      for (let i = 0; i < LIMIT; i++) {
        await algorithm.consume('user:1');
      }

      // Multiple subsequent requests should all be rejected
      for (let i = 0; i < 3; i++) {
        const result = await algorithm.consume('user:1');
        expect(result.allowed).toBe(false);
      }
    });
  });

  describe('window reset', () => {
    it('should reset counter after window passes', async () => {
      // Exhaust the limit
      for (let i = 0; i < LIMIT; i++) {
        await algorithm.consume('user:1');
      }

      // Verify blocked
      let result = await algorithm.consume('user:1');
      expect(result.allowed).toBe(false);

      // Advance past the window
      advanceTime(WINDOW_MS);

      // Should be allowed again
      result = await algorithm.consume('user:1');
      expect(result.allowed).toBe(true);
      expect(result.remaining).toBe(4);
    });

    it('should have fresh limit in new window', async () => {
      // Exhaust the limit
      for (let i = 0; i < LIMIT; i++) {
        await algorithm.consume('user:1');
      }

      // Advance past the window
      advanceTime(WINDOW_MS);

      // Should have full quota in new window
      for (let i = 0; i < LIMIT; i++) {
        const result = await algorithm.consume('user:1');
        expect(result.allowed).toBe(true);
        expect(result.remaining).toBe(LIMIT - i - 1);
      }
    });

    it('should calculate correct resetAt time', async () => {
      const result = await algorithm.consume('user:1');

      // Window started at BASE_TIME (which is aligned to window boundaries)
      const expectedWindowStart = Math.floor(BASE_TIME / WINDOW_MS) * WINDOW_MS;
      const expectedResetAt = new Date(expectedWindowStart + WINDOW_MS);

      expect(result.resetAt).toEqual(expectedResetAt);
    });
  });

  describe('boundary behavior', () => {
    it('should handle request right at window boundary', async () => {
      // Position time at exact window boundary
      const windowStart = Math.floor(BASE_TIME / WINDOW_MS) * WINDOW_MS;
      setMockedTime(windowStart);

      const result = await algorithm.consume('user:1');

      expect(result.allowed).toBe(true);
      expect(result.resetAt.getTime()).toBe(windowStart + WINDOW_MS);
    });

    it('should handle request just before window ends', async () => {
      // Position time 1ms before window ends
      const windowStart = Math.floor(BASE_TIME / WINDOW_MS) * WINDOW_MS;
      setMockedTime(windowStart + WINDOW_MS - 1);

      const result = await algorithm.consume('user:1');

      expect(result.allowed).toBe(true);
      expect(result.resetAt.getTime()).toBe(windowStart + WINDOW_MS);
      expect(result.retryAfter).toBeUndefined();
    });

    it('should create new window after boundary', async () => {
      const windowStart = Math.floor(BASE_TIME / WINDOW_MS) * WINDOW_MS;
      setMockedTime(windowStart);

      // Exhaust limit in first window
      for (let i = 0; i < LIMIT; i++) {
        await algorithm.consume('user:1');
      }

      // Move to next window
      setMockedTime(windowStart + WINDOW_MS);

      const result = await algorithm.consume('user:1');
      expect(result.allowed).toBe(true);
      expect(result.remaining).toBe(4);
      expect(result.resetAt.getTime()).toBe(windowStart + 2 * WINDOW_MS);
    });

    it('should demonstrate burst-at-boundary problem', async () => {
      // This test demonstrates the known limitation of fixed window
      const windowStart = Math.floor(BASE_TIME / WINDOW_MS) * WINDOW_MS;

      // Make requests at end of first window
      setMockedTime(windowStart + WINDOW_MS - 1);
      for (let i = 0; i < LIMIT; i++) {
        const result = await algorithm.consume('user:burst');
        expect(result.allowed).toBe(true);
      }

      // Move to start of next window (just 1ms later)
      setMockedTime(windowStart + WINDOW_MS);

      // Can make LIMIT more requests immediately
      for (let i = 0; i < LIMIT; i++) {
        const result = await algorithm.consume('user:burst');
        expect(result.allowed).toBe(true);
      }

      // Total of 2*LIMIT requests in ~1ms - the burst problem
    });
  });

  describe('reset()', () => {
    it('should clear the counter for a key', async () => {
      // Use some requests
      for (let i = 0; i < 3; i++) {
        await algorithm.consume('user:1');
      }

      // Reset the key
      await algorithm.reset('user:1');

      // Should have full quota again
      const result = await algorithm.consume('user:1');
      expect(result.allowed).toBe(true);
      expect(result.remaining).toBe(4);
    });

    it('should only reset the specified key', async () => {
      // Use requests for both users
      for (let i = 0; i < 3; i++) {
        await algorithm.consume('user:1');
        await algorithm.consume('user:2');
      }

      // Reset only user:1
      await algorithm.reset('user:1');

      // user:1 should have full quota
      const result1 = await algorithm.consume('user:1');
      expect(result1.remaining).toBe(4);

      // user:2 should still have used quota
      const result2 = await algorithm.consume('user:2');
      expect(result2.remaining).toBe(1); // 5 - 3 - 1 = 1
    });

    it('should be safe to reset a key that does not exist', async () => {
      // Should not throw
      await expect(algorithm.reset('nonexistent:key')).resolves.toBeUndefined();
    });
  });

  describe('destroy()', () => {
    it('should clean up the store', async () => {
      await algorithm.consume('user:1');
      await algorithm.destroy();

      // Store should be cleared
      const entry = await store.get('user:1');
      expect(entry).toBeNull();
    });
  });

  describe('retryAfter calculation', () => {
    it('should calculate retryAfter in whole seconds', async () => {
      // Position time 30.5 seconds into the window
      const windowStart = Math.floor(BASE_TIME / WINDOW_MS) * WINDOW_MS;
      setMockedTime(windowStart + 30500);

      // Exhaust limit
      for (let i = 0; i < LIMIT; i++) {
        await algorithm.consume('user:1');
      }

      const result = await algorithm.consume('user:1');

      // 60000 - 30500 = 29500ms = 29.5s, ceil to 30s
      expect(result.retryAfter).toBe(30);
    });

    it('should return retryAfter of 1 when very close to reset', async () => {
      const windowStart = Math.floor(BASE_TIME / WINDOW_MS) * WINDOW_MS;
      // Position 100ms before window ends
      setMockedTime(windowStart + WINDOW_MS - 100);

      // Exhaust limit
      for (let i = 0; i < LIMIT; i++) {
        await algorithm.consume('user:1');
      }

      const result = await algorithm.consume('user:1');

      // 100ms = 0.1s, ceil to 1s
      expect(result.retryAfter).toBe(1);
    });
  });
});
