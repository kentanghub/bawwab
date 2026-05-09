import type { FastifyInstance } from 'fastify';
import type { ChatRequest, Message } from '../types/index.js';
import { intelligentRouter } from '../services/intelligent-router.js';
import { tokenOptimizer } from '../services/token-optimizer.js';
import { cacheManager } from '../services/cache-manager.js';
import { metricsCollector } from '../services/metrics.js';
import { prometheusMetrics } from '../services/prometheus.js';
import { pluginManager } from '../plugins/manager.js';
import { chatRequestSchema } from '../services/validator.js';
import { logger } from '../services/logger.js';
import { createHash } from 'node:crypto';

export async function chatRoutes(app: FastifyInstance) {
  app.post('/chat/completions', {
    schema: {
      body: {
        type: 'object',
        required: ['model', 'messages'],
        properties: {
          model: { type: 'string' },
          messages: {
            type: 'array',
            items: {
              type: 'object',
              required: ['role', 'content'],
              properties: {
                role: { type: 'string', enum: ['system', 'user', 'assistant', 'tool'] },
                content: { type: ['string', 'array', 'object'] }
              }
            }
          },
          temperature: { type: 'number', minimum: 0, maximum: 2 },
          max_tokens: { type: 'number', minimum: 1 },
          stream: { type: 'boolean' },
          tools: { type: 'array' },
          tool_choice: { type: ['string', 'object'] }
        }
      }
    }
  }, async (request, reply) => {
    const startTime = Date.now();
    
    // 1. Validate request body with Zod
    const parseResult = chatRequestSchema.safeParse(request.body);
    if (!parseResult.success) {
      return reply.status(400).send({
        error: 'Invalid request body',
        details: parseResult.error.errors.map(e => ({
          path: e.path.join('.'),
          message: e.message
        }))
      });
    }
    
    const body = parseResult.data as ChatRequest;
    const isStream = body.stream || false;
    
    try {
      const optimizedRequest = tokenOptimizer.optimize(body);
      const decision = await intelligentRouter.route(optimizedRequest);
      const provider = pluginManager.getProvider(decision.providerId);
      
      if (!provider) {
        return reply.status(404).send({ error: 'Provider not found' });
      }

      // 3. Generate hash-based cache key (not full JSON)
      const cacheKeyHash = generateCacheHash(decision.providerId, decision.modelId, optimizedRequest.messages);
      
      if (!isStream) {
        const cacheKey = cacheManager.generateKey('chat', cacheKeyHash);
        const cached = await cacheManager.get(cacheKey);
        if (cached) {
          const parsed = JSON.parse(cached);
          metricsCollector.record({
            id: crypto.randomUUID(),
            timestamp: new Date(),
            providerId: decision.providerId,
            modelId: decision.modelId,
            endpoint: '/v1/chat/completions',
            statusCode: 200,
            latencyMs: Date.now() - startTime,
            tokensIn: parsed.usage?.prompt_tokens || estimateTokens(optimizedRequest.messages),
            tokensOut: parsed.usage?.completion_tokens || 0,
            cost: 0, // cached = free
            cacheHit: true,
            userAgent: request.headers['user-agent']?.toString(),
            clientIp: request.ip
          });
          return reply.send(parsed);
        }
      }

      // 4. Forward with retry/fallback logic
      const response = await forwardWithFallback(
        provider,
        decision,
        optimizedRequest,
        isStream
      );

      const latency = Date.now() - startTime;

      // 2. Extract tokensOut from provider response
      let tokensOut = 0;
      let tokensIn = estimateTokens(optimizedRequest.messages);
      let actualCost = decision.estimatedCost;

      // Handle streaming response with proper SSE headers
      if (isStream && response && typeof (response as ReadableStream).getReader === 'function') {
        reply.raw.writeHead(200, {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          'Connection': 'keep-alive',
          'X-Accel-Buffering': 'no'
        });

        const reader = (response as ReadableStream<Uint8Array>).getReader();
        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            reply.raw.write(Buffer.from(value));
          }
        } finally {
          reader.releaseLock();
          reply.raw.end();
        }

        metricsCollector.record({
          id: crypto.randomUUID(),
          timestamp: new Date(),
          providerId: decision.providerId,
          modelId: decision.modelId,
          endpoint: '/v1/chat/completions',
          statusCode: 200,
          latencyMs: Date.now() - startTime,
          tokensIn,
          tokensOut: 0,
          cost: 0,
          userAgent: request.headers['user-agent']?.toString(),
          clientIp: request.ip
        });
        return reply;
      }

      if (!isStream && typeof response === 'object') {
        tokensOut = response.usage?.completion_tokens || 0;
        tokensIn = response.usage?.prompt_tokens || tokensIn;
        actualCost = calculateActualCost(decision.providerId, decision.modelId, tokensIn, tokensOut);
      }

      metricsCollector.record({
        id: crypto.randomUUID(),
        timestamp: new Date(),
        providerId: decision.providerId,
        modelId: decision.modelId,
        endpoint: '/v1/chat/completions',
        statusCode: 200,
        latencyMs: latency,
        tokensIn,
        tokensOut,
        cost: actualCost,
        userAgent: request.headers['user-agent']?.toString(),
        clientIp: request.ip
      });

      if (!isStream && typeof response === 'object') {
        const cacheKey = cacheManager.generateKey('chat', cacheKeyHash);
        await cacheManager.set(cacheKey, JSON.stringify(response), 300);
      }

      return reply.send(response);

    } catch (error) {
      const latency = Date.now() - startTime;
      
      // Determine appropriate status code
      let statusCode = 500;
      if (error instanceof Error) {
        if (error.message.includes('Provider error (4')) statusCode = 502;
        if (error.message.includes('Provider error (5')) statusCode = 502;
        if (error.message.includes('timeout')) statusCode = 504;
        if (error.message.includes('No available providers')) statusCode = 503;
        if (error.message.includes('All providers failed')) statusCode = 502;
      }
      
      metricsCollector.record({
        id: crypto.randomUUID(),
        timestamp: new Date(),
        providerId: 'unknown',
        modelId: body.model,
        endpoint: '/v1/chat/completions',
        statusCode,
        latencyMs: latency,
        tokensIn: 0,
        tokensOut: 0,
        cost: 0,
        error: error instanceof Error ? error.message : 'Unknown error',
        userAgent: request.headers['user-agent']?.toString(),
        clientIp: request.ip
      });

      return reply.status(statusCode).send({
        error: statusCode === 502 ? 'Bad Gateway' : statusCode === 503 ? 'Service Unavailable' : 'Internal server error',
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

// 4. Retry with fallback to other providers
async function forwardWithFallback(
  primaryProvider: any, 
  decision: any,
  request: ChatRequest, 
  stream: boolean
): Promise<any> {
  const providers = [primaryProvider];
  
  // Add fallback providers (same model or compatible)
  const fallbackProviders = pluginManager.getEnabledProviders()
    .filter(p => p.id !== primaryProvider.id)
    .filter(p => p.healthStatus.status !== 'unhealthy')
    .filter(p => p.healthStatus.consecutiveFailures < 3)
    .slice(0, 2); // Max 2 fallbacks
  
  providers.push(...fallbackProviders);
  
  let lastError: Error | null = null;
  
  for (const provider of providers) {
    try {
      // Find matching model on fallback provider
      let modelId = decision.modelId;
      const matchingModel = provider.models.find((m: any) => m.id === modelId);
      if (!matchingModel && provider.models.length > 0) {
        // Use first available model as fallback
        modelId = provider.models[0].id;
      }
      
      const result = await forwardToProvider(provider, modelId, request, stream);
      
      // Update provider success rate
      await pluginManager.updateProvider(provider.id, {
        successRate: Math.min(1, (provider.successRate || 0.9) + 0.02)
      });
      
      return result;
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      
      // Mark provider as having a failure
      await pluginManager.updateProvider(provider.id, {
        healthStatus: {
          ...provider.healthStatus,
          consecutiveFailures: provider.healthStatus.consecutiveFailures + 1
        },
        successRate: Math.max(0, (provider.successRate || 0.9) - 0.05)
      });
      
      logger.warn({ provider: provider.id, error: lastError.message }, '[Fallback] Provider failed, trying next...');
    }
  }
  
  throw new Error(`All providers failed. Last error: ${lastError?.message || 'Unknown'}`);
}

async function forwardToProvider(provider: any, modelId: string, request: ChatRequest, stream: boolean = false): Promise<any> {
  const envKey = `${provider.id.toUpperCase()}_API_KEY`;
  const apiKey = process.env[envKey];
  
  if (!apiKey && provider.authType !== 'none') {
    throw new Error(`API key not configured for provider "${provider.name}". Set the ${envKey} environment variable.`);
  }
  
  const safeApiKey = apiKey || '';
  
  const headers: Record<string, string> = {
    'Content-Type': 'application/json'
  };
  
  if (provider.authType === 'bearer') {
    headers['Authorization'] = `Bearer ${safeApiKey}`;
  } else if (provider.authType === 'apikey') {
    headers[provider.authHeader || 'Authorization'] = safeApiKey;
  }

  const body = { ...request, model: modelId, stream };

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 60000); // 60s timeout

  // Retry logic: 2 attempts per provider
  let lastError: Error | null = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const response = await fetch(`${provider.baseUrl}/chat/completions`, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
        signal: controller.signal
      });

      clearTimeout(timeout);

      if (!response.ok) {
        const error = await response.text();
        throw new Error(`Provider error (${response.status}): ${error}`);
      }

      if (stream) {
        return response.body;
      }

      return await response.json();
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      if (attempt === 0) {
        logger.warn({ provider: provider.id, attempt: 1 }, '[Retry] Provider attempt 1 failed, retrying...');
        await new Promise(r => setTimeout(r, 500)); // 500ms backoff
      }
    }
  }
  
  clearTimeout(timeout);
  throw lastError;
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

function calculateActualCost(providerId: string, modelId: string, tokensIn: number, tokensOut: number): number {
  const provider = pluginManager.getProvider(providerId);
  if (!provider) return 0;
  
  const model = provider.models.find(m => m.id === modelId);
  if (!model) return 0;
  
  const inputCost = (tokensIn / 1000) * model.costPer1kInput;
  const outputCost = (tokensOut / 1000) * model.costPer1kOutput;
  
  return inputCost + outputCost;
}

// 3. Generate short hash-based cache key
function generateCacheHash(providerId: string, modelId: string, messages: Message[]): string {
  const content = JSON.stringify({ providerId, modelId, messages });
  return createHash('sha256').update(content).digest('hex').slice(0, 32);
}
