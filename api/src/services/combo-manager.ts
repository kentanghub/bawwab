/**
 * Provider Combo Manager — SQLite-backed
 * Allows users to create custom provider combinations (combos)
 * with ordered fallback priority.
 */

import { logger } from './logger.js';
import { pluginManager } from '../plugins/manager.js';
import { getDb } from './database.js';

export interface ComboProvider {
  providerId: string;
  modelId: string;
  priority: number;
}

export interface ProviderCombo {
  id: string;
  name: string;
  description?: string;
  kind: string;
  providers: ComboProvider[];
  createdAt: string;
  updatedAt: string;
}

interface ComboRow {
  id: string;
  name: string;
  kind: string;
  models: string;
  created_at: string;
  updated_at: string;
}

// Default combos
const DEFAULT_COMBOS: Array<{ id: string; name: string; description: string; providers: ComboProvider[] }> = [
  {
    id: 'premium-coding',
    name: 'Premium Coding',
    description: 'Best quality for coding tasks',
    providers: [
      { providerId: 'anthropic', modelId: 'claude-opus-4-20250514', priority: 1 },
      { providerId: 'openai', modelId: 'gpt-4o', priority: 2 },
      { providerId: 'deepseek', modelId: 'deepseek-v3', priority: 3 },
    ],
  },
  {
    id: 'fast-cheap',
    name: 'Fast & Cheap',
    description: 'Low cost, fast responses',
    providers: [
      { providerId: 'groq', modelId: 'llama-3.3-70b-versatile', priority: 1 },
      { providerId: 'groq', modelId: 'mixtral-8x7b-32768', priority: 2 },
      { providerId: 'openai', modelId: 'gpt-3.5-turbo', priority: 3 },
    ],
  },
  {
    id: 'open-source',
    name: 'Open Source Only',
    description: 'Only open source models',
    providers: [
      { providerId: 'groq', modelId: 'llama-3.3-70b-versatile', priority: 1 },
      { providerId: 'together', modelId: 'meta-llama/Llama-3.3-70B-Instruct-Turbo', priority: 2 },
      { providerId: 'fireworks', modelId: 'accounts/fireworks/models/llama-v3p3-70b-instruct', priority: 3 },
    ],
  },
  {
    id: 'china-local',
    name: 'China Local',
    description: 'China-based providers',
    providers: [
      { providerId: 'deepseek', modelId: 'deepseek-chat', priority: 1 },
      { providerId: 'kimi', modelId: 'kimi-k2', priority: 2 },
      { providerId: 'siliconflow', modelId: 'deepseek-ai/DeepSeek-V3', priority: 3 },
      { providerId: 'qwen', modelId: 'qwen-max', priority: 4 },
    ],
  },
  {
    id: 'unlimited-free',
    name: 'Unlimited Free',
    description: 'Free tier providers',
    providers: [
      { providerId: 'kiro', modelId: 'kr/claude-sonnet-4.5', priority: 1 },
      { providerId: 'opencode', modelId: 'oc/gpt-4o-mini', priority: 2 },
      { providerId: 'pollinations', modelId: 'openai', priority: 3 },
    ],
  },
];

function rowToCombo(row: ComboRow): ProviderCombo {
  let providers: ComboProvider[] = [];
  try { providers = JSON.parse(row.models || '[]'); } catch {}
  return {
    id: row.id,
    name: row.name,
    kind: row.kind,
    providers,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

class ComboManager {
  constructor() {
    this.seedDefaults();
  }

  /** Insert default combos if they don't exist */
  private seedDefaults(): void {
    const db = getDb();
    const stmt = db.prepare(`
      INSERT OR IGNORE INTO combos (id, name, kind, models)
      VALUES (?, ?, 'fallback', ?)
    `);
    for (const combo of DEFAULT_COMBOS) {
      stmt.run(combo.id, combo.name, JSON.stringify(combo.providers));
    }
    logger.info(`[ComboManager] Loaded ${DEFAULT_COMBOS.length} default combos`);
  }

  getCombo(id: string): ProviderCombo | undefined {
    const db = getDb();
    const row = db.prepare('SELECT * FROM combos WHERE id = ?').get(id) as ComboRow | undefined;
    return row ? rowToCombo(row) : undefined;
  }

  getAllCombos(): ProviderCombo[] {
    const db = getDb();
    const rows = db.prepare('SELECT * FROM combos ORDER BY name').all() as ComboRow[];
    return rows.map(rowToCombo);
  }

  createCombo(combo: { id: string; name: string; description?: string; kind?: string; providers: ComboProvider[] }): ProviderCombo {
    const db = getDb();
    const id = combo.id;
    const kind = combo.kind || 'fallback';

    db.prepare(`
      INSERT INTO combos (id, name, kind, models)
      VALUES (?, ?, ?, ?)
    `).run(id, combo.name, kind, JSON.stringify(combo.providers));

    logger.info(`[ComboManager] Created combo: ${id}`);
    return this.getCombo(id)!;
  }

  updateCombo(id: string, updates: Partial<Omit<ProviderCombo, 'id' | 'createdAt'>>): ProviderCombo | undefined {
    const existing = this.getCombo(id);
    if (!existing) return undefined;

    const db = getDb();
    const name = updates.name ?? existing.name;
    const kind = updates.kind ?? existing.kind;
    const providers = updates.providers ?? existing.providers;

    db.prepare(`
      UPDATE combos SET name = ?, kind = ?, models = ?, updated_at = datetime('now')
      WHERE id = ?
    `).run(name, kind, JSON.stringify(providers), id);

    return this.getCombo(id);
  }

  deleteCombo(id: string): boolean {
    if (DEFAULT_COMBOS.some(c => c.id === id)) {
      throw new Error('Cannot delete default combos');
    }
    const db = getDb();
    const result = db.prepare('DELETE FROM combos WHERE id = ?').run(id);
    return result.changes > 0;
  }

  /**
   * Get ordered list of providers for a combo
   * Filters out providers that are not enabled or unhealthy
   */
  getComboProviders(comboId: string): Array<{ provider: any; modelId: string; priority: number }> {
    const combo = this.getCombo(comboId);
    if (!combo) return [];

    return combo.providers
      .sort((a, b) => a.priority - b.priority)
      .map(cp => {
        const provider = pluginManager.getProvider(cp.providerId);
        return { provider, modelId: cp.modelId, priority: cp.priority };
      })
      .filter(item => item.provider && item.provider.isEnabled)
      .filter(item => item.provider!.healthStatus.status !== 'unhealthy')
      .filter(item => item.provider!.healthStatus.consecutiveFailures < 3);
  }

  hasCombo(id: string): boolean {
    const db = getDb();
    const row = db.prepare('SELECT 1 FROM combos WHERE id = ?').get(id);
    return !!row;
  }
}

export const comboManager = new ComboManager();
