/**
 * Unit Tests — Smart Fallback (tier classification + fallback plan building)
 * Tests the pure logic of the 3-tier fallback system.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock pluginManager before importing smart-fallback
const mockProviders: any[] = [];

vi.mock('../plugins/manager.js', () => ({
  pluginManager: {
    getEnabledProviders: () => mockProviders,
    getAllProviders: () => mockProviders,
    getProvider: (id: string) => mockProviders.find(p => p.id === id),
  },
}));

// Now import — the mock is already in place
const { SmartFallback } = await import('../services/smart-fallback.js');

function makeProvider(overrides: Partial<any> = {}): any {
  return {
    id: 'test-provider',
    alias: 'tp',
    name: 'Test Provider',
    type: 'apikey',
    baseUrl: 'https://api.test.com',
    authType: 'bearer',
    models: [],
    capabilities: ['llm'],
    healthStatus: { status: 'healthy', lastChecked: new Date(), consecutiveFailures: 0 },
    latencyMs: 200,
    successRate: 0.98,
    costPer1kTokens: 0.01,
    isEnabled: true,
    ...overrides,
  };
}

function makeModel(overrides: Partial<any> = {}): any {
  return {
    id: 'test-model',
    name: 'Test Model',
    contextWindow: 128000,
    maxTokens: 4096,
    supportsStreaming: true,
    supportsVision: false,
    supportsTools: true,
    supportsThinking: false,
    costPer1kInput: 0.001,
    costPer1kOutput: 0.002,
    ...overrides,
  };
}

describe('SmartFallback', () => {
  let fallback: InstanceType<typeof SmartFallback>;

  beforeEach(() => {
    fallback = new SmartFallback();
    mockProviders.length = 0;
  });

  describe('getModelTier', () => {
    it('should classify Tier 1 models correctly', () => {
      expect(fallback.getModelTier('claude-opus-4-20250514')).toBe(1);
      expect(fallback.getModelTier('claude-sonnet-4-20250514')).toBe(1);
      expect(fallback.getModelTier('gpt-4o')).toBe(1);
      expect(fallback.getModelTier('deepseek-v3')).toBe(1);
      expect(fallback.getModelTier('kimi-k2')).toBe(1);
    });

    it('should classify Tier 2 models correctly', () => {
      expect(fallback.getModelTier('gpt-3.5-turbo')).toBe(2);
      expect(fallback.getModelTier('deepseek-chat')).toBe(2);
      expect(fallback.getModelTier('mistral-large-latest')).toBe(2);
      expect(fallback.getModelTier('grok-2')).toBe(2);
    });

    it('should classify Tier 3 models correctly', () => {
      expect(fallback.getModelTier('gemma2-9b-it')).toBe(3);
      expect(fallback.getModelTier('mixtral-8x7b-32768')).toBe(3);
      expect(fallback.getModelTier('codestral-latest')).toBe(3);
      expect(fallback.getModelTier('command-r')).toBe(3);
    });

    it('should default to Tier 2 for unknown models', () => {
      expect(fallback.getModelTier('unknown-model-xyz')).toBe(2);
      expect(fallback.getModelTier('')).toBe(2);
    });
  });

  describe('buildFallbackPlan', () => {
    it('should return primary provider first', () => {
      const primary = makeProvider({
        id: 'primary',
        models: [makeModel({ id: 'gpt-4o' })],
      });
      const secondary = makeProvider({
        id: 'secondary',
        successRate: 0.9,
        models: [makeModel({ id: 'gpt-3.5-turbo' })],
      });
      mockProviders.push(primary, secondary);

      const plan = fallback.buildFallbackPlan(primary, 'gpt-4o', 'gpt-4o');
      expect(plan.providers[0].id).toBe('primary');
    });

    it('should include tier fallback providers', () => {
      const tier1 = makeProvider({
        id: 'tier1-provider',
        models: [makeModel({ id: 'gpt-4o' })],
      });
      const tier2 = makeProvider({
        id: 'tier2-provider',
        successRate: 0.95,
        models: [makeModel({ id: 'gpt-3.5-turbo' })],
      });
      const tier3 = makeProvider({
        id: 'tier3-provider',
        successRate: 0.9,
        models: [makeModel({ id: 'gemma2-9b-it' })],
      });
      mockProviders.push(tier1, tier2, tier3);

      const plan = fallback.buildFallbackPlan(tier1, 'gpt-4o', 'gpt-4o');
      // Should start with tier 1, then fallback to tier 2, then tier 3
      expect(plan.tiers).toEqual([1, 2, 3]);
      expect(plan.providers.length).toBeGreaterThanOrEqual(1);
    });

    it('should exclude unhealthy providers', () => {
      const healthy = makeProvider({
        id: 'healthy',
        models: [makeModel({ id: 'gpt-4o' })],
      });
      const unhealthy = makeProvider({
        id: 'unhealthy',
        healthStatus: { status: 'unhealthy', lastChecked: new Date(), consecutiveFailures: 5 },
        models: [makeModel({ id: 'gpt-3.5-turbo' })],
      });
      mockProviders.push(healthy, unhealthy);

      const plan = fallback.buildFallbackPlan(healthy, 'gpt-4o', 'gpt-4o');
      expect(plan.providers.find((p: any) => p.id === 'unhealthy')).toBeUndefined();
    });

    it('should exclude providers with 3+ consecutive failures', () => {
      const good = makeProvider({
        id: 'good',
        models: [makeModel({ id: 'gpt-4o' })],
      });
      const flaky = makeProvider({
        id: 'flaky',
        healthStatus: { status: 'degraded', lastChecked: new Date(), consecutiveFailures: 3 },
        models: [makeModel({ id: 'gpt-3.5-turbo' })],
      });
      mockProviders.push(good, flaky);

      const plan = fallback.buildFallbackPlan(good, 'gpt-4o', 'gpt-4o');
      expect(plan.providers.find((p: any) => p.id === 'flaky')).toBeUndefined();
    });

    it('should build model mapping for fallback providers', () => {
      const primary = makeProvider({
        id: 'primary',
        models: [makeModel({ id: 'gpt-4o' })],
      });
      const fallback1 = makeProvider({
        id: 'fallback1',
        successRate: 0.95,
        models: [makeModel({ id: 'claude-sonnet-4-20250514' })],
      });
      mockProviders.push(primary, fallback1);

      const plan = fallback.buildFallbackPlan(primary, 'gpt-4o', 'gpt-4o');
      expect(plan.modelMapping.size).toBeGreaterThan(0);
    });
  });
});
