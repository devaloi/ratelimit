import type { Redis } from 'ioredis';
import type { Store, StoreEntry, RedisStoreConfig } from './types.js';

/**
 * Validate that a parsed value conforms to the StoreEntry shape.
 */
function isStoreEntry(value: unknown): value is StoreEntry {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const v = value as Record<string, unknown>;
  if (v['count'] !== undefined && typeof v['count'] !== 'number') {
    return false;
  }
  if (v['tokens'] !== undefined && typeof v['tokens'] !== 'number') {
    return false;
  }
  if (v['lastRefill'] !== undefined && typeof v['lastRefill'] !== 'number') {
    return false;
  }
  if (v['timestamps'] !== undefined && !Array.isArray(v['timestamps'])) {
    return false;
  }
  return true;
}

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
    try {
      const parsed: unknown = JSON.parse(data);
      if (!isStoreEntry(parsed)) {
        return null;
      }
      return parsed;
    } catch {
      return null;
    }
  }

  /**
   * Set an entry for a key with a TTL.
   * @param key - The rate limit key
   * @param entry - The entry to store
   * @param ttlMs - Time to live in milliseconds
   */
  async set(key: string, entry: StoreEntry, ttlMs: number): Promise<void> {
    const prefixedKey = this.getKey(key);
    await this.client.set(prefixedKey, JSON.stringify(entry), 'PX', ttlMs);
  }

  /**
   * Atomically increment a numeric field in the entry.
   * Creates the entry if it doesn't exist.
   * Uses WATCH/MULTI/EXEC for optimistic locking to prevent race conditions.
   * @param key - The rate limit key
   * @param field - The field to increment (e.g., 'count')
   * @param ttlMs - Time to live in milliseconds (for new entries)
   * @returns The new value after incrementing
   */
  async increment(key: string, field: keyof StoreEntry, ttlMs: number): Promise<number> {
    const prefixedKey = this.getKey(key);
    const maxRetries = 5;

    for (let attempt = 0; attempt < maxRetries; attempt++) {
      await this.client.watch(prefixedKey);

      const data = await this.client.get(prefixedKey);
      let entry: StoreEntry;
      let isNew = false;

      if (data === null) {
        entry = {};
        (entry as Record<string, number>)[field] = 1;
        isNew = true;
      } else {
        try {
          const parsed: unknown = JSON.parse(data);
          entry = isStoreEntry(parsed) ? parsed : {};
        } catch {
          entry = {};
        }
        const currentValue = (entry[field] as number | undefined) ?? 0;
        (entry as Record<string, number>)[field] = currentValue + 1;
      }

      const multi = this.client.multi();
      if (isNew) {
        multi.set(prefixedKey, JSON.stringify(entry), 'PX', ttlMs);
      } else {
        multi.set(prefixedKey, JSON.stringify(entry));
      }
      const results = await multi.exec();

      // WATCH abort: results is null when another client modified the key
      if (results !== null) {
        return entry[field] as number;
      }
    }

    throw new Error(`Failed to increment key "${key}" after ${maxRetries} retries`);
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
