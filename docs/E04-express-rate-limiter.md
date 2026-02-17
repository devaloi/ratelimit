# E04: ratelimit — Express Rate Limiting Middleware

**Catalog ID:** E04 | **Size:** S | **Language:** TypeScript (Node.js)
**Repo name:** `ratelimit`
**One-liner:** A production-grade Express rate limiting middleware with multiple algorithms (fixed window, sliding window, token bucket) and pluggable backends (memory, Redis).

---

## Why This Stands Out

- **Three algorithms** implemented from scratch — shows CS fundamentals, not just "npm install"
- **Pluggable backend architecture**: in-memory for dev, Redis for production
- **TypeScript throughout** with strict types, generics, and clean interfaces
- Structured as an **npm-publishable package** — proper `exports`, type declarations, build pipeline
- **Comprehensive test suite** with time-mocking — tests rate limiting without waiting real seconds
- Well-documented: each algorithm explained with tradeoffs in README
- Clean **middleware factory pattern** — idiomatic Express

---

## Architecture

```
ratelimit/
├── src/
│   ├── index.ts              # Public API: rateLimit() factory + types
│   ├── middleware.ts          # Express middleware wrapper
│   ├── algorithms/
│   │   ├── types.ts           # Algorithm interface
│   │   ├── fixed-window.ts    # Fixed window counter
│   │   ├── sliding-window.ts  # Sliding window log
│   │   ├── token-bucket.ts    # Token bucket
│   │   └── index.ts           # Algorithm factory
│   ├── stores/
│   │   ├── types.ts           # Store interface
│   │   ├── memory.ts          # In-memory store (Map + cleanup interval)
│   │   ├── redis.ts           # Redis store (ioredis)
│   │   └── index.ts           # Store factory
│   ├── extractors/
│   │   └── key.ts             # Key extraction: IP, header, custom function
│   └── types.ts               # Shared types: Options, RateLimitInfo, etc.
├── tests/
│   ├── fixed-window.test.ts
│   ├── sliding-window.test.ts
│   ├── token-bucket.test.ts
│   ├── memory-store.test.ts
│   ├── redis-store.test.ts
│   ├── middleware.test.ts      # Full Express integration tests
│   └── helpers/
│       └── time.ts             # Time-mocking utilities
├── examples/
│   ├── basic.ts                # Simplest usage
│   ├── redis.ts                # With Redis backend
│   ├── multi-tier.ts           # Different limits for different routes
│   └── custom-key.ts           # Rate limit by API key instead of IP
├── package.json
├── tsconfig.json
├── tsconfig.build.json
├── jest.config.ts
├── .eslintrc.json
├── .prettierrc
├── .gitignore
├── LICENSE
└── README.md
```

---

## Usage Examples

```typescript
import express from 'express';
import { rateLimit } from 'ratelimit';

const app = express();

// Basic: 100 requests per 15 minutes per IP (fixed window, in-memory)
app.use(rateLimit({ limit: 100, window: '15m' }));

// Sliding window for more accuracy
app.use('/api', rateLimit({
  algorithm: 'sliding-window',
  limit: 50,
  window: '1m',
}));

// Token bucket for burst tolerance
app.use('/api/heavy', rateLimit({
  algorithm: 'token-bucket',
  limit: 10,         // bucket capacity
  refillRate: 2,     // tokens per second
}));

// Redis backend for distributed systems
import Redis from 'ioredis';
app.use(rateLimit({
  limit: 100,
  window: '15m',
  store: { type: 'redis', client: new Redis() },
}));

// Custom key extraction (rate limit by API key)
app.use(rateLimit({
  limit: 1000,
  window: '1h',
  keyExtractor: (req) => req.headers['x-api-key'] as string,
}));
```

---

## Key Design Decisions

**Algorithm interface:**
```typescript
interface RateLimitAlgorithm {
  consume(key: string): Promise<RateLimitResult>;
  reset(key: string): Promise<void>;
}

interface RateLimitResult {
  allowed: boolean;
  limit: number;
  remaining: number;
  resetAt: Date;        // when the window/bucket resets
  retryAfter?: number;  // seconds until next request allowed
}
```

