/**
 * Dynamic Model Discovery
 * Auto-fetch model lists from provider /models endpoints.
 * Enable new models without restart.
 */

import { logger } from './logger.js';
import { pluginManager } from '../plugins/manager.js';

class ModelDiscovery {
  async discoverModels(providerId: string): Promise<Array<{ id: string; name: string }>> {
    const provider = pluginManager.getProvider(providerId);
    if (!provider) return [];

    try {
      const envKey = `${provider.id.toUpperCase()}_API_KEY`;
      const apiKey = process.env[envKey];

      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (provider.authType === 'bearer' && apiKey) {
        headers['Authorization'] = `Bearer ${apiKey}`;
      }

      const response = await fetch(`${provider.baseUrl}/models`, {
        method: 'GET',
        headers,
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const data = await response.json() as any;
      const models = Array.isArray(data.data) ? data.data : Array.isArray(data.models) ? data.models : [];

      return models.map((m: any) => ({
        id: String(m.id),
        name: String(m.name || m.id),
      }));
    } catch (err) {
      logger.warn(`[ModelDiscovery] Failed to discover models for ${providerId}: ${(err as Error).message}`);
      return [];
    }
  }

  async syncProviderModels(providerId: string): Promise<number> {
    const discovered = await this.discoverModels(providerId);
    const provider = pluginManager.getProvider(providerId);
    if (!provider) return 0;

    let added = 0;
    for (const model of discovered) {
      const exists = provider.models.find(m => m.id === model.id);
      if (!exists) {
        provider.models.push({
          id: model.id,
          name: model.name,
          contextWindow: 128000,
          maxTokens: 4096,
          supportsStreaming: true,
          supportsVision: false,
          supportsTools: true,
          supportsThinking: false,
          costPer1kInput: 0,
          costPer1kOutput: 0,
        });
        added++;
      }
    }

    if (added > 0) {
      logger.info(`[ModelDiscovery] Added ${added} new models to ${providerId}`);
    }
    return added;
  }

  async syncAll(): Promise<Record<string, number>> {
    const results: Record<string, number> = {};
    for (const provider of pluginManager.getEnabledProviders()) {
      results[provider.id] = await this.syncProviderModels(provider.id);
    }
    return results;
  }
}

export const modelDiscovery = new ModelDiscovery();
