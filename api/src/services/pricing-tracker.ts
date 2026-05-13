/**
 * Pricing Tracker — hardcoded + user-override pricing for AI models.
 *
 * Fallback chain:
 *   1. Provider-specific override (pricing_overrides table)
 *   2. Canonical model (MODEL_PRICING map)
 *   3. Pattern match (PATTERN_PRICING globs)
 */

import { getDb } from './database.js';

interface PricingRate {
  input: number;   // $/1M tokens
  output: number;
  cached: number;
  reasoning: number;
}

interface PatternPricing {
  pattern: string;
  pricing: PricingRate;
}

// ─── Hardcoded canonical model pricing ($/1M tokens) ─────────────────────
const MODEL_PRICING: Record<string, PricingRate> = {
  // === Anthropic / Claude ===
  'claude-opus-4-6':            { input: 5.00,  output: 25.00, cached: 0.50,  reasoning: 25.00 },
  'claude-opus-4-5-20251101':   { input: 5.00,  output: 25.00, cached: 0.50,  reasoning: 25.00 },
  'claude-sonnet-4-6':          { input: 3.00,  output: 15.00, cached: 0.30,  reasoning: 15.00 },
  'claude-sonnet-4-5-20250929': { input: 3.00,  output: 15.00, cached: 0.30,  reasoning: 15.00 },
  'claude-haiku-4-5-20251001':  { input: 1.00,  output: 5.00,  cached: 0.10,  reasoning: 5.00  },
  'claude-sonnet-4-20250514':   { input: 3.00,  output: 15.00, cached: 1.50,  reasoning: 15.00 },
  'claude-opus-4-20250514':     { input: 15.00, output: 25.00, cached: 7.50,  reasoning: 112.50 },
  'claude-3-5-sonnet-20241022': { input: 3.00,  output: 15.00, cached: 1.50,  reasoning: 15.00 },
  'claude-haiku-4.5':           { input: 0.50,  output: 2.50,  cached: 0.05,  reasoning: 3.75  },
  'claude-opus-4.1':            { input: 5.00,  output: 25.00, cached: 0.50,  reasoning: 37.50 },
  'claude-opus-4.5':            { input: 5.00,  output: 25.00, cached: 0.50,  reasoning: 37.50 },
  'claude-opus-4.6':            { input: 5.00,  output: 25.00, cached: 0.50,  reasoning: 37.50 },
  'claude-sonnet-4':            { input: 3.00,  output: 15.00, cached: 0.30,  reasoning: 22.50 },
  'claude-sonnet-4.5':          { input: 3.00,  output: 15.00, cached: 0.30,  reasoning: 22.50 },
  'claude-sonnet-4.6':          { input: 3.00,  output: 15.00, cached: 0.30,  reasoning: 22.50 },

  // === OpenAI / GPT ===
  'gpt-3.5-turbo':              { input: 0.50,  output: 1.50,  cached: 0.25,  reasoning: 2.25  },
  'gpt-4':                      { input: 2.50,  output: 10.00, cached: 1.25,  reasoning: 15.00 },
  'gpt-4-turbo':                { input: 10.00, output: 30.00, cached: 5.00,  reasoning: 45.00 },
  'gpt-4o':                     { input: 2.50,  output: 10.00, cached: 1.25,  reasoning: 15.00 },
  'gpt-4o-mini':                { input: 0.15,  output: 0.60,  cached: 0.075, reasoning: 0.90  },
  'gpt-4.1':                    { input: 2.50,  output: 10.00, cached: 1.25,  reasoning: 15.00 },
  'gpt-5':                      { input: 3.00,  output: 12.00, cached: 1.50,  reasoning: 18.00 },
  'gpt-5-mini':                 { input: 0.75,  output: 3.00,  cached: 0.375, reasoning: 4.50  },
  'gpt-5-codex':                { input: 3.00,  output: 12.00, cached: 1.50,  reasoning: 18.00 },
  'gpt-5.1':                    { input: 4.00,  output: 16.00, cached: 2.00,  reasoning: 24.00 },
  'gpt-5.1-codex':              { input: 4.00,  output: 16.00, cached: 2.00,  reasoning: 24.00 },
  'gpt-5.1-codex-mini':         { input: 1.50,  output: 6.00,  cached: 0.75,  reasoning: 9.00  },
  'gpt-5.1-codex-mini-high':    { input: 2.00,  output: 8.00,  cached: 1.00,  reasoning: 12.00 },
  'gpt-5.1-codex-max':          { input: 8.00,  output: 32.00, cached: 4.00,  reasoning: 48.00 },
  'gpt-5.2':                    { input: 5.00,  output: 20.00, cached: 2.50,  reasoning: 30.00 },
  'gpt-5.2-codex':              { input: 5.00,  output: 20.00, cached: 2.50,  reasoning: 30.00 },
  'gpt-5.3-codex':              { input: 6.00,  output: 24.00, cached: 3.00,  reasoning: 36.00 },
  'gpt-5.3-codex-xhigh':       { input: 10.00, output: 40.00, cached: 5.00,  reasoning: 60.00 },
  'gpt-5.3-codex-high':        { input: 8.00,  output: 32.00, cached: 4.00,  reasoning: 48.00 },
  'gpt-5.3-codex-low':         { input: 4.00,  output: 16.00, cached: 2.00,  reasoning: 24.00 },
  'gpt-5.3-codex-none':        { input: 3.00,  output: 12.00, cached: 1.50,  reasoning: 18.00 },
  'gpt-5.3-codex-spark':       { input: 3.00,  output: 12.00, cached: 0.30,  reasoning: 12.00 },
  'o1':                         { input: 15.00, output: 60.00, cached: 7.50,  reasoning: 90.00 },
  'o1-mini':                    { input: 3.00,  output: 12.00, cached: 1.50,  reasoning: 18.00 },

  // === Gemini ===
  'gemini-3-flash-preview':     { input: 0.50,  output: 3.00,  cached: 0.03,  reasoning: 4.50  },
  'gemini-3-pro-preview':       { input: 2.00,  output: 12.00, cached: 0.25,  reasoning: 18.00 },
  'gemini-3-flash':             { input: 0.50,  output: 3.00,  cached: 0.03,  reasoning: 4.50  },
  'gemini-2.5-pro':             { input: 2.00,  output: 12.00, cached: 0.25,  reasoning: 18.00 },
  'gemini-2.5-flash':           { input: 0.30,  output: 2.50,  cached: 0.03,  reasoning: 3.75  },
  'gemini-2.5-flash-lite':      { input: 0.15,  output: 1.25,  cached: 0.015, reasoning: 1.875 },

  // === DeepSeek ===
  'deepseek-chat':              { input: 0.14,  output: 0.28,  cached: 0.0028, reasoning: 0.28 },
  'deepseek-reasoner':          { input: 0.14,  output: 0.28,  cached: 0.0028, reasoning: 0.28 },
  'deepseek-r1':                { input: 0.14,  output: 0.28,  cached: 0.0028, reasoning: 0.28 },
  'deepseek-v3.2-chat':         { input: 0.14,  output: 0.28,  cached: 0.0028, reasoning: 0.28 },
  'deepseek-v3.2-reasoner':     { input: 0.14,  output: 0.28,  cached: 0.0028, reasoning: 0.28 },
  'deepseek-v4-flash':          { input: 0.14,  output: 0.28,  cached: 0.0028, reasoning: 0.28 },
  'deepseek-v4-pro':            { input: 0.435, output: 0.87,  cached: 0.003625, reasoning: 0.87 },

  // === Qwen ===
  'qwen3-coder-plus':           { input: 1.00,  output: 4.00,  cached: 0.50,  reasoning: 6.00  },
  'qwen3-coder-flash':          { input: 0.50,  output: 2.00,  cached: 0.25,  reasoning: 3.00  },

  // === Kimi ===
  'kimi-k2':                    { input: 1.00,  output: 4.00,  cached: 0.50,  reasoning: 6.00  },
  'kimi-k2-thinking':           { input: 1.50,  output: 6.00,  cached: 0.75,  reasoning: 9.00  },
  'kimi-k2.5':                  { input: 1.20,  output: 4.80,  cached: 0.60,  reasoning: 7.20  },
  'kimi-k2.5-thinking':         { input: 1.80,  output: 7.20,  cached: 0.90,  reasoning: 10.80 },
  'kimi-latest':                { input: 1.00,  output: 4.00,  cached: 0.50,  reasoning: 6.00  },

  // === GLM ===
  'glm-4.6':                    { input: 0.50,  output: 2.00,  cached: 0.25,  reasoning: 3.00  },
  'glm-4.7':                    { input: 0.75,  output: 3.00,  cached: 0.375, reasoning: 4.50  },
  'glm-5':                      { input: 1.00,  output: 4.00,  cached: 0.50,  reasoning: 6.00  },

  // === MiniMax ===
  'MiniMax-M2.1':               { input: 0.50,  output: 2.00,  cached: 0.25,  reasoning: 3.00  },
  'MiniMax-M2.5':               { input: 0.50,  output: 2.00,  cached: 0.25,  reasoning: 3.00  },
  'MiniMax-M2.7':               { input: 0.50,  output: 2.00,  cached: 0.25,  reasoning: 3.00  },

  // === Grok ===
  'grok-code-fast-1':           { input: 0.50,  output: 2.00,  cached: 0.25,  reasoning: 3.00  },

  // === Misc ===
  'auto':                       { input: 2.00,  output: 8.00,  cached: 1.00,  reasoning: 12.00 },
};

