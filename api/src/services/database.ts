/**
 * Bawwab Persistent Storage Layer — SQLite-backed
 * Replaces all in-memory Maps with persistent tables.
 */
import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
import os from 'os';

const DATA_DIR = process.env.BAWWAB_DATA_DIR || path.join(os.homedir(), '.bawwab', 'db');
const DB_PATH = path.join(DATA_DIR, 'data.sqlite');

// Ensure directory exists
fs.mkdirSync(DATA_DIR, { recursive: true });

const db: Database.Database = new Database(DB_PATH);

// Performance: WAL mode + synchronous NORMAL
db.pragma('journal_mode = WAL');
db.pragma('synchronous = NORMAL');
db.pragma('foreign_keys = ON');

// ─── Schema ────────────────────────────────────────────────────────────────

db.exec(`
  -- Metadata KV store
  CREATE TABLE IF NOT EXISTS _meta (
    key TEXT PRIMARY KEY,
    value TEXT
  );

  -- App settings (single row, id=1)
  CREATE TABLE IF NOT EXISTS settings (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    data TEXT NOT NULL DEFAULT '{}'
  );
  INSERT OR IGNORE INTO settings (id, data) VALUES (1, '{}');

  -- Provider connections (multi-account per provider)
  CREATE TABLE IF NOT EXISTS provider_connections (
    id TEXT PRIMARY KEY,
    provider TEXT NOT NULL,
    auth_type TEXT NOT NULL DEFAULT 'api_key',
    name TEXT,
    email TEXT,
    priority INTEGER NOT NULL DEFAULT 0,
    is_active INTEGER NOT NULL DEFAULT 1,
    data TEXT NOT NULL DEFAULT '{}',
    last_used_at TEXT,
    consecutive_use_count INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_conn_provider ON provider_connections(provider, is_active, priority);

  -- OAuth tokens (persistent)
  CREATE TABLE IF NOT EXISTS oauth_tokens (
    id TEXT PRIMARY KEY,
    provider TEXT NOT NULL,
    access_token TEXT,
    refresh_token TEXT,
    expires_at TEXT,
    token_type TEXT DEFAULT 'Bearer',
    scope TEXT,
    data TEXT NOT NULL DEFAULT '{}',
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_oauth_provider ON oauth_tokens(provider);

  -- Cookie credentials (persistent)
  CREATE TABLE IF NOT EXISTS cookie_credentials (
    id TEXT PRIMARY KEY,
    provider TEXT NOT NULL,
    cookies TEXT NOT NULL,
    headers TEXT NOT NULL DEFAULT '{}',
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_cookie_provider ON cookie_credentials(provider);

  -- Virtual API keys
  CREATE TABLE IF NOT EXISTS virtual_keys (
    id TEXT PRIMARY KEY,
    key_hash TEXT NOT NULL UNIQUE,
    key_prefix TEXT NOT NULL,
    name TEXT,
    is_active INTEGER NOT NULL DEFAULT 1,
    rate_limit_rpm INTEGER,
    rate_limit_tpm INTEGER,
    rate_limit_rpd INTEGER,
    quota_daily_requests INTEGER,
    quota_daily_tokens INTEGER,
    quota_daily_cost REAL,
    quota_monthly_requests INTEGER,
    quota_monthly_tokens INTEGER,
    quota_monthly_cost REAL,
    allowed_models TEXT,
    metadata TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    last_used_at TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_vkey_hash ON virtual_keys(key_hash);
  CREATE INDEX IF NOT EXISTS idx_vkey_active ON virtual_keys(is_active);

  -- Virtual key usage counters
  CREATE TABLE IF NOT EXISTS virtual_key_usage (
    key_id TEXT NOT NULL,
    period TEXT NOT NULL,
    requests INTEGER NOT NULL DEFAULT 0,
    tokens_in INTEGER NOT NULL DEFAULT 0,
    tokens_out INTEGER NOT NULL DEFAULT 0,
    cost REAL NOT NULL DEFAULT 0,
    PRIMARY KEY (key_id, period),
    FOREIGN KEY (key_id) REFERENCES virtual_keys(id) ON DELETE CASCADE
  );

  -- Webhook subscriptions
  CREATE TABLE IF NOT EXISTS webhooks (
    id TEXT PRIMARY KEY,
    url TEXT NOT NULL,
    events TEXT NOT NULL DEFAULT '[]',
    secret TEXT,
    is_active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  -- A/B tests
  CREATE TABLE IF NOT EXISTS ab_tests (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    model_a TEXT NOT NULL,
    model_b TEXT NOT NULL,
    split_percent INTEGER NOT NULL DEFAULT 50,
    is_active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  -- A/B test results
  CREATE TABLE IF NOT EXISTS ab_test_results (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    test_id TEXT NOT NULL,
    variant TEXT NOT NULL CHECK (variant IN ('A', 'B')),
    latency_ms REAL,
    tokens_in INTEGER,
    tokens_out INTEGER,
    cost REAL,
    error TEXT,
    recorded_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (test_id) REFERENCES ab_tests(id) ON DELETE CASCADE
  );
  CREATE INDEX IF NOT EXISTS idx_ab_results ON ab_test_results(test_id, variant);

  -- Provider combos
  CREATE TABLE IF NOT EXISTS combos (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL UNIQUE,
    kind TEXT NOT NULL DEFAULT 'fallback',
    models TEXT NOT NULL DEFAULT '[]',
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  -- Model aliases
  CREATE TABLE IF NOT EXISTS model_aliases (
    alias TEXT PRIMARY KEY,
    target TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  -- Pricing overrides
  CREATE TABLE IF NOT EXISTS pricing_overrides (
    provider TEXT NOT NULL,
    model TEXT NOT NULL,
    input_per_1m REAL NOT NULL DEFAULT 0,
    output_per_1m REAL NOT NULL DEFAULT 0,
    cached_per_1m REAL DEFAULT 0,
    reasoning_per_1m REAL DEFAULT 0,
    PRIMARY KEY (provider, model)
  );

  -- Usage history (per-request)
  CREATE TABLE IF NOT EXISTS usage_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    timestamp TEXT NOT NULL DEFAULT (datetime('now')),
    provider TEXT,
    model TEXT,
    connection_id TEXT,
    virtual_key_id TEXT,
    endpoint TEXT,
    prompt_tokens INTEGER DEFAULT 0,
    completion_tokens INTEGER DEFAULT 0,
    cached_tokens INTEGER DEFAULT 0,
    reasoning_tokens INTEGER DEFAULT 0,
    cost REAL DEFAULT 0,
    latency_ms REAL DEFAULT 0,
    status TEXT,
    rtk_saved_tokens INTEGER DEFAULT 0,
    meta TEXT DEFAULT '{}'
  );
  CREATE INDEX IF NOT EXISTS idx_usage_ts ON usage_history(timestamp);
  CREATE INDEX IF NOT EXISTS idx_usage_provider ON usage_history(provider, timestamp);
  CREATE INDEX IF NOT EXISTS idx_usage_model ON usage_history(model, timestamp);

  -- Usage daily aggregation
  CREATE TABLE IF NOT EXISTS usage_daily (
    date_key TEXT PRIMARY KEY,
    data TEXT NOT NULL DEFAULT '{}'
  );

  -- Request details (observability)
  CREATE TABLE IF NOT EXISTS request_details (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    timestamp TEXT NOT NULL DEFAULT (datetime('now')),
    provider TEXT,
    model TEXT,
    connection_id TEXT,
    status TEXT,
    data TEXT DEFAULT '{}'
  );
  CREATE INDEX IF NOT EXISTS idx_reqdet_ts ON request_details(timestamp);

  -- Circuit breaker state
  CREATE TABLE IF NOT EXISTS circuit_breaker_state (
    provider TEXT PRIMARY KEY,
    state TEXT NOT NULL DEFAULT 'closed',
    failure_count INTEGER NOT NULL DEFAULT 0,
    success_count INTEGER NOT NULL DEFAULT 0,
    last_failure_at TEXT,
    last_success_at TEXT,
    next_retry_at TEXT,
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  -- Provider health tracking
  CREATE TABLE IF NOT EXISTS provider_health (
    provider TEXT PRIMARY KEY,
    success_count INTEGER NOT NULL DEFAULT 0,
    failure_count INTEGER NOT NULL DEFAULT 0,
    total_latency_ms REAL NOT NULL DEFAULT 0,
    last_check_at TEXT,
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  -- Rate limiter state (for persistence across restarts)
  CREATE TABLE IF NOT EXISTS rate_limit_state (
    key TEXT PRIMARY KEY,
    window_start TEXT NOT NULL,
    count INTEGER NOT NULL DEFAULT 0
  );

  -- Quota tracker: per-provider quota config
  CREATE TABLE IF NOT EXISTS provider_quotas (
    provider_id TEXT PRIMARY KEY,
    provider_name TEXT,
    daily_limit_requests INTEGER NOT NULL DEFAULT 10000,
    monthly_limit_requests INTEGER NOT NULL DEFAULT 100000,
    daily_limit_tokens INTEGER NOT NULL DEFAULT 10000000,
    monthly_limit_tokens INTEGER NOT NULL DEFAULT 100000000,
    daily_limit_cost REAL NOT NULL DEFAULT 50.0,
    monthly_limit_cost REAL NOT NULL DEFAULT 500.0,
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  -- Quota tracker: per-provider usage counters
  CREATE TABLE IF NOT EXISTS provider_usage (
    provider_id TEXT PRIMARY KEY,
    requests_today INTEGER NOT NULL DEFAULT 0,
    requests_this_month INTEGER NOT NULL DEFAULT 0,
    tokens_in_today INTEGER NOT NULL DEFAULT 0,
    tokens_out_today INTEGER NOT NULL DEFAULT 0,
    tokens_in_this_month INTEGER NOT NULL DEFAULT 0,
    tokens_out_this_month INTEGER NOT NULL DEFAULT 0,
    cost_today REAL NOT NULL DEFAULT 0,
    cost_this_month REAL NOT NULL DEFAULT 0,
    day_key TEXT NOT NULL DEFAULT '',
    month_key TEXT NOT NULL DEFAULT '',
    last_used_at TEXT,
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  -- Cloud sync state
  CREATE TABLE IF NOT EXISTS cloud_sync (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    machine_id TEXT,
    last_sync_at TEXT,
    data TEXT NOT NULL DEFAULT '{}'
  );
  INSERT OR IGNORE INTO cloud_sync (id, data) VALUES (1, '{}');

  -- API keys table
  CREATE TABLE IF NOT EXISTS api_keys (
    id TEXT PRIMARY KEY,
    key_hash TEXT NOT NULL UNIQUE,
    name TEXT,
    is_active INTEGER NOT NULL DEFAULT 1,
    rate_limit_rpm INTEGER DEFAULT 100,
    monthly_quota_tokens INTEGER,
    monthly_quota_requests INTEGER,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    last_used_at TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_apikey_hash ON api_keys(key_hash);
  CREATE INDEX IF NOT EXISTS idx_apikey_active ON api_keys(is_active);
`);

