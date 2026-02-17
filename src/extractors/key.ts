import type { Request } from 'express';
import type { KeyExtractor } from '../types.js';

/**
 * Default key extractor that uses the client IP address.
 * Falls back to 'unknown' if IP cannot be determined.
 */
export const ipKeyExtractor: KeyExtractor = (req: Request): string => {
  // Check X-Forwarded-For header first (for proxied requests)
  const forwarded = req.headers['x-forwarded-for'];
  if (typeof forwarded === 'string') {
    const firstIp = forwarded.split(',')[0]?.trim();
    if (firstIp !== undefined && firstIp.length > 0) {
      return firstIp;
    }
  }

  // Fall back to req.ip (Express property)
  if (req.ip !== undefined && req.ip.length > 0) {
    return req.ip;
  }

  // Last resort: socket remote address
  const socketAddr = req.socket?.remoteAddress;
  if (socketAddr !== undefined && socketAddr.length > 0) {
    return socketAddr;
  }

  return 'unknown';
};

/**
 * Create a key extractor that uses a specific header value.
 *
 * @param headerName - Name of the header to extract (case-insensitive)
 * @param fallback - Fallback value if header is not present (default: throws error)
 * @returns KeyExtractor function
 *
 * @example
 * const extractor = headerKeyExtractor('x-api-key');
 * app.use(rateLimit({ keyExtractor: extractor }));
 */
export function headerKeyExtractor(headerName: string, fallback?: string): KeyExtractor {
  const normalizedHeader = headerName.toLowerCase();

  return (req: Request): string => {
    const value = req.headers[normalizedHeader];

    if (typeof value === 'string' && value.length > 0) {
      return value;
    }

    if (Array.isArray(value) && value.length > 0) {
      const first = value[0];
      if (first !== undefined && first.length > 0) {
        return first;
      }
    }

    if (fallback !== undefined) {
      return fallback;
    }

    throw new Error(`Missing required header for rate limiting: ${headerName}`);
  };
}

/**
 * Create a composite key extractor that combines multiple values.
 *
 * @param extractors - Array of key extractors to combine
 * @param separator - Separator between key parts (default: ':')
 * @returns KeyExtractor function that returns combined key
 *
 * @example
 * const extractor = compositeKeyExtractor([
 *   ipKeyExtractor,
 *   headerKeyExtractor('x-api-key', 'anonymous')
 * ]);
 */
export function compositeKeyExtractor(
  extractors: KeyExtractor[],
  separator: string = ':'
): KeyExtractor {
  return (req: Request): string => {
    return extractors.map((extractor) => extractor(req)).join(separator);
  };
}
