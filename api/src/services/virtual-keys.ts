/**
 * Virtual API Keys — SQLite-backed persistent storage
 * Per-key quotas, rate limits, cost attribution, revocation.
 */
import { randomBytes, createHash } from 'node:crypto';
import { getDb, genId, hashKey, transaction } from './database.js';
import { logger } from './logger.js';

// ─── Types ──────────────────────────────────────────────────────────────────

export interface VirtualKey {
  id: string;
  name: string;
  keyHash: string;
  keyPrefix: string;
  owner: string;
  isActive: boolean;
  createdAt: Date;
  expiresAt?: Date;
  revokedAt?: Date;
  quotas: KeyQuotas;
  rateLimits: RateLimits;
  metadata: Record<string, any>;
  lastUsedAt?: Date;
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
  rpm: number;
  tpm: number;
  rpd: number;
}

export interface KeyUsage {
  requestsToday: number;
  requestsThisMonth: number;
  tokensInToday: number;
  tokensInThisMonth: number;
  tokensOutToday: number;
  tokensOutThisMonth: number;
  costToday: number;
  costThisMonth: number;
}

interface DbRow {
  id: string;
  key_hash: string;
  key_prefix: string;
  name: string | null;
  is_active: number;
  rate_limit_rpm: number | null;
  rate_limit_tpm: number | null;
  rate_limit_rpd: number | null;
  quota_daily_requests: number | null;
  quota_daily_tokens: number | null;
  quota_daily_cost: number | null;
  quota_monthly_requests: number | null;
  quota_monthly_tokens: number | null;
  quota_monthly_cost: number | null;
  allowed_models: string | null;
  metadata: string;
  created_at: string;
  last_used_at: string | null;
}

interface UsageRow {
  key_id: string;
  period: string;
  requests: number;
  tokens_in: number;
  tokens_out: number;
  cost: number;
}

// ─── Helpers ────────────────────────────────────────────────────────────────

const DEFAULT_QUOTAS: KeyQuotas = {
  dailyRequests: 10_000,
  monthlyRequests: 100_000,
  dailyTokens: 10_000_000,
  monthlyTokens: 100_000_000,
  dailyCost: 50,
  monthlyCost: 500,
};

const DEFAULT_RATE_LIMITS: RateLimits = {
  rpm: 60,
  tpm: 100_000,
  rpd: 10_000,
};

function dayKey(): string {
  return new Date().toISOString().slice(0, 10); // YYYY-MM-DD
}

function monthKey(): string {
  return new Date().toISOString().slice(0, 7); // YYYY-MM
}

function rowToKey(row: DbRow): VirtualKey {
  return {
    id: row.id,
    name: row.name || '',
    keyHash: row.key_hash,
    keyPrefix: row.key_prefix,
    owner: '', // not stored in current schema, kept for API compat
    isActive: row.is_active === 1,
    createdAt: new Date(row.created_at),
    quotas: {
      dailyRequests: row.quota_daily_requests ?? undefined,
      monthlyRequests: row.quota_monthly_requests ?? undefined,
      dailyTokens: row.quota_daily_tokens ?? undefined,
      monthlyTokens: row.quota_monthly_tokens ?? undefined,
      dailyCost: row.quota_daily_cost ?? undefined,
      monthlyCost: row.quota_monthly_cost ?? undefined,
    },
    rateLimits: {
      rpm: row.rate_limit_rpm ?? 60,
      tpm: row.rate_limit_tpm ?? 100_000,
      rpd: row.rate_limit_rpd ?? 10_000,
    },
    metadata: JSON.parse(row.metadata || '{}'),
    lastUsedAt: row.last_used_at ? new Date(row.last_used_at) : undefined,
  };
}

// ─── Rate Limit Buckets (in-memory, per-minute windows) ────────────────────

interface MinuteBucket {
  requests: number;
  tokens: number;
  resetAt: number;
}

const rateLimitBuckets = new Map<string, MinuteBucket>();

