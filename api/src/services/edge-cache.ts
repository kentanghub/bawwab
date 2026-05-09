/**
 * Edge Caching (Redis-backed)
 * Aggressive TTL-based caching for non-streaming responses.
 * Falls back to in-memory if Redis unavailable.
 */

import { logger } from './logger.js';

class EdgeCache {
  private memory = new Map<string, { value: string; expiry: number }>();
  private redis: any = null;
  private enabled = false;

  enable(redisClient: any) {
    this.redis = redisClient;
    this.enabled = true;
    logger.info('Edge cache enabled (Redis)');
  }

  async get(key: string): Promise<string | null> {
    // Try Redis first
    if (this.enabled && this.redis) {
      try {
        const val = await this.redis.get(`edge:${key}`);
        if (val) return val;
      } catch {
        // fallthrough
      }
    }
    // Memory fallback
    const entry = this.memory.get(key);
    if (entry && entry.expiry > Date.now()) return entry.value;
    if (entry) this.memory.delete(key);
    return null;
  }

  async set(key: string, value: string, ttlSeconds: number = 300): Promise<void> {
    if (this.enabled && this.redis) {
      try {
        await this.redis.setex(`edge:${key}`, ttlSeconds, value);
        return;
      } catch {
        // fallthrough
      }
    }
    this.memory.set(key, { value, expiry: Date.now() + ttlSeconds * 1000 });
  }

  async invalidate(pattern: string): Promise<void> {
    // Simple exact or prefix invalidation for memory
    for (const [k] of Array.from(this.memory.entries())) {
      if (k.startsWith(pattern)) this.memory.delete(k);
    }
    if (this.enabled && this.redis) {
      try {
        const keys = await this.redis.keys(`edge:${pattern}*`);
        if (keys.length) await this.redis.del(...keys);
      } catch {}
    }
  }

  getStats() {
    return { memoryEntries: this.memory.size, redisEnabled: this.enabled };
  }
}

export const edgeCache = new EdgeCache();
