/**
 * Redis cache adapter – wraps the existing Redis connection for caching.
 * This is the "full mode" adapter.
 */

import { type CacheAdapter } from "./types";
import { redis } from "../redis/redis";
import { logger } from "../logger";

export class RedisCacheAdapter implements CacheAdapter {
  private get client() {
    if (!redis) {
      throw new Error("[RedisCacheAdapter] Redis connection not available");
    }
    return redis;
  }

  async get<T = string>(key: string): Promise<T | null> {
    const value = await this.client.get(key);
    if (value === null) return null;
    try {
      return JSON.parse(value) as T;
    } catch {
      return value as unknown as T;
    }
  }

  async set(key: string, value: string, ttlSeconds?: number): Promise<void> {
    if (ttlSeconds) {
      await this.client.set(key, value, "EX", ttlSeconds);
    } else {
      await this.client.set(key, value);
    }
  }

  async del(key: string): Promise<void> {
    await this.client.del(key);
  }

  async exists(key: string): Promise<boolean> {
    const result = await this.client.exists(key);
    return result === 1;
  }

  async mget(keys: string[]): Promise<(string | null)[]> {
    if (keys.length === 0) return [];
    return this.client.mget(keys);
  }

  async mset(
    entries: Array<{ key: string; value: string; ttlSeconds?: number }>,
  ): Promise<void> {
    if (entries.length === 0) return;

    // Use pipeline for efficiency
    const pipeline = this.client.pipeline();
    for (const entry of entries) {
      if (entry.ttlSeconds) {
        pipeline.set(entry.key, entry.value, "EX", entry.ttlSeconds);
      } else {
        pipeline.set(entry.key, entry.value);
      }
    }
    await pipeline.exec();
  }

  async incr(key: string): Promise<number> {
    return this.client.incr(key);
  }

  async expire(key: string, ttlSeconds: number): Promise<void> {
    await this.client.expire(key, ttlSeconds);
  }

  async close(): Promise<void> {
    // Redis connection is managed globally; don't close here
    logger.debug("[RedisCacheAdapter] close() called – no-op (shared connection)");
  }
}
