import { getDb } from './database.js';

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

export function checkRateLimit(keyHash: string): RateLimitResult {
  const db = getDb();

  // Get key config
  const keyRow = db.prepare('SELECT rate_limit FROM api_keys WHERE key_hash = ?').get(keyHash) as any;
  if (!keyRow) {
    return { allowed: false, remaining: 0, resetAt: 0, limit: 0 };
  }

  const limit = keyRow.rate_limit || 60;
  const now = Date.now();
  const windowStart = Math.floor(now / windowMs) * windowMs;
  const resetAt = windowStart + windowMs;

  // Count requests in current window from logs
  const countRow = db.prepare(`
    SELECT COUNT(*) as count FROM request_logs
    WHERE timestamp >= datetime(?, 'unixepoch')
      AND (client_ip = ? OR EXISTS (
        SELECT 1 FROM api_keys WHERE key_hash = ?
      ))
  `).get(Math.floor(windowStart / 1000), keyHash, keyHash) as any;

  const count = countRow?.count || 0;
  const remaining = Math.max(0, limit - count);
  const allowed = count < limit;

  return {
    allowed,
    remaining,
    resetAt,
    limit,
    retryAfter: allowed ? undefined : Math.ceil((resetAt - now) / 1000)
  };
}

export function checkQuota(keyHash: string): QuotaResult {
  const db = getDb();

  const keyRow = db.prepare('SELECT monthly_quota, monthly_usage, quota_reset_at FROM api_keys WHERE key_hash = ?').get(keyHash) as any;
  if (!keyRow) {
    return { allowed: false, monthlyQuota: 0, monthlyUsage: 0, remaining: 0, resetAt: '' };
  }

  const now = new Date();
  const quota = keyRow.monthly_quota || 10000;
  let usage = keyRow.monthly_usage || 0;
  let resetAt = keyRow.quota_reset_at;

  // Check if we need to reset monthly usage
  if (!resetAt || new Date(resetAt) < now) {
    // Reset to next month
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

export function incrementUsage(keyHash: string, tokens: number = 0): void {
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
