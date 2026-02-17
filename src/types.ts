import type { Request, Response } from 'express';

/**
 * Result returned by rate limit algorithm after checking a request.
 */
export interface RateLimitResult {
  /** Whether the request is allowed */
  allowed: boolean;
  /** Maximum number of requests allowed in the window */
  limit: number;
  /** Number of requests remaining in the current window */
  remaining: number;
  /** When the current window resets (UTC) */
  resetAt: Date;
  /** Seconds until next request will be allowed (only present when denied) */
  retryAfter?: number;
}

/**
 * Information attached to the request object for downstream use.
 */
export interface RateLimitInfo extends RateLimitResult {
  /** The key used for rate limiting this request */
  key: string;
}

/**
 * Supported rate limiting algorithms.
 */
export type AlgorithmType = 'fixed-window' | 'sliding-window' | 'token-bucket';

/**
 * Store configuration options.
 */
export interface StoreConfig {
  type: 'memory' | 'redis';
  /** Redis client instance (required for 'redis' type) */
  client?: unknown;
  /** Cleanup interval in milliseconds for memory store (default: 60000) */
  cleanupInterval?: number;
  /** Key prefix for Redis store (default: 'rl:') */
  prefix?: string;
}

/**
 * Function to extract a unique key from the request for rate limiting.
 */
export type KeyExtractor = (req: Request) => string;

/**
 * Handler called when rate limit is exceeded.
 */
export type LimitReachedHandler = (
  req: Request,
  res: Response,
  info: RateLimitResult
) => void | Promise<void>;

/**
 * Function to determine if a request should skip rate limiting.
 */
export type SkipFunction = (req: Request) => boolean;

/**
 * Configuration options for the rate limiter middleware.
 */
export interface Options {
  /**
   * Rate limiting algorithm to use.
   * @default 'fixed-window'
   */
  algorithm?: AlgorithmType;

  /**
   * Maximum number of requests allowed in the window.
   * For token-bucket, this is the bucket capacity.
   */
  limit: number;

  /**
   * Time window for rate limiting (e.g., '15m', '1h', '1d').
   * Required for fixed-window and sliding-window algorithms.
   */
  window?: string;

  /**
   * Token refill rate per second (only for token-bucket algorithm).
   */
  refillRate?: number;

  /**
   * Store configuration for the rate limiter backend.
   * @default { type: 'memory' }
   */
  store?: StoreConfig;

  /**
   * Function to extract the rate limiting key from the request.
   * @default (req) => req.ip
   */
  keyExtractor?: KeyExtractor;

  /**
   * Handler called when the rate limit is exceeded.
   */
  onLimitReached?: LimitReachedHandler;

  /**
   * Whether to skip counting failed requests (status >= 400).
   * @default false
   */
  skipFailedRequests?: boolean;

  /**
   * Function to determine if a request should bypass rate limiting.
   */
  skip?: SkipFunction;

  /**
   * Whether to send standard rate limit headers.
   * @default true
   */
  headers?: boolean;

  /**
   * Custom message for 429 response.
   * @default 'Too Many Requests'
   */
  message?: string;

  /**
   * HTTP status code for rate limited responses.
   * @default 429
   */
  statusCode?: number;
}

/**
 * Express Request with rate limit info attached.
 */
export interface RateLimitedRequest extends Request {
  rateLimit?: RateLimitInfo;
}

/**
 * Standard 429 response body.
 */
export interface RateLimitErrorResponse {
  error: string;
  retryAfter: number;
  limit: number;
  resetAt: string;
}
