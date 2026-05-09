import type { FastifyInstance } from 'fastify';
import type { ChatRequest, Message } from '../types/index.js';
import { pluginManager } from '../plugins/manager.js';
import { metricsCollector } from '../services/metrics.js';
import { logger } from '../services/logger.js';

interface CompareRequest {
  messages: Message[];
  models?: string[];           // specific models to compare
  providers?: string[];        // specific providers to compare
  max_providers?: number;      // max number of providers (default 3)
  temperature?: number;
  max_tokens?: number;
  timeout_ms?: number;         // per-provider timeout (default 30000)
}

interface CompareResult {
  provider: string;
  providerName: string;
  model: string;
  response?: string;
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
  latency_ms: number;
  cost_estimate: number;
  status: 'success' | 'error' | 'timeout';
  error?: string;
  ranking?: number; // will be filled by evaluator
}

export async function compareRoutes(app: FastifyInstance) {
  // ═══════════════════════════════════════════════
  // MULTI-MODEL COMPARISON
  // ═══════════════════════════════════════════════
  app.post('/compare', async (request, reply) => {
    const startTime = Date.now();
    const body = request.body as CompareRequest;

    if (!body.messages || body.messages.length === 0) {
      return reply.status(400).send({ error: 'messages array is required' });
    }

    // Determine which providers/models to compare
    const targets = resolveTargets(body);
    if (targets.length === 0) {
      return reply.status(503).send({ error: 'No providers available for comparison' });
    }

    // Execute all in parallel with individual timeouts
    const timeoutMs = body.timeout_ms || 30000;
    const results = await Promise.all(
      targets.map(t => executeComparison(t, body, timeoutMs))
    );

    // Sort by success first, then latency
    const sorted = [...results].sort((a, b) => {
      if (a.status === 'success' && b.status !== 'success') return -1;
      if (b.status === 'success' && a.status !== 'success') return 1;
      return a.latency_ms - b.latency_ms;
    });

    // Assign rankings
    sorted.forEach((r, i) => { r.ranking = i + 1; });

    const totalLatency = Date.now() - startTime;
    const successCount = results.filter(r => r.status === 'success').length;

    metricsCollector.record({
      id: crypto.randomUUID(),
      timestamp: new Date(),
      providerId: 'compare',
      modelId: targets.map(t => t.model).join(','),
      endpoint: '/v1/compare',
      statusCode: 200,
      latencyMs: totalLatency,
      tokensIn: 0,
      tokensOut: 0,
      cost: 0,
      userAgent: request.headers['user-agent']?.toString(),
      clientIp: request.ip
    });

    return reply.send({
      object: 'compare.result',
      created: Date.now(),
      total_providers: targets.length,
      success_count: successCount,
      total_latency_ms: totalLatency,
      results: sorted
    });
  });

  // ═══════════════════════════════════════════════
  // BATTLE MODE — Head-to-head with voting
  // ═══════════════════════════════════════════════
  app.post('/compare/battle', async (request, reply) => {
    const body = request.body as CompareRequest & { anonymous?: boolean };

    // Same as compare but returns anonymized responses
    const targets = resolveTargets(body);
    const timeoutMs = body.timeout_ms || 30000;

    const results = await Promise.all(
      targets.map(t => executeComparison(t, body, timeoutMs))
    );

    // Shuffle and anonymize
    const shuffled = results
      .filter(r => r.status === 'success')
      .sort(() => Math.random() - 0.5)
      .map((r, i) => ({
        id: `model_${String.fromCharCode(65 + i)}`, // model_A, model_B, ...
        response: r.response,
        latency_ms: r.latency_ms,
        token_count: r.usage?.completion_tokens || 0
      }));

    return reply.send({
      object: 'compare.battle',
      created: Date.now(),
      candidates: shuffled,
      vote_url: '/v1/compare/vote', // placeholder for future voting API
      reveal_after_seconds: 30
    });
  });
}

