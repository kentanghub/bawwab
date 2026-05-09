import type { Provider, PluginManifest, Model } from '../types/index.js';

class PluginManager {
  private providers: Map<string, Provider> = new Map();
  private plugins: PluginManifest[] = [];

  async loadPlugins(): Promise<void> {
    // Built-in providers
    this.registerBuiltInProviders();
    
    // Load external plugins from plugins directory
    try {
      const pluginDir = process.env.PLUGIN_DIR || './plugins/external';
      // Dynamic import would go here for external plugins
    } catch (err) {
      console.log('No external plugins found');
    }
  }

  private registerBuiltInProviders(): void {
    const providers: Provider[] = [
      // Free providers
      {
        id: 'kiro',
        alias: 'kr',
        name: 'Kiro AI',
        type: 'free',
        baseUrl: 'https://api.kiro.dev',
        authType: 'none',
        models: [{ id: 'kr/claude-sonnet-4', name: 'Claude Sonnet 4', contextWindow: 200000, maxTokens: 8192, supportsStreaming: true, supportsVision: true, supportsTools: true, supportsThinking: false, costPer1kInput: 0, costPer1kOutput: 0 }],
        capabilities: ['llm'],
        healthStatus: { status: 'unknown', lastChecked: new Date(), consecutiveFailures: 0 },
        latencyMs: 0,
        successRate: 1,
        costPer1kTokens: 0,
        isEnabled: true
      },
      {
        id: 'opencode',
        alias: 'oc',
        name: 'OpenCode Free',
        type: 'free',
        baseUrl: 'https://opencode.ai/zen/v1',
        authType: 'none',
        models: [], // Fetched dynamically
        capabilities: ['llm'],
        healthStatus: { status: 'unknown', lastChecked: new Date(), consecutiveFailures: 0 },
        latencyMs: 0,
        successRate: 1,
        costPer1kTokens: 0,
        isEnabled: true
      },
      // API Key providers
      {
        id: 'openrouter',
        alias: 'or',
        name: 'OpenRouter',
        type: 'apikey',
        baseUrl: 'https://openrouter.ai/api/v1',
        authType: 'bearer',
        authHeader: 'Authorization',
        models: [
          { id: 'anthropic/claude-sonnet-4', name: 'Claude Sonnet 4', contextWindow: 200000, maxTokens: 8192, supportsStreaming: true, supportsVision: true, supportsTools: true, supportsThinking: false, costPer1kInput: 0.003, costPer1kOutput: 0.015 },
          { id: 'openai/gpt-4o', name: 'GPT-4o', contextWindow: 128000, maxTokens: 16384, supportsStreaming: true, supportsVision: true, supportsTools: true, supportsThinking: false, costPer1kInput: 0.005, costPer1kOutput: 0.015 },
          { id: 'meta-llama/llama-4-scout', name: 'Llama 4 Scout', contextWindow: 256000, maxTokens: 8192, supportsStreaming: true, supportsVision: false, supportsTools: true, supportsThinking: false, costPer1kInput: 0.0003, costPer1kOutput: 0.0012 }
        ],
        capabilities: ['llm', 'embedding'],
        healthStatus: { status: 'unknown', lastChecked: new Date(), consecutiveFailures: 0 },
        latencyMs: 0,
        successRate: 0.99,
        costPer1kTokens: 0.005,
        isEnabled: true
      },
      {
        id: 'glm',
        alias: 'glm',
        name: 'GLM Coding',
        type: 'apikey',
        baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
        authType: 'bearer',
        authHeader: 'Authorization',
        models: [
          { id: 'glm-4.5', name: 'GLM 4.5', contextWindow: 128000, maxTokens: 8192, supportsStreaming: true, supportsVision: true, supportsTools: true, supportsThinking: true, costPer1kInput: 0.001, costPer1kOutput: 0.003 }
        ],
        capabilities: ['llm'],
        healthStatus: { status: 'unknown', lastChecked: new Date(), consecutiveFailures: 0 },
        latencyMs: 0,
        successRate: 0.98,
        costPer1kTokens: 0.002,
        isEnabled: true
      },
      {
        id: 'deepseek',
        alias: 'ds',
        name: 'DeepSeek',
        type: 'apikey',
        baseUrl: 'https://api.deepseek.com/v1',
        authType: 'bearer',
        authHeader: 'Authorization',
        models: [
          { id: 'deepseek-chat', name: 'DeepSeek Chat', contextWindow: 64000, maxTokens: 8192, supportsStreaming: true, supportsVision: false, supportsTools: true, supportsThinking: true, costPer1kInput: 0.00027, costPer1kOutput: 0.0011 },
          { id: 'deepseek-reasoner', name: 'DeepSeek Reasoner', contextWindow: 64000, maxTokens: 8192, supportsStreaming: true, supportsVision: false, supportsTools: true, supportsThinking: true, costPer1kInput: 0.00055, costPer1kOutput: 0.00219 }
        ],
        capabilities: ['llm'],
        healthStatus: { status: 'unknown', lastChecked: new Date(), consecutiveFailures: 0 },
        latencyMs: 0,
        successRate: 0.97,
        costPer1kTokens: 0.001,
        isEnabled: true
      },
      {
        id: 'gemini',
        alias: 'gem',
        name: 'Gemini',
        type: 'apikey',
        baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
        authType: 'apikey',
        authHeader: 'key',
        models: [
          { id: 'gemini-2.5-pro', name: 'Gemini 2.5 Pro', contextWindow: 1000000, maxTokens: 65536, supportsStreaming: true, supportsVision: true, supportsTools: true, supportsThinking: true, costPer1kInput: 0.00125, costPer1kOutput: 0.01 },
          { id: 'gemini-2.5-flash', name: 'Gemini 2.5 Flash', contextWindow: 1000000, maxTokens: 8192, supportsStreaming: true, supportsVision: true, supportsTools: true, supportsThinking: false, costPer1kInput: 0.00015, costPer1kOutput: 0.0006 }
        ],
        capabilities: ['llm', 'embedding', 'image', 'imageToText', 'tts', 'stt'],
        healthStatus: { status: 'unknown', lastChecked: new Date(), consecutiveFailures: 0 },
        latencyMs: 0,
        successRate: 0.98,
        costPer1kTokens: 0.003,
        isEnabled: true
      },
      {
        id: 'anthropic',
        alias: 'anth',
        name: 'Anthropic',
        type: 'apikey',
        baseUrl: 'https://api.anthropic.com/v1',
        authType: 'bearer',
        authHeader: 'x-api-key',
        models: [
          { id: 'claude-sonnet-4-20250514', name: 'Claude Sonnet 4', contextWindow: 200000, maxTokens: 8192, supportsStreaming: true, supportsVision: true, supportsTools: true, supportsThinking: true, costPer1kInput: 0.003, costPer1kOutput: 0.015 },
          { id: 'claude-opus-4-20250514', name: 'Claude Opus 4', contextWindow: 200000, maxTokens: 8192, supportsStreaming: true, supportsVision: true, supportsTools: true, supportsThinking: true, costPer1kInput: 0.015, costPer1kOutput: 0.075 }
        ],
        capabilities: ['llm', 'imageToText'],
        healthStatus: { status: 'unknown', lastChecked: new Date(), consecutiveFailures: 0 },
        latencyMs: 0,
        successRate: 0.99,
        costPer1kTokens: 0.01,
        isEnabled: true
      }
    ];

    providers.forEach(p => this.providers.set(p.id, p));
  }

