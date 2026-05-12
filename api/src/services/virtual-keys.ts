/**
 * Virtual API Keys (Multi-Tenant)
 * End users can generate their own API keys with:
 * - Per-key quotas (daily/monthly requests, tokens, cost)
 * - Per-key rate limits (RPM/TPM)
 * - Cost attribution per key
 * - Key revocation / expiration
 */

import { logger } from './logger.js';
import { createHash, randomBytes } from 'node:crypto';

export interface VirtualKey {
  id: string;
  name: string;
  keyHash: string;        // sha256 of actual key (for lookup)
  keyPrefix: string;      // first 8 chars for display
  owner: string;          // user identifier
  createdAt: Date;
  expiresAt?: Date;
  revokedAt?: Date;
  quotas: KeyQuotas;
  rateLimits: RateLimits;
  usage: KeyUsage;
}

export interface KeyQuotas {
  dailyRequests?: number;
  monthlyRequests?: number;
  dailyTokens?: number;
  monthlyTokens?: number;
  dailyCost?: number;
  monthlyCost?: number;
}

export interface RateLimits {
  rpm: number;  // requests per minute
  tpm: number;  // tokens per minute
  rpd: number;  // requests per day
}

export interface KeyUsage {
  requestsToday: number;
  requestsThisMonth: number;
  tokensToday: number;
  tokensThisMonth: number;
  costToday: number;
  costThisMonth: number;
  lastUsedAt?: Date;
  lastResetDay: Date;
  lastResetMonth: Date;
}

interface MinuteBucket {
  requests: number;
  tokens: number;
  resetAt: Date;
}

// In-memory stores (use DB in production)
const keyStore: Map<string, VirtualKey> = new Map();
const hashToId: Map<string, string> = new Map();
const rateLimitBuckets: Map<string, MinuteBucket> = new Map();

const DEFAULT_QUOTAS: KeyQuotas = {
  dailyRequests: 10000,
  monthlyRequests: 100000,
  dailyTokens: 10000000,
  monthlyTokens: 100000000,
  dailyCost: 50,
  monthlyCost: 500,
};

const DEFAULT_RATE_LIMITS: RateLimits = {
  rpm: 60,
  tpm: 100000,
  rpd: 10000,
};

class VirtualKeyManager {
  /**
   * Generate a new virtual API key
   */
  createKey(options: {
    name: string;
    owner: string;
    quotas?: Partial<KeyQuotas>;
    rateLimits?: Partial<RateLimits>;
    expiresInDays?: number;
  }): { key: VirtualKey; plainKey: string } {
    const plainKey = `bawwab-${randomBytes(24).toString('hex')}`;
    const keyHash = createHash('sha256').update(plainKey).digest('hex');
    const keyPrefix = plainKey.slice(0, 12);

    const now = new Date();
    const id = `key_${randomBytes(8).toString('hex')}`;

    const key: VirtualKey = {
      id,
      name: options.name,
      keyHash,
      keyPrefix,
      owner: options.owner,
      createdAt: now,
      expiresAt: options.expiresInDays
        ? new Date(now.getTime() + options.expiresInDays * 86400000)
        : undefined,
      quotas: { ...DEFAULT_QUOTAS, ...options.quotas },
      rateLimits: { ...DEFAULT_RATE_LIMITS, ...options.rateLimits },
      usage: {
        requestsToday: 0,
        requestsThisMonth: 0,
        tokensToday: 0,
        tokensThisMonth: 0,
        costToday: 0,
        costThisMonth: 0,
        lastResetDay: this.dayStart(),
        lastResetMonth: this.monthStart(),
      },
    };

    keyStore.set(id, key);
    hashToId.set(keyHash, id);
    logger.info(`[VirtualKey] Created key ${id} for ${options.owner}`);

    return { key, plainKey };
  }

  /**
   * Validate and lookup key by plaintext
   */
  validateKey(plainKey: string): VirtualKey | null {
    const keyHash = createHash('sha256').update(plainKey).digest('hex');
    const id = hashToId.get(keyHash);
    if (!id) return null;

    const key = keyStore.get(id);
    if (!key) return null;

    // Check expiration
    if (key.expiresAt && new Date() > key.expiresAt) return null;
    if (key.revokedAt) return null;

    this.resetCountersIfNeeded(key);
    return key;
  }