// ─── Helpers ───────────────────────────────────────────────────────────────

export function getDb(): Database.Database {
  return db;
}

export function getSetting(key: string): any {
  const row = db.prepare('SELECT data FROM settings WHERE id = 1').get() as any;
  if (!row) return undefined;
  try {
    const data = JSON.parse(row.data);
    return data[key];
  } catch {
    return undefined;
  }
}

export function setSetting(key: string, value: any): void {
  const row = db.prepare('SELECT data FROM settings WHERE id = 1').get() as any;
  let data: any = {};
  try { data = JSON.parse(row?.data || '{}'); } catch {}
  data[key] = value;
  db.prepare('UPDATE settings SET data = ? WHERE id = 1').run(JSON.stringify(data));
}

export function getAllSettings(): any {
  const row = db.prepare('SELECT data FROM settings WHERE id = 1').get() as any;
  try { return JSON.parse(row?.data || '{}'); } catch { return {}; }
}

export function getMeta(key: string): string | null {
  const row = db.prepare('SELECT value FROM _meta WHERE key = ?').get(key) as any;
  return row?.value ?? null;
}

export function setMeta(key: string, value: string): void {
  db.prepare('INSERT OR REPLACE INTO _meta (key, value) VALUES (?, ?)').run(key, value);
}

