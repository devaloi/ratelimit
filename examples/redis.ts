/**
 * Example: Redis Backend
 *
 * Demonstrates using Redis as the storage backend for rate limiting.
 * This is essential for distributed systems where multiple server
 * instances need to share rate limit state.
 *
 * Requires: Redis running on localhost:6379
 *
 * Run:   npx ts-node examples/redis.ts
 * Test:  curl http://localhost:3001/api/data
 */

import express from 'express';
import Redis from 'ioredis';
import { rateLimit } from '../src/index.js';

async function main() {
  const app = express();

  // Create Redis client using ioredis
  const redisClient = new Redis({
    host: 'localhost',
    port: 6379,
  });

  redisClient.on('error', (err: Error) => {
    console.error('Redis Client Error:', err);
  });

  redisClient.on('connect', () => {
    console.log('Connected to Redis');
  });

  // Apply rate limiting with Redis backend
  const limiter = rateLimit({
    limit: 50, // Maximum 50 requests
    window: '1m', // Per 1-minute window
    algorithm: 'sliding-window', // Use sliding window for smoother limiting
    store: {
      type: 'redis',
      client: redisClient,
      prefix: 'myapp:ratelimit:', // Custom key prefix
    },
  });

  app.use(limiter);

  // API endpoint
  app.get('/api/data', (req, res) => {
    res.json({
      data: { id: 1, name: 'Sample Data' },
      timestamp: new Date().toISOString(),
    });
  });

  // Health check
  app.get('/health', (req, res) => {
    res.json({ status: 'ok', redis: 'connected' });
  });

  const PORT = 3001;
  app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
    console.log('');
    console.log('Try these commands:');
    console.log(`  curl http://localhost:${PORT}/api/data`);
    console.log(`  curl -i http://localhost:${PORT}/api/data  # See rate limit headers`);
    console.log('');
    console.log('Rate limit: 50 requests per minute per IP (sliding window)');
    console.log('Backend: Redis with prefix "myapp:ratelimit:"');
  });

  // Graceful shutdown
  process.on('SIGINT', () => {
    console.log('\nShutting down...');
    redisClient.quit();
    process.exit(0);
  });
}

main().catch(console.error);