**Store interface:**
```typescript
interface Store {
  get(key: string): Promise<StoreEntry | null>;
  set(key: string, entry: StoreEntry, ttl: number): Promise<void>;
  increment(key: string, field: string): Promise<number>;
  delete(key: string): Promise<void>;
}
```

**Response headers** (standard):
- `X-RateLimit-Limit`: maximum requests
- `X-RateLimit-Remaining`: requests left in window
- `X-RateLimit-Reset`: UTC epoch seconds when window resets
- `Retry-After`: seconds until next request allowed (only on 429)

**429 response body:**
```json
{
  "error": "Too Many Requests",
  "retryAfter": 30,
  "limit": 100,
  "resetAt": "2026-02-17T10:30:00Z"
}
```

---

## Algorithm Details (implement these)

### Fixed Window
- Divide time into fixed intervals (e.g., 15-minute blocks)
- Count requests per key per window
- Simple, low memory, but has burst-at-boundary problem
- Store key: `{key}:{window_start_timestamp}`

### Sliding Window Log
- Track timestamp of every request per key
- On each request: remove entries older than window, count remaining
- More accurate than fixed window, higher memory per key
- Trim old entries on each check to keep memory bounded

### Token Bucket
- Each key has a bucket with capacity N, refill rate R/second
- On each request: calculate tokens added since last request, subtract 1
- If tokens >= 1: allow. If < 1: deny.
- Handles bursts naturally (up to bucket capacity)
- Store: `{tokens: number, lastRefill: timestamp}`

---

## Phases

### Phase 1: Scaffold & Core Types

**1.1 — Project setup**
- `npm init`, configure `package.json` with proper `exports`, `types`, `files`
- TypeScript config: strict mode, ES2022 target, declaration files
- Jest config with `ts-jest`
- ESLint + Prettier config
- Create directory structure

**1.2 — Types and interfaces**
- Define all interfaces: `RateLimitAlgorithm`, `RateLimitResult`, `Store`, `StoreEntry`, `Options`
- Define `Options` type with all configuration:
  ```typescript
  interface Options {
    algorithm?: 'fixed-window' | 'sliding-window' | 'token-bucket';
    limit: number;
    window?: string;          // '15m', '1h', '1d' — parsed to ms
    refillRate?: number;      // for token bucket
    store?: StoreConfig;
    keyExtractor?: (req: Request) => string;
    onLimitReached?: (req: Request, res: Response, info: RateLimitResult) => void;
    skipFailedRequests?: boolean;
    skip?: (req: Request) => boolean;
  }
  ```

**1.3 — Window string parser**
- Parse `'15m'` → 900000ms, `'1h'` → 3600000ms, `'1d'` → 86400000ms
- Support: `s`, `m`, `h`, `d`
- Throw on invalid format

### Phase 2: Algorithms

**2.1 — Fixed window**
- Implement `FixedWindowAlgorithm` class
- Key includes window boundary: `key:${Math.floor(now / windowMs)}`
- Use store.increment() for atomic counter
- Tests with mocked time: fill window, verify reject, advance time, verify accept

**2.2 — Sliding window log**
- Implement `SlidingWindowAlgorithm` class
- Store a sorted list of timestamps per key
- On consume: filter timestamps within window, check count vs limit
- Add current timestamp if allowed
- Tests: requests spread across window boundary behave correctly

**2.3 — Token bucket**
- Implement `TokenBucketAlgorithm` class
- Lazy refill: on each request, calculate elapsed time × refillRate, add to tokens (cap at limit)
- Deduct 1 token if available
- Tests: burst up to capacity, steady rate at refill speed, recovery after drain

### Phase 3: Stores