  /**
   * Check rate limits for a key
   */
  checkRateLimit(keyId: string, tokens: number): { allowed: boolean; retryAfter?: number } {
    const key = keyStore.get(keyId);
    if (!key) return { allowed: false };

    const now = new Date();
    const bucketKey = `${keyId}:${now.getHours()}:${now.getMinutes()}`;
    let bucket = rateLimitBuckets.get(bucketKey);

    if (!bucket || now > bucket.resetAt) {
      bucket = { requests: 0, tokens: 0, resetAt: new Date(now.getTime() + 60000) };
      rateLimitBuckets.set(bucketKey, bucket);
    }

    // RPM check
    if (bucket.requests >= key.rateLimits.rpm) {
      return { allowed: false, retryAfter: Math.ceil((bucket.resetAt.getTime() - now.getTime()) / 1000) };
    }

    // TPM check
    if (bucket.tokens + tokens > key.rateLimits.tpm) {
      return { allowed: false, retryAfter: Math.ceil((bucket.resetAt.getTime() - now.getTime()) / 1000) };
    }

    // RPD check
    if (key.usage.requestsToday >= key.rateLimits.rpd) {
      return { allowed: false, retryAfter: Math.ceil((this.dayEnd().getTime() - now.getTime()) / 1000) };
    }

    // Quota checks
    if (key.quotas.dailyRequests && key.usage.requestsToday >= key.quotas.dailyRequests) {
      return { allowed: false, retryAfter: Math.ceil((this.dayEnd().getTime() - now.getTime()) / 1000) };
    }
    if (key.quotas.dailyTokens && key.usage.tokensToday >= key.quotas.dailyTokens) {
      return { allowed: false, retryAfter: Math.ceil((this.dayEnd().getTime() - now.getTime()) / 1000) };
    }
    if (key.quotas.dailyCost && key.usage.costToday >= key.quotas.dailyCost) {
      return { allowed: false, retryAfter: Math.ceil((this.dayEnd().getTime() - now.getTime()) / 1000) };
    }

    // Record usage
    bucket.requests++;
    bucket.tokens += tokens;

    return { allowed: true };
  }

  /**
   * Record usage against a key
   */
  recordUsage(keyId: string, tokensIn: number, tokensOut: number, cost: number): void {
    const key = keyStore.get(keyId);
    if (!key) return;

    this.resetCountersIfNeeded(key);

    key.usage.requestsToday++;
    key.usage.requestsThisMonth++;
    key.usage.tokensToday += tokensIn + tokensOut;
    key.usage.tokensThisMonth += tokensIn + tokensOut;
    key.usage.costToday += cost;
    key.usage.costThisMonth += cost;
    key.usage.lastUsedAt = new Date();
  }

  /**
   * Get key by ID (admin only)
   */
  getKey(id: string): VirtualKey | undefined {
    return keyStore.get(id);
  }

  /**
   * List all keys for an owner
   */
  listKeys(owner?: string): VirtualKey[] {
    const keys = Array.from(keyStore.values());
    if (owner) {
      return keys.filter(k => k.owner === owner);
    }
    return keys;
  }

  /**
   * Revoke a key
   */
  revokeKey(id: string): boolean {
    const key = keyStore.get(id);
    if (!key) return false;
    key.revokedAt = new Date();
    hashToId.delete(key.keyHash);
    logger.info(`[VirtualKey] Revoked key ${id}`);
    return true;
  }

  /**
   * Delete a key permanently
   */
  deleteKey(id: string): boolean {
    const key = keyStore.get(id);
    if (key) {
      hashToId.delete(key.keyHash);
      keyStore.delete(id);
      logger.info(`[VirtualKey] Deleted key ${id}`);
      return true;
    }
    return false;
  }

  /**
   * Get usage summary for a key
   */
  getUsageSummary(id: string): Record<string, any> | undefined {
    const key = keyStore.get(id);
    if (!key) return undefined;
    this.resetCountersIfNeeded(key);

    return {
      keyId: key.id,
      name: key.name,
      owner: key.owner,
      quotas: key.quotas,
      usage: key.usage,
      utilization: {
        dailyRequests: key.quotas.dailyRequests ? (key.usage.requestsToday / key.quotas.dailyRequests) * 100 : 0,
        monthlyRequests: key.quotas.monthlyRequests ? (key.usage.requestsThisMonth / key.quotas.monthlyRequests) * 100 : 0,
        dailyTokens: key.quotas.dailyTokens ? (key.usage.tokensToday / key.quotas.dailyTokens) * 100 : 0,
        monthlyTokens: key.quotas.monthlyTokens ? (key.usage.tokensThisMonth / key.quotas.monthlyTokens) * 100 : 0,
        dailyCost: key.quotas.dailyCost ? (key.usage.costToday / key.quotas.dailyCost) * 100 : 0,
        monthlyCost: key.quotas.monthlyCost ? (key.usage.costThisMonth / key.quotas.monthlyCost) * 100 : 0,
      },
      status: key.revokedAt ? 'revoked' : key.expiresAt && new Date() > key.expiresAt ? 'expired' : 'active',
    };
  }

  private resetCountersIfNeeded(key: VirtualKey): void {
    const dayStart = this.dayStart();
    const monthStart = this.monthStart();

    if (key.usage.lastResetDay < dayStart) {
      key.usage.requestsToday = 0;
      key.usage.tokensToday = 0;
      key.usage.costToday = 0;
      key.usage.lastResetDay = dayStart;
    }

    if (key.usage.lastResetMonth < monthStart) {
      key.usage.requestsThisMonth = 0;
      key.usage.tokensThisMonth = 0;
      key.usage.costThisMonth = 0;
      key.usage.lastResetMonth = monthStart;
    }
  }

  private dayStart(): Date {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d;
  }

  private dayEnd(): Date {
    const d = new Date();
    d.setHours(23, 59, 59, 999);
    return d;
  }

  private monthStart(): Date {
    const d = new Date();
    d.setDate(1);
    d.setHours(0, 0, 0, 0);
    return d;
  }
}

export const virtualKeyManager = new VirtualKeyManager();
