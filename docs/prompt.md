# Build ratelimit — Express Rate Limiting Middleware

You are building a **portfolio project** for a Senior AI Engineer's public GitHub. It must be impressive, clean, and production-grade. Read these docs before writing any code:

1. **`docs/E04-express-rate-limiter.md`** — Complete project spec: architecture, phases, algorithm details, commit plan. This is your primary blueprint. Follow it phase by phase.
2. **`docs/github-portfolio.md`** — Portfolio goals and Definition of Done (Level 1 + Level 2). Understand the quality bar.
3. **`docs/github-portfolio-checklist.md`** — Pre-publish checklist. Every item must pass before you're done.

---

## Instructions

### Read first, build second
Read all three docs completely before writing a single line of code. Understand the three algorithms, the store interface, the middleware factory pattern, and the quality expectations.

### Follow the phases in order
The project spec has 6 phases. Do them in order:
1. **Scaffold & Core Types** — project setup (TypeScript strict, Jest, ESLint, Prettier), interfaces, Options type, window string parser
2. **Algorithms** — fixed window, sliding window log, token bucket — each with tests using mocked time
3. **Stores** — in-memory store with TTL cleanup, Redis store with atomic ops
4. **Middleware & Integration** — Express middleware factory, response headers, supertest integration tests
5. **Refactor for Elegance** — DRY algorithm code, tighten types (no `any`), clean up store lifecycle
6. **Examples & Documentation** — 4 runnable examples, README with algorithm comparison table, final checklist

### Use subagents
This is a substantial project. Use subagents to parallelize where it makes sense:
- One subagent per algorithm (fixed window, sliding window, token bucket) — they're independent
- One subagent for memory store while another does Redis store
- A dedicated subagent for the middleware factory + integration tests
- A dedicated subagent for the refactoring pass (review all types, DRY patterns)
- A dedicated subagent for examples + README

### Commit frequently
Follow the commit plan in the spec. Use **conventional commits** (`feat:`, `test:`, `refactor:`, `docs:`, `ci:`, `chore:`). Each commit should be a logical unit. Do NOT accumulate a massive uncommitted diff.

### Quality non-negotiables
- **Three algorithms from scratch.** Fixed window, sliding window log, and token bucket — all implemented by hand. No rate limiting libraries. This is the whole point of the project.
- **TypeScript strict mode.** No `any` types. No type assertions without comments. Generics where they add value. This must showcase TypeScript mastery.
- **Time-mocked tests.** Tests must not wait real seconds. Mock `Date.now()` or inject a clock. Test that requests are rejected after the limit, and accepted after the window resets.
- **npm-publishable structure.** Proper `package.json` exports, `.d.ts` declaration files, `tsconfig.build.json` for the build output. `npm pack` should produce a clean package.
- **Standard rate limit headers.** `X-RateLimit-Limit`, `X-RateLimit-Remaining`, `X-RateLimit-Reset`, `Retry-After` on 429s. Test these explicitly.
- **No fake anything.** No placeholder tests. No "TODO" comments. No stubbed-out functions. Everything works.
- **Lint clean.** `npm run lint` (ESLint + Prettier) must pass with zero issues.

### Final verification
Before you consider the project done:
1. `npm run build` — compiles clean, produces dist/ with .js + .d.ts
2. `npm test` — all tests pass
3. `npm run lint` — zero issues
4. Walk through `docs/github-portfolio-checklist.md` item by item
5. Run each example: `npx ts-node examples/basic.ts` — verify it starts and rate limits work
6. Verify 429 response includes correct headers and JSON body
7. Review git log — does the commit history tell a coherent story?

### What NOT to do
- Don't use any rate limiting library. Implement all three algorithms from scratch.
- Don't use `any` types anywhere. Strict TypeScript throughout.
- Don't write tests that wait real time (no `setTimeout` in tests). Mock the clock.
- Don't skip the refactoring phase.
- Don't write tests after everything else. Write them alongside each algorithm.
- Don't leave `// TODO` or `// FIXME` comments anywhere.
- Don't hardcode any personal paths, usernames, or data.
- Don't commit `node_modules/`, `dist/`, or `.DS_Store`.
- Don't use Docker. No Dockerfile. Just `npm run build` and `npm test`.

---

## GitHub Username

The GitHub username is **devaloi**. If referencing a GitHub repo URL, use `github.com/devaloi/ratelimit`. For the npm package name, use `@devaloi/ratelimit` (scoped). Do not guess or use any other username.

## Start

Read the three docs. Then begin Phase 1 from `docs/E04-express-rate-limiter.md`.
