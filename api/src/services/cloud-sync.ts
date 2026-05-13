/**
 * Cloud Sync — export/import based state synchronization.
 *
 * Exports the full state as JSON (all relevant tables).
 * Imports by wiping and re-importing in a single transaction.
 * Tracks machine ID and last sync timestamp.
 */
import crypto from 'crypto';
import os from 'os';
import { getDb, transaction } from './database.js';

function validateColumnName(name: string): string {
  if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(name)) throw new Error('Invalid column: ' + name);
  return name;
}

// ─── Machine ID generation ───────────────────────────────────────────────

function generateMachineId(): string {
  const parts: string[] = [];
  try {
    parts.push(os.hostname());
    parts.push(os.platform());
    parts.push(os.arch());
    parts.push(os.cpus().map(c => c.model).join(','));
    parts.push(String(os.totalmem()));
  } catch { /* ignore */ }
  const fingerprint = parts.join('|');
  return crypto.createHash('sha256').update(fingerprint).digest('hex').slice(0, 16);
}

// ─── Table definitions for export/import ─────────────────────────────────

interface SyncState {
  settings: any;
  provider_connections: any[];
  model_aliases: any[];
  pricing_overrides: any[];
  combos: any[];
  virtual_keys: any[];
  webhooks: any[];
  ab_tests: any[];
  _meta: any[];
}

const TABLES: Array<{ name: string; keyCol?: string }> = [
  { name: 'provider_connections' },
  { name: 'model_aliases' },
  { name: 'pricing_overrides' },
  { name: 'combos' },
  { name: 'virtual_keys' },
  { name: 'webhooks' },
  { name: 'ab_tests' },
  { name: '_meta' },
];

const VALID_TABLES = new Set(TABLES.map(t => t.name));

function validateTableName(name: string): string {
  if (!VALID_TABLES.has(name)) throw new Error(`Invalid table: ${name}`);
  return name;
}

function getRowCount(tableName: string): number {
  const validated = validateTableName(tableName);
  const db = getDb();
  const row = db.prepare(`SELECT COUNT(*) as count FROM "${validated}"`).get() as any;
  return row?.count ?? 0;
}

function getAllRows(tableName: string): any[] {
  const validated = validateTableName(tableName);
  const db = getDb();
  return db.prepare(`SELECT * FROM "${validated}"`).all();
}

// ─── Export singleton ────────────────────────────────────────────────────

export const cloudSync = {
  /**
   * Generate a hardware-fingerprint-based machine ID.
   */
  generateMachineId(): string {
    return generateMachineId();
  },

  /**
   * Export the full application state as JSON.
   */
  exportState(): SyncState {
    const db = getDb();

    // Settings (JSON blob in single row)
    const settingsRow = db.prepare('SELECT data FROM settings WHERE id = 1').get() as any;
    const settings = settingsRow ? JSON.parse(settingsRow.data) : {};

    // All other tables
    const state: SyncState = { settings, ...{} as any };
    for (const table of TABLES) {
      (state as any)[table.name] = getAllRows(table.name);
    }

    return state;
  },

  /**
   * Import state from JSON, wiping existing data first.
   * Runs in a single transaction for atomicity.
   */
  importState(data: Partial<SyncState>): { imported: Record<string, number> } {
    const db = getDb();
    const imported: Record<string, number> = {};

    transaction(() => {
      // Settings
      if (data.settings !== undefined) {
        db.prepare('UPDATE settings SET data = ? WHERE id = 1').run(JSON.stringify(data.settings));
        imported.settings = 1;
      }

      // All other tables
      for (const table of TABLES) {
        const rows = (data as any)[table.name];
        if (!Array.isArray(rows)) continue;

        const validatedTable = validateTableName(table.name);

        // Wipe
        db.prepare(`DELETE FROM "${validatedTable}"`).run();

        if (rows.length === 0) {
          imported[table.name] = 0;
          continue;
        }

        // Get column names from first row, validate each
        const cols = Object.keys(rows[0]).map(c => validateColumnName(c));
        const placeholders = cols.map(() => '?').join(', ');
        const colNames = cols.map(c => `"${c}"`).join(', ');
        const insert = db.prepare(`INSERT INTO "${validatedTable}" (${colNames}) VALUES (${placeholders})`);

        for (const row of rows) {
          insert.run(...cols.map(c => row[c]));
        }
        imported[table.name] = rows.length;
      }
    });

    // Update sync metadata
    const machineId = this.getMachineId();
    db.prepare(
      'UPDATE cloud_sync SET last_sync_at = datetime(\'now\'), data = json_set(COALESCE(data, \'{}\'), \'$.imported_at\', datetime(\'now\')) WHERE id = 1'
    ).run();

    return { imported };
  },

  /**
   * Get the current machine ID (generates and stores if first time).
   */
  getMachineId(): string {
    const db = getDb();
    const row = db.prepare('SELECT machine_id FROM cloud_sync WHERE id = 1').get() as any;
    if (row?.machine_id) return row.machine_id;

    const id = generateMachineId();
    db.prepare('UPDATE cloud_sync SET machine_id = ? WHERE id = 1').run(id);
    return id;
  },

  /**
   * Get sync status with table row counts.
   */
  getSyncStatus(): { machineId: string; lastSyncAt: string | null; tables: Record<string, number> } {
    const db = getDb();
    const row = db.prepare('SELECT machine_id, last_sync_at FROM cloud_sync WHERE id = 1').get() as any;

    const tables: Record<string, number> = {};
    for (const table of TABLES) {
      tables[table.name] = getRowCount(table.name);
    }
    // Also count settings as 1 if non-empty
    const settingsRow = db.prepare('SELECT data FROM settings WHERE id = 1').get() as any;
    tables.settings = settingsRow && settingsRow.data !== '{}' ? 1 : 0;

    return {
      machineId: row?.machine_id || this.getMachineId(),
      lastSyncAt: row?.last_sync_at || null,
      tables,
    };
  },
};