function resolveTargets(body: CompareRequest): { providerId: string; model: string }[] {
  const targets: { providerId: string; model: string }[] = [];
  const maxProviders = body.max_providers || 3;

  // If specific models requested
  if (body.models && body.models.length > 0) {
    for (const modelId of body.models.slice(0, maxProviders)) {
      // Find provider for this model
      for (const provider of pluginManager.getEnabledProviders()) {
        const model = provider.models.find(m => m.id === modelId);
        if (model) {
          targets.push({ providerId: provider.id, model: model.id });
          break;
        }
      }
    }
    if (targets.length > 0) return targets;
  }

  // If specific providers requested
  if (body.providers && body.providers.length > 0) {
    for (const pid of body.providers.slice(0, maxProviders)) {
      const provider = pluginManager.getProvider(pid);
      if (provider && provider.isEnabled) {
        targets.push({ providerId: provider.id, model: provider.models[0]?.id || 'default' });
      }
    }
    if (targets.length > 0) return targets;
  }

  // Auto-select top N providers by health
  const candidates = pluginManager.getEnabledProviders()
    .filter(p => p.healthStatus.status !== 'unhealthy')
    .filter(p => p.healthStatus.consecutiveFailures < 3)
    .sort((a, b) => b.successRate - a.successRate)
    .slice(0, maxProviders);

  for (const provider of candidates) {
    const model = provider.models[0];
    if (model) {
      targets.push({ providerId: provider.id, model: model.id });
    }
  }

  return targets;
}

async function executeComparison(
  target: { providerId: string; model: string },
  body: CompareRequest,
  timeoutMs: number
): Promise<CompareResult> {
  const provider = pluginManager.getProvider(target.providerId);
  if (!provider) {
    return {
      provider: target.providerId,
      providerName: 'Unknown',
      model: target.model,
      latency_ms: 0,
      cost_estimate: 0,
      status: 'error',
      error: 'Provider not found'
    };
  }

  const envKey = `${provider.id.toUpperCase()}_API_KEY`;
  const apiKey = process.env[envKey];

  if (!apiKey && provider.authType !== 'none') {
    return {
      provider: provider.id,
      providerName: provider.name,
      model: target.model,
      latency_ms: 0,
      cost_estimate: 0,
      status: 'error',
      error: `API key not configured (${envKey})`
    };
  }

  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (provider.authType === 'bearer') headers['Authorization'] = `Bearer ${apiKey}`;
  else if (provider.authType === 'apikey') headers[provider.authHeader || 'Authorization'] = apiKey || '';

  const requestBody = {
    model: target.model,
    messages: body.messages,
    temperature: body.temperature ?? 0.7,
    max_tokens: body.max_tokens ?? 1024,
    stream: false
  };

  const startTime = Date.now();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(`${provider.baseUrl}/chat/completions`, {
      method: 'POST',
      headers,
      body: JSON.stringify(requestBody),
      signal: controller.signal
    });

    clearTimeout(timeout);
    const latency = Date.now() - startTime;

    if (!response.ok) {
      const errText = await response.text();
      return {
        provider: provider.id,
        providerName: provider.name,
        model: target.model,
        latency_ms: latency,
        cost_estimate: 0,
        status: 'error',
        error: `HTTP ${response.status}: ${errText.slice(0, 200)}`
      };
    }

    const data = await response.json();
    const content = data.choices?.[0]?.message?.content || '';
    const usage = data.usage;

    // Estimate cost
    const model = provider.models.find(m => m.id === target.model);
    const costEstimate = usage && model
      ? (usage.prompt_tokens / 1000) * model.costPer1kInput +
        (usage.completion_tokens / 1000) * model.costPer1kOutput
      : 0;

    return {
      provider: provider.id,
      providerName: provider.name,
      model: target.model,
      response: content,
      usage: usage ? {
        prompt_tokens: usage.prompt_tokens || 0,
        completion_tokens: usage.completion_tokens || 0,
        total_tokens: usage.total_tokens || 0
      } : undefined,
      latency_ms: latency,
      cost_estimate: costEstimate,
      status: 'success'
    };

  } catch (err: any) {
    clearTimeout(timeout);
    const latency = Date.now() - startTime;

    if (err.name === 'AbortError') {
      return {
        provider: provider.id,
        providerName: provider.name,
        model: target.model,
        latency_ms: latency,
        cost_estimate: 0,
        status: 'timeout',
        error: `Timed out after ${timeoutMs}ms`
      };
    }

    return {
      provider: provider.id,
      providerName: provider.name,
      model: target.model,
      latency_ms: latency,
      cost_estimate: 0,
      status: 'error',
      error: err.message
    };
  }
}