/** Generate a short unique ID */
export function genId(prefix: string = ''): string {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let id = '';
  for (let i = 0; i < 12; i++) id += chars[Math.floor(Math.random() * chars.length)];
  return prefix ? `${prefix}_${id}` : id;
}

/** Hash a key for storage (SHA-256) */
import * as crypto from 'crypto';
export function hashKey(key: string): string {
  return crypto.createHash('sha256').update(key).digest('hex');
}

/** Run in transaction */
export function transaction<T>(fn: () => T): T {
  return db.transaction(fn)();
}

/** Constant-time string comparison (prevents timing attacks) */
export function safeCompare(a: string | undefined, b: string | undefined): boolean {
  if (!a || !b) return false;
  if (a.length !== b.length) return false;
  try {
    return crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));
  } catch { return false; }
}

/** Close database on shutdown */
export function closeDb(): void {
  db.close();
}

// ─── Compatibility exports (for existing code) ─────────────────────────────

/** Initialize database — no-op since tables are created on import */
export function initDatabase(): void {
  // Tables are auto-created via the CREATE TABLE IF NOT EXISTS statements above
}

/** Insert a request log entry into usage_history */
export function insertLog(log: any): void {
  try {
    db.prepare(`
      INSERT INTO usage_history (provider, model, prompt_tokens, completion_tokens, cost, latency_ms, status, meta)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      log.provider || null,
      log.model || null,
      log.tokensIn || log.prompt_tokens || 0,
      log.tokensOut || log.completion_tokens || 0,
      log.cost || 0,
      log.latencyMs || log.latency_ms || 0,
      log.status || 'ok',
      JSON.stringify(log)
    );
  } catch {}
}

/** Get recent request logs */
export function getRecentLogs(limit = 100): any[] {
  try {
    return db.prepare('SELECT * FROM usage_history ORDER BY id DESC LIMIT ?').all(limit);
  } catch { return []; }
}

/** Get aggregate stats */
export function getStats(): any {
  try {
    const row = db.prepare(`
      SELECT COUNT(*) as totalRequests,
             SUM(prompt_tokens) as totalTokensIn,
             SUM(completion_tokens) as totalTokensOut,
             SUM(cost) as totalCost,
             AVG(latency_ms) as avgLatency,
             SUM(CASE WHEN status = 'ok' THEN 1 ELSE 0 END) as successfulRequests,
             SUM(CASE WHEN status != 'ok' THEN 1 ELSE 0 END) as failedRequests
      FROM usage_history
    `).get() as any;
    return row || {};
  } catch { return {}; }
}

/** Get hourly stats for last 24h */
export function getHourlyStats(): any[] {
  try {
    return db.prepare(`
      SELECT strftime('%Y-%m-%d %H:00', timestamp) as hour,
             COUNT(*) as requests,
             SUM(prompt_tokens) as tokensIn,
             SUM(completion_tokens) as tokensOut,
             SUM(cost) as cost,
             AVG(latency_ms) as avgLatency
      FROM usage_history
      WHERE timestamp >= datetime('now', '-24 hours')
      GROUP BY hour
      ORDER BY hour
    `).all();
  } catch { return []; }
}

export default db;
