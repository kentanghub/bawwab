import type { Provider, PluginManifest, Model } from '../types/index.js';
import { logger } from '../services/logger.js';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

class PluginManager {
  private providers: Map<string, Provider> = new Map();
  private plugins: PluginManifest[] = [];

  async loadPlugins(): Promise<void> {
    // Built-in providers
    this.registerBuiltInProviders();

    // Load custom providers from JSON config
    this.loadCustomProvidersFromConfig();

    // Load external plugins from plugins directory
    try {
      const pluginDir = process.env.PLUGIN_DIR || './plugins/external';
      // Dynamic import would go here for external plugins
    } catch (err) {
      logger.info('No external plugins found');
    }
  }

  private loadCustomProvidersFromConfig(): void {
    const configPaths = [
      process.env.PROVIDERS_CONFIG_PATH,
      join(process.cwd(), 'config', 'providers.json'),
      join(process.cwd(), 'providers.json'),
      join(process.cwd(), '..', 'config', 'providers.json')
    ].filter(Boolean) as string[];

    for (const configPath of configPaths) {
      if (!existsSync(configPath)) continue;

      try {
        const raw = readFileSync(configPath, 'utf-8');
        const config = JSON.parse(raw);

        if (!Array.isArray(config.providers)) {
          logger.warn(`Invalid providers config at ${configPath}: "providers" must be an array`);
          continue;
        }

        for (const p of config.providers) {
          const provider = this.normalizeProvider(p);
          if (provider) {
            this.providers.set(provider.id, provider);
            logger.info(`Loaded custom provider from config: ${provider.id} (${provider.name})`);
          }
        }

        logger.info(`Loaded ${config.providers.length} custom provider(s) from ${configPath}`);
        break; // Stop after first found config
      } catch (err: any) {
        logger.warn(`Failed to load providers config from ${configPath}: ${err.message}`);
      }
    }
  }

  private normalizeProvider(raw: any): Provider | null {
    if (!raw.id || !raw.name || !raw.baseUrl) {
      logger.warn('Skipping invalid provider config: missing id, name, or baseUrl');
      return null;
    }

    // Validate URL to prevent SSRF
    try {
      const url = new URL(raw.baseUrl);
      if (!['http:', 'https:'].includes(url.protocol)) {
        logger.warn(`Invalid protocol for provider ${raw.id}: ${url.protocol}`);
        return null;
      }
    } catch {
      logger.warn(`Invalid baseUrl for provider ${raw.id}: ${raw.baseUrl}`);
      return null;
    }

    const now = new Date();
    return {
      id: String(raw.id).toLowerCase().replace(/[^a-z0-9_-]/g, ''),
      alias: String(raw.alias || raw.id).toLowerCase(),
      name: String(raw.name),
      type: ['free', 'apikey', 'oauth', 'cookie'].includes(raw.type) ? raw.type : 'apikey',
      baseUrl: raw.baseUrl,
      authType: ['none', 'bearer', 'apikey', 'cookie'].includes(raw.authType) ? raw.authType : 'none',
      authHeader: raw.authHeader ? String(raw.authHeader) : undefined,
      models: Array.isArray(raw.models) ? raw.models.map((m: any) => ({
        id: String(m.id),
        name: String(m.name || m.id),
        contextWindow: Number(m.contextWindow) || 128000,
        maxTokens: Number(m.maxTokens) || 4096,
        supportsStreaming: Boolean(m.supportsStreaming),
        supportsVision: Boolean(m.supportsVision),
        supportsTools: Boolean(m.supportsTools),
        supportsThinking: Boolean(m.supportsThinking),
        costPer1kInput: Number(m.costPer1kInput) || 0,
        costPer1kOutput: Number(m.costPer1kOutput) || 0
      })) : [],
      capabilities: Array.isArray(raw.capabilities) ? raw.capabilities : ['llm'],
      healthStatus: { status: 'unknown', lastChecked: now, consecutiveFailures: 0 },
      latencyMs: 0,
      successRate: Number(raw.successRate) || 0.99,
      costPer1kTokens: Number(raw.costPer1kTokens) || 0,
      isEnabled: raw.isEnabled !== false
    };
  }

