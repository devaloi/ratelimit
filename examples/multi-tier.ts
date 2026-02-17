/**
 * Example: Multi-Tier Rate Limiting
 *
 * Demonstrates applying different rate limits to different routes:
 * - /api/data: Strict limit (10 requests per minute) for heavy operations
 * - /api/public: Lenient limit (100 requests per minute) for public endpoints
 *
 * Run:   npx ts-node examples/multi-tier.ts
 * Test:  curl http://localhost:3002/api/data
 *        curl http://localhost:3002/api/public
 */

import express from 'express';
import { rateLimit } from '../src/index';

const app = express();

// Strict rate limiter for heavy/expensive endpoints
const strictLimiter = rateLimit({
  limit: 10, // Only 10 requests
  window: '1m', // Per minute
  algorithm: 'fixed-window',
  message: 'Too many requests to this endpoint. Please try again later.',
});

// Lenient rate limiter for public/lightweight endpoints
const lenientLimiter = rateLimit({
  limit: 100, // 100 requests
  window: '1m', // Per minute
  algorithm: 'fixed-window',
});

// Apply strict limiter to /api/data routes
app.use('/api/data', strictLimiter);

// Apply lenient limiter to /api/public routes
app.use('/api/public', lenientLimiter);

// Heavy endpoint - simulates expensive database query
app.get('/api/data', (req, res) => {
  res.json({
    message: 'This is expensive data from the database',
    items: [
      { id: 1, name: 'Item 1' },
      { id: 2, name: 'Item 2' },
    ],
    timestamp: new Date().toISOString(),
  });
});

// Public endpoint - lightweight
app.get('/api/public', (req, res) => {
  res.json({
    message: 'This is public information',
    version: '1.0.0',
    timestamp: new Date().toISOString(),
  });
});

// Public status endpoint - also lightweight
app.get('/api/public/status', (req, res) => {
  res.json({
    status: 'operational',
    uptime: process.uptime(),
  });
});

// Health check - no rate limiting
app.get('/health', (req, res) => {
  res.json({ status: 'ok' });
});

const PORT = 3002;
app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
  console.log('');
  console.log('Endpoints with different rate limits:');
  console.log('');
  console.log('  /api/data   - STRICT:  10 requests per minute');
  console.log(`    curl http://localhost:${PORT}/api/data`);
  console.log('');
  console.log('  /api/public - LENIENT: 100 requests per minute');
  console.log(`    curl http://localhost:${PORT}/api/public`);
  console.log(`    curl http://localhost:${PORT}/api/public/status`);
  console.log('');
  console.log('  /health     - No rate limiting');
  console.log(`    curl http://localhost:${PORT}/health`);
});
