import type { FastifyInstance } from 'fastify';
import type { ChatRequest, Message } from '../types/index.js';
import { intelligentRouter } from '../services/intelligent-router.js';
import { tokenOptimizer } from '../services/token-optimizer.js';
import { toolCompressor } from '../services/tool-compressor.js';
import { formatTranslator } from '../services/format-translator.js';
import { keyManager } from '../services/key-manager.js';
import { smartFallback } from '../services/smart-fallback.js';
import { debugLogger } from '../services/debug-logger.js';
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
    const cavemanMode = request.headers['x-caveman-mode'] === 'true';
    const debugMode = request.headers['x-debug-mode'] === 'true' || debugLogger.isEnabled();
    if (debugMode) debugLogger.setEnabled(true);
    
    const debugEntryId = crypto.randomUUID();
    let decision: any = null;
    
    try {
      let optimizedRequest = tokenOptimizer.optimize(body);
      
      // Apply tool output compression before routing
      optimizedRequest = {
        ...optimizedRequest,
        messages: toolCompressor.compressMessages(optimizedRequest.messages)
      };
      
      decision = await intelligentRouter.route(optimizedRequest);
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

      const response = await forwardWithFallback(
        provider,
        decision,
        optimizedRequest,
        isStream,
        cavemanMode
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

      // Debug logging
      debugLogger.log({
        id: debugEntryId,
        timestamp: new Date(),
        method: 'POST',
        path: '/chat/completions',
        headers: Object.fromEntries(Object.entries(request.headers).map(([k,v]) => [k, String(v)])),
        requestBody: body,
        providerId: decision?.providerId,
        modelId: decision?.modelId,
        responseStatus: 200,
        responseBody: isStream ? undefined : response,
        latencyMs: Date.now() - startTime,
        format: formatTranslator.detectFormat(decision?.providerId || ''),
        cavemanMode,
        cacheHit: false,
      });

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

      // Debug logging for errors
      debugLogger.log({
        id: debugEntryId,
        timestamp: new Date(),
        method: 'POST',
        path: '/chat/completions',
        headers: Object.fromEntries(Object.entries(request.headers).map(([k,v]) => [k, String(v)])),
        requestBody: body,
        providerId: decision?.providerId,
        modelId: decision?.modelId,
        responseStatus: statusCode,
        error: error instanceof Error ? error.message : 'Unknown error',
        latencyMs: Date.now() - startTime,
        format: formatTranslator.detectFormat(decision?.providerId || ''),
        cavemanMode,
        cacheHit: false,
      });

      return reply.status(statusCode).send({
        error: statusCode === 502 ? 'Bad Gateway' : statusCode === 503 ? 'Service Unavailable' : 'Internal server error',
        message: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  });

  app.get('/debug/logs', async (request, reply) => {
    const auth = request.headers['x-api-key'];
    if (auth !== process.env.ADMIN_API_KEY) {
      return reply.status(401).send({ error: 'Unauthorized' });
    }
    const limit = parseInt((request.query as any)['limit'] as string) || 50;
    return { logs: debugLogger.getLogs(limit), stats: debugLogger.getStats() };
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
  stream: boolean,
  cavemanMode: boolean = false
): Promise<any> {
  // Build smart 3-tier fallback plan
  const plan = smartFallback.buildFallbackPlan(
    primaryProvider,
    decision.modelId,
    request.model
  );
  smartFallback.logDecision(plan, request.model);

  const providers = plan.providers;
  if (providers.length === 0) {
    throw new Error('No available providers');
  }

  let lastError: Error | null = null;
  
  for (const provider of providers) {
    try {
      // Use smart fallback model mapping
      let modelId = plan.modelMapping.get(provider.id) || decision.modelId;
      
      const result = await forwardToProvider(provider, modelId, request, stream, cavemanMode);
      
      // Update provider success rate
      await pluginManager.updateProvider(provider.id, {
        successRate: Math.min(1, (provider.successRate || 0.9) + 0.02),
        healthStatus: {
          ...provider.healthStatus,
          consecutiveFailures: 0
        }
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

async function forwardToProvider(provider: any, modelId: string, request: ChatRequest, stream: boolean = false, cavemanMode: boolean = false): Promise<any> {
  const envKey = `${provider.id.toUpperCase()}_API_KEY`;
  
  // Use keyManager for multi-account round-robin
  const apiKey = keyManager.getNextKey(provider.id);
  
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

  // Detect provider format and translate request
  const targetFormat = formatTranslator.detectFormat(provider.id);
  const translatedRequest = formatTranslator.translateRequest(
    { ...request, model: modelId, stream },
    targetFormat,
    { addCavemanPrompt: cavemanMode }
  );

  // Determine correct endpoint for provider format
  let endpoint = '/chat/completions';
  if (targetFormat === 'claude') {
    endpoint = '/messages';
    headers['anthropic-version'] = '2023-06-01';
  } else if (targetFormat === 'gemini') {
    // Gemini uses a different URL pattern with API key as query param
    endpoint = `/models/${modelId}:generateContent`;
  }

  const body = translatedRequest;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 60000); // 60s timeout

  // Retry logic: 2 attempts per provider
  let lastError: Error | null = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      let url = `${provider.baseUrl}${endpoint}`;
      
      // Gemini requires API key as query param
      if (targetFormat === 'gemini') {
        url = `${provider.baseUrl}${endpoint}?key=${safeApiKey}`;
        delete headers['Authorization'];
      }
      
      const response = await fetch(url, {
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

      const nativeResponse = await response.json();
      
      // Translate response back to OpenAI format
      return formatTranslator.translateResponse(nativeResponse, targetFormat);
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
