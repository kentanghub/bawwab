import type { ChatRequest, RouteDecision, Provider, Model } from '../types/index.js';
import { pluginManager } from './plugin-manager.js';

class IntelligentRouter {
  private initialized = false;

  initialize(): void {
    this.initialized = true;
  }

  async route(request: ChatRequest): Promise<RouteDecision> {
    const modelId = request.model;
    
    // 1. Direct model match
    const directMatch = this.findDirectMatch(modelId);
    if (directMatch) {
      return this.buildDecision(directMatch.provider, directMatch.model, 'Direct model match');
    }

    // 2. Parse combo model (e.g., "combo/gpt4+claude")
    if (modelId.startsWith('combo/')) {
      return this.routeCombo(request);
    }

    // 3. Parse alias (e.g., "kr/claude-sonnet")
    const [alias, ...modelParts] = modelId.split('/');
    const provider = pluginManager.getAllProviders().find(p => p.alias === alias);
    
    if (provider) {
      const model = modelParts.length > 0 
        ? provider.models.find(m => m.id.includes(modelParts.join('/')))
        : provider.models[0];
      
      if (model) {
        return this.buildDecision(provider, model, `Alias match: ${alias}`);
      }
    }

    // 4. Intelligent routing based on request characteristics
    return this.intelligentRoute(request);
  }

  private findDirectMatch(modelId: string): { provider: Provider; model: Model } | null {
    for (const provider of pluginManager.getEnabledProviders()) {
      const model = provider.models.find(m => m.id === modelId);
      if (model) {
        return { provider, model };
      }
    }
    return null;
  }

  private async routeCombo(request: ChatRequest): Promise<RouteDecision> {
    // Combo routing - try first model, fallback to second
    const comboParts = request.model.replace('combo/', '').split('+');
    const primary = comboParts[0];
    
    const match = this.findDirectMatch(primary);
    if (match) {
      return this.buildDecision(match.provider, match.model, `Combo primary: ${primary}`);
    }
    
    throw new Error(`No provider found for combo model: ${request.model}`);
  }

  private async intelligentRoute(request: ChatRequest): Promise<RouteDecision> {
    const candidates = this.getCandidateProviders(request);
    
    if (candidates.length === 0) {
      throw new Error('No available providers for this request');
    }

    // Score each candidate
    const scored = candidates.map(c => ({
      ...c,
      score: this.scoreProvider(c.provider, c.model, request)
    }));

    // Sort by score descending
    scored.sort((a, b) => b.score - a.score);

    const best = scored[0];
    return this.buildDecision(
      best.provider,
      best.model,
      `Intelligent routing (score: ${best.score.toFixed(2)})`
    );
  }

  private getCandidateProviders(request: ChatRequest): { provider: Provider; model: Model }[] {
    const candidates: { provider: Provider; model: Model }[] = [];
    
    for (const provider of pluginManager.getEnabledProviders()) {
      // Skip unhealthy providers
      if (provider.healthStatus.status === 'unhealthy') continue;
      
      // Skip providers with too many consecutive failures
      if (provider.healthStatus.consecutiveFailures >= 3) continue;

      for (const model of provider.models) {
        // Check capability requirements
        if (request.tools && request.tools.length > 0 && !model.supportsTools) continue;
        if (this.hasVisionContent(request) && !model.supportsVision) continue;
        
        candidates.push({ provider, model });
      }
    }
    
    return candidates;
  }

  private hasVisionContent(request: ChatRequest): boolean {
    return request.messages.some(msg => {
      if (typeof msg.content === 'string') return false;
      return msg.content.some(part => part.type === 'image_url');
    });
  }

  private scoreProvider(provider: Provider, model: Model, request: ChatRequest): number {
    let score = 0;

    // Health score (0-30)
    const healthScore = provider.successRate * 30;
    score += healthScore;

    // Latency score (0-20) - prefer lower latency
    const latencyScore = Math.max(0, 20 - (provider.latencyMs / 100));
    score += latencyScore;

    // Cost score (0-20) - prefer lower cost
    const avgCost = (model.costPer1kInput + model.costPer1kOutput) / 2;
    const costScore = avgCost === 0 ? 20 : Math.max(0, 20 - (avgCost * 100));
    score += costScore;

    // Capability score (0-15)
    let capabilityScore = 0;
    if (model.supportsStreaming) capabilityScore += 3;
    if (model.supportsTools) capabilityScore += 4;
    if (model.supportsVision) capabilityScore += 4;
    if (model.supportsThinking) capabilityScore += 4;
    score += capabilityScore;

    // Context window score (0-10)
    const contextScore = Math.min(10, model.contextWindow / 20000);
    score += contextScore;

    // Free provider bonus (0-5)
    if (provider.type === 'free') score += 5;

    return score;
  }

  private buildDecision(provider: Provider, model: Model, reasoning: string): RouteDecision {
    const estimatedCost = model.costPer1kInput * 0.001 + model.costPer1kOutput * 0.001;
    
    return {
      providerId: provider.id,
      modelId: model.id,
      reasoning,
      estimatedCost,
      estimatedLatency: provider.latencyMs || 500
    };
  }
}

export const intelligentRouter = new IntelligentRouter();
