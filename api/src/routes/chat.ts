import type { FastifyInstance } from 'fastify';
import type { ChatRequest, Message } from '../types/index.js';
import { intelligentRouter } from '../services/intelligent-router.js';
import { tokenOptimizer } from '../services/token-optimizer.js';
import { cacheManager } from '../services/cache-manager.js';
import { metricsCollector } from '../services/metrics.js';
import { pluginManager } from '../plugins/manager.js';

export async function chatRoutes(app: FastifyInstance) {
  app.post('/chat/completions', async (request, reply) => {
    const startTime = Date.now();
    const body = request.body as ChatRequest;
    
    try {
      const optimizedRequest = tokenOptimizer.optimize(body);
      const decision = await intelligentRouter.route(optimizedRequest);
      const provider = pluginManager.getProvider(decision.providerId);
      
      if (!provider) {
        return reply.status(404).send({ error: 'Provider not found' });
      }

      if (!body.stream) {
        const cacheKey = cacheManager.generateKey('chat', decision.providerId, decision.modelId, JSON.stringify(optimizedRequest.messages));
        const cached = await cacheManager.get(cacheKey);
        if (cached) {
          return reply.send(JSON.parse(cached));
        }
      }

      const response = await forwardToProvider(provider, decision.modelId, optimizedRequest, body.stream);
      
      const latency = Date.now() - startTime;
      metricsCollector.record({
        id: crypto.randomUUID(),
        timestamp: new Date(),
        providerId: decision.providerId,
        modelId: decision.modelId,
        endpoint: '/v1/chat/completions',
        statusCode: 200,
        latencyMs: latency,
        tokensIn: estimateTokens(optimizedRequest.messages),
        tokensOut: 0,
        cost: decision.estimatedCost,
        userAgent: request.headers['user-agent']?.toString(),
        clientIp: request.ip
      });

      if (!body.stream && typeof response === 'object') {
        const cacheKey = cacheManager.generateKey('chat', decision.providerId, decision.modelId, JSON.stringify(optimizedRequest.messages));
        await cacheManager.set(cacheKey, JSON.stringify(response), 300);
      }

      return reply.send(response);

    } catch (error) {
      const latency = Date.now() - startTime;
      metricsCollector.record({
        id: crypto.randomUUID(),
        timestamp: new Date(),
        providerId: 'unknown',
        modelId: body.model,
        endpoint: '/v1/chat/completions',
        statusCode: 500,
        latencyMs: latency,
        tokensIn: 0,
        tokensOut: 0,
        cost: 0,
        error: error instanceof Error ? error.message : 'Unknown error',
        userAgent: request.headers['user-agent']?.toString(),
        clientIp: request.ip
      });

      return reply.status(500).send({
        error: 'Internal server error',
        message: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  });

  app.get('/models', async () => {
    const models: any[] = [];
    
    for (const provider of pluginManager.getEnabledProviders()) {
      for (const model of provider.models) {
        models.push({
          id: model.id,
          object: 'model',
          created: Date.now(),
          owned_by: provider.name,
          permission: [],
          root: model.id,
          parent: null,
          context_window: model.contextWindow,
          capabilities: {
            streaming: model.supportsStreaming,
            vision: model.supportsVision,
            tools: model.supportsTools,
            thinking: model.supportsThinking
          }
        });
      }
    }
    
    return { object: 'list', data: models };
  });
}

async function forwardToProvider(provider: any, modelId: string, request: ChatRequest, stream: boolean = false): Promise<any> {
  const apiKey = process.env[`${provider.id.toUpperCase()}_API_KEY`] || '';
  
  const headers: Record<string, string> = {
    'Content-Type': 'application/json'
  };
  
  if (provider.authType === 'bearer') {
    headers['Authorization'] = `Bearer ${apiKey}`;
  } else if (provider.authType === 'apikey') {
    headers[provider.authHeader || 'Authorization'] = apiKey;
  }

  const body = { ...request, model: modelId, stream };

  const response = await fetch(`${provider.baseUrl}/chat/completions`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body)
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Provider error (${response.status}): ${error}`);
  }

  if (stream) {
    return response.body;
  }

  return await response.json();
}

function estimateTokens(messages: Message[]): number {
  let chars = 0;
  for (const msg of messages) {
    if (typeof msg.content === 'string') {
      chars += msg.content.length;
    } else {
      for (const part of msg.content) {
        if (part.type === 'text' && part.text) {
          chars += part.text.length;
        }
      }
    }
  }
  return Math.ceil(chars / 4);
}