  private registerBuiltInProviders(): void {
    const providers: Provider[] = [
      // Free providers
      {
        id: 'kiro',
        alias: 'kr',
        name: 'Kiro AI',
        type: 'cookie',
        baseUrl: 'https://api.kiro.dev',
        authType: 'cookie',
        models: [
          { id: 'kr/claude-sonnet-4', name: 'Claude Sonnet 4', contextWindow: 200000, maxTokens: 8192, supportsStreaming: true, supportsVision: true, supportsTools: true, supportsThinking: false, costPer1kInput: 0, costPer1kOutput: 0 },
          { id: 'kr/claude-sonnet-4.5', name: 'Claude Sonnet 4.5', contextWindow: 200000, maxTokens: 8192, supportsStreaming: true, supportsVision: true, supportsTools: true, supportsThinking: false, costPer1kInput: 0, costPer1kOutput: 0 }
        ],
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
        id: 'openai',
        alias: 'oa',
        name: 'OpenAI',
        type: 'apikey',
        baseUrl: 'https://api.openai.com/v1',
        authType: 'bearer',
        authHeader: 'Authorization',
        models: [
          { id: 'gpt-4o', name: 'GPT-4o', contextWindow: 128000, maxTokens: 16384, supportsStreaming: true, supportsVision: true, supportsTools: true, supportsThinking: false, costPer1kInput: 0.005, costPer1kOutput: 0.015 },
          { id: 'gpt-4o-mini', name: 'GPT-4o Mini', contextWindow: 128000, maxTokens: 16384, supportsStreaming: true, supportsVision: true, supportsTools: true, supportsThinking: false, costPer1kInput: 0.00015, costPer1kOutput: 0.0006 },
          { id: 'text-embedding-3-small', name: 'Embedding 3 Small', contextWindow: 8191, maxTokens: 8191, supportsStreaming: false, supportsVision: false, supportsTools: false, supportsThinking: false, costPer1kInput: 0.00002, costPer1kOutput: 0 },
          { id: 'text-embedding-3-large', name: 'Embedding 3 Large', contextWindow: 8191, maxTokens: 8191, supportsStreaming: false, supportsVision: false, supportsTools: false, supportsThinking: false, costPer1kInput: 0.00013, costPer1kOutput: 0 },
          { id: 'dall-e-3', name: 'DALL-E 3', contextWindow: 0, maxTokens: 0, supportsStreaming: false, supportsVision: false, supportsTools: false, supportsThinking: false, costPer1kInput: 0, costPer1kOutput: 0 },
          { id: 'tts-1', name: 'TTS-1', contextWindow: 0, maxTokens: 0, supportsStreaming: false, supportsVision: false, supportsTools: false, supportsThinking: false, costPer1kInput: 0.015, costPer1kOutput: 0 },
          { id: 'whisper-1', name: 'Whisper-1', contextWindow: 0, maxTokens: 0, supportsStreaming: false, supportsVision: false, supportsTools: false, supportsThinking: false, costPer1kInput: 0.006, costPer1kOutput: 0 }
        ],
        capabilities: ['llm', 'embedding', 'image', 'imageToText', 'tts', 'stt'],
        healthStatus: { status: 'unknown', lastChecked: new Date(), consecutiveFailures: 0 },
        latencyMs: 0,
        successRate: 0.99,
        costPer1kTokens: 0.01,
        isEnabled: true
      },
      {
        id: 'pollinations',
        alias: 'poll',
        name: 'Pollinations AI',
        type: 'free',
        baseUrl: 'https://image.pollinations.ai',
        authType: 'none',
        models: [
          { id: 'flux', name: 'Flux', contextWindow: 0, maxTokens: 0, supportsStreaming: false, supportsVision: false, supportsTools: false, supportsThinking: false, costPer1kInput: 0, costPer1kOutput: 0 },
          { id: 'turbo', name: 'Turbo', contextWindow: 0, maxTokens: 0, supportsStreaming: false, supportsVision: false, supportsTools: false, supportsThinking: false, costPer1kInput: 0, costPer1kOutput: 0 }
        ],
        capabilities: ['image'],
        healthStatus: { status: 'unknown', lastChecked: new Date(), consecutiveFailures: 0 },
        latencyMs: 0,
        successRate: 0.95,
        costPer1kTokens: 0,
        isEnabled: true
      },
      {
        id: 'jina',
        alias: 'jn',
        name: 'Jina AI',
        type: 'apikey',
        baseUrl: 'https://r.jina.ai/http',
        authType: 'bearer',
        authHeader: 'Authorization',
        models: [
          { id: 'jina-embeddings-v3', name: 'Jina Embeddings v3', contextWindow: 8192, maxTokens: 8192, supportsStreaming: false, supportsVision: false, supportsTools: false, supportsThinking: false, costPer1kInput: 0.00002, costPer1kOutput: 0 }
        ],
        capabilities: ['embedding', 'webFetch'],
        healthStatus: { status: 'unknown', lastChecked: new Date(), consecutiveFailures: 0 },
        latencyMs: 0,
        successRate: 0.97,
        costPer1kTokens: 0.00002,
        isEnabled: true
      },
      {
        id: 'tavily',
        alias: 'tv',
        name: 'Tavily Search',
        type: 'apikey',
        baseUrl: 'https://api.tavily.com',
        authType: 'bearer',
        authHeader: 'Authorization',
        models: [],
        capabilities: ['webSearch'],
        healthStatus: { status: 'unknown', lastChecked: new Date(), consecutiveFailures: 0 },
        latencyMs: 0,
        successRate: 0.95,
        costPer1kTokens: 0,
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
      },
      // New providers (Week 1 expansion)
      {
        id: 'groq',
        alias: 'gq',
        name: 'Groq',
        type: 'apikey',
        baseUrl: 'https://api.groq.com/openai/v1',
        authType: 'bearer',
        authHeader: 'Authorization',
        models: [
          { id: 'llama-3.3-70b-versatile', name: 'Llama 3.3 70B', contextWindow: 128000, maxTokens: 32768, supportsStreaming: true, supportsVision: false, supportsTools: true, supportsThinking: false, costPer1kInput: 0.00059, costPer1kOutput: 0.00079 },
          { id: 'mixtral-8x7b-32768', name: 'Mixtral 8x7B', contextWindow: 32768, maxTokens: 32768, supportsStreaming: true, supportsVision: false, supportsTools: true, supportsThinking: false, costPer1kInput: 0.00024, costPer1kOutput: 0.00024 },
          { id: 'gemma2-9b-it', name: 'Gemma 2 9B', contextWindow: 8192, maxTokens: 8192, supportsStreaming: true, supportsVision: false, supportsTools: false, supportsThinking: false, costPer1kInput: 0.0002, costPer1kOutput: 0.0002 }
        ],
        capabilities: ['llm'],
        healthStatus: { status: 'unknown', lastChecked: new Date(), consecutiveFailures: 0 },
        latencyMs: 0,
        successRate: 0.98,
        costPer1kTokens: 0.0005,
        isEnabled: true
      },
      {
        id: 'xai',
        alias: 'xai',
        name: 'xAI',
        type: 'apikey',
        baseUrl: 'https://api.x.ai/v1',
        authType: 'bearer',
        authHeader: 'Authorization',
        models: [
          { id: 'grok-2', name: 'Grok 2', contextWindow: 131072, maxTokens: 8192, supportsStreaming: true, supportsVision: true, supportsTools: true, supportsThinking: false, costPer1kInput: 0.002, costPer1kOutput: 0.01 },
          { id: 'grok-2-vision', name: 'Grok 2 Vision', contextWindow: 32768, maxTokens: 8192, supportsStreaming: true, supportsVision: true, supportsTools: true, supportsThinking: false, costPer1kInput: 0.002, costPer1kOutput: 0.01 }
        ],
        capabilities: ['llm', 'imageToText'],
        healthStatus: { status: 'unknown', lastChecked: new Date(), consecutiveFailures: 0 },
        latencyMs: 0,
        successRate: 0.97,
        costPer1kTokens: 0.005,
        isEnabled: true
      },
      {
        id: 'mistral',
        alias: 'ms',
        name: 'Mistral AI',
        type: 'apikey',
        baseUrl: 'https://api.mistral.ai/v1',
        authType: 'bearer',
        authHeader: 'Authorization',
        models: [
          { id: 'mistral-large-latest', name: 'Mistral Large', contextWindow: 128000, maxTokens: 8192, supportsStreaming: true, supportsVision: false, supportsTools: true, supportsThinking: false, costPer1kInput: 0.002, costPer1kOutput: 0.006 },
          { id: 'mistral-medium-latest', name: 'Mistral Medium', contextWindow: 32000, maxTokens: 8192, supportsStreaming: true, supportsVision: false, supportsTools: true, supportsThinking: false, costPer1kInput: 0.0006, costPer1kOutput: 0.0018 },
          { id: 'codestral-latest', name: 'Codestral', contextWindow: 32000, maxTokens: 8192, supportsStreaming: true, supportsVision: false, supportsTools: true, supportsThinking: false, costPer1kInput: 0.0002, costPer1kOutput: 0.0006 }
        ],
        capabilities: ['llm'],
        healthStatus: { status: 'unknown', lastChecked: new Date(), consecutiveFailures: 0 },
        latencyMs: 0,
        successRate: 0.97,
        costPer1kTokens: 0.002,
        isEnabled: true
      },
      {
        id: 'together',
        alias: 'tg',
        name: 'Together AI',
        type: 'apikey',
        baseUrl: 'https://api.together.xyz/v1',
        authType: 'bearer',
        authHeader: 'Authorization',
        models: [
          { id: 'meta-llama/Llama-3.3-70B-Instruct-Turbo', name: 'Llama 3.3 70B Turbo', contextWindow: 128000, maxTokens: 4096, supportsStreaming: true, supportsVision: false, supportsTools: true, supportsThinking: false, costPer1kInput: 0.00088, costPer1kOutput: 0.00088 },
          { id: 'mistralai/Mixtral-8x22B-Instruct-v0.1', name: 'Mixtral 8x22B', contextWindow: 65536, maxTokens: 4096, supportsStreaming: true, supportsVision: false, supportsTools: true, supportsThinking: false, costPer1kInput: 0.0012, costPer1kOutput: 0.0012 }
        ],
        capabilities: ['llm'],
        healthStatus: { status: 'unknown', lastChecked: new Date(), consecutiveFailures: 0 },
        latencyMs: 0,
        successRate: 0.96,
        costPer1kTokens: 0.001,
        isEnabled: true
      },
      {
        id: 'fireworks',
        alias: 'fw',
        name: 'Fireworks AI',
        type: 'apikey',
        baseUrl: 'https://api.fireworks.ai/inference/v1',
        authType: 'bearer',
        authHeader: 'Authorization',
        models: [
          { id: 'accounts/fireworks/models/llama-v3p3-70b-instruct', name: 'Llama 3.3 70B', contextWindow: 128000, maxTokens: 4096, supportsStreaming: true, supportsVision: false, supportsTools: true, supportsThinking: false, costPer1kInput: 0.0009, costPer1kOutput: 0.0009 },
          { id: 'accounts/fireworks/models/deepseek-v3', name: 'DeepSeek V3', contextWindow: 64000, maxTokens: 4096, supportsStreaming: true, supportsVision: false, supportsTools: true, supportsThinking: true, costPer1kInput: 0.0009, costPer1kOutput: 0.0009 }
        ],
        capabilities: ['llm'],
        healthStatus: { status: 'unknown', lastChecked: new Date(), consecutiveFailures: 0 },
        latencyMs: 0,
        successRate: 0.96,
        costPer1kTokens: 0.001,
        isEnabled: true
      },
      {
        id: 'cohere',
        alias: 'ch',
        name: 'Cohere',
        type: 'apikey',
        baseUrl: 'https://api.cohere.ai/v1',
        authType: 'bearer',
        authHeader: 'Authorization',
        models: [
          { id: 'command-r-plus', name: 'Command R+', contextWindow: 128000, maxTokens: 4096, supportsStreaming: true, supportsVision: false, supportsTools: true, supportsThinking: false, costPer1kInput: 0.003, costPer1kOutput: 0.015 },
          { id: 'command-r', name: 'Command R', contextWindow: 128000, maxTokens: 4096, supportsStreaming: true, supportsVision: false, supportsTools: true, supportsThinking: false, costPer1kInput: 0.0005, costPer1kOutput: 0.0015 }
        ],
        capabilities: ['llm'],
        healthStatus: { status: 'unknown', lastChecked: new Date(), consecutiveFailures: 0 },
        latencyMs: 0,
        successRate: 0.97,
        costPer1kTokens: 0.005,
        isEnabled: true
      },
      {
        id: 'perplexity',
        alias: 'pp',
        name: 'Perplexity',
        type: 'apikey',
        baseUrl: 'https://api.perplexity.ai',
        authType: 'bearer',
        authHeader: 'Authorization',
        models: [
          { id: 'llama-3.1-sonar-large-128k-online', name: 'Sonar Large 128K', contextWindow: 128000, maxTokens: 4096, supportsStreaming: true, supportsVision: false, supportsTools: false, supportsThinking: false, costPer1kInput: 0.001, costPer1kOutput: 0.001 },
          { id: 'llama-3.1-sonar-small-128k-online', name: 'Sonar Small 128K', contextWindow: 128000, maxTokens: 4096, supportsStreaming: true, supportsVision: false, supportsTools: false, supportsThinking: false, costPer1kInput: 0.0002, costPer1kOutput: 0.0002 }
        ],
        capabilities: ['llm', 'webSearch'],
        healthStatus: { status: 'unknown', lastChecked: new Date(), consecutiveFailures: 0 },
        latencyMs: 0,
        successRate: 0.96,
        costPer1kTokens: 0.001,
        isEnabled: true
      },
      {
        id: 'nvidia',
        alias: 'nv',
        name: 'NVIDIA',
        type: 'apikey',
        baseUrl: 'https://integrate.api.nvidia.com/v1',
        authType: 'bearer',
        authHeader: 'Authorization',
        models: [
          { id: 'nvidia/llama-3.1-nemotron-70b-instruct', name: 'Nemotron 70B', contextWindow: 128000, maxTokens: 4096, supportsStreaming: true, supportsVision: false, supportsTools: true, supportsThinking: false, costPer1kInput: 0.0007, costPer1kOutput: 0.0007 }
        ],
        capabilities: ['llm'],
        healthStatus: { status: 'unknown', lastChecked: new Date(), consecutiveFailures: 0 },
        latencyMs: 0,
        successRate: 0.96,
        costPer1kTokens: 0.001,
        isEnabled: true
      },
      {
        id: 'kimi',
        alias: 'km',
        name: 'Kimi',
        type: 'apikey',
        baseUrl: 'https://api.moonshot.cn/v1',
        authType: 'bearer',
        authHeader: 'Authorization',
        models: [
          { id: 'kimi-k2', name: 'Kimi K2', contextWindow: 256000, maxTokens: 8192, supportsStreaming: true, supportsVision: true, supportsTools: true, supportsThinking: true, costPer1kInput: 0.001, costPer1kOutput: 0.003 }
        ],
        capabilities: ['llm'],
        healthStatus: { status: 'unknown', lastChecked: new Date(), consecutiveFailures: 0 },
        latencyMs: 0,
        successRate: 0.97,
        costPer1kTokens: 0.002,
        isEnabled: true
      },
      {
        id: 'minimax',
        alias: 'mm',
        name: 'MiniMax',
        type: 'apikey',
        baseUrl: 'https://api.minimaxi.chat/v1',
        authType: 'bearer',
        authHeader: 'Authorization',
        models: [
          { id: 'MiniMax-Text-01', name: 'MiniMax Text', contextWindow: 1000000, maxTokens: 8192, supportsStreaming: true, supportsVision: false, supportsTools: true, supportsThinking: false, costPer1kInput: 0.0001, costPer1kOutput: 0.0001 }
        ],
        capabilities: ['llm'],
        healthStatus: { status: 'unknown', lastChecked: new Date(), consecutiveFailures: 0 },
        latencyMs: 0,
        successRate: 0.96,
        costPer1kTokens: 0.0002,
        isEnabled: true
      },
      {
        id: 'siliconflow',
        alias: 'sf',
        name: 'SiliconFlow',
        type: 'apikey',
        baseUrl: 'https://api.siliconflow.cn/v1',
        authType: 'bearer',
        authHeader: 'Authorization',
        models: [
          { id: 'deepseek-ai/DeepSeek-V3', name: 'DeepSeek V3', contextWindow: 64000, maxTokens: 4096, supportsStreaming: true, supportsVision: false, supportsTools: true, supportsThinking: true, costPer1kInput: 0.00014, costPer1kOutput: 0.00028 },
          { id: 'Qwen/Qwen2.5-72B-Instruct', name: 'Qwen 2.5 72B', contextWindow: 32768, maxTokens: 4096, supportsStreaming: true, supportsVision: false, supportsTools: true, supportsThinking: false, costPer1kInput: 0.0004, costPer1kOutput: 0.0004 }
        ],
        capabilities: ['llm'],
        healthStatus: { status: 'unknown', lastChecked: new Date(), consecutiveFailures: 0 },
        latencyMs: 0,
        successRate: 0.96,
        costPer1kTokens: 0.0005,
        isEnabled: true
      },
      {
        id: 'cerebras',
        alias: 'cb',
        name: 'Cerebras',
        type: 'apikey',
        baseUrl: 'https://api.cerebras.ai/v1',
        authType: 'bearer',
        authHeader: 'Authorization',
        models: [
          { id: 'llama-3.3-70b', name: 'Llama 3.3 70B', contextWindow: 128000, maxTokens: 4096, supportsStreaming: true, supportsVision: false, supportsTools: true, supportsThinking: false, costPer1kInput: 0.0006, costPer1kOutput: 0.0006 }
        ],
        capabilities: ['llm'],
        healthStatus: { status: 'unknown', lastChecked: new Date(), consecutiveFailures: 0 },
        latencyMs: 0,
        successRate: 0.95,
        costPer1kTokens: 0.001,
        isEnabled: true
      },
      {
        id: 'nebius',
        alias: 'nb',
        name: 'Nebius AI',
        type: 'apikey',
        baseUrl: 'https://api.studio.nebius.ai/v1',
        authType: 'bearer',
        authHeader: 'Authorization',
        models: [
          { id: 'meta-llama/Meta-Llama-3.1-70B-Instruct', name: 'Llama 3.1 70B', contextWindow: 128000, maxTokens: 4096, supportsStreaming: true, supportsVision: false, supportsTools: true, supportsThinking: false, costPer1kInput: 0.0003, costPer1kOutput: 0.0003 }
        ],
        capabilities: ['llm'],
        healthStatus: { status: 'unknown', lastChecked: new Date(), consecutiveFailures: 0 },
        latencyMs: 0,
        successRate: 0.95,
        costPer1kTokens: 0.0005,
        isEnabled: true
      },
      {
        id: 'chutes',
        alias: 'ct',
        name: 'Chutes',
        type: 'apikey',
        baseUrl: 'https://llm.chutes.ai/v1',
        authType: 'bearer',
        authHeader: 'Authorization',
        models: [
          { id: 'chutesai/Llama-3.3-70B-Instruct', name: 'Llama 3.3 70B', contextWindow: 128000, maxTokens: 4096, supportsStreaming: true, supportsVision: false, supportsTools: true, supportsThinking: false, costPer1kInput: 0.0002, costPer1kOutput: 0.0002 }
        ],
        capabilities: ['llm'],
        healthStatus: { status: 'unknown', lastChecked: new Date(), consecutiveFailures: 0 },
        latencyMs: 0,
        successRate: 0.95,
        costPer1kTokens: 0.0003,
        isEnabled: true
      },
      {
        id: 'hyperbolic',
        alias: 'hb',
        name: 'Hyperbolic',
        type: 'apikey',
        baseUrl: 'https://api.hyperbolic.xyz/v1',
        authType: 'bearer',
        authHeader: 'Authorization',
        models: [
          { id: 'meta-llama/Meta-Llama-3.1-70B-Instruct', name: 'Llama 3.1 70B', contextWindow: 128000, maxTokens: 4096, supportsStreaming: true, supportsVision: false, supportsTools: true, supportsThinking: false, costPer1kInput: 0.0004, costPer1kOutput: 0.0004 }
        ],
        capabilities: ['llm'],
        healthStatus: { status: 'unknown', lastChecked: new Date(), consecutiveFailures: 0 },
        latencyMs: 0,
        successRate: 0.95,
        costPer1kTokens: 0.0005,
        isEnabled: true
      },
      // Batch 2: Provider expansion to exceed 9router
      {
        id: 'qwen',
        alias: 'qw',
        name: 'Qwen',
        type: 'apikey',
        baseUrl: 'https://portal.qwen.ai/v1',
        authType: 'bearer',
        authHeader: 'Authorization',
        models: [
          { id: 'qwen-max', name: 'Qwen Max', contextWindow: 32000, maxTokens: 8192, supportsStreaming: true, supportsVision: true, supportsTools: true, supportsThinking: true, costPer1kInput: 0.002, costPer1kOutput: 0.006 },
          { id: 'qwen-plus', name: 'Qwen Plus', contextWindow: 128000, maxTokens: 8192, supportsStreaming: true, supportsVision: true, supportsTools: true, supportsThinking: false, costPer1kInput: 0.0008, costPer1kOutput: 0.002 }
        ],
        capabilities: ['llm'],
        healthStatus: { status: 'unknown', lastChecked: new Date(), consecutiveFailures: 0 },
        latencyMs: 0,
        successRate: 0.96,
        costPer1kTokens: 0.001,
        isEnabled: true
      },
      {
        id: 'alicode',
        alias: 'ac',
        name: 'AliCode',
        type: 'apikey',
        baseUrl: 'https://coding.dashscope.aliyuncs.com/v1',
        authType: 'bearer',
        authHeader: 'Authorization',
        models: [
          { id: 'qwen-coder-plus', name: 'Qwen Coder Plus', contextWindow: 128000, maxTokens: 8192, supportsStreaming: true, supportsVision: false, supportsTools: true, supportsThinking: false, costPer1kInput: 0.0005, costPer1kOutput: 0.0015 }
        ],
        capabilities: ['llm'],
        healthStatus: { status: 'unknown', lastChecked: new Date(), consecutiveFailures: 0 },
        latencyMs: 0,
        successRate: 0.96,
        costPer1kTokens: 0.001,
        isEnabled: true
      },
      {
        id: 'alicode-intl',
        alias: 'aci',
        name: 'AliCode Intl',
        type: 'apikey',
        baseUrl: 'https://coding-intl.dashscope.aliyuncs.com/v1',
        authType: 'bearer',
        authHeader: 'Authorization',
        models: [
          { id: 'qwen-coder-plus-latest', name: 'Qwen Coder Plus Intl', contextWindow: 128000, maxTokens: 8192, supportsStreaming: true, supportsVision: false, supportsTools: true, supportsThinking: false, costPer1kInput: 0.0005, costPer1kOutput: 0.0015 }
        ],
        capabilities: ['llm'],
        healthStatus: { status: 'unknown', lastChecked: new Date(), consecutiveFailures: 0 },
        latencyMs: 0,
        successRate: 0.96,
        costPer1kTokens: 0.001,
        isEnabled: true
      },
      {
        id: 'volcengine',
        alias: 've',
        name: 'Volcengine Ark',
        type: 'apikey',
        baseUrl: 'https://ark.cn-beijing.volces.com/api/coding/v3',
        authType: 'bearer',
        authHeader: 'Authorization',
        models: [
          { id: 'doubao-pro-128k', name: 'Doubao Pro 128K', contextWindow: 128000, maxTokens: 4096, supportsStreaming: true, supportsVision: false, supportsTools: true, supportsThinking: false, costPer1kInput: 0.0005, costPer1kOutput: 0.001 }
        ],
        capabilities: ['llm'],
        healthStatus: { status: 'unknown', lastChecked: new Date(), consecutiveFailures: 0 },
        latencyMs: 0,
        successRate: 0.95,
        costPer1kTokens: 0.001,
        isEnabled: true
      },
      {
        id: 'byteplus',
        alias: 'bp',
        name: 'BytePlus',
        type: 'apikey',
        baseUrl: 'https://ark.ap-southeast.bytepluses.com/api/coding/v3',
        authType: 'bearer',
        authHeader: 'Authorization',
        models: [
          { id: 'doubao-pro-128k', name: 'Doubao Pro 128K', contextWindow: 128000, maxTokens: 4096, supportsStreaming: true, supportsVision: false, supportsTools: true, supportsThinking: false, costPer1kInput: 0.0005, costPer1kOutput: 0.001 }
        ],
        capabilities: ['llm'],
        healthStatus: { status: 'unknown', lastChecked: new Date(), consecutiveFailures: 0 },
        latencyMs: 0,
        successRate: 0.95,
        costPer1kTokens: 0.001,
        isEnabled: true
      },
      {
        id: 'kilocode',
        alias: 'kc',
        name: 'KiloCode',
        type: 'apikey',
        baseUrl: 'https://api.kilo.ai/api/openrouter',
        authType: 'bearer',
        authHeader: 'Authorization',
        models: [
          { id: 'openrouter/auto', name: 'Auto Router', contextWindow: 128000, maxTokens: 4096, supportsStreaming: true, supportsVision: false, supportsTools: true, supportsThinking: false, costPer1kInput: 0.001, costPer1kOutput: 0.003 }
        ],
        capabilities: ['llm'],
        healthStatus: { status: 'unknown', lastChecked: new Date(), consecutiveFailures: 0 },
        latencyMs: 0,
        successRate: 0.95,
        costPer1kTokens: 0.002,
        isEnabled: true
      },
      {
        id: 'nanobanana',
        alias: 'nbn',
        name: 'NanoBanana',
        type: 'apikey',
        baseUrl: 'https://api.nanobananaapi.ai/v1',
        authType: 'bearer',
        authHeader: 'Authorization',
        models: [
          { id: 'nb-llama-3.3-70b', name: 'NB Llama 3.3 70B', contextWindow: 128000, maxTokens: 4096, supportsStreaming: true, supportsVision: false, supportsTools: true, supportsThinking: false, costPer1kInput: 0.0001, costPer1kOutput: 0.0001 }
        ],
        capabilities: ['llm'],
        healthStatus: { status: 'unknown', lastChecked: new Date(), consecutiveFailures: 0 },
        latencyMs: 0,
        successRate: 0.94,
        costPer1kTokens: 0.0002,
        isEnabled: true
      },
      {
        id: 'commandcode',
        alias: 'cc',
        name: 'CommandCode',
        type: 'apikey',
        baseUrl: 'https://api.commandcode.ai/alpha',
        authType: 'bearer',
        authHeader: 'Authorization',
        models: [
          { id: 'commandcode-v1', name: 'CommandCode v1', contextWindow: 128000, maxTokens: 4096, supportsStreaming: true, supportsVision: false, supportsTools: true, supportsThinking: false, costPer1kInput: 0.001, costPer1kOutput: 0.003 }
        ],
        capabilities: ['llm'],
        healthStatus: { status: 'unknown', lastChecked: new Date(), consecutiveFailures: 0 },
        latencyMs: 0,
        successRate: 0.95,
        costPer1kTokens: 0.002,
        isEnabled: true
      },
      {
        id: 'azure',
        alias: 'az',
        name: 'Azure OpenAI',
        type: 'apikey',
        baseUrl: 'https://{resource}.openai.azure.com/openai/deployments/{deployment}',
        authType: 'bearer',
        authHeader: 'api-key',
        models: [
          { id: 'gpt-4o', name: 'GPT-4o', contextWindow: 128000, maxTokens: 4096, supportsStreaming: true, supportsVision: true, supportsTools: true, supportsThinking: false, costPer1kInput: 0.005, costPer1kOutput: 0.015 },
          { id: 'gpt-4o-mini', name: 'GPT-4o Mini', contextWindow: 128000, maxTokens: 4096, supportsStreaming: true, supportsVision: true, supportsTools: true, supportsThinking: false, costPer1kInput: 0.00015, costPer1kOutput: 0.0006 }
        ],
        capabilities: ['llm'],
        healthStatus: { status: 'unknown', lastChecked: new Date(), consecutiveFailures: 0 },
        latencyMs: 0,
        successRate: 0.98,
        costPer1kTokens: 0.005,
        isEnabled: true
      },
      {
        id: 'cloudflare',
        alias: 'cf',
        name: 'Cloudflare AI',
        type: 'apikey',
        baseUrl: 'https://api.cloudflare.com/client/v4/accounts/{accountId}/ai/v1',
        authType: 'bearer',
        authHeader: 'Authorization',
        models: [
          { id: '@cf/meta/llama-3.3-70b-instruct', name: 'Llama 3.3 70B', contextWindow: 32000, maxTokens: 4096, supportsStreaming: true, supportsVision: false, supportsTools: true, supportsThinking: false, costPer1kInput: 0.0001, costPer1kOutput: 0.0001 }
        ],
        capabilities: ['llm'],
        healthStatus: { status: 'unknown', lastChecked: new Date(), consecutiveFailures: 0 },
        latencyMs: 0,
        successRate: 0.96,
        costPer1kTokens: 0.0002,
        isEnabled: true
      },
      {
        id: 'gitlab',
        alias: 'gl',
        name: 'GitLab Duo',
        type: 'apikey',
        baseUrl: 'https://gitlab.com/api/v4',
        authType: 'bearer',
        authHeader: 'Authorization',
        models: [
          { id: 'gitlab-duo-chat', name: 'GitLab Duo Chat', contextWindow: 32000, maxTokens: 4096, supportsStreaming: true, supportsVision: false, supportsTools: false, supportsThinking: false, costPer1kInput: 0.001, costPer1kOutput: 0.003 }
        ],
        capabilities: ['llm'],
        healthStatus: { status: 'unknown', lastChecked: new Date(), consecutiveFailures: 0 },
        latencyMs: 0,
        successRate: 0.95,
        costPer1kTokens: 0.002,
        isEnabled: true
      },
      {
        id: 'codebuddy',
        alias: 'cb',
        name: 'CodeBuddy (Tencent)',
        type: 'apikey',
        baseUrl: 'https://copilot.tencent.com/v1',
        authType: 'bearer',
        authHeader: 'Authorization',
        models: [
          { id: 'codebuddy-v1', name: 'CodeBuddy v1', contextWindow: 32000, maxTokens: 4096, supportsStreaming: true, supportsVision: false, supportsTools: true, supportsThinking: false, costPer1kInput: 0.001, costPer1kOutput: 0.002 }
        ],
        capabilities: ['llm'],
        healthStatus: { status: 'unknown', lastChecked: new Date(), consecutiveFailures: 0 },
        latencyMs: 0,
        successRate: 0.95,
        costPer1kTokens: 0.0015,
        isEnabled: true
      },
      {
        id: 'xiaomi-mimo',
        alias: 'xm',
        name: 'Xiaomi MiMo',
        type: 'apikey',
        baseUrl: 'https://api.xiaomimimo.com/v1',
        authType: 'bearer',
        authHeader: 'Authorization',
        models: [
          { id: 'mimo-v1', name: 'MiMo v1', contextWindow: 32000, maxTokens: 4096, supportsStreaming: true, supportsVision: false, supportsTools: true, supportsThinking: false, costPer1kInput: 0.001, costPer1kOutput: 0.002 }
        ],
        capabilities: ['llm'],
        healthStatus: { status: 'unknown', lastChecked: new Date(), consecutiveFailures: 0 },
        latencyMs: 0,
        successRate: 0.94,
        costPer1kTokens: 0.0015,
        isEnabled: true
      },
      {
        id: 'ollama',
        alias: 'ol',
        name: 'Ollama',
        type: 'apikey',
        baseUrl: 'https://ollama.com/api',
        authType: 'none',
        authHeader: '',
        models: [
          { id: 'llama3.3', name: 'Llama 3.3', contextWindow: 128000, maxTokens: 4096, supportsStreaming: true, supportsVision: false, supportsTools: true, supportsThinking: false, costPer1kInput: 0, costPer1kOutput: 0 }
        ],
        capabilities: ['llm'],
        healthStatus: { status: 'unknown', lastChecked: new Date(), consecutiveFailures: 0 },
        latencyMs: 0,
        successRate: 0.95,
        costPer1kTokens: 0,
        isEnabled: true
      },
      {
        id: 'ollama-local',
        alias: 'oll',
        name: 'Ollama Local',
        type: 'apikey',
        baseUrl: 'http://localhost:11434/api',
        authType: 'none',
        authHeader: '',
        models: [
          { id: 'llama3.3', name: 'Llama 3.3 Local', contextWindow: 128000, maxTokens: 4096, supportsStreaming: true, supportsVision: false, supportsTools: true, supportsThinking: false, costPer1kInput: 0, costPer1kOutput: 0 }
        ],
        capabilities: ['llm'],
        healthStatus: { status: 'unknown', lastChecked: new Date(), consecutiveFailures: 0 },
        latencyMs: 0,
        successRate: 0.95,
        costPer1kTokens: 0,
        isEnabled: true
      },
      {
        id: 'vertex',
        alias: 'vx',
        name: 'Vertex AI',
        type: 'apikey',
        baseUrl: 'https://aiplatform.googleapis.com/v1',
        authType: 'bearer',
        authHeader: 'Authorization',
        models: [
          { id: 'gemini-1.5-pro-002', name: 'Gemini 1.5 Pro', contextWindow: 2000000, maxTokens: 8192, supportsStreaming: true, supportsVision: true, supportsTools: true, supportsThinking: false, costPer1kInput: 0.00125, costPer1kOutput: 0.005 },
          { id: 'gemini-1.5-flash-002', name: 'Gemini 1.5 Flash', contextWindow: 1000000, maxTokens: 8192, supportsStreaming: true, supportsVision: true, supportsTools: true, supportsThinking: false, costPer1kInput: 0.000075, costPer1kOutput: 0.0003 }
        ],
        capabilities: ['llm', 'imageToText'],
        healthStatus: { status: 'unknown', lastChecked: new Date(), consecutiveFailures: 0 },
        latencyMs: 0,
        successRate: 0.97,
        costPer1kTokens: 0.002,
        isEnabled: true
      },
      {
        id: 'vertex-partner',
        alias: 'vxp',
        name: 'Vertex Partner',
        type: 'apikey',
        baseUrl: 'https://aiplatform.googleapis.com/v1',
        authType: 'bearer',
        authHeader: 'Authorization',
        models: [
          { id: 'claude-3-5-sonnet@20241022', name: 'Claude 3.5 Sonnet', contextWindow: 200000, maxTokens: 8192, supportsStreaming: true, supportsVision: true, supportsTools: true, supportsThinking: false, costPer1kInput: 0.003, costPer1kOutput: 0.015 }
        ],
        capabilities: ['llm'],
        healthStatus: { status: 'unknown', lastChecked: new Date(), consecutiveFailures: 0 },
        latencyMs: 0,
        successRate: 0.97,
        costPer1kTokens: 0.005,
        isEnabled: true
      },
      {
        id: 'deepgram',
        alias: 'dg',
        name: 'Deepgram',
        type: 'apikey',
        baseUrl: 'https://api.deepgram.com/v1',
        authType: 'apikey',
        authHeader: 'Authorization',
        models: [
          { id: 'nova-2', name: 'Nova 2', contextWindow: 0, maxTokens: 0, supportsStreaming: false, supportsVision: false, supportsTools: false, supportsThinking: false, costPer1kInput: 0.0043, costPer1kOutput: 0 }
        ],
        capabilities: ['audioTranscription'],
        healthStatus: { status: 'unknown', lastChecked: new Date(), consecutiveFailures: 0 },
        latencyMs: 0,
        successRate: 0.97,
        costPer1kTokens: 0.0043,
        isEnabled: true
      },
      {
        id: 'assemblyai',
        alias: 'aa',
        name: 'AssemblyAI',
        type: 'apikey',
        baseUrl: 'https://api.assemblyai.com/v1',
        authType: 'apikey',
        authHeader: 'Authorization',
        models: [
          { id: 'best', name: 'Best', contextWindow: 0, maxTokens: 0, supportsStreaming: false, supportsVision: false, supportsTools: false, supportsThinking: false, costPer1kInput: 0.0037, costPer1kOutput: 0 }
        ],
        capabilities: ['audioTranscription'],
        healthStatus: { status: 'unknown', lastChecked: new Date(), consecutiveFailures: 0 },
        latencyMs: 0,
        successRate: 0.97,
        costPer1kTokens: 0.0037,
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
