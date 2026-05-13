/**
 * Multi-Account Manager
 * Round-robin and fill-first strategies per provider with per-model cooldown locks.
 * Inspired by 9Router accountFallback.
 */
import { getDb, genId, transaction } from './database.js';
import { logger } from './logger.js';

// ─── Types ──────────────────────────────────────────────────────────────────

export interface ConnectionRow {
  id: string;
  provider: string;
  auth_type: string;
  name: string | null;
  email: string | null;
  priority: number;
  is_active: number;
  data: string;
  last_used_at: string | null;
  consecutive_use_count: number;
  created_at: string;
  updated_at: string;
  // Dynamic model lock fields stored in data JSON
  model_locks?: Record<string, string>; // model → ISO expiry
}

export interface ConnectionResult {
  id: string;
  data: Record<string, any>;
}

export type Strategy = 'fill-first' | 'round-robin';

// ─── Error Classification ───────────────────────────────────────────────────

const BASE_BACKOFF_MS = 2_000;
const MAX_BACKOFF_MS = 5 * 60 * 1000; // 5 minutes
const AUTH_COOLDOWN_MS = 2 * 60 * 1000; // 2 minutes
const DEFAULT_COOLDOWN_MS = 30_000; // 30 seconds

function classifyError(status: number, backoffLevel: number): { cooldownMs: number; newLevel: number } {
  if (status === 429) {
    const newLevel = backoffLevel + 1;
    const cooldown = Math.min(BASE_BACKOFF_MS * Math.pow(2, newLevel - 1), MAX_BACKOFF_MS);
    return { cooldownMs: cooldown, newLevel };
  }
  if (status === 401 || status === 403) {
    return { cooldownMs: AUTH_COOLDOWN_MS, newLevel: 0 };
  }
  return { cooldownMs: DEFAULT_COOLDOWN_MS, newLevel: 0 };
}

// ─── Mutex ──────────────────────────────────────────────────────────────────

let selectionMutex: Promise<void> = Promise.resolve();

function withMutex<T>(fn: () => T | Promise<T>): Promise<T> {
  const current = selectionMutex;
  let release!: () => void;
  selectionMutex = new Promise<void>(r => { release = r; });
  return current.then(async () => {
    try {
      return await fn();
    } finally {
      release();
    }
  });
}

// ─── Multi-Account Manager ──────────────────────────────────────────────────

class MultiAccountManager {
  private getStrategy(provider: string): Strategy {
    // Could be made configurable per-provider via settings table
    return 'round-robin';
  }

  private getStickyLimit(): number {
    return 3;
  }

  /**
   * Get an available connection for a provider/model.
   * Returns null if all connections are locked/unavailable.
   */
  async getConnection(provider: string, model?: string, excludeIds?: string[]): Promise<ConnectionResult | null> {
    return withMutex(() => {
      const db = getDb();
      const excludeSet = new Set(excludeIds || []);

      // Get all active connections for this provider, ordered by priority
      const rows = db.prepare(`
        SELECT * FROM provider_connections
        WHERE provider = ? AND is_active = 1
        ORDER BY priority ASC, created_at ASC
      `).all(provider) as ConnectionRow[];

      if (rows.length === 0) return null;

      const now = Date.now();

      // Filter out excluded and model-locked connections
      const available = rows.filter(row => {
        if (excludeSet.has(row.id)) return false;
        // Check model locks stored in data JSON
        const data = this.parseData(row.data);
        const locks = data._model_locks || {};
        const modelLock = model ? locks[model] : null;
        const allLock = locks['__all'];
        if (modelLock && new Date(modelLock).getTime() > now) return false;
        if (allLock && new Date(allLock).getTime() > now) return false;
        return true;
      });

      if (available.length === 0) return null;

      const strategy = this.getStrategy(provider);
      let selected: ConnectionRow;

      if (strategy === 'round-robin') {
        selected = this.selectRoundRobin(available);
      } else {
        // fill-first: just pick first by priority
        selected = available[0];
      }

      // Update lastUsedAt and consecutiveUseCount
      const newCount = strategy === 'round-robin'
        ? this.calculateNewCount(selected, available)
        : 0;

      db.prepare(`
        UPDATE provider_connections
        SET last_used_at = datetime('now'),
            consecutive_use_count = ?,
            updated_at = datetime('now')
        WHERE id = ?
      `).run(newCount, selected.id);

      return {
        id: selected.id,
        data: this.parseData(selected.data),
      };
    });
  }

  private selectRoundRobin(available: ConnectionRow[]): ConnectionRow {
    const stickyLimit = this.getStickyLimit();
    const now = Date.now();

    // Sort by most recently used first
    const sorted = [...available].sort((a, b) => {
      if (!a.last_used_at && !b.last_used_at) return a.priority - b.priority;
      if (!a.last_used_at) return 1;
      if (!b.last_used_at) return -1;
      return new Date(b.last_used_at).getTime() - new Date(a.last_used_at).getTime();
    });

    const current = sorted[0];

    // If current connection hasn't hit sticky limit, keep using it
    if (current.last_used_at && current.consecutive_use_count < stickyLimit) {
      return current;
    }

    // Otherwise pick the least recently used
    const byOldest = [...available].sort((a, b) => {
      if (!a.last_used_at && !b.last_used_at) return a.priority - b.priority;
      if (!a.last_used_at) return -1;
      if (!b.last_used_at) return 1;
      return new Date(a.last_used_at).getTime() - new Date(b.last_used_at).getTime();
    });

    return byOldest[0];
  }

