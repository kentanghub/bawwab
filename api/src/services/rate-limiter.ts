import { getDb } from './database.js';

interface RateLimitState {
  count: number;
  resetAt: number;
}

interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  resetAt: number;
  limit: number;
  retryAfter?: number;
}

interface QuotaResult {
  allowed: boolean;
  monthlyQuota: number;
  monthlyUsage: number;
  remaining: number;
  resetAt: string;
}

const windowMs = 60 * 1000; // 1 minute window
const rateLimitMap = new Map<string, RateLimitState>();

export function checkRateLimit(keyHash: string, limit: number = 60): RateLimitResult {
  const now = Date.now();
  const state = rateLimitMap.get(keyHash);

  if (!state || state.resetAt <= now) {
    // New window
    const resetAt = Math.ceil(now / windowMs) * windowMs;
    rateLimitMap.set(keyHash, { count: 1, resetAt });
    return { allowed: true, remaining: limit - 1, resetAt, limit };
  }

  const remaining = Math.max(0, limit - state.count);
  const allowed = state.count < limit;

  if (allowed) {
    state.count++;
  }

  return {
    allowed,
    remaining,
    resetAt: state.resetAt,
    limit,
    retryAfter: allowed ? undefined : Math.ceil((state.resetAt - now) / 1000)
  };
}

export function checkQuota(keyHash: string): QuotaResult {
  const db = getDb();

  const keyRow = db.prepare('SELECT monthly_quota, monthly_usage, quota_reset_at FROM api_keys WHERE key_hash = ?').get(keyHash) as any;
  if (!keyRow) {
    return { allowed: true, monthlyQuota: 999999, monthlyUsage: 0, remaining: 999999, resetAt: '' };
  }

  const now = new Date();
  const quota = keyRow.monthly_quota || 10000;
  let usage = keyRow.monthly_usage || 0;
  let resetAt = keyRow.quota_reset_at;

  // Check if we need to reset monthly usage
  if (!resetAt || new Date(resetAt) < now) {
    const nextMonth = new Date(now.getFullYear(), now.getMonth() + 1, 1);
    resetAt = nextMonth.toISOString();
    usage = 0;
    db.prepare('UPDATE api_keys SET monthly_usage = 0, quota_reset_at = ? WHERE key_hash = ?')
      .run(resetAt, keyHash);
  }

  const remaining = Math.max(0, quota - usage);
  const allowed = usage < quota;

  return { allowed, monthlyQuota: quota, monthlyUsage: usage, remaining, resetAt };
}

export function incrementUsage(keyHash: string): void {
  const db = getDb();
  const now = new Date().toISOString();
  db.prepare(`
    UPDATE api_keys
    SET usage_count = usage_count + 1,
        monthly_usage = monthly_usage + 1,
        last_used_at = ?
    WHERE key_hash = ?
  `).run(now, keyHash);
}

export function getKeyUsage(keyHash: string): {
  rateLimit: number;
  monthlyQuota: number;
  monthlyUsage: number;
  usageCount: number;
  quotaResetAt: string;
} {
  const db = getDb();
  const row = db.prepare(`
    SELECT rate_limit, monthly_quota, monthly_usage, usage_count, quota_reset_at
    FROM api_keys WHERE key_hash = ?
  `).get(keyHash) as any;

  if (!row) {
    return { rateLimit: 60, monthlyQuota: 10000, monthlyUsage: 0, usageCount: 0, quotaResetAt: '' };
  }

  return {
    rateLimit: row.rate_limit,
    monthlyQuota: row.monthly_quota,
    monthlyUsage: row.monthly_usage,
    usageCount: row.usage_count,
    quotaResetAt: row.quota_reset_at
  };
}
