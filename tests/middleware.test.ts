import express, { Application, Request, Response } from 'express';
import request from 'supertest';
import { rateLimit } from '../src/middleware';
import type { RateLimitedRequest, RateLimitResult, RateLimitErrorResponse } from '../src/types';

describe('rateLimit middleware', () => {
  let app: Application;

  beforeEach(() => {
    app = express();
    // Trust proxy for IP extraction in tests
    app.set('trust proxy', true);
  });

  describe('requests within limit', () => {
    it('should allow requests within limit with 200 status', async () => {
      app.use(
        rateLimit({
          limit: 5,
          window: '1m',
        })
      );
      app.get('/test', (_req: Request, res: Response) => {
        res.status(200).json({ message: 'ok' });
      });

      const response = await request(app).get('/test');

      expect(response.status).toBe(200);
      expect(response.body).toEqual({ message: 'ok' });
    });

    it('should allow multiple requests within limit', async () => {
      app.use(
        rateLimit({
          limit: 3,
          window: '1m',
        })
      );
      app.get('/test', (_req: Request, res: Response) => {
        res.status(200).json({ message: 'ok' });
      });

      for (let i = 0; i < 3; i++) {
        const response = await request(app).get('/test');
        expect(response.status).toBe(200);
      }
    });
  });

  describe('requests over limit', () => {
    it('should return 429 when requests exceed limit', async () => {
      app.use(
        rateLimit({
          limit: 2,
          window: '1m',
        })
      );
      app.get('/test', (_req: Request, res: Response) => {
        res.status(200).json({ message: 'ok' });
      });

      // First two requests should succeed
      await request(app).get('/test');
      await request(app).get('/test');

      // Third request should be rate limited
      const response = await request(app).get('/test');

      expect(response.status).toBe(429);
    });

    it('should return custom status code when specified', async () => {
      app.use(
        rateLimit({
          limit: 1,
          window: '1m',
          statusCode: 503,
        })
      );
      app.get('/test', (_req: Request, res: Response) => {
        res.status(200).json({ message: 'ok' });
      });

      await request(app).get('/test');
      const response = await request(app).get('/test');

      expect(response.status).toBe(503);
    });
  });

  describe('response headers', () => {
    it('should set X-RateLimit-* headers on every response', async () => {
      app.use(
        rateLimit({
          limit: 5,
          window: '1m',
        })
      );
      app.get('/test', (_req: Request, res: Response) => {
        res.status(200).json({ message: 'ok' });
      });

      const response = await request(app).get('/test');

      expect(response.headers['x-ratelimit-limit']).toBe('5');
      expect(response.headers['x-ratelimit-remaining']).toBe('4');
      expect(response.headers['x-ratelimit-reset']).toBeDefined();
      expect(Number(response.headers['x-ratelimit-reset'])).toBeGreaterThan(0);
    });

    it('should decrement remaining count with each request', async () => {
      app.use(
        rateLimit({
          limit: 3,
          window: '1m',
        })
      );
      app.get('/test', (_req: Request, res: Response) => {
        res.status(200).json({ message: 'ok' });
      });

      let response = await request(app).get('/test');
      expect(response.headers['x-ratelimit-remaining']).toBe('2');

      response = await request(app).get('/test');
      expect(response.headers['x-ratelimit-remaining']).toBe('1');

      response = await request(app).get('/test');
      expect(response.headers['x-ratelimit-remaining']).toBe('0');
    });

    it('should set Retry-After header on 429 responses', async () => {
      app.use(
        rateLimit({
          limit: 1,
          window: '1m',
        })
      );
      app.get('/test', (_req: Request, res: Response) => {
        res.status(200).json({ message: 'ok' });
      });

      await request(app).get('/test');
      const response = await request(app).get('/test');

      expect(response.status).toBe(429);
      expect(response.headers['retry-after']).toBeDefined();
      expect(Number(response.headers['retry-after'])).toBeGreaterThan(0);
    });

    it('should not set headers when headers option is false', async () => {
      app.use(
        rateLimit({
          limit: 5,
          window: '1m',
          headers: false,
        })
      );
      app.get('/test', (_req: Request, res: Response) => {
        res.status(200).json({ message: 'ok' });
      });

      const response = await request(app).get('/test');

      expect(response.headers['x-ratelimit-limit']).toBeUndefined();
      expect(response.headers['x-ratelimit-remaining']).toBeUndefined();
      expect(response.headers['x-ratelimit-reset']).toBeUndefined();
    });
  });

  describe('429 response body', () => {
    it('should return correct JSON body format on 429', async () => {
      app.use(
        rateLimit({
          limit: 1,
          window: '1m',
        })
      );
      app.get('/test', (_req: Request, res: Response) => {
        res.status(200).json({ message: 'ok' });
      });

      await request(app).get('/test');
      const response = await request(app).get('/test');

      expect(response.status).toBe(429);
      const body = response.body as RateLimitErrorResponse;
      expect(body).toHaveProperty('error', 'Too Many Requests');
      expect(body).toHaveProperty('retryAfter');
      expect(typeof body.retryAfter).toBe('number');
      expect(body).toHaveProperty('limit', 1);
      expect(body).toHaveProperty('resetAt');
      expect(typeof body.resetAt).toBe('string');
      // Verify resetAt is valid ISO date
      expect(() => new Date(body.resetAt)).not.toThrow();
    });

    it('should use custom message when specified', async () => {
      app.use(
        rateLimit({
          limit: 1,
          window: '1m',
          message: 'Rate limit exceeded, please slow down',
        })
      );
      app.get('/test', (_req: Request, res: Response) => {
        res.status(200).json({ message: 'ok' });
      });

      await request(app).get('/test');
      const response = await request(app).get('/test');
      const body = response.body as RateLimitErrorResponse;

      expect(body.error).toBe('Rate limit exceeded, please slow down');
    });
  });

  describe('custom key extractor', () => {
    it('should use custom key extractor function', async () => {
      app.use(
        rateLimit({
          limit: 2,
          window: '1m',
          keyExtractor: (req: Request) => req.headers['x-api-key'] as string,
        })
      );
      app.get('/test', (_req: Request, res: Response) => {
        res.status(200).json({ message: 'ok' });
      });

      // Requests with key 'user-a' should have their own limit
      await request(app).get('/test').set('x-api-key', 'user-a');
      await request(app).get('/test').set('x-api-key', 'user-a');
      const responseA = await request(app).get('/test').set('x-api-key', 'user-a');
      expect(responseA.status).toBe(429);

      // Requests with key 'user-b' should have a separate limit
      const responseB = await request(app).get('/test').set('x-api-key', 'user-b');
      expect(responseB.status).toBe(200);
    });

    it('should rate limit separately per key', async () => {
      app.use(
        rateLimit({
          limit: 1,
          window: '1m',
          keyExtractor: (req: Request) => req.query['userId'] as string,
        })
      );
      app.get('/test', (_req: Request, res: Response) => {
        res.status(200).json({ message: 'ok' });
      });

      // First request for user1
      let response = await request(app).get('/test?userId=user1');
      expect(response.status).toBe(200);

      // Second request for user1 should be limited
      response = await request(app).get('/test?userId=user1');
      expect(response.status).toBe(429);

      // First request for user2 should succeed
      response = await request(app).get('/test?userId=user2');
      expect(response.status).toBe(200);
    });
  });

  describe('skip function', () => {
    it('should bypass rate limiting when skip returns true', async () => {
      app.use(
        rateLimit({
          limit: 1,
          window: '1m',
          skip: (req: Request) => req.path === '/health',
        })
      );
      app.get('/test', (_req: Request, res: Response) => {
        res.status(200).json({ message: 'ok' });
      });
      app.get('/health', (_req: Request, res: Response) => {
        res.status(200).json({ status: 'healthy' });
      });

      // Health endpoint should always work, even after many requests
      for (let i = 0; i < 10; i++) {
        const response = await request(app).get('/health');
        expect(response.status).toBe(200);
        // Headers should not be set for skipped requests
        expect(response.headers['x-ratelimit-limit']).toBeUndefined();
      }
    });

    it('should still rate limit non-skipped requests', async () => {
      app.use(
        rateLimit({
          limit: 1,
          window: '1m',
          skip: (req: Request) => req.path === '/health',
        })
      );
      app.get('/test', (_req: Request, res: Response) => {
        res.status(200).json({ message: 'ok' });
      });
      app.get('/health', (_req: Request, res: Response) => {
        res.status(200).json({ status: 'healthy' });
      });

      // Normal endpoint should be rate limited
      await request(app).get('/test');
      const response = await request(app).get('/test');
      expect(response.status).toBe(429);
    });
  });

  describe('multiple middleware instances', () => {
    it('should support different routes with different limits', async () => {
      app.use(
        '/api',
        rateLimit({
          limit: 2,
          window: '1m',
        })
      );
      app.use(
        '/admin',
        rateLimit({
          limit: 5,
          window: '1m',
        })
      );

      app.get('/api/data', (_req: Request, res: Response) => {
        res.status(200).json({ data: 'api' });
      });
      app.get('/admin/data', (_req: Request, res: Response) => {
        res.status(200).json({ data: 'admin' });
      });

      // Exhaust API limit
      await request(app).get('/api/data');
      await request(app).get('/api/data');
      let response = await request(app).get('/api/data');
      expect(response.status).toBe(429);

      // Admin route should still have its own limit
      response = await request(app).get('/admin/data');
      expect(response.status).toBe(200);
      expect(response.headers['x-ratelimit-limit']).toBe('5');
    });

    it('should track limits independently per middleware instance', async () => {
      const strictLimiter = rateLimit({
        limit: 1,
        window: '1m',
      });
      const relaxedLimiter = rateLimit({
        limit: 100,
        window: '1m',
      });

      app.use('/strict', strictLimiter);
      app.use('/relaxed', relaxedLimiter);

      app.get('/strict/endpoint', (_req: Request, res: Response) => {
        res.status(200).json({ message: 'strict' });
      });
      app.get('/relaxed/endpoint', (_req: Request, res: Response) => {
        res.status(200).json({ message: 'relaxed' });
      });

      // Hit strict limit
      await request(app).get('/strict/endpoint');
      let response = await request(app).get('/strict/endpoint');
      expect(response.status).toBe(429);

      // Relaxed should still work
      response = await request(app).get('/relaxed/endpoint');
      expect(response.status).toBe(200);
      expect(response.headers['x-ratelimit-remaining']).toBe('99');
    });
  });

  describe('onLimitReached callback', () => {
    it('should call onLimitReached when rate limit is exceeded', async () => {
      const onLimitReached = jest.fn();

      app.use(
        rateLimit({
          limit: 1,
          window: '1m',
          onLimitReached,
        })
      );
      app.get('/test', (_req: Request, res: Response) => {
        res.status(200).json({ message: 'ok' });
      });

      await request(app).get('/test');
      await request(app).get('/test');

      expect(onLimitReached).toHaveBeenCalledTimes(1);
    });

    it('should pass req, res, and info to onLimitReached callback', async () => {
      let callbackReq: Request | undefined;
      let callbackRes: Response | undefined;
      let callbackInfo: RateLimitResult | undefined;

      app.use(
        rateLimit({
          limit: 1,
          window: '1m',
          onLimitReached: (req, res, info) => {
            callbackReq = req;
            callbackRes = res;
            callbackInfo = info;
          },
        })
      );
      app.get('/test', (_req: Request, res: Response) => {
        res.status(200).json({ message: 'ok' });
      });

      await request(app).get('/test');
      await request(app).get('/test');

      expect(callbackReq).toBeDefined();
      expect(callbackRes).toBeDefined();
      expect(callbackInfo).toBeDefined();
      expect(callbackInfo?.allowed).toBe(false);
      expect(callbackInfo?.limit).toBe(1);
      expect(callbackInfo?.remaining).toBe(0);
    });

    it('should not call onLimitReached when request is within limit', async () => {
      const onLimitReached = jest.fn();

      app.use(
        rateLimit({
          limit: 5,
          window: '1m',
          onLimitReached,
        })
      );
      app.get('/test', (_req: Request, res: Response) => {
        res.status(200).json({ message: 'ok' });
      });

      await request(app).get('/test');
      await request(app).get('/test');

      expect(onLimitReached).not.toHaveBeenCalled();
    });
  });

  describe('skipFailedRequests option', () => {
    it('should reset counter after failed request when skipFailedRequests is true', async () => {
      app.use(
        rateLimit({
          limit: 1,
          window: '1m',
          skipFailedRequests: true,
        })
      );
      app.get('/fail', (_req: Request, res: Response) => {
        res.status(400).json({ error: 'Bad request' });
      });
      app.get('/success', (_req: Request, res: Response) => {
        res.status(200).json({ message: 'ok' });
      });

      // Failed request (should reset counter after)
      const failedResponse = await request(app).get('/fail');
      expect(failedResponse.status).toBe(400);

      // Give time for the reset to complete
      await new Promise((resolve) => setTimeout(resolve, 50));

      // This should succeed because previous failed request was not counted
      const successResponse = await request(app).get('/success');
      expect(successResponse.status).toBe(200);
    });

    it('should count all requests when skipFailedRequests is false', async () => {
      app.use(
        rateLimit({
          limit: 1,
          window: '1m',
          skipFailedRequests: false,
        })
      );
      app.get('/fail', (_req: Request, res: Response) => {
        res.status(400).json({ error: 'Bad request' });
      });
      app.get('/success', (_req: Request, res: Response) => {
        res.status(200).json({ message: 'ok' });
      });

      // Failed request (should still count)
      await request(app).get('/fail');

      // Next request should be rate limited
      const response = await request(app).get('/success');
      expect(response.status).toBe(429);
    });
  });

  describe('different algorithms', () => {
    describe('fixed-window algorithm', () => {
      it('should work with fixed-window algorithm', async () => {
        app.use(
          rateLimit({
            algorithm: 'fixed-window',
            limit: 2,
            window: '1m',
          })
        );
        app.get('/test', (_req: Request, res: Response) => {
          res.status(200).json({ message: 'ok' });
        });

        let response = await request(app).get('/test');
        expect(response.status).toBe(200);
        expect(response.headers['x-ratelimit-remaining']).toBe('1');

        response = await request(app).get('/test');
        expect(response.status).toBe(200);
        expect(response.headers['x-ratelimit-remaining']).toBe('0');

        response = await request(app).get('/test');
        expect(response.status).toBe(429);
      });
    });

    describe('sliding-window algorithm', () => {
      it('should work with sliding-window algorithm', async () => {
        app.use(
          rateLimit({
            algorithm: 'sliding-window',
            limit: 2,
            window: '1m',
          })
        );
        app.get('/test', (_req: Request, res: Response) => {
          res.status(200).json({ message: 'ok' });
        });

        let response = await request(app).get('/test');
        expect(response.status).toBe(200);
        expect(response.headers['x-ratelimit-remaining']).toBe('1');

        response = await request(app).get('/test');
        expect(response.status).toBe(200);
        expect(response.headers['x-ratelimit-remaining']).toBe('0');

        response = await request(app).get('/test');
        expect(response.status).toBe(429);
      });
    });

    describe('token-bucket algorithm', () => {
      it('should work with token-bucket algorithm', async () => {
        app.use(
          rateLimit({
            algorithm: 'token-bucket',
            limit: 2, // bucket capacity
            refillRate: 0.1, // 0.1 tokens per second (slow refill for testing)
          })
        );
        app.get('/test', (_req: Request, res: Response) => {
          res.status(200).json({ message: 'ok' });
        });

        // First request
        let response = await request(app).get('/test');
        expect(response.status).toBe(200);
        expect(response.headers['x-ratelimit-limit']).toBe('2');

        // Second request
        response = await request(app).get('/test');
        expect(response.status).toBe(200);

        // Third request should be limited (bucket empty)
        response = await request(app).get('/test');
        expect(response.status).toBe(429);
      });

      it('should require refillRate for token-bucket', () => {
        expect(() => {
          rateLimit({
            algorithm: 'token-bucket',
            limit: 10,
            // refillRate missing
          });
        }).toThrow('Token bucket algorithm requires a positive refillRate');
      });
    });
  });

  describe('req.rateLimit attachment', () => {
    it('should attach rate limit info to req.rateLimit', async () => {
      let capturedRateLimit: RateLimitedRequest['rateLimit'];

      app.use(
        rateLimit({
          limit: 5,
          window: '1m',
        })
      );
      app.get('/test', (req: Request, res: Response) => {
        capturedRateLimit = (req as RateLimitedRequest).rateLimit;
        res.status(200).json({ message: 'ok' });
      });

      await request(app).get('/test');

      expect(capturedRateLimit).toBeDefined();
      expect(capturedRateLimit?.allowed).toBe(true);
      expect(capturedRateLimit?.limit).toBe(5);
      expect(capturedRateLimit?.remaining).toBe(4);
      expect(capturedRateLimit?.key).toBeDefined();
      expect(capturedRateLimit?.resetAt).toBeInstanceOf(Date);
    });

    it('should have correct info after multiple requests', async () => {
      const rateLimitInfos: RateLimitedRequest['rateLimit'][] = [];

      app.use(
        rateLimit({
          limit: 3,
          window: '1m',
        })
      );
      app.get('/test', (req: Request, res: Response) => {
        rateLimitInfos.push((req as RateLimitedRequest).rateLimit);
        res.status(200).json({ message: 'ok' });
      });

      await request(app).get('/test');
      await request(app).get('/test');
      await request(app).get('/test');

      expect(rateLimitInfos[0]?.remaining).toBe(2);
      expect(rateLimitInfos[1]?.remaining).toBe(1);
      expect(rateLimitInfos[2]?.remaining).toBe(0);
    });

    it('should include key in req.rateLimit', async () => {
      let capturedRateLimit: RateLimitedRequest['rateLimit'];

      app.use(
        rateLimit({
          limit: 5,
          window: '1m',
          keyExtractor: () => 'custom-key-123',
        })
      );
      app.get('/test', (req: Request, res: Response) => {
        capturedRateLimit = (req as RateLimitedRequest).rateLimit;
        res.status(200).json({ message: 'ok' });
      });

      await request(app).get('/test');

      expect(capturedRateLimit?.key).toBe('custom-key-123');
    });
  });

  describe('configuration validation', () => {
    it('should throw error if limit is not provided', () => {
      expect(() => {
        rateLimit({
          window: '1m',
        } as never);
      }).toThrow();
    });

    it('should throw error if limit is zero or negative', () => {
      expect(() => {
        rateLimit({
          limit: 0,
          window: '1m',
        });
      }).toThrow('Rate limit requires a positive limit option');

      expect(() => {
        rateLimit({
          limit: -5,
          window: '1m',
        });
      }).toThrow('Rate limit requires a positive limit option');
    });

    it('should throw error if window is missing for fixed-window', () => {
      expect(() => {
        rateLimit({
          algorithm: 'fixed-window',
          limit: 10,
        });
      }).toThrow('Fixed window algorithm requires a window option');
    });

    it('should throw error if window is missing for sliding-window', () => {
      expect(() => {
        rateLimit({
          algorithm: 'sliding-window',
          limit: 10,
        });
      }).toThrow('Sliding window algorithm requires a window option');
    });
  });

  describe('default options', () => {
    it('should use fixed-window algorithm by default', async () => {
      app.use(
        rateLimit({
          limit: 2,
          window: '1m',
        })
      );
      app.get('/test', (_req: Request, res: Response) => {
        res.status(200).json({ message: 'ok' });
      });

      // Should behave as fixed window
      await request(app).get('/test');
      await request(app).get('/test');
      const response = await request(app).get('/test');
      expect(response.status).toBe(429);
    });

    it('should send headers by default', async () => {
      app.use(
        rateLimit({
          limit: 5,
          window: '1m',
        })
      );
      app.get('/test', (_req: Request, res: Response) => {
        res.status(200).json({ message: 'ok' });
      });

      const response = await request(app).get('/test');
      expect(response.headers['x-ratelimit-limit']).toBeDefined();
    });

    it('should use memory store by default', async () => {
      app.use(
        rateLimit({
          limit: 5,
          window: '1m',
        })
      );
      app.get('/test', (_req: Request, res: Response) => {
        res.status(200).json({ message: 'ok' });
      });

      // Should work without any store configuration
      const response = await request(app).get('/test');
      expect(response.status).toBe(200);
    });
  });
});
