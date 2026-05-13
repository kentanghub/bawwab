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

// ─── Persistence ────────────────────────────────────────────────────────────

/** Load persisted rate limit state from SQLite on startup */
function loadPersistedState(): void {
  try {
    const db = getDb();
    const rows = db.prepare('SELECT key, count, window_start FROM rate_limit_state').all() as Array<{
      key: string;
      count: number;
      window_start: string;
    }>;
    const now = Date.now();
    for (const row of rows) {
      const resetAt = new Date(row.window_start).getTime() + windowMs;
      if (resetAt > now) {
        // Window still active
        rateLimitMap.set(row.key, { count: row.count, resetAt });
      }
    }
  } catch {
    // Table may not exist yet — ignore
  }
}

/** Persist a single rate limit state to SQLite */
function persistState(key: string, state: RateLimitState): void {
  try {
    const db = getDb();
    const windowStart = new Date(state.resetAt - windowMs).toISOString();
    db.prepare(`
      INSERT INTO rate_limit_state (key, window_start, count)
      VALUES (?, ?, ?)
      ON CONFLICT(key) DO UPDATE SET window_start = excluded.window_start, count = excluded.count
    `).run(key, windowStart, state.count);
  } catch {
    // Ignore persistence errors — in-memory still works
  }
}

/** Remove expired entries from SQLite */
function cleanupExpired(): void {
  try {
    const db = getDb();
    const cutoff = new Date(Date.now() - windowMs * 2).toISOString();
    db.prepare('DELETE FROM rate_limit_state WHERE window_start < ?').run(cutoff);
  } catch {
    // Ignore
  }
}

// Load on module import
let initialized = false;

function ensureInitialized(): void {
  if (!initialized) {
    loadPersistedState();
    initialized = true;
  }
}

// Cleanup every 5 minutes
setInterval(cleanupExpired, 5 * 60 * 1000).unref();

// ─── Public API ─────────────────────────────────────────────────────────────

export function checkRateLimit(keyHash: string, limit: number = 60): RateLimitResult {
  ensureInitialized();

  const now = Date.now();
  const state = rateLimitMap.get(keyHash);

  if (!state || state.resetAt <= now) {
    // New window
    const resetAt = Math.ceil(now / windowMs) * windowMs;
    const newState = { count: 1, resetAt };
    rateLimitMap.set(keyHash, newState);
    persistState(keyHash, newState);
    return { allowed: true, remaining: limit - 1, resetAt, limit };
  }

  const remaining = Math.max(0, limit - state.count);
  const allowed = state.count < limit;

  if (allowed) {
    state.count++;
    persistState(keyHash, state);
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
