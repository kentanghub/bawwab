/**
 * Smart 3-Tier Fallback System
 * Automatically falls back through tiers when providers fail:
 *   Tier 1: Best quality (Claude Opus, GPT-4, DeepSeek V3, etc.)
 *   Tier 2: Balanced (Claude Sonnet, GPT-3.5, Mistral Large, etc.)
 *   Tier 3: Fast/cheap (Groq, Gemma, Llama via cheap hosts, etc.)
 */

import { logger } from './logger.js';
import { pluginManager } from '../plugins/manager.js';
import type { Provider } from '../types/index.js';

export type Tier = 1 | 2 | 3;

export interface FallbackPlan {
  tiers: Tier[];
  providers: Provider[];
  modelMapping: Map<string, string>; // original model -> fallback model
}

// Model tier classification
const TIER_1_MODELS = new Set([
  'claude-opus-4-20250514',
  'claude-sonnet-4-20250514',
  'gpt-4o',
  'gpt-4-turbo',
  'deepseek-v3',
  'accounts/fireworks/models/deepseek-v3',
  'kimi-k2',
  'command-r-plus',
]);

const TIER_2_MODELS = new Set([
  'gpt-3.5-turbo',
  'deepseek-chat',
  'mistral-large-latest',
  'grok-2',
  'llama-3.3-70b-versatile',
  'meta-llama/Llama-3.3-70B-Instruct-Turbo',
  'MiniMax-Text-01',
]);

const TIER_3_MODELS = new Set([
  'gemma2-9b-it',
  'mixtral-8x7b-32768',
  'grok-2-vision',
  'mistral-medium-latest',
  'codestral-latest',
  'mistralai/Mixtral-8x22B-Instruct-v0.1',
  'llama-3.3-70b',
  'accounts/fireworks/models/llama-v3p3-70b-instruct',
  'command-r',
]);

export class SmartFallback {
  /**
   * Determine tier for a given model
   */
  getModelTier(modelId: string): Tier {
    if (TIER_1_MODELS.has(modelId)) return 1;
    if (TIER_2_MODELS.has(modelId)) return 2;
    if (TIER_3_MODELS.has(modelId)) return 3;
    // Default based on cost
    return 2;
  }

  /**
   * Build fallback plan for a request
   * Returns providers ordered by tier preference
   */
  buildFallbackPlan(
    primaryProvider: Provider,
    primaryModelId: string,
    requestedModelId: string
  ): FallbackPlan {
    const startTier = this.getModelTier(primaryModelId);
    const tiers: Tier[] = [startTier];
    
    // Add lower tiers if starting from higher tier
    if (startTier === 1) tiers.push(2, 3);
    else if (startTier === 2) tiers.push(3, 1); // Try 3 then loop to 1
    else tiers.push(1, 2); // Try 1 then 2

    const allProviders = pluginManager.getEnabledProviders()
      .filter(p => p.healthStatus.status !== 'unhealthy')
      .filter(p => p.healthStatus.consecutiveFailures < 3)
      .sort((a, b) => (b.successRate || 0.95) - (a.successRate || 0.95));

    // Reorder providers by tier
    const orderedProviders: Provider[] = [];
    const modelMapping = new Map<string, string>();

    for (const tier of tiers) {
      for (const provider of allProviders) {
        // Find best matching model in this provider for this tier
        const tierModels = provider.models.filter(m => this.getModelTier(m.id) === tier);
        if (tierModels.length > 0) {
          if (!orderedProviders.find(p => p.id === provider.id)) {
            orderedProviders.push(provider);
            // Map original model to this provider's model
            const bestModel = tierModels[0]; // First match
            modelMapping.set(provider.id, bestModel.id);
          }
        }
      }
    }

    // Ensure primary provider is first
    const primaryIdx = orderedProviders.findIndex(p => p.id === primaryProvider.id);
    if (primaryIdx > 0) {
      const [p] = orderedProviders.splice(primaryIdx, 1);
      orderedProviders.unshift(p);
    }

    return { tiers, providers: orderedProviders, modelMapping };
  }

  /**
   * Log fallback decision for debugging
   */
  logDecision(plan: FallbackPlan, requestedModel: string): void {
    const providerNames = plan.providers.map(p => 
      `${p.name}(${plan.modelMapping.get(p.id) || 'unknown'})`
    ).join(' → ');
    
    logger.info(
      `[SmartFallback] Model ${requestedModel} → tiers [${plan.tiers.join(',')}] → ${providerNames}`
    );
  }
}

export const smartFallback = new SmartFallback();
