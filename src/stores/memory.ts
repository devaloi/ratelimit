import type { Store, StoreEntry, MemoryStoreConfig } from './types.js';

/**
 * Configuration for MemoryStore with optional time provider.
 */
export interface MemoryStoreOptions extends MemoryStoreConfig {
  /** Optional function to get current timestamp (for testing) */
  getCurrentTime?: () => number;
}

/**
 * Internal storage entry with expiration tracking.
 */
interface InternalEntry {
  entry: StoreEntry;
  expiresAt: number;
}

/**
 * In-memory implementation of the rate limit store.
 *
 * Uses a Map for O(1) lookups and a cleanup interval to remove expired entries.
 * Suitable for single-process applications. For distributed systems, use RedisStore.
 */
export class MemoryStore implements Store {
  private readonly data = new Map<string, InternalEntry>();
  private readonly cleanupInterval: number;
  private readonly getCurrentTime: () => number;
  private cleanupTimer: ReturnType<typeof setInterval> | null = null;

  constructor(config: MemoryStoreOptions = {}) {
    this.cleanupInterval = config.cleanupInterval ?? 60000;
    this.getCurrentTime = config.getCurrentTime ?? ((): number => Date.now());

    // Start cleanup interval if configured
    if (this.cleanupInterval > 0) {
      this.startCleanup();
    }
  }

  /**
   * Start the cleanup interval.
   */
  private startCleanup(): void {
    this.cleanupTimer = setInterval(() => {
      this.removeExpiredEntries();
    }, this.cleanupInterval);

    // Unref the timer so it doesn't prevent the process from exiting
    if (typeof this.cleanupTimer.unref === 'function') {
      this.cleanupTimer.unref();
    }
  }

  /**
   * Remove all expired entries from the store.
   */
  private removeExpiredEntries(): void {
    const now = this.getCurrentTime();
    for (const [key, item] of this.data) {
      if (item.expiresAt <= now) {
        this.data.delete(key);
      }
    }
  }

  /**
   * Get the entry for a key.
   * Returns null if the key doesn't exist or has expired.
   */
  get(key: string): Promise<StoreEntry | null> {
    const item = this.data.get(key);
    if (!item) {
      return Promise.resolve(null);
    }

    const now = this.getCurrentTime();
    if (item.expiresAt <= now) {
      this.data.delete(key);
      return Promise.resolve(null);
    }

    return Promise.resolve(item.entry);
  }

  /**
   * Set an entry for a key with a TTL.
   */
  set(key: string, entry: StoreEntry, ttlMs: number): Promise<void> {
    const now = this.getCurrentTime();
    const expiresAt = now + ttlMs;

    this.data.set(key, {
      entry: { ...entry, expiresAt },
      expiresAt,
    });

    return Promise.resolve();
  }

  /**
   * Atomically increment a numeric field in the entry.
   * Creates the entry if it doesn't exist or has expired.
   */
  increment(key: string, field: keyof StoreEntry, ttlMs: number): Promise<number> {
    const now = this.getCurrentTime();
    const item = this.data.get(key);

    let entry: StoreEntry;
    let expiresAt: number;

    if (!item || item.expiresAt <= now) {
      // Create new entry with initial value of 1
      expiresAt = now + ttlMs;
      entry = { [field]: 1, expiresAt };
    } else {
      // Increment existing field
      entry = item.entry;
      const currentValue = (entry[field] as number) ?? 0;
      entry[field] = currentValue + 1;
      expiresAt = item.expiresAt;
    }

    this.data.set(key, { entry, expiresAt });
    return Promise.resolve(entry[field] as number);
  }

  /**
   * Delete an entry from the store.
   */
  delete(key: string): Promise<void> {
    this.data.delete(key);
    return Promise.resolve();
  }

  /**
   * Clean up resources.
   * Clears the cleanup interval and all stored data.
   */
  destroy(): Promise<void> {
    if (this.cleanupTimer !== null) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }
    this.data.clear();
    return Promise.resolve();
  }
}
