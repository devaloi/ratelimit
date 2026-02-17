import type { Redis } from 'ioredis';
import type { Store, StoreEntry, RedisStoreConfig } from './types.js';

/**
 * Redis-backed store for rate limiting.
 * Uses ioredis client for Redis operations.
 */
export class RedisStore implements Store {
  private readonly client: Redis;
  private readonly prefix: string;

  constructor(config: RedisStoreConfig) {
    // Cast justified: RedisStoreConfig.client is typed as unknown to avoid
    // forcing ioredis as a direct dependency. Callers must provide a valid Redis client.
    this.client = config.client as Redis;
    this.prefix = config.prefix ?? 'rl:';
  }

  /**
   * Get the prefixed key for Redis operations.
   */
  private getKey(key: string): string {
    return `${this.prefix}${key}`;
  }

  /**
   * Get the entry for a key.
   * @param key - The rate limit key
   * @returns The stored entry or null if not found/expired
   */
  async get(key: string): Promise<StoreEntry | null> {
    const data = await this.client.get(this.getKey(key));
    if (data === null) {
      return null;
    }
    // Cast justified: we trust our own stored JSON format
    return JSON.parse(data) as StoreEntry;
  }

  /**
   * Set an entry for a key with a TTL.
   * @param key - The rate limit key
   * @param entry - The entry to store
   * @param ttlMs - Time to live in milliseconds
   */
  async set(key: string, entry: StoreEntry, ttlMs: number): Promise<void> {
    const prefixedKey = this.getKey(key);
    await this.client.set(prefixedKey, JSON.stringify(entry));
    await this.client.pexpire(prefixedKey, ttlMs);
  }

  /**
   * Atomically increment a numeric field in the entry.
   * Creates the entry if it doesn't exist.
   * Uses MULTI/EXEC for atomicity.
   * @param key - The rate limit key
   * @param field - The field to increment (e.g., 'count')
   * @param ttlMs - Time to live in milliseconds (for new entries)
   * @returns The new value after incrementing
   */
  async increment(key: string, field: keyof StoreEntry, ttlMs: number): Promise<number> {
    const prefixedKey = this.getKey(key);

    // Get current entry
    const data = await this.client.get(prefixedKey);
    let entry: StoreEntry;
    let isNew = false;

    if (data === null) {
      // Create new entry with field set to 1
      entry = { [field]: 1 };
      isNew = true;
    } else {
      // Increment existing field
      // Cast justified: JSON.parse returns unknown, we trust our own stored format
      entry = JSON.parse(data) as StoreEntry;
      // Cast justified: increment() is only called on numeric fields (count, tokens)
      const currentValue = (entry[field] as number | undefined) ?? 0;
      entry[field] = currentValue + 1;
    }

    // Use MULTI/EXEC for atomic set + pexpire
    const multi = this.client.multi();
    multi.set(prefixedKey, JSON.stringify(entry));
    if (isNew) {
      multi.pexpire(prefixedKey, ttlMs);
    }
    await multi.exec();

    // Cast justified: we just set this field to a number above
    return entry[field] as number;
  }

  /**
   * Delete an entry.
   * @param key - The rate limit key
   */
  async delete(key: string): Promise<void> {
    await this.client.del(this.getKey(key));
  }

  /**
   * Clean up resources.
   * Note: We don't close the Redis client here as it's managed externally.
   */
  async destroy(): Promise<void> {
    // No-op: The client lifecycle is managed by the user
  }
}