  private calculateNewCount(selected: ConnectionRow, available: ConnectionRow[]): number {
    // Check if selected was the most recently used
    const sorted = [...available].sort((a, b) => {
      if (!a.last_used_at && !b.last_used_at) return 0;
      if (!a.last_used_at) return 1;
      if (!b.last_used_at) return -1;
      return new Date(b.last_used_at).getTime() - new Date(a.last_used_at).getTime();
    });

    if (sorted[0]?.id === selected.id && selected.last_used_at) {
      return (selected.consecutive_use_count || 0) + 1;
    }
    return 1;
  }

  /**
   * Mark a connection as unavailable for a specific model.
   * Applies per-model cooldown lock.
   */
  async markUnavailable(connectionId: string, status: number, error: string, provider: string, model?: string): Promise<void> {
    const db = getDb();

    const row = db.prepare('SELECT data FROM provider_connections WHERE id = ?').get(connectionId) as { data: string } | undefined;
    if (!row) return;

    const data = this.parseData(row.data);
    const backoffLevel = data._backoff_level || 0;
    const { cooldownMs, newLevel } = classifyError(status, backoffLevel);

    // Set model lock
    const locks = data._model_locks || {};
    const lockKey = model || '__all';
    locks[lockKey] = new Date(Date.now() + cooldownMs).toISOString();
    data._model_locks = locks;
    data._backoff_level = newLevel;
    data._last_error = error.slice(0, 200);
    data._last_error_status = status;

    db.prepare(`
      UPDATE provider_connections
      SET data = ?, is_active = 1, updated_at = datetime('now')
      WHERE id = ?
    `).run(JSON.stringify(data), connectionId);

    logger.warn(`[MultiAccount] Connection ${connectionId.slice(0, 8)} locked for model=${lockKey} ${Math.round(cooldownMs / 1000)}s [${status}]`);
  }

  /**
   * Clear error state on successful request.
   */
  async markSuccess(connectionId: string): Promise<void> {
    const db = getDb();

    const row = db.prepare('SELECT data FROM provider_connections WHERE id = ?').get(connectionId) as { data: string } | undefined;
    if (!row) return;

    const data = this.parseData(row.data);
    const now = Date.now();

    // Clear expired model locks
    const locks = data._model_locks || {};
    for (const [key, expiry] of Object.entries(locks)) {
      if (new Date(expiry as string).getTime() <= now) {
        delete locks[key];
      }
    }

    // Reset backoff if no active locks remain
    const hasActiveLocks = Object.values(locks).some(expiry => new Date(expiry as string).getTime() > now);
    if (!hasActiveLocks) {
      data._backoff_level = 0;
      data._last_error = null;
      data._last_error_status = null;
    }

    data._model_locks = locks;

    db.prepare(`
      UPDATE provider_connections
      SET data = ?, updated_at = datetime('now')
      WHERE id = ?
    `).run(JSON.stringify(data), connectionId);
  }

  /**
   * Add a new provider connection.
   */
  async addConnection(provider: string, authType: string, data: Record<string, any>, name?: string, priority?: number): Promise<string> {
    const id = genId('conn');
    const db = getDb();

    db.prepare(`
      INSERT INTO provider_connections (id, provider, auth_type, name, priority, data)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(id, provider, authType, name || null, priority ?? 0, JSON.stringify(data));

    logger.info(`[MultiAccount] Added connection ${id} for ${provider}`);
    return id;
  }

  /**
   * Remove a provider connection.
   */
  async removeConnection(id: string): Promise<boolean> {
    const db = getDb();
    const result = db.prepare('DELETE FROM provider_connections WHERE id = ?').run(id);
    if (result.changes > 0) {
      logger.info(`[MultiAccount] Removed connection ${id}`);
      return true;
    }
    return false;
  }

  /**
   * List all connections, optionally filtered by provider.
   */
  async listConnections(provider?: string): Promise<ConnectionRow[]> {
    const db = getDb();
    if (provider) {
      return db.prepare(`
        SELECT * FROM provider_connections WHERE provider = ? ORDER BY priority ASC, created_at ASC
      `).all(provider) as ConnectionRow[];
    }
    return db.prepare('SELECT * FROM provider_connections ORDER BY provider, priority ASC').all() as ConnectionRow[];
  }

  /**
   * Get count of active connections for a provider.
   */
  async getActiveCount(provider: string): Promise<number> {
    const db = getDb();
    const row = db.prepare(`
      SELECT COUNT(*) as count FROM provider_connections
      WHERE provider = ? AND is_active = 1
    `).get(provider) as { count: number };
    return row.count;
  }

  /**
   * Clean up expired model locks across all connections.
   */
  async cleanupExpiredLocks(): Promise<number> {
    const db = getDb();
    const rows = db.prepare('SELECT id, data FROM provider_connections').all() as { id: string; data: string }[];
    const now = Date.now();
    let cleaned = 0;

    for (const row of rows) {
      const data = this.parseData(row.data);
      const locks = data._model_locks || {};
      let changed = false;

      for (const [key, expiry] of Object.entries(locks)) {
        if (new Date(expiry as string).getTime() <= now) {
          delete locks[key];
          changed = true;
        }
      }

      if (changed) {
        data._model_locks = locks;
        db.prepare('UPDATE provider_connections SET data = ? WHERE id = ?')
          .run(JSON.stringify(data), row.id);
        cleaned++;
      }
    }

    return cleaned;
  }

  private parseData(raw: string): Record<string, any> {
    try {
      return JSON.parse(raw);
    } catch {
      return {};
    }
  }
}

export const multiAccountManager = new MultiAccountManager();