  getProvider(id: string): Provider | undefined {
    return this.providers.get(id);
  }

  getAllProviders(): Provider[] {
    return Array.from(this.providers.values());
  }

  getEnabledProviders(): Provider[] {
    return this.getAllProviders().filter(p => p.isEnabled);
  }

  getProvidersByCapability(capability: string): Provider[] {
    return this.getEnabledProviders().filter(p => 
      p.capabilities.includes(capability as any)
    );
  }

  getModel(providerId: string, modelId: string): Model | undefined {
    const provider = this.getProvider(providerId);
    return provider?.models.find(m => m.id === modelId);
  }

  async addProvider(provider: Provider): Promise<void> {
    this.providers.set(provider.id, provider);
  }

  async updateProvider(id: string, updates: Partial<Provider>): Promise<void> {
    const existing = this.providers.get(id);
    if (existing) {
      this.providers.set(id, { ...existing, ...updates });
    }
  }

  async removeProvider(id: string): Promise<void> {
    this.providers.delete(id);
  }

  getPlugins(): PluginManifest[] {
    return this.plugins;
  }

  async installPlugin(manifest: PluginManifest): Promise<void> {
    this.plugins.push(manifest);
    // Would dynamically load the plugin entry point here
  }
}

export const pluginManager = new PluginManager();
