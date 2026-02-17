/**
 * Entry stored in the rate limit store.
 * Structure varies by algorithm but is represented as a flexible record.
 */
export interface StoreEntry {
  /** Counter for fixed window */
  count?: number;
  /** Timestamps for sliding window log */
  timestamps?: number[];
  /** Current token count for token bucket */
  tokens?: number;
  /** Last refill timestamp for token bucket */
  lastRefill?: number;
  /** Window start timestamp for fixed window */
  windowStart?: number;
  /** Entry expiration timestamp */
  expiresAt?: number;
}

/**
 * Interface for rate limit data stores.
 * Implementations must be async to support both memory and distributed stores.
 */
export interface Store {
  /**
   * Get the entry for a key.
   * @param key - The rate limit key
   * @returns The stored entry or null if not found/expired
   */
  get(key: string): Promise<StoreEntry | null>;

  /**
   * Set an entry for a key with a TTL.
   * @param key - The rate limit key
   * @param entry - The entry to store
   * @param ttlMs - Time to live in milliseconds
   */
  set(key: string, entry: StoreEntry, ttlMs: number): Promise<void>;

  /**
   * Atomically increment a numeric field in the entry.
   * Creates the entry if it doesn't exist.
   * @param key - The rate limit key
   * @param field - The field to increment (e.g., 'count')
   * @param ttlMs - Time to live in milliseconds (for new entries)
   * @returns The new value after incrementing
   */
  increment(key: string, field: keyof StoreEntry, ttlMs: number): Promise<number>;

  /**
   * Delete an entry.
   * @param key - The rate limit key
   */
  delete(key: string): Promise<void>;

  /**
   * Clean up resources (e.g., cleanup intervals, connections).
   */
  destroy(): Promise<void>;
}

/**
 * Configuration for memory store.
 */
export interface MemoryStoreConfig {
  /** Cleanup interval in milliseconds (default: 60000) */
  cleanupInterval?: number;
}

/**
 * Configuration for Redis store.
 */
export interface RedisStoreConfig {
  /** ioredis client instance */
  client: unknown;
  /** Key prefix (default: 'rl:') */
  prefix?: string;
}
