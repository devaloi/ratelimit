import type { RateLimitResult } from '../types.js';
import type { Store } from '../stores/types.js';
import type { RateLimitAlgorithm, FixedWindowConfig } from './types.js';
import { MS_PER_SECOND } from '../constants.js';

/**
 * Configuration for FixedWindowAlgorithm with optional time provider.
 */
export interface FixedWindowAlgorithmConfig extends FixedWindowConfig {
  /** Store for persisting rate limit data */
  store: Store;
  /** Optional function to get current timestamp (for testing) */
  getCurrentTime?: () => number;
}

/**
 * Fixed Window Rate Limiting Algorithm.
 *
 * Divides time into fixed intervals (windows) and counts requests per key per window.
 * Simple and memory-efficient, but has the "burst at boundary" problem where
 * clients can potentially make 2x the limit by timing requests around window boundaries.
 *
 * Key format stored: `{key}:{window_start_timestamp}`
 */
export class FixedWindowAlgorithm implements RateLimitAlgorithm {
  private readonly limit: number;
  private readonly windowMs: number;
  private readonly store: Store;
  private readonly getCurrentTime: () => number;

  constructor(config: FixedWindowAlgorithmConfig) {
    this.limit = config.limit;
    this.windowMs = config.windowMs;
    this.store = config.store;
    this.getCurrentTime = config.getCurrentTime ?? ((): number => Date.now());
  }

  /**
   * Calculate the start timestamp of the current window.
   */
  private getWindowStart(timestamp: number): number {
    return Math.floor(timestamp / this.windowMs) * this.windowMs;
  }

  /**
   * Generate the storage key for a given key and window.
   */
  private getStorageKey(key: string, windowStart: number): string {
    return `${key}:${windowStart}`;
  }

  /**
   * Attempt to consume a request for the given key.
   */
  async consume(key: string): Promise<RateLimitResult> {
    const currentTime = this.getCurrentTime();
    const windowStart = this.getWindowStart(currentTime);
    const windowEnd = windowStart + this.windowMs;
    const storageKey = this.getStorageKey(key, windowStart);

    // Get current count for this window
    const entry = await this.store.get(storageKey);
    const currentCount = entry?.count ?? 0;

    // Calculate reset time
    const resetAt = new Date(windowEnd);

    // Check if we're over the limit
    if (currentCount >= this.limit) {
      const retryAfter = Math.ceil((windowEnd - currentTime) / MS_PER_SECOND);
      return {
        allowed: false,
        limit: this.limit,
        remaining: 0,
        resetAt,
        retryAfter,
      };
    }

    // Increment the counter
    const ttlMs = windowEnd - currentTime;
    const newCount = await this.store.increment(storageKey, 'count', ttlMs);

    // Handle race condition: another request might have incremented first
    if (newCount > this.limit) {
      const retryAfter = Math.ceil((windowEnd - currentTime) / MS_PER_SECOND);
      return {
        allowed: false,
        limit: this.limit,
        remaining: 0,
        resetAt,
        retryAfter,
      };
    }

    return {
      allowed: true,
      limit: this.limit,
      remaining: this.limit - newCount,
      resetAt,
    };
  }

  /**
   * Reset the rate limit state for a given key.
   * Deletes the current window's counter.
   */
  async reset(key: string): Promise<void> {
    const currentTime = this.getCurrentTime();
    const windowStart = this.getWindowStart(currentTime);
    const storageKey = this.getStorageKey(key, windowStart);
    await this.store.delete(storageKey);
  }

  /**
   * Clean up resources used by the algorithm.
   */
  async destroy(): Promise<void> {
    await this.store.destroy();
  }
}
