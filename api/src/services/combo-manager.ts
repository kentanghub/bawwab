/**
 * Provider Combo Manager
 * Allows users to create custom provider combinations (combos)
 * with ordered fallback priority.
 *
 * Example combo:
 * {
 *   id: 'coding-premium',
 *   name: 'Premium Coding',
 *   providers: [
 *     { providerId: 'anthropic', modelId: 'claude-opus-4', priority: 1 },
 *     { providerId: 'openai', modelId: 'gpt-4o', priority: 2 },
 *     { providerId: 'deepseek', modelId: 'deepseek-v3', priority: 3 }
 *   ]
 * }
 */

import { logger } from './logger.js';
import { pluginManager } from '../plugins/manager.js';

export interface ComboProvider {
  providerId: string;
  modelId: string;
  priority: number;
}

export interface ProviderCombo {
  id: string;
  name: string;
  description?: string;
  providers: ComboProvider[];
  createdAt: Date;
  updatedAt: Date;
}

// In-memory store (persist to DB in production)
const comboStore: Map<string, ProviderCombo> = new Map();

// Default combos (like 9router's built-in combos)
const DEFAULT_COMBOS: ProviderCombo[] = [
  {
    id: 'premium-coding',
    name: 'Premium Coding',
    description: 'Best quality for coding tasks',
    providers: [
      { providerId: 'anthropic', modelId: 'claude-opus-4-20250514', priority: 1 },
      { providerId: 'openai', modelId: 'gpt-4o', priority: 2 },
      { providerId: 'deepseek', modelId: 'deepseek-v3', priority: 3 },
    ],
    createdAt: new Date(),
    updatedAt: new Date(),
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
    createdAt: new Date(),
    updatedAt: new Date(),
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
    createdAt: new Date(),
    updatedAt: new Date(),
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
    createdAt: new Date(),
    updatedAt: new Date(),
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
    createdAt: new Date(),
    updatedAt: new Date(),
  },
];

class ComboManager {
  constructor() {
    // Load default combos
    DEFAULT_COMBOS.forEach(c => comboStore.set(c.id, c));
    logger.info(`[ComboManager] Loaded ${DEFAULT_COMBOS.length} default combos`);
  }

  getCombo(id: string): ProviderCombo | undefined {
    return comboStore.get(id);
  }

  getAllCombos(): ProviderCombo[] {
    return Array.from(comboStore.values()).sort((a, b) =>
      a.name.localeCompare(b.name)
    );
  }

  createCombo(combo: Omit<ProviderCombo, 'createdAt' | 'updatedAt'>): ProviderCombo {
    const now = new Date();
    const newCombo: ProviderCombo = {
      ...combo,
      createdAt: now,
      updatedAt: now,
    };
    comboStore.set(combo.id, newCombo);
    logger.info(`[ComboManager] Created combo: ${combo.id}`);
    return newCombo;
  }

  updateCombo(id: string, updates: Partial<Omit<ProviderCombo, 'id' | 'createdAt'>>): ProviderCombo | undefined {
    const existing = comboStore.get(id);
    if (!existing) return undefined;

    const updated: ProviderCombo = {
      ...existing,
      ...updates,
      updatedAt: new Date(),
    };
    comboStore.set(id, updated);
    return updated;
  }

  deleteCombo(id: string): boolean {
    // Don't allow deleting default combos
    if (DEFAULT_COMBOS.some(c => c.id === id)) {
      throw new Error('Cannot delete default combos');
    }
    return comboStore.delete(id);
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

  /**
   * Check if combo ID exists
   */
  hasCombo(id: string): boolean {
    return comboStore.has(id);
  }
}

export const comboManager = new ComboManager();
