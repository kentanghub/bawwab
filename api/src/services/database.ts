import Database from 'better-sqlite3';
import { logger } from './logger.js';
import type { RequestLog } from '../types/index.js';

const DB_PATH = process.env.DB_PATH || './data/bawwab.db';

let db: Database.Database | null = null;

export function initDatabase(): Database.Database {
  if (db) return db;

  db = new Database(DB_PATH);
  db.pragma('journal_mode = WAL');

  // Create tables
  db.exec(`
    CREATE TABLE IF NOT EXISTS request_logs (
      id TEXT PRIMARY KEY,
      timestamp TEXT NOT NULL,
      provider_id TEXT NOT NULL,
      model_id TEXT NOT NULL,
      endpoint TEXT NOT NULL,
      status_code INTEGER NOT NULL,
      latency_ms INTEGER NOT NULL,
      tokens_in INTEGER NOT NULL DEFAULT 0,
      tokens_out INTEGER NOT NULL DEFAULT 0,
      cost REAL NOT NULL DEFAULT 0,
      cache_hit INTEGER NOT NULL DEFAULT 0,
      error TEXT,
      user_agent TEXT,
      client_ip TEXT,
      api_key TEXT,
      request_id TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_logs_timestamp ON request_logs(timestamp);
    CREATE INDEX IF NOT EXISTS idx_logs_provider ON request_logs(provider_id);
    CREATE INDEX IF NOT EXISTS idx_logs_endpoint ON request_logs(endpoint);
    CREATE INDEX IF NOT EXISTS idx_logs_api_key ON request_logs(api_key);

    CREATE TABLE IF NOT EXISTS api_keys (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      key_hash TEXT NOT NULL UNIQUE,
      role TEXT NOT NULL DEFAULT 'user',
      is_active INTEGER NOT NULL DEFAULT 1,
      rate_limit INTEGER DEFAULT 60,
      monthly_quota INTEGER DEFAULT 10000,
      usage_count INTEGER NOT NULL DEFAULT 0,
      monthly_usage INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      last_used_at TEXT,
      quota_reset_at TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_api_keys_hash ON api_keys(key_hash);
  `);

  logger.info('SQLite database initialized at ' + DB_PATH);
  return db;
}

export function getDb(): Database.Database {
  if (!db) return initDatabase();
  return db;
}

export function closeDb(): void {
  if (db) {
    db.close();
    db = null;
  }
}

// Request Logs
export function insertLog(log: RequestLog): void {
  const stmt = getDb().prepare(`
    INSERT INTO request_logs 
    (id, timestamp, provider_id, model_id, endpoint, status_code, latency_ms, tokens_in, tokens_out, cost, cache_hit, error, user_agent, client_ip, api_key)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  stmt.run(
    log.id,
    log.timestamp.toISOString(),
    log.providerId,
    log.modelId,
    log.endpoint,
    log.statusCode,
    log.latencyMs,
    log.tokensIn,
    log.tokensOut,
    log.cost,
    log.cacheHit ? 1 : 0,
    log.error || null,
    log.userAgent || null,
    log.clientIp || null,
    log.apiKey || null
  );
}

export function getRecentLogs(limit = 100): RequestLog[] {
  const stmt = getDb().prepare(`
    SELECT * FROM request_logs 
    ORDER BY timestamp DESC 
    LIMIT ?
  `);

  const rows = stmt.all(limit) as any[];
  return rows.map(row => ({
    id: row.id,
    timestamp: new Date(row.timestamp),
    providerId: row.provider_id,
    modelId: row.model_id,
    endpoint: row.endpoint,
    statusCode: row.status_code,
    latencyMs: row.latency_ms,
    tokensIn: row.tokens_in,
    tokensOut: row.tokens_out,
    cost: row.cost,
    cacheHit: row.cache_hit === 1,
    error: row.error,
    userAgent: row.user_agent,
    clientIp: row.client_ip
  }));
}

export function getStats(): {
  totalRequests: number;
  totalTokens: number;
  totalCost: number;
  avgLatency: number;
  successRate: number;
  providerBreakdown: Record<string, { requests: number; tokens: number; cost: number }>;
} {
  const db = getDb();

  const totalRequests = (db.prepare('SELECT COUNT(*) as count FROM request_logs').get() as any).count;
  const totalTokens = (db.prepare('SELECT COALESCE(SUM(tokens_in + tokens_out), 0) as sum FROM request_logs').get() as any).sum;
  const totalCost = (db.prepare('SELECT COALESCE(SUM(cost), 0) as sum FROM request_logs').get() as any).sum;
  const avgLatency = (db.prepare('SELECT COALESCE(AVG(latency_ms), 0) as avg FROM request_logs').get() as any).avg;
  const successCount = (db.prepare('SELECT COUNT(*) as count FROM request_logs WHERE status_code < 400').get() as any).count;
  const successRate = totalRequests > 0 ? successCount / totalRequests : 1;

  const providerRows = db.prepare(`
    SELECT provider_id, COUNT(*) as requests, SUM(tokens_in + tokens_out) as tokens, SUM(cost) as cost
    FROM request_logs GROUP BY provider_id
  `).all() as any[];

  const providerBreakdown: Record<string, { requests: number; tokens: number; cost: number }> = {};
  for (const row of providerRows) {
    providerBreakdown[row.provider_id] = {
      requests: row.requests,
      tokens: row.tokens,
      cost: row.cost
    };
  }

  return { totalRequests, totalTokens, totalCost, avgLatency, successRate, providerBreakdown };
}

export function getHourlyStats(): { hour: string; requests: number; tokens: number; cost: number }[] {
  const rows = getDb().prepare(`
    SELECT strftime('%Y-%m-%dT%H:00:00.000Z', timestamp) as hour,
           COUNT(*) as requests,
           SUM(tokens_in + tokens_out) as tokens,
           SUM(cost) as cost
    FROM request_logs
    GROUP BY hour
    ORDER BY hour DESC
    LIMIT 168
  `).all() as any[];

  return rows.map(r => ({ hour: r.hour, requests: r.requests, tokens: r.tokens, cost: r.cost }));
}
