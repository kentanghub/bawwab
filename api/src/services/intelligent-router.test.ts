/**
 * Unit Tests — Intelligent Router
 * Tests direct model matching, alias routing, combo routing, and scoring.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock pluginManager
const mockProviders: any[] = [];

vi.mock('../plugins/manager.js', () => ({
  pluginManager: {
    getEnabledProviders: () => mockProviders.filter(p => p.isEnabled),
    getAllProviders: () => mockProviders,
    getProvider: (id: string) => mockProviders.find(p => p.id === id),
  },
}));

const { intelligentRouter } = await import('../services/intelligent-router.js');

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

function makeChatRequest(overrides: Partial<any> = {}): any {
  return {
    model: 'gpt-4o',
    messages: [{ role: 'user', content: 'Hello' }],
    ...overrides,
  };
}

describe('IntelligentRouter', () => {
  beforeEach(() => {
    mockProviders.length = 0;
    intelligentRouter.initialize();
  });

  describe('route — direct model match', () => {
    it('should route to provider with exact model match', async () => {
      const provider = makeProvider({
        id: 'openai-provider',
        models: [makeModel({ id: 'gpt-4o' }), makeModel({ id: 'gpt-3.5-turbo' })],
      });
      mockProviders.push(provider);

      const decision = await intelligentRouter.route(makeChatRequest({ model: 'gpt-4o' }));
      expect(decision.providerId).toBe('openai-provider');
      expect(decision.modelId).toBe('gpt-4o');
    });

    it('should skip disabled providers for direct match', async () => {
      const disabled = makeProvider({
        id: 'disabled',
        isEnabled: false,
        models: [makeModel({ id: 'gpt-4o' })],
      });
      const enabled = makeProvider({
        id: 'enabled',
        models: [makeModel({ id: 'gpt-4o' })],
      });
      mockProviders.push(disabled, enabled);

      const decision = await intelligentRouter.route(makeChatRequest({ model: 'gpt-4o' }));
      expect(decision.providerId).toBe('enabled');
    });
  });

  describe('route — alias routing', () => {
    it('should route using provider alias prefix', async () => {
      const provider = makeProvider({
        id: 'anthropic-provider',
        alias: 'anthropic',
        models: [
          makeModel({ id: 'claude-3-opus-20240229', name: 'Claude 3 Opus' }),
          makeModel({ id: 'claude-3-sonnet-20240229', name: 'Claude 3 Sonnet' }),
        ],
      });
      mockProviders.push(provider);

      const decision = await intelligentRouter.route(
        makeChatRequest({ model: 'anthropic/claude-3-opus-20240229' })
      );
      expect(decision.providerId).toBe('anthropic-provider');
    });
  });

  describe('route — combo routing', () => {
    it('should route combo/ prefix to primary model', async () => {
      const provider = makeProvider({
        id: 'combo-provider',
        models: [
          makeModel({ id: 'gpt-4o' }),
          makeModel({ id: 'claude-3-opus-20240229' }),
        ],
      });
      mockProviders.push(provider);

      const decision = await intelligentRouter.route(
        makeChatRequest({ model: 'combo/gpt-4o+claude-3-opus-20240229' })
      );
      expect(decision.modelId).toBe('gpt-4o');
    });
  });

  describe('route — intelligent fallback', () => {
    it('should throw when no providers available', async () => {
      // No providers
      await expect(
        intelligentRouter.route(makeChatRequest({ model: 'nonexistent-model' }))
      ).rejects.toThrow();
    });

    it('should skip unhealthy providers in intelligent routing', async () => {
      // Use a model that won't be direct-matched, so intelligent routing kicks in
      const unhealthy = makeProvider({
        id: 'unhealthy',
        healthStatus: { status: 'unhealthy', lastChecked: new Date(), consecutiveFailures: 5 },
        models: [makeModel({ id: 'intelligent-route-model' })],
      });
      mockProviders.push(unhealthy);

      await expect(
        intelligentRouter.route(makeChatRequest({ model: 'unknown-model-no-match' }))
      ).rejects.toThrow();
    });

    it('should prefer higher-scoring providers via intelligent routing', async () => {
      // Use models that won't be direct-matched, so scoring applies
      const slow = makeProvider({
        id: 'slow',
        latencyMs: 2000,
        successRate: 0.7,
        models: [makeModel({ id: 'score-model', costPer1kInput: 0.1, costPer1kOutput: 0.2 })],
      });
      const fast = makeProvider({
        id: 'fast',
        latencyMs: 100,
        successRate: 0.99,
        models: [makeModel({ id: 'score-model', costPer1kInput: 0.001, costPer1kOutput: 0.002 })],
      });
      mockProviders.push(slow, fast);

      const decision = await intelligentRouter.route(
        makeChatRequest({ model: 'totally-unknown-xyz' })
      );
      // Fast provider should win due to better latency + success rate
      expect(decision.providerId).toBe('fast');
    });

    it('should filter by tool support requirement', async () => {
      const noTools = makeProvider({
        id: 'no-tools',
        models: [makeModel({ id: 'cap-model', supportsTools: false })],
      });
      const withTools = makeProvider({
        id: 'with-tools',
        models: [makeModel({ id: 'cap-model', supportsTools: true })],
      });
      mockProviders.push(noTools, withTools);

      const decision = await intelligentRouter.route(
        makeChatRequest({
          model: 'cap-unknown-model',
          tools: [{ type: 'function', function: { name: 'test', description: 'test', parameters: {} } }],
        })
      );
      expect(decision.providerId).toBe('with-tools');
    });
  });

  describe('route — decision structure', () => {
    it('should return proper RouteDecision fields', async () => {
      const provider = makeProvider({
        id: 'test-p',
        latencyMs: 150,
        models: [makeModel({ id: 'gpt-4o', costPer1kInput: 0.005, costPer1kOutput: 0.015 })],
      });
      mockProviders.push(provider);

      const decision = await intelligentRouter.route(makeChatRequest());
      expect(decision).toHaveProperty('providerId');
      expect(decision).toHaveProperty('modelId');
      expect(decision).toHaveProperty('reasoning');
      expect(decision).toHaveProperty('estimatedCost');
      expect(decision).toHaveProperty('estimatedLatency');
      expect(decision.estimatedLatency).toBe(150);
    });
  });
});