function getMinuteBucket(keyId: string): MinuteBucket {
  const now = Date.now();
  const bucketKey = `${keyId}:${Math.floor(now / 60_000)}`;
  let bucket = rateLimitBuckets.get(bucketKey);
  if (!bucket || now > bucket.resetAt) {
    bucket = { requests: 0, tokens: 0, resetAt: now + 60_000 };
    rateLimitBuckets.set(bucketKey, bucket);
  }
  return bucket;
}

// Periodically prune old buckets
setInterval(() => {
  const now = Date.now();
  for (const [key, bucket] of Array.from(rateLimitBuckets)) {
    if (bucket.resetAt < now) rateLimitBuckets.delete(key);
  }
}, 60_000);

// ─── Virtual Key Manager ───────────────────────────────────────────────────

class VirtualKeyManager {
  /**
   * Create a new virtual API key.
   */
  createKey(options: {
    name: string;
    owner: string;
    quotas?: Partial<KeyQuotas>;
    rateLimits?: Partial<RateLimits>;
    expiresInDays?: number;
    metadata?: Record<string, any>;
  }): { key: VirtualKey; plainKey: string } {
    const plainKey = `bawwab-${randomBytes(24).toString('hex')}`;
    const keyHashVal = createHash('sha256').update(plainKey).digest('hex');
    const keyPrefix = plainKey.slice(0, 12);
    const id = genId('key');

    const quotas = { ...DEFAULT_QUOTAS, ...options.quotas };
    const rateLimits = { ...DEFAULT_RATE_LIMITS, ...options.rateLimits };
    const metadata = options.metadata || {};

    const db = getDb();
    db.prepare(`
      INSERT INTO virtual_keys (
        id, key_hash, key_prefix, name, is_active,
        rate_limit_rpm, rate_limit_tpm, rate_limit_rpd,
        quota_daily_requests, quota_daily_tokens, quota_daily_cost,
        quota_monthly_requests, quota_monthly_tokens, quota_monthly_cost,
        metadata
      ) VALUES (?, ?, ?, ?, 1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id, keyHashVal, keyPrefix, options.name,
      rateLimits.rpm, rateLimits.tpm, rateLimits.rpd,
      quotas.dailyRequests ?? null, quotas.dailyTokens ?? null, quotas.dailyCost ?? null,
      quotas.monthlyRequests ?? null, quotas.monthlyTokens ?? null, quotas.monthlyCost ?? null,
      JSON.stringify(metadata),
    );

    logger.info(`[VirtualKey] Created key ${id} for ${options.owner}`);

    const key: VirtualKey = {
      id,
      name: options.name,
      keyHash: keyHashVal,
      keyPrefix,
      owner: options.owner,
      isActive: true,
      createdAt: new Date(),
      quotas,
      rateLimits,
      metadata,
    };

    return { key, plainKey };
  }

  /**
   * Validate and lookup key by plaintext key.
   */
  validateKey(plainKey: string): VirtualKey | null {
    const keyHashVal = createHash('sha256').update(plainKey).digest('hex');
    const db = getDb();

    const row = db.prepare(`
      SELECT * FROM virtual_keys WHERE key_hash = ? AND is_active = 1
    `).get(keyHashVal) as DbRow | undefined;

    if (!row) return null;

    return rowToKey(row);
  }

  /**
   * Revoke a key (deactivate, keep record).
   */
  revokeKey(id: string): boolean {
    const db = getDb();
    const result = db.prepare(`
      UPDATE virtual_keys SET is_active = 0 WHERE id = ?
    `).run(id);

    if (result.changes > 0) {
      logger.info(`[VirtualKey] Revoked key ${id}`);
      return true;
    }
    return false;
  }

  /**
   * Delete a key permanently.
   */
  deleteKey(id: string): boolean {
    const db = getDb();
    const result = db.prepare('DELETE FROM virtual_keys WHERE id = ?').run(id);
    if (result.changes > 0) {
      logger.info(`[VirtualKey] Deleted key ${id}`);
      return true;
    }
    return false;
  }

  /**
   * List keys, optionally filtered.
   */
  listKeys(owner?: string): VirtualKey[] {
    const db = getDb();
    // owner is stored in metadata for compatibility
    const rows = db.prepare('SELECT * FROM virtual_keys ORDER BY created_at DESC').all() as DbRow[];
    let keys = rows.map(rowToKey);
    if (owner) {
      keys = keys.filter(k => k.owner === owner || k.metadata?.owner === owner);
    }
    return keys;
  }

  /**
   * Get key by ID.
   */
  getKey(id: string): VirtualKey | undefined {
    const db = getDb();
    const row = db.prepare('SELECT * FROM virtual_keys WHERE id = ?').get(id) as DbRow | undefined;
    return row ? rowToKey(row) : undefined;
  }

  /**
   * Record usage against a key.
   */
  recordUsage(keyId: string, tokensIn: number, tokensOut: number, cost: number): void {
    const db = getDb();
    const day = dayKey();
    const month = monthKey();

    transaction(() => {
      // Update daily usage
      db.prepare(`
        INSERT INTO virtual_key_usage (key_id, period, requests, tokens_in, tokens_out, cost)
        VALUES (?, ?, 1, ?, ?, ?)
        ON CONFLICT(key_id, period) DO UPDATE SET
          requests = requests + 1,
          tokens_in = tokens_in + excluded.tokens_in,
          tokens_out = tokens_out + excluded.tokens_out,
          cost = cost + excluded.cost
      `).run(keyId, day, tokensIn, tokensOut, cost);

      // Update monthly usage
      db.prepare(`
        INSERT INTO virtual_key_usage (key_id, period, requests, tokens_in, tokens_out, cost)
        VALUES (?, ?, 1, ?, ?, ?)
        ON CONFLICT(key_id, period) DO UPDATE SET
          requests = requests + 1,
          tokens_in = tokens_in + excluded.tokens_in,
          tokens_out = tokens_out + excluded.tokens_out,
          cost = cost + excluded.cost
      `).run(keyId, month, tokensIn, tokensOut, cost);

      // Update last_used_at
      db.prepare(`
        UPDATE virtual_keys SET last_used_at = datetime('now') WHERE id = ?
      `).run(keyId);
    });
  }

  /**
   * Get usage for a key.
   */
  getKeyUsage(keyId: string): KeyUsage {
    const db = getDb();
    const day = dayKey();
    const month = monthKey();

    const dayRow = db.prepare(`
      SELECT * FROM virtual_key_usage WHERE key_id = ? AND period = ?
    `).get(keyId, day) as UsageRow | undefined;

    const monthRow = db.prepare(`
      SELECT * FROM virtual_key_usage WHERE key_id = ? AND period = ?
    `).get(keyId, month) as UsageRow | undefined;

    return {
      requestsToday: dayRow?.requests ?? 0,
      requestsThisMonth: monthRow?.requests ?? 0,
      tokensInToday: dayRow?.tokens_in ?? 0,
      tokensInThisMonth: monthRow?.tokens_in ?? 0,
      tokensOutToday: dayRow?.tokens_out ?? 0,
      tokensOutThisMonth: monthRow?.tokens_out ?? 0,
      costToday: dayRow?.cost ?? 0,
      costThisMonth: monthRow?.cost ?? 0,
    };
  }

  /**
   * Check rate limits for a key.
   */
  checkRateLimit(keyId: string, tokens: number): { allowed: boolean; retryAfter?: number } {
    const key = this.getKey(keyId);
    if (!key || !key.isActive) return { allowed: false };

    const bucket = getMinuteBucket(keyId);
    const usage = this.getKeyUsage(keyId);
    const now = Date.now();

    // RPM check
    if (bucket.requests >= key.rateLimits.rpm) {
      return { allowed: false, retryAfter: Math.ceil((bucket.resetAt - now) / 1000) };
    }

    // TPM check
    if (bucket.tokens + tokens > key.rateLimits.tpm) {
      return { allowed: false, retryAfter: Math.ceil((bucket.resetAt - now) / 1000) };
    }

    // RPD check
    if (usage.requestsToday >= key.rateLimits.rpd) {
      const tomorrow = new Date();
      tomorrow.setHours(24, 0, 0, 0);
      return { allowed: false, retryAfter: Math.ceil((tomorrow.getTime() - now) / 1000) };
    }

    // Quota checks
    if (key.quotas.dailyRequests && usage.requestsToday >= key.quotas.dailyRequests) {
      const tomorrow = new Date();
      tomorrow.setHours(24, 0, 0, 0);
      return { allowed: false, retryAfter: Math.ceil((tomorrow.getTime() - now) / 1000) };
    }
    if (key.quotas.dailyTokens && (usage.tokensInToday + usage.tokensOutToday) >= key.quotas.dailyTokens) {
      const tomorrow = new Date();
      tomorrow.setHours(24, 0, 0, 0);
      return { allowed: false, retryAfter: Math.ceil((tomorrow.getTime() - now) / 1000) };
    }
    if (key.quotas.dailyCost && usage.costToday >= key.quotas.dailyCost) {
      const tomorrow = new Date();
      tomorrow.setHours(24, 0, 0, 0);
      return { allowed: false, retryAfter: Math.ceil((tomorrow.getTime() - now) / 1000) };
    }

    // Record in-memory bucket
    bucket.requests++;
    bucket.tokens += tokens;

    return { allowed: true };
  }

  /**
   * Check quota for a key (for pre-flight checks).
   */
  checkQuota(keyId: string): { allowed: boolean; reason?: string } {
    const key = this.getKey(keyId);
    if (!key || !key.isActive) return { allowed: false, reason: 'Key not found or inactive' };

    const usage = this.getKeyUsage(keyId);

    if (key.quotas.dailyRequests && usage.requestsToday >= key.quotas.dailyRequests) {
      return { allowed: false, reason: 'Daily request quota exceeded' };
    }
    if (key.quotas.monthlyRequests && usage.requestsThisMonth >= key.quotas.monthlyRequests) {
      return { allowed: false, reason: 'Monthly request quota exceeded' };
    }
    if (key.quotas.dailyCost && usage.costToday >= key.quotas.dailyCost) {
      return { allowed: false, reason: 'Daily cost quota exceeded' };
    }
    if (key.quotas.monthlyCost && usage.costThisMonth >= key.quotas.monthlyCost) {
      return { allowed: false, reason: 'Monthly cost quota exceeded' };
    }

    return { allowed: true };
  }

  /**
   * Get usage summary for a key.
   */
  getUsageSummary(id: string): Record<string, any> | undefined {
    const key = this.getKey(id);
    if (!key) return undefined;

    const usage = this.getKeyUsage(id);

    return {
      keyId: key.id,
      name: key.name,
      owner: key.owner,
      quotas: key.quotas,
      usage,
      utilization: {
        dailyRequests: key.quotas.dailyRequests ? (usage.requestsToday / key.quotas.dailyRequests) * 100 : 0,
        monthlyRequests: key.quotas.monthlyRequests ? (usage.requestsThisMonth / key.quotas.monthlyRequests) * 100 : 0,
        dailyTokens: key.quotas.dailyTokens ? ((usage.tokensInToday + usage.tokensOutToday) / key.quotas.dailyTokens) * 100 : 0,
        monthlyTokens: key.quotas.monthlyTokens ? ((usage.tokensInThisMonth + usage.tokensOutThisMonth) / key.quotas.monthlyTokens) * 100 : 0,
        dailyCost: key.quotas.dailyCost ? (usage.costToday / key.quotas.dailyCost) * 100 : 0,
        monthlyCost: key.quotas.monthlyCost ? (usage.costThisMonth / key.quotas.monthlyCost) * 100 : 0,
      },
      status: !key.isActive ? 'revoked' : 'active',
      lastUsedAt: key.lastUsedAt,
    };
  }
}

export const virtualKeyManager = new VirtualKeyManager();
