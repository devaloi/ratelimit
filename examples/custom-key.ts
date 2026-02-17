/**
 * Example: Custom Key Extractor (API Key)
 *
 * Demonstrates rate limiting by API key instead of IP address.
 * This is useful for API services where clients authenticate with API keys.
 *
 * Run:   npx ts-node examples/custom-key.ts
 * Test:  curl -H "X-API-Key: user123" http://localhost:3003/api/data
 *        curl -H "X-API-Key: user456" http://localhost:3003/api/data
 */

import express from 'express';
import { rateLimit, headerKeyExtractor } from '../src/index';

const app = express();

// Rate limit by X-API-Key header
// Each unique API key gets its own rate limit bucket
const apiKeyLimiter = rateLimit({
  limit: 20, // 20 requests
  window: '1m', // Per minute
  algorithm: 'token-bucket', // Use token bucket for smooth rate limiting
  refillRate: 0.33, // Refill ~20 tokens per minute (0.33 per second)
  keyExtractor: headerKeyExtractor('X-API-Key', 'anonymous'),
  message: 'API rate limit exceeded. Please wait before making more requests.',
});

// Middleware to validate API key exists (for protected routes)
const requireApiKey = (
  req: express.Request,
  res: express.Response,
  next: express.NextFunction
) => {
  const apiKey = req.headers['x-api-key'];
  if (!apiKey) {
    res.status(401).json({
      error: 'Unauthorized',
      message: 'X-API-Key header is required',
    });
    return;
  }
  next();
};

// Apply rate limiting and API key validation to /api routes
app.use('/api', requireApiKey, apiKeyLimiter);

// Protected API endpoint
app.get('/api/data', (req, res) => {
  const apiKey = req.headers['x-api-key'];
  res.json({
    message: 'Protected data accessed successfully',
    apiKey: apiKey,
    data: {
      items: ['item1', 'item2', 'item3'],
      count: 3,
    },
    timestamp: new Date().toISOString(),
  });
});

// Another protected endpoint
app.get('/api/profile', (req, res) => {
  const apiKey = req.headers['x-api-key'];
  res.json({
    apiKey: apiKey,
    profile: {
      name: 'Example User',
      plan: 'standard',
      rateLimit: '20 requests/minute',
    },
  });
});

// Public endpoint - no rate limiting
app.get('/public/info', (req, res) => {
  res.json({
    name: 'My API Service',
    version: '1.0.0',
    documentation: 'https://example.com/docs',
  });
});

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok' });
});

const PORT = 3003;
app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
  console.log('');
  console.log('Rate limiting by API key (X-API-Key header)');
  console.log('Each API key has its own limit: 20 requests per minute');
  console.log('');
  console.log('Try these commands:');
  console.log(`  curl -H "X-API-Key: user123" http://localhost:${PORT}/api/data`);
  console.log(`  curl -H "X-API-Key: user456" http://localhost:${PORT}/api/data`);
  console.log(`  curl -H "X-API-Key: user123" http://localhost:${PORT}/api/profile`);
  console.log('');
  console.log('Without API key (returns 401):');
  console.log(`  curl http://localhost:${PORT}/api/data`);
  console.log('');
  console.log('Public endpoint (no auth or rate limit):');
  console.log(`  curl http://localhost:${PORT}/public/info`);
});
