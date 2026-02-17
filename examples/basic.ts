/**
 * Example: Basic Rate Limiting
 *
 * Demonstrates the simplest usage of the rate limiter:
 * - 100 requests per 15 minutes per IP address
 * - Fixed window algorithm (default)
 * - In-memory store (default)
 *
 * Run:   npx ts-node examples/basic.ts
 * Test:  curl http://localhost:3000/api/hello
 */

import express from 'express';
import { rateLimit } from '../src/index.js';

const app = express();

// Apply rate limiting middleware globally
// Default: fixed-window algorithm with in-memory store
const limiter = rateLimit({
  limit: 100, // Maximum 100 requests
  window: '15m', // Per 15-minute window
});

app.use(limiter);

// Simple test route
app.get('/api/hello', (req, res) => {
  res.json({
    message: 'Hello, World!',
    timestamp: new Date().toISOString(),
  });
});

// Health check route
app.get('/health', (req, res) => {
  res.json({ status: 'ok' });
});

const PORT = 3000;
app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
  console.log('');
  console.log('Try these commands:');
  console.log(`  curl http://localhost:${PORT}/api/hello`);
  console.log(`  curl -i http://localhost:${PORT}/api/hello  # See rate limit headers`);
  console.log('');
  console.log('Rate limit: 100 requests per 15 minutes per IP');
});
