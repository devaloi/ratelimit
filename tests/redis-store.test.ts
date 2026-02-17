import Redis from 'ioredis-mock';
import { RedisStore } from '../src/stores/redis';
import type { StoreEntry } from '../src/stores/types';

describe('RedisStore', () => {
  let client: InstanceType<typeof Redis>;
  let store: RedisStore;

  beforeEach(() => {
    client = new Redis();
    store = new RedisStore({ client });
  });

  afterEach(async () => {
    await store.destroy();
    await client.flushall();
  });

  describe('get', () => {
    it('should return null for missing key', async () => {
      const result = await store.get('nonexistent');
      expect(result).toBeNull();
    });

    it('should return stored entry', async () => {
      const entry: StoreEntry = { count: 5, windowStart: 1000 };
      await store.set('test-key', entry, 60000);

      const result = await store.get('test-key');
      expect(result).toEqual(entry);
    });
  });

  describe('set', () => {
    it('should store entry as JSON', async () => {
      const entry: StoreEntry = { count: 3, windowStart: 2000 };
      await store.set('json-key', entry, 60000);

      const result = await store.get('json-key');
      expect(result).toEqual(entry);
    });

    it('should set TTL using PEXPIRE', async () => {
      const entry: StoreEntry = { count: 1 };
      await store.set('ttl-key', entry, 1000);

      // Check TTL is set (should be <= 1000ms)
      const ttl = await client.pttl('rl:ttl-key');
      expect(ttl).toBeGreaterThan(0);
      expect(ttl).toBeLessThanOrEqual(1000);
    });

    it('should handle complex entries with all fields', async () => {
      const entry: StoreEntry = {
        count: 10,
        timestamps: [1000, 2000, 3000],
        tokens: 50,
        lastRefill: 5000,
        windowStart: 1000,
        expiresAt: 10000,
      };
      await store.set('complex-key', entry, 60000);

      const result = await store.get('complex-key');
      expect(result).toEqual(entry);
    });
  });

  describe('increment', () => {
    it('should create entry if does not exist', async () => {
      const result = await store.increment('new-key', 'count', 60000);

      expect(result).toBe(1);

      const entry = await store.get('new-key');
      expect(entry).toEqual({ count: 1 });
    });

    it('should increment existing field', async () => {
      await store.set('inc-key', { count: 5 }, 60000);

      const result = await store.increment('inc-key', 'count', 60000);

      expect(result).toBe(6);

      const entry = await store.get('inc-key');
      expect(entry?.count).toBe(6);
    });

    it('should increment field that does not exist in entry', async () => {
      await store.set('partial-key', { windowStart: 1000 }, 60000);

      const result = await store.increment('partial-key', 'count', 60000);

      expect(result).toBe(1);

      const entry = await store.get('partial-key');
      expect(entry?.count).toBe(1);
      expect(entry?.windowStart).toBe(1000);
    });

    it('should increment tokens field', async () => {
      await store.set('tokens-key', { tokens: 10 }, 60000);

      const result = await store.increment('tokens-key', 'tokens', 60000);

      expect(result).toBe(11);
    });

    it('should set TTL for new entries', async () => {
      await store.increment('new-ttl-key', 'count', 5000);

      const ttl = await client.pttl('rl:new-ttl-key');
      expect(ttl).toBeGreaterThan(0);
      expect(ttl).toBeLessThanOrEqual(5000);
    });
  });

  describe('delete', () => {
    it('should remove entry', async () => {
      await store.set('delete-key', { count: 1 }, 60000);

      await store.delete('delete-key');

      const result = await store.get('delete-key');
      expect(result).toBeNull();
    });

    it('should not throw for nonexistent key', async () => {
      await expect(store.delete('nonexistent')).resolves.toBeUndefined();
    });
  });

  describe('key prefix', () => {
    it('should apply default prefix', async () => {
      await store.set('prefixed', { count: 1 }, 60000);

      // Verify key is stored with prefix
      const raw = await client.get('rl:prefixed');
      expect(raw).not.toBeNull();
      expect(JSON.parse(raw!)).toEqual({ count: 1 });
    });

    it('should apply custom prefix', async () => {
      const customStore = new RedisStore({ client, prefix: 'custom:' });
      await customStore.set('mykey', { count: 2 }, 60000);

      const raw = await client.get('custom:mykey');
      expect(raw).not.toBeNull();
      expect(JSON.parse(raw!)).toEqual({ count: 2 });

      // Verify default prefix key does not exist
      const defaultRaw = await client.get('rl:mykey');
      expect(defaultRaw).toBeNull();

      await customStore.destroy();
    });

    it('should use prefix in delete', async () => {
      await store.set('del-test', { count: 1 }, 60000);

      // Verify it exists
      expect(await client.get('rl:del-test')).not.toBeNull();

      await store.delete('del-test');

      // Verify it was deleted with correct prefix
      expect(await client.get('rl:del-test')).toBeNull();
    });

    it('should use prefix in increment', async () => {
      await store.increment('inc-prefix', 'count', 60000);

      const raw = await client.get('rl:inc-prefix');
      expect(raw).not.toBeNull();
      expect(JSON.parse(raw!)).toEqual({ count: 1 });
    });
  });

  describe('destroy', () => {
    it('should not close the client', async () => {
      await store.destroy();

      // Client should still be usable
      await client.set('after-destroy', 'value');
      const result = await client.get('after-destroy');
      expect(result).toBe('value');
    });
  });

  describe('set/get round-trip', () => {
    it('should preserve all StoreEntry fields', async () => {
      const entries: StoreEntry[] = [
        { count: 100 },
        { timestamps: [1, 2, 3, 4, 5] },
        { tokens: 999, lastRefill: 12345 },
        { windowStart: 1000000, expiresAt: 2000000, count: 50 },
      ];

      for (let i = 0; i < entries.length; i++) {
        const key = `roundtrip-${i}`;
        await store.set(key, entries[i], 60000);
        const result = await store.get(key);
        expect(result).toEqual(entries[i]);
      }
    });
  });
});
