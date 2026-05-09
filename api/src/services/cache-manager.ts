import Redis from 'ioredis';

class CacheManager {
  private redis: Redis | null = null;
  private connected = false;
  private memoryCache = new Map<string, { value: string; expiry: number }>();

  async connect(): Promise<void> {
    const redisUrl = process.env.REDIS_URL;
    
    if (redisUrl) {
      try {
        this.redis = new Redis(redisUrl, {
          retryStrategy: (times) => Math.min(times * 50, 2000),
          maxRetriesPerRequest: 3
        });
        
        this.redis.on('connect', () => {
          this.connected = true;
          console.log('Redis connected');
        });
        
        this.redis.on('error', (err) => {
          console.error('Redis error:', err.message);
          this.connected = false;
        });
      } catch (err) {
        console.warn('Failed to connect to Redis, using in-memory cache');
        this.connected = false;
      }
    }
  }

  async disconnect(): Promise<void> {
    if (this.redis) {
      await this.redis.quit();
      this.connected = false;
    }
  }

  isConnected(): boolean {
    return this.connected;
  }

  async get(key: string): Promise<string | null> {
    // Try Redis first
    if (this.connected && this.redis) {
      try {
        return await this.redis.get(key);
      } catch {
        // Fallback to memory
      }
    }
    
    // In-memory fallback
    const entry = this.memoryCache.get(key);
    if (entry && entry.expiry > Date.now()) {
      return entry.value;
    }
    this.memoryCache.delete(key);
    return null;
  }

  async set(key: string, value: string, ttlSeconds?: number): Promise<void> {
    if (this.connected && this.redis) {
      try {
        if (ttlSeconds) {
          await this.redis.setex(key, ttlSeconds, value);
        } else {
          await this.redis.set(key, value);
        }
        return;
      } catch {
        // Fallback to memory
      }
    }
    
    // In-memory fallback
    const expiry = ttlSeconds ? Date.now() + ttlSeconds * 1000 : Infinity;
    this.memoryCache.set(key, { value, expiry });
  }

  async del(key: string): Promise<void> {
    if (this.connected && this.redis) {
      try {
        await this.redis.del(key);
      } catch {
        // Ignore
      }
    }
    this.memoryCache.delete(key);
  }

  async getJson<T>(key: string): Promise<T | null> {
    const value = await this.get(key);
    if (!value) return null;
    try {
      return JSON.parse(value) as T;
    } catch {
      return null;
    }
  }

  async setJson<T>(key: string, value: T, ttlSeconds?: number): Promise<void> {
    await this.set(key, JSON.stringify(value), ttlSeconds);
  }

  generateKey(...parts: string[]): string {
    return `bawwab:${parts.join(':')}`;
  }
}

export const cacheManager = new CacheManager();