**3.1 — Memory store**
- Use `Map<string, StoreEntry>` with TTL tracking
- Cleanup interval (configurable, default 60s) removes expired entries
- `destroy()` method to clear interval (for clean test teardown)
- Tests: set/get/increment/delete, TTL expiry, cleanup

**3.2 — Redis store**
- Use `ioredis` (peer dependency, not bundled)
- Use Redis MULTI/EXEC for atomic operations
- Set TTL on keys using `PEXPIRE`
- Tests: use `ioredis-mock` or skip with `describe.skip` if no Redis available
- Mark Redis as optional peer dependency

### Phase 4: Middleware & Integration

**4.1 — Express middleware**
- `rateLimit(options)` returns `(req, res, next) => void`
- Extract key (default: `req.ip`)
- Call algorithm.consume(key)
- If allowed: set headers, call next()
- If denied: set headers, send 429 with JSON body
- Attach `req.rateLimit` info for downstream use
- Call `options.skip?.(req)` to bypass certain requests
- Call `options.onLimitReached?.(req, res, info)` on 429

**4.2 — Integration tests**
- Create Express app with middleware, use `supertest`
- Test: requests within limit succeed, over limit get 429
- Test: headers are correct on every response
- Test: custom key extractor works
- Test: skip function bypasses rate limiting
- Test: multiple middleware instances (different routes, different limits)
- Test: response body format on 429

### Phase 5: Refactor for Elegance

- Ensure algorithms share no duplicated logic — extract common patterns
- Review type safety: no `any`, no type assertions without reason
- Ensure store cleanup doesn't leak (memory store interval cleared)
- Review error messages for DX (developer experience)
- ESLint clean, Prettier formatted
- Each file <150 lines

### Phase 6: Examples & Documentation

**6.1 — Examples**
- `examples/basic.ts`: minimal setup
- `examples/redis.ts`: Redis backend
- `examples/multi-tier.ts`: different limits for auth vs public routes
- `examples/custom-key.ts`: rate limit by API key header
- Each example is runnable: `npx ts-node examples/basic.ts`

**6.2 — README.md**
```
# ratelimit — Express Rate Limiting Middleware

[badges]

One-line description

## Install
  npm install

## Quick Start
  5-line example

## Algorithms
  ### Fixed Window — how it works, when to use
  ### Sliding Window — how it works, when to use
  ### Token Bucket — how it works, when to use
  Comparison table: accuracy, memory, burst handling

## API Reference
  rateLimit(options) — full options table

## Stores
  ### Memory (default)
  ### Redis

## Custom Key Extraction

## Examples
  Links to example files

## Headers
  What headers are set and what they mean

## Development
  npm test, npm run lint, npm run build

## License
  MIT
```

**6.3 — Final checks**
- Full posting checklist
- `npm run build` produces clean dist/ with .js + .d.ts
- `npm test` all green
- `npm run lint` clean
- No secrets, no personal data
- Conventional commits

---

## Tech Stack

| Component | Choice |
|-----------|--------|
| Language | TypeScript (strict) |
| Runtime | Node.js 20+ |
| Framework | Express (peer dep) |
| Redis | ioredis (optional peer dep) |
| Testing | Jest + supertest |
| Linting | ESLint + Prettier |
| Build | tsc (declaration files for npm) |

---

## Commit Plan

1. `feat: scaffold project with TypeScript, Jest, ESLint config`
2. `feat: add core types, interfaces, and window parser`
3. `feat: implement fixed window algorithm with tests`
4. `feat: implement sliding window algorithm with tests`
5. `feat: implement token bucket algorithm with tests`
6. `feat: add in-memory store with TTL cleanup`
7. `feat: add Redis store with atomic operations`
8. `feat: add Express middleware factory with headers`
9. `test: add middleware integration tests with supertest`
10. `feat: add usage examples (basic, redis, multi-tier, custom-key)`
11. `refactor: DRY algorithm code, tighten types`
12. `docs: add README with algorithm comparison and API reference`
13. `ci: add GitHub Actions workflow (test, lint, build)`
14. `chore: final lint pass and cleanup`