// ─── Pattern pricing (glob: * = any substring, first match wins) ─────────
const PATTERN_PRICING: PatternPricing[] = [
  // Codex variants
  { pattern: '*-codex-xhigh',  pricing: { input: 10.00, output: 40.00, cached: 5.00, reasoning: 60.00 } },
  { pattern: '*-codex-high',   pricing: { input: 8.00,  output: 32.00, cached: 4.00, reasoning: 48.00 } },
  { pattern: '*-codex-max',    pricing: { input: 8.00,  output: 32.00, cached: 4.00, reasoning: 48.00 } },
  { pattern: '*-codex-mini-*', pricing: { input: 1.50,  output: 6.00,  cached: 0.75, reasoning: 9.00  } },
  { pattern: '*-codex-mini',   pricing: { input: 1.50,  output: 6.00,  cached: 0.75, reasoning: 9.00  } },
  { pattern: '*-codex-low',    pricing: { input: 4.00,  output: 16.00, cached: 2.00, reasoning: 24.00 } },
  { pattern: '*-codex-none',   pricing: { input: 3.00,  output: 12.00, cached: 1.50, reasoning: 18.00 } },
  { pattern: '*-codex-spark',  pricing: { input: 3.00,  output: 12.00, cached: 0.30, reasoning: 12.00 } },
  { pattern: 'codex-*',        pricing: { input: 3.00,  output: 12.00, cached: 1.50, reasoning: 18.00 } },
  { pattern: '*-codex',        pricing: { input: 3.00,  output: 12.00, cached: 1.50, reasoning: 18.00 } },
  // Claude
  { pattern: 'claude-opus-*',   pricing: { input: 5.00,  output: 25.00, cached: 0.50, reasoning: 25.00 } },
  { pattern: 'claude-sonnet-*', pricing: { input: 3.00,  output: 15.00, cached: 0.30, reasoning: 15.00 } },
  { pattern: 'claude-haiku-*',  pricing: { input: 1.00,  output: 5.00,  cached: 0.10, reasoning: 5.00  } },
  { pattern: 'claude-*',        pricing: { input: 3.00,  output: 15.00, cached: 0.30, reasoning: 15.00 } },
  // Gemini
  { pattern: 'gemini-*-flash-lite', pricing: { input: 0.15, output: 1.25, cached: 0.015, reasoning: 1.875 } },
  { pattern: 'gemini-*-flash',  pricing: { input: 0.30,  output: 2.50,  cached: 0.03, reasoning: 3.75  } },
  { pattern: 'gemini-*-pro',    pricing: { input: 2.00,  output: 12.00, cached: 0.25, reasoning: 18.00 } },
  { pattern: 'gemini-*',        pricing: { input: 0.50,  output: 3.00,  cached: 0.03, reasoning: 4.50  } },
  // GPT
  { pattern: 'gpt-5.3-*',       pricing: { input: 6.00,  output: 24.00, cached: 3.00, reasoning: 36.00 } },
  { pattern: 'gpt-5.2-*',       pricing: { input: 5.00,  output: 20.00, cached: 2.50, reasoning: 30.00 } },
  { pattern: 'gpt-5.1-*',       pricing: { input: 4.00,  output: 16.00, cached: 2.00, reasoning: 24.00 } },
  { pattern: 'gpt-5-*',         pricing: { input: 3.00,  output: 12.00, cached: 1.50, reasoning: 18.00 } },
  { pattern: 'gpt-5*',          pricing: { input: 3.00,  output: 12.00, cached: 1.50, reasoning: 18.00 } },
  { pattern: 'gpt-4o-*',        pricing: { input: 0.15,  output: 0.60,  cached: 0.075, reasoning: 0.90 } },
  { pattern: 'gpt-4*',          pricing: { input: 2.50,  output: 10.00, cached: 1.25, reasoning: 15.00 } },
  // o-series
  { pattern: 'o1-*',            pricing: { input: 3.00,  output: 12.00, cached: 1.50, reasoning: 18.00 } },
  { pattern: 'o1',              pricing: { input: 15.00, output: 60.00, cached: 7.50, reasoning: 90.00 } },
  { pattern: 'o3-*',            pricing: { input: 10.00, output: 40.00, cached: 5.00, reasoning: 60.00 } },
  { pattern: 'o4-*',            pricing: { input: 2.00,  output: 8.00,  cached: 1.00, reasoning: 12.00 } },
  // DeepSeek
  { pattern: 'deepseek-*',      pricing: { input: 0.14,  output: 0.28,  cached: 0.0028, reasoning: 0.28 } },
  // Qwen
  { pattern: 'qwen*',           pricing: { input: 0.50,  output: 2.00,  cached: 0.25, reasoning: 3.00  } },
  // Kimi
  { pattern: 'kimi-*-thinking', pricing: { input: 1.80,  output: 7.20,  cached: 0.90, reasoning: 10.80 } },
  { pattern: 'kimi-*',          pricing: { input: 1.00,  output: 4.00,  cached: 0.50, reasoning: 6.00  } },
  // GLM
  { pattern: 'glm-*',           pricing: { input: 0.75,  output: 3.00,  cached: 0.375, reasoning: 4.50 } },
  // MiniMax
  { pattern: 'minimax-*',       pricing: { input: 0.50,  output: 2.00,  cached: 0.25, reasoning: 3.00  } },
  { pattern: 'MiniMax-*',       pricing: { input: 0.50,  output: 2.00,  cached: 0.25, reasoning: 3.00  } },
  // Grok
  { pattern: 'grok-*',          pricing: { input: 0.50,  output: 2.00,  cached: 0.25, reasoning: 3.00  } },
];

