import type { Store, StoreEntry } from '../stores/types.js';
import type { RateLimitResult } from '../types.js';
import type { RateLimitAlgorithm, TokenBucketConfig } from './types.js';

/**
 * Extended configuration for TokenBucketAlgorithm including optional time function.
 */
export interface TokenBucketAlgorithmConfig extends TokenBucketConfig {
  /** Function to get current time in milliseconds (for testing) */
  getCurrentTime?: () => number;
}

/**
 * Token Bucket rate limiting algorithm.
 *
 * Each key has a bucket with a maximum capacity. Tokens are added at a constant
 * refill rate. Each request consumes one token. If tokens >= 1, the request is
 * allowed; otherwise, it's denied.
 *
 * Features:
 * - Handles bursts naturally (up to bucket capacity)
 * - Smooth rate limiting over time
 * - Lazy refill calculation (only on request, not constantly)
 */
export class TokenBucketAlgorithm implements RateLimitAlgorithm {
  private readonly store: Store;
  private readonly capacity: number;
  private readonly refillRate: number;
  private readonly getCurrentTime: () => number;

  constructor(store: Store, config: TokenBucketAlgorithmConfig) {
    this.store = store;
    this.capacity = config.capacity;
    this.refillRate = config.refillRate;
    this.getCurrentTime = config.getCurrentTime ?? ((): number => Date.now());

    if (this.capacity <= 0) {
      throw new Error('Capacity must be greater than 0');
    }
    if (this.refillRate <= 0) {
      throw new Error('Refill rate must be greater than 0');
    }
  }

  /**
   * Attempt to consume a token for the given key.
   */
  async consume(key: string): Promise<RateLimitResult> {
    const now = this.getCurrentTime();
    const entry = await this.store.get(key);

    let tokens: number;
    let lastRefill: number;

    if (entry === null || entry.tokens === undefined || entry.lastRefill === undefined) {
      // New bucket: start at full capacity
      tokens = this.capacity;
      lastRefill = now;
    } else {
      // Calculate tokens added since last refill (lazy refill)
      const elapsedMs = now - entry.lastRefill;
      const elapsedSeconds = elapsedMs / 1000;
      const tokensToAdd = elapsedSeconds * this.refillRate;

      // Add tokens but don't exceed capacity
      tokens = Math.min(this.capacity, entry.tokens + tokensToAdd);
      lastRefill = now;
    }

    if (tokens >= 1) {
      // Allow request: consume one token
      tokens -= 1;

      // Calculate time until bucket is full (for resetAt) - after consuming
      const tokensNeededForFull = this.capacity - tokens;
      const secondsUntilFull = tokensNeededForFull / this.refillRate;
      const msUntilFull = secondsUntilFull * 1000;
      const resetAt = new Date(now + msUntilFull);

      // Calculate TTL: time until bucket would be full + buffer
      const ttlMs = this.calculateTtlMs(tokens);

      const newEntry: StoreEntry = {
        tokens,
        lastRefill,
        expiresAt: now + ttlMs,
      };
      await this.store.set(key, newEntry, ttlMs);

      return {
        allowed: true,
        limit: this.capacity,
        remaining: Math.floor(tokens),
        resetAt,
      };
    } else {
      // Deny request: not enough tokens
      // Calculate time until bucket is full (for resetAt)
      const tokensNeededForFull = this.capacity - tokens;
      const secondsUntilFull = tokensNeededForFull / this.refillRate;
      const msUntilFull = secondsUntilFull * 1000;
      const resetAt = new Date(now + msUntilFull);

      // Calculate how long until we have 1 token
      const tokensNeeded = 1 - tokens;
      const secondsUntilToken = tokensNeeded / this.refillRate;
      const retryAfter = Math.ceil(secondsUntilToken);

      // Still update the store with current state (for accurate tracking)
      const ttlMs = this.calculateTtlMs(tokens);
      const newEntry: StoreEntry = {
        tokens,
        lastRefill,
        expiresAt: now + ttlMs,
      };
      await this.store.set(key, newEntry, ttlMs);

      return {
        allowed: false,
        limit: this.capacity,
        remaining: 0,
        resetAt,
        retryAfter,
      };
    }
  }

  /**
   * Reset the bucket for a given key to full capacity.
   */
  async reset(key: string): Promise<void> {
    await this.store.delete(key);
  }

  /**
   * Clean up resources used by the algorithm.
   */
  async destroy(): Promise<void> {
    await this.store.destroy();
  }

  /**
   * Calculate TTL for store entry.
   * TTL should be long enough to cover the time until the bucket is full.
   */
  private calculateTtlMs(currentTokens: number): number {
    // Time to refill from current to capacity, plus a buffer
    const tokensToFill = this.capacity - currentTokens;
    const secondsToFill = tokensToFill / this.refillRate;
    const msToFill = secondsToFill * 1000;
    // Add 10% buffer to avoid edge cases
    return Math.max(msToFill * 1.1, 60000); // Minimum 1 minute TTL
  }
}
