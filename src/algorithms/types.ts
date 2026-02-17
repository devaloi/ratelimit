import type { RateLimitResult } from '../types.js';

/**
 * Interface for rate limiting algorithms.
 * All algorithms must implement this interface to be used with the middleware.
 */
export interface RateLimitAlgorithm {
  /**
   * Attempt to consume a request for the given key.
   * @param key - Unique identifier for the rate limit (e.g., IP address, user ID)
   * @returns Result indicating whether the request is allowed and rate limit info
   */
  consume(key: string): Promise<RateLimitResult>;

  /**
   * Reset the rate limit state for a given key.
   * @param key - Unique identifier for the rate limit
   */
  reset(key: string): Promise<void>;

  /**
   * Clean up resources used by the algorithm (e.g., timers, connections).
   * Should be called when the algorithm is no longer needed.
   */
  destroy?(): Promise<void>;
}

/**
 * Configuration for fixed window algorithm.
 */
export interface FixedWindowConfig {
  /** Maximum requests per window */
  limit: number;
  /** Window size in milliseconds */
  windowMs: number;
}

/**
 * Configuration for sliding window log algorithm.
 */
export interface SlidingWindowConfig {
  /** Maximum requests per window */
  limit: number;
  /** Window size in milliseconds */
  windowMs: number;
}

/**
 * Configuration for token bucket algorithm.
 */
export interface TokenBucketConfig {
  /** Maximum tokens (bucket capacity) */
  capacity: number;
  /** Tokens added per second */
  refillRate: number;
}

/**
 * Factory function to create a rate limit algorithm.
 */
export type AlgorithmFactory<T> = (config: T) => RateLimitAlgorithm;