// ─── Helpers ─────────────────────────────────────────────────────────────

function matchPattern(pattern: string, model: string): boolean {
  const regex = new RegExp(
    '^' + pattern.split('*').map(s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('.*') + '$'
  );
  return regex.test(model);
}

interface UsageData {
  input_tokens?: number;
  output_tokens?: number;
  cached_tokens?: number;
  reasoning_tokens?: number;
}

interface CostBreakdown {
  inputCost: number;
  outputCost: number;
  cachedCost: number;
  reasoningCost: number;
  totalCost: number;
}

// ─── Singleton ───────────────────────────────────────────────────────────

export const pricingTracker = {
  /**
   * Get pricing for a model (3-step fallback).
   */
  getPricing(provider: string, model: string): PricingRate | null {
    if (!model) return null;
    const db = getDb();

    // 1. Provider-specific override from DB
    const override = db.prepare(
      'SELECT input_per_1m, output_per_1m, cached_per_1m, reasoning_per_1m FROM pricing_overrides WHERE provider = ? AND model = ?'
    ).get(provider, model) as any;
    if (override) {
      return {
        input: override.input_per_1m,
        output: override.output_per_1m,
        cached: override.cached_per_1m,
        reasoning: override.reasoning_per_1m,
      };
    }

    // Strip vendor prefix if present
    const baseModel = model.includes('/') ? model.split('/').pop()! : model;

    // 2. Canonical model pricing
    if (MODEL_PRICING[baseModel]) return MODEL_PRICING[baseModel];
    if (MODEL_PRICING[model]) return MODEL_PRICING[model];

    // 3. Pattern match
    for (const { pattern, pricing } of PATTERN_PRICING) {
      if (matchPattern(pattern, baseModel) || matchPattern(pattern, model)) {
        return pricing;
      }
    }

    return null;
  },

  /**
   * Calculate cost for a given usage.
   */
  calculateCost(provider: string, model: string, usage: UsageData): CostBreakdown {
    const pricing = this.getPricing(provider, model);
    if (!pricing) {
      return { inputCost: 0, outputCost: 0, cachedCost: 0, reasoningCost: 0, totalCost: 0 };
    }

    const inputTokens = usage.input_tokens || 0;
    const cachedTokens = usage.cached_tokens || 0;
    const nonCachedInput = Math.max(0, inputTokens - cachedTokens);
    const outputTokens = usage.output_tokens || 0;
    const reasoningTokens = usage.reasoning_tokens || 0;

    const inputCost = nonCachedInput * (pricing.input / 1_000_000);
    const cachedCost = cachedTokens * (pricing.cached / 1_000_000);
    const outputCost = outputTokens * (pricing.output / 1_000_000);
    const reasoningCost = reasoningTokens * (pricing.reasoning / 1_000_000);

    return {
      inputCost,
      outputCost,
      cachedCost,
      reasoningCost,
      totalCost: inputCost + outputCost + cachedCost + reasoningCost,
    };
  },

  /** List all canonical pricing entries */
  listCanonicalPricing(): Record<string, PricingRate> {
    return { ...MODEL_PRICING };
  },

  /** List all pattern pricing rules */
  listPatternPricing(): PatternPricing[] {
    return [...PATTERN_PRICING];
  },

  /** List user overrides from DB */
  listOverrides(): Array<{ provider: string; model: string } & PricingRate> {
    const db = getDb();
    const rows = db.prepare(
      'SELECT provider, model, input_per_1m as input, output_per_1m as output, cached_per_1m as cached, reasoning_per_1m as reasoning FROM pricing_overrides ORDER BY provider, model'
    ).all() as any[];
    return rows;
  },

  /** Set a user pricing override */
  setOverride(provider: string, model: string, pricing: PricingRate): void {
    const db = getDb();
    db.prepare(
      `INSERT INTO pricing_overrides (provider, model, input_per_1m, output_per_1m, cached_per_1m, reasoning_per_1m)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(provider, model) DO UPDATE SET
         input_per_1m = excluded.input_per_1m,
         output_per_1m = excluded.output_per_1m,
         cached_per_1m = excluded.cached_per_1m,
         reasoning_per_1m = excluded.reasoning_per_1m`
    ).run(provider, model, pricing.input, pricing.output, pricing.cached, pricing.reasoning);
  },

  /** Remove a user pricing override */
  removeOverride(provider: string, model: string): boolean {
    const db = getDb();
    const result = db.prepare('DELETE FROM pricing_overrides WHERE provider = ? AND model = ?').run(provider, model);
    return result.changes > 0;
  },
};
