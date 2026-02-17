/**
 * @devaloi/ratelimit - Express Rate Limiting Middleware
 *
 * A production-grade Express rate limiting middleware with multiple algorithms
 * (fixed window, sliding window, token bucket) and pluggable backends (memory, Redis).
 */

// Types
export type {
  Options,
  RateLimitResult,
  RateLimitInfo,
  RateLimitedRequest,
  RateLimitErrorResponse,
  AlgorithmType,
  StoreConfig,
  KeyExtractor,
  LimitReachedHandler,
  SkipFunction,
} from './types.js';

// Algorithm types
export type {
  RateLimitAlgorithm,
  FixedWindowConfig,
  SlidingWindowConfig,
  TokenBucketConfig,
} from './algorithms/index.js';

// Store types
export type { Store, StoreEntry, MemoryStoreConfig, RedisStoreConfig } from './stores/index.js';

// Key extractors
export { ipKeyExtractor, headerKeyExtractor, compositeKeyExtractor } from './extractors/index.js';

// Utilities
export { parseWindow, formatDuration } from './utils/index.js';
