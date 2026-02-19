# @devaloi/ratelimit

[![CI](https://github.com/devaloi/ratelimit/actions/workflows/ci.yml/badge.svg)](https://github.com/devaloi/ratelimit/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![TypeScript](https://img.shields.io/badge/TypeScript-strict-blue.svg)](https://www.typescriptlang.org/)
[![Node.js](https://img.shields.io/badge/Node.js-20%2B-green.svg)](https://nodejs.org/)

A production-grade Express rate limiting middleware with multiple algorithms (fixed window, sliding window, token bucket) and pluggable backends (memory, Redis).

## Features

- **Three algorithms from scratch** — Fixed window, sliding window log, and token bucket
- **Pluggable backends** — In-memory for development, Redis for production/distributed systems
- **TypeScript strict mode** — Full type safety with no `any` types
- **Standard rate limit headers** — `X-RateLimit-Limit`, `X-RateLimit-Remaining`, `X-RateLimit-Reset`
- **npm-publishable structure** — Proper exports, declaration files, build pipeline
- **Comprehensive test suite** — 157 tests with time-mocking (no real delays)

## Install

```bash
npm install @devaloi/ratelimit
```

## Quick Start

```typescript
import express from 'express';
import { rateLimit } from '@devaloi/ratelimit';

const app = express();

// 100 requests per 15 minutes per IP
app.use(rateLimit({ limit: 100, window: '15m' }));

app.get('/api/hello', (req, res) => {
  res.json({ message: 'Hello, World!' });
});

app.listen(3000);
```

## Algorithms

### Fixed Window

Divides time into fixed intervals and counts requests per window. Simple and memory-efficient.

```typescript
app.use(rateLimit({
  algorithm: 'fixed-window',  // default
  limit: 100,
  window: '15m',
}));
```

**When to use:** Simple rate limiting where exact precision isn't critical.  
**Trade-off:** Burst-at-boundary problem (2x limit possible at window edges).

### Sliding Window

Tracks individual request timestamps. More accurate than fixed window.

```typescript
app.use(rateLimit({
  algorithm: 'sliding-window',
  limit: 100,
  window: '15m',
}));
```

**When to use:** When you need accurate rate limiting without burst issues.  
**Trade-off:** Higher memory usage per key (stores all timestamps in window).

### Token Bucket

Each key has a bucket that fills at a constant rate. Allows controlled bursts.

```typescript
app.use(rateLimit({
  algorithm: 'token-bucket',
  limit: 10,       // bucket capacity
  refillRate: 2,   // tokens per second
}));
```

**When to use:** APIs that allow occasional bursts but need sustained rate control.  
**Trade-off:** More complex mental model; burst size = bucket capacity.

### Algorithm Comparison

| Feature | Fixed Window | Sliding Window | Token Bucket |
|---------|--------------|----------------|--------------|
| **Accuracy** | ⭐⭐ | ⭐⭐⭐ | ⭐⭐⭐ |
| **Memory per key** | Very low | Higher | Low |
| **Burst handling** | Poor (2x at boundary) | Good | Excellent (configurable) |
| **Complexity** | Simple | Moderate | Moderate |
| **Best for** | Basic limiting | Precise limiting | Burst-tolerant APIs |

## API Reference

### `rateLimit(options)`

Creates an Express middleware for rate limiting.

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `limit` | `number` | **required** | Maximum requests per window (or bucket capacity for token bucket) |
| `window` | `string` | — | Time window (`'15m'`, `'1h'`, `'1d'`). Required for fixed/sliding window. |
| `algorithm` | `string` | `'fixed-window'` | `'fixed-window'`, `'sliding-window'`, or `'token-bucket'` |
| `refillRate` | `number` | — | Tokens per second. Required for token bucket. |
| `store` | `StoreConfig` | `{ type: 'memory' }` | Backend store configuration |
| `keyExtractor` | `function` | `req.ip` | Function to extract rate limit key from request |
| `skip` | `function` | — | Function to skip rate limiting for certain requests |
| `onLimitReached` | `function` | — | Callback when limit is exceeded |
| `skipFailedRequests` | `boolean` | `false` | Don't count failed requests (status >= 400). Resets the key on failure rather than decrementing, which may over-allow subsequent requests. |
| `headers` | `boolean` | `true` | Whether to send rate limit headers |
| `message` | `string` | `'Too Many Requests'` | Error message for 429 response |
| `statusCode` | `number` | `429` | HTTP status code for rate limited responses |

## Stores

### Memory (default)

In-memory store using a Map. Suitable for single-instance deployments.

```typescript
app.use(rateLimit({
  limit: 100,
  window: '15m',
  store: { type: 'memory', cleanupInterval: 60000 },
}));
```

### Redis

Distributed store for multi-instance deployments.

```typescript
import Redis from 'ioredis';

app.use(rateLimit({
  limit: 100,
  window: '15m',
  store: {
    type: 'redis',
    client: new Redis(),
    prefix: 'myapp:rl:',
  },
}));
```

## Custom Key Extraction

Rate limit by API key instead of IP:

```typescript
app.use(rateLimit({
  limit: 1000,
  window: '1h',
  keyExtractor: (req) => req.headers['x-api-key'] as string,
}));
```

Use the built-in helpers:

```typescript
import { headerKeyExtractor, compositeKeyExtractor } from '@devaloi/ratelimit';

// Rate limit by header
app.use(rateLimit({
  limit: 1000,
  window: '1h',
  keyExtractor: headerKeyExtractor('x-api-key', 'anonymous'),
}));

// Combine IP and user ID
app.use(rateLimit({
  limit: 100,
  window: '15m',
  keyExtractor: compositeKeyExtractor([
    (req) => req.ip ?? 'unknown',
    headerKeyExtractor('x-user-id', 'guest'),
  ]),
}));
```

## Response Headers

Every response includes these headers:

| Header | Description |
|--------|-------------|
| `X-RateLimit-Limit` | Maximum requests allowed |
| `X-RateLimit-Remaining` | Requests remaining in current window |
| `X-RateLimit-Reset` | UTC epoch seconds when the window resets |
| `Retry-After` | Seconds until next request allowed (only on 429) |

### 429 Response Body

```json
{
  "error": "Too Many Requests",
  "retryAfter": 30,
  "limit": 100,
  "resetAt": "2026-02-17T10:30:00.000Z"
}
```

## Examples

See the [`examples/`](examples/) directory for runnable examples:

- [`basic.ts`](examples/basic.ts) — Simple fixed window rate limiting
- [`redis.ts`](examples/redis.ts) — Distributed rate limiting with Redis
- [`multi-tier.ts`](examples/multi-tier.ts) — Different limits for different routes
- [`custom-key.ts`](examples/custom-key.ts) — Rate limit by API key header

Run an example:

```bash
npx ts-node examples/basic.ts
```

## Development

```bash
# Install dependencies
npm install

# Run tests
npm test

# Run tests with coverage
npm run test:coverage

# Lint code
npm run lint

# Format code
npm run format

# Build
npm run build
```

## Architecture

```
src/
├── index.ts              # Public API exports
├── middleware.ts         # Express middleware factory
├── types.ts              # Shared types
├── algorithms/
│   ├── fixed-window.ts   # Fixed window counter
│   ├── sliding-window.ts # Sliding window log
│   ├── token-bucket.ts   # Token bucket
│   └── types.ts          # Algorithm interface
├── stores/
│   ├── memory.ts         # In-memory store
│   ├── redis.ts          # Redis store
│   └── types.ts          # Store interface
├── extractors/
│   └── key.ts            # Key extraction utilities
└── utils/
    └── parse-window.ts   # Window string parser
```

## License

MIT © [devaloi](https://github.com/devaloi)
