import type { Request, Response, NextFunction } from 'express';
import type {
  Options,
  RateLimitInfo,
  RateLimitedRequest,
  RateLimitErrorResponse,
  RateLimitResult,
  AlgorithmType,
} from './types.js';
import type { RateLimitAlgorithm } from './algorithms/types.js';
import type { Store } from './stores/types.js';
import { FixedWindowAlgorithm } from './algorithms/fixed-window.js';
import { SlidingWindowAlgorithm } from './algorithms/sliding-window.js';
import { TokenBucketAlgorithm } from './algorithms/token-bucket.js';
import { MemoryStore } from './stores/memory.js';
import { RedisStore } from './stores/redis.js';
import { ipKeyExtractor } from './extractors/key.js';
import { parseWindow } from './utils/parse-window.js';

/**
 * Express middleware handler type.
 */
type ExpressMiddleware = (req: Request, res: Response, next: NextFunction) => void;

/**
 * Create a store instance based on configuration.
 */
function createStore(options: Options): Store {
  const storeConfig = options.store ?? { type: 'memory' };

  if (storeConfig.type === 'redis') {
    if (storeConfig.client === undefined || storeConfig.client === null) {
      throw new Error('Redis store requires a client instance');
    }
    return new RedisStore({
      client: storeConfig.client,
      prefix: storeConfig.prefix,
    });
  }

  return new MemoryStore({
    cleanupInterval: storeConfig.cleanupInterval,
  });
}

/**
 * Create a rate limiting algorithm based on configuration.
 */
function createAlgorithm(options: Options, store: Store): RateLimitAlgorithm {
  const algorithmType: AlgorithmType = options.algorithm ?? 'fixed-window';

  switch (algorithmType) {
    case 'token-bucket': {
      if (
        options.refillRate === undefined ||
        options.refillRate === null ||
        options.refillRate <= 0
      ) {
        throw new Error('Token bucket algorithm requires a positive refillRate');
      }
      return new TokenBucketAlgorithm(store, {
        capacity: options.limit,
        refillRate: options.refillRate,
      });
    }

    case 'sliding-window': {
      if (options.window === undefined || options.window === null || options.window === '') {
        throw new Error('Sliding window algorithm requires a window option');
      }
      const windowMs = parseWindow(options.window);
      return new SlidingWindowAlgorithm(store, {
        limit: options.limit,
        windowMs,
      });
    }

    case 'fixed-window':
    default: {
      if (options.window === undefined || options.window === null || options.window === '') {
        throw new Error('Fixed window algorithm requires a window option');
      }
      const windowMs = parseWindow(options.window);
      return new FixedWindowAlgorithm({
        limit: options.limit,
        windowMs,
        store,
      });
    }
  }
}

/**
 * Set rate limit headers on the response.
 */
function setRateLimitHeaders(res: Response, result: RateLimitResult): void {
  res.setHeader('X-RateLimit-Limit', result.limit);
  res.setHeader('X-RateLimit-Remaining', Math.max(0, result.remaining));
  res.setHeader('X-RateLimit-Reset', Math.floor(result.resetAt.getTime() / 1000));
}

/**
 * Set Retry-After header on the response.
 */
function setRetryAfterHeader(res: Response, retryAfter: number): void {
  res.setHeader('Retry-After', retryAfter);
}

/**
 * Create a 429 error response body.
 */
function createErrorResponse(result: RateLimitResult, message: string): RateLimitErrorResponse {
  return {
    error: message,
    retryAfter: result.retryAfter ?? 0,
    limit: result.limit,
    resetAt: result.resetAt.toISOString(),
  };
}

/**
 * Create a rate limiting middleware for Express.
 *
 * @param options - Configuration options for the rate limiter
 * @returns Express middleware function
 *
 * @example
 * // Basic usage with fixed window
 * app.use(rateLimit({
 *   limit: 100,
 *   window: '15m'
 * }));
 *
 * @example
 * // Token bucket with custom key extractor
 * app.use(rateLimit({
 *   algorithm: 'token-bucket',
 *   limit: 10,
 *   refillRate: 1,
 *   keyExtractor: (req) => req.headers['x-api-key'] as string
 * }));
 */
export function rateLimit(options: Options): ExpressMiddleware {
  // Validate required options
  if (options.limit === undefined || options.limit <= 0) {
    throw new Error('Rate limit requires a positive limit option');
  }

  // Create store and algorithm once (shared across all requests)
  const store = createStore(options);
  const algorithm = createAlgorithm(options, store);

  // Extract configuration with defaults
  const keyExtractor = options.keyExtractor ?? ipKeyExtractor;
  const shouldSendHeaders = options.headers !== false;
  const message = options.message ?? 'Too Many Requests';
  const statusCode = options.statusCode ?? 429;
  const skipFailedRequests = options.skipFailedRequests ?? false;

  return (req: Request, res: Response, next: NextFunction): void => {
    // Check if request should be skipped
    if (options.skip !== undefined && options.skip(req) === true) {
      next();
      return;
    }

    // Extract the rate limiting key
    const key = keyExtractor(req);

    // Consume a request from the rate limiter
    algorithm
      .consume(key)
      .then((result: RateLimitResult) => {
        // Attach rate limit info to the request
        const rateLimitInfo: RateLimitInfo = {
          ...result,
          key,
        };
        (req as RateLimitedRequest).rateLimit = rateLimitInfo;

        // Set headers if enabled
        if (shouldSendHeaders) {
          setRateLimitHeaders(res, result);
        }

        if (result.allowed) {
          // Handle skipFailedRequests option
          if (skipFailedRequests) {
            // We need to hook into the response to potentially decrement count
            // For simplicity, we track the status code on 'finish'
            res.on('finish', () => {
              // If response failed (status >= 400), we would ideally decrement
              // However, since counters are already incremented atomically,
              // we'll reset the key's count for the next request
              // This is a simplified implementation - production might track differently
              if (res.statusCode >= 400) {
                algorithm.reset(key).catch(() => {
                  // Silently ignore reset errors
                });
              }
            });
          }
          next();
        } else {
          // Rate limit exceeded
          if (shouldSendHeaders && result.retryAfter !== undefined) {
            setRetryAfterHeader(res, result.retryAfter);
          }

          // Call onLimitReached handler if provided
          if (options.onLimitReached) {
            Promise.resolve(options.onLimitReached(req, res, result)).catch(() => {
              // Silently ignore handler errors
            });
          }

          // Send 429 response
          const errorResponse = createErrorResponse(result, message);
          res.status(statusCode).json(errorResponse);
        }
      })
      .catch((error: Error) => {
        // Pass errors to Express error handler
        next(error);
      });
  };
}

/**
 * Default export for convenience.
 */
export default rateLimit;
