import type { RateLimitResult } from '../types.js';
import type { Store, StoreEntry } from '../stores/types.js';
import type { RateLimitAlgorithm, SlidingWindowConfig } from './types.js';
import { MS_PER_SECOND } from '../constants.js';

/**
 * Configuration for sliding window log algorithm with optional time provider.
 */
export interface SlidingWindowOptions extends SlidingWindowConfig {
  /** Custom time provider for testing (defaults to Date.now) */
  getCurrentTime?: () => number;
}

/**
 * Sliding Window Log rate limiting algorithm.
 *
 * Tracks the timestamp of every request per key. On each request:
 * - Removes entries older than the window
 * - Counts remaining entries
 * - Allows if count is under the limit
 *
 * More accurate than fixed window but uses more memory per key.
 */
export class SlidingWindowAlgorithm implements RateLimitAlgorithm {
  private readonly store: Store;
  private readonly limit: number;
  private readonly windowMs: number;
  private readonly getCurrentTime: () => number;

  constructor(store: Store, config: SlidingWindowOptions) {
    this.store = store;
    this.limit = config.limit;
    this.windowMs = config.windowMs;
    this.getCurrentTime = config.getCurrentTime ?? ((): number => Date.now());
  }

  async consume(key: string): Promise<RateLimitResult> {
    const now = this.getCurrentTime();
    const windowStart = now - this.windowMs;

    // Get existing entry
    const entry = await this.store.get(key);
    let timestamps = entry?.timestamps ?? [];

    // Filter out timestamps older than the window
    timestamps = timestamps.filter((ts) => ts > windowStart);

    const currentCount = timestamps.length;

    if (currentCount >= this.limit) {
      // Rate limit exceeded
      // Find the oldest timestamp in the window - that's when it will expire
      const oldestTimestamp = timestamps.length > 0 ? Math.min(...timestamps) : now;
      const resetAt = new Date(oldestTimestamp + this.windowMs);
      const retryAfter = Math.ceil((oldestTimestamp + this.windowMs - now) / MS_PER_SECOND);

      return {
        allowed: false,
        limit: this.limit,
        remaining: 0,
        resetAt,
        retryAfter: Math.max(1, retryAfter),
      };
    }

    // Add the new timestamp
    timestamps.push(now);

    // Save updated timestamps with TTL equal to window size
    const newEntry: StoreEntry = {
      timestamps,
      expiresAt: now + this.windowMs,
    };
    await this.store.set(key, newEntry, this.windowMs);

    // Calculate reset time based on oldest timestamp
    const oldestTimestamp = timestamps.length > 0 ? Math.min(...timestamps) : now;
    const resetAt = new Date(oldestTimestamp + this.windowMs);

    return {
      allowed: true,
      limit: this.limit,
      remaining: this.limit - timestamps.length,
      resetAt,
    };
  }

  async reset(key: string): Promise<void> {
    await this.store.delete(key);
  }

  async destroy(): Promise<void> {
    await this.store.destroy();
  }
}
