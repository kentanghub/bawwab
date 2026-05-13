import type { FastifyInstance } from 'fastify';
import type { ChatRequest, Message } from '../types/index.js';
import { intelligentRouter } from '../services/intelligent-router.js';
import { tokenOptimizer } from '../services/token-optimizer.js';
import { toolCompressor } from '../services/tool-compressor.js';
import { formatTranslator } from '../services/format-translator.js';
import { keyManager } from '../services/key-manager.js';
import { smartFallback } from '../services/smart-fallback.js';
import { debugLogger } from '../services/debug-logger.js';
import { oauthManager } from '../services/oauth-manager.js';
import { cacheManager } from '../services/cache-manager.js';
import { semanticCache } from '../services/semantic-cache.js';
import { metricsCollector } from '../services/metrics.js';
import { quotaTracker } from '../services/quota-tracker.js';
import { providerRateLimiter } from '../services/provider-rate-limiter.js';
import { modelBenchmark } from '../services/model-benchmark.js';
import { circuitBreaker } from '../services/circuit-breaker.js';
import { virtualKeyManager } from '../services/virtual-keys.js';
import { requestDeduplicator } from '../services/request-deduplicator.js';
import { contentSafety } from '../services/content-safety.js';
import { webhookManager } from '../services/webhooks.js';
import { abTestingManager } from '../services/ab-testing.js';
import { compressMessages as rtkCompress } from '../services/rtk-token-saver.js';
import { modelAliasManager } from '../services/model-aliases.js';
import { pricingTracker } from '../services/pricing-tracker.js';
import { requestLogger } from '../services/request-logger.js';
import { multiAccountManager } from '../services/multi-account.js';
import { prometheusMetrics } from '../services/prometheus.js';
import { pluginManager } from '../plugins/manager.js';
import { chatRequestSchema } from '../services/validator.js';
import { logger } from '../services/logger.js';
import { createHash } from 'node:crypto';
import { safeCompare } from '../services/database.js';

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
    const authKey = request.headers['x-api-key'] as string;
    const debugAuth = request.headers['authorization']?.replace('Bearer ', '') || request.headers['x-api-key'] as string || '';
  const debugMode = request.headers['x-debug-mode'] === 'true' && !!process.env.ADMIN_API_KEY && debugAuth === process.env.ADMIN_API_KEY && safeCompare(authKey || '', process.env.ADMIN_API_KEY || '');
    if (debugMode) debugLogger.setEnabled(true);

    // Virtual Key validation
    const authHeader = request.headers.authorization || '';
    const virtualKey = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : undefined;
    let vKey: ReturnType<typeof virtualKeyManager.validateKey> = null;
    if (virtualKey && virtualKey.startsWith('bawwab-')) {
      vKey = virtualKeyManager.validateKey(virtualKey);
      if (!vKey) {
        return reply.status(401).send({ error: 'Invalid or expired virtual API key' });
      }
      const estimateTokens = body.messages.reduce((sum, m) => sum + (typeof m.content === 'string' ? m.content.length / 4 : 100), 0);
      const rl = virtualKeyManager.checkRateLimit(vKey.id, estimateTokens);
      if (!rl.allowed) {
        return reply.status(429).send({ error: 'Rate limit exceeded', retryAfter: rl.retryAfter });
      }
    }

    const debugEntryId = crypto.randomUUID();
    let decision: any = null;
    let activeAbTest: { testId: string; variant: 'A' | 'B' } | null = null;
    
    try {
      let optimizedRequest = tokenOptimizer.optimize(body);

      // Content Safety Scan
      const safety = contentSafety.scanRequest(optimizedRequest.messages);
      if (!safety.safe) {
        return reply.status(400).send({
          error: 'Content safety violation',
          warnings: safety.warnings,
          injection: safety.injectionDetected,
          toxic: safety.toxicDetected,
        });
      }
      optimizedRequest.messages = safety.redactedMessages as typeof optimizedRequest.messages;

      // Apply tool output compression before routing
      optimizedRequest = {
        ...optimizedRequest,
        messages: toolCompressor.compressMessages(optimizedRequest.messages)
      };

      // Apply RTK token saver compression (tool_result auto-compression)
      const rtkResult = rtkCompress(optimizedRequest.messages);
      optimizedRequest.messages = rtkResult.messages;
      if (rtkResult.stats.savedBytes > 0) {
        logger.info({
          savedBytes: rtkResult.stats.savedBytes,
          savedPercent: rtkResult.stats.savedPercent,
          compressedCount: rtkResult.stats.compressedCount,
        }, '[RTK] Token savings applied');
      }

      // Resolve model alias (e.g., "cc/opus" → { provider: "claude", model: "opus" })
      const resolved = modelAliasManager.resolveAlias(body.model);
      if (resolved.provider && resolved.provider !== 'openai') {
        // Alias resolution found a known provider prefix — use it
        const resolvedProvider = pluginManager.getAllProviders().find(
          p => p.id === resolved.provider || p.alias === resolved.provider
        );
        if (resolvedProvider && resolved.model) {
          optimizedRequest.model = resolved.model;
        }
      }
      // else: keep original model ID for router to match directly (e.g. 'canopywave/moonshotai/kimi-k2.6')

      // Check for active A/B test matching this model
      const abTests = abTestingManager.listTests();
      const matchingTest = abTests.find(
        t => t.isActive && (t.modelA === body.model || t.modelB === body.model || t.modelA === optimizedRequest.model || t.modelB === optimizedRequest.model)
      );
      if (matchingTest) {
        const variant = abTestingManager.getVariant(matchingTest.id);
        activeAbTest = { testId: matchingTest.id, variant };
        optimizedRequest.model = variant === 'A' ? matchingTest.modelA : matchingTest.modelB;
        logger.info({ testId: matchingTest.id, variant, model: optimizedRequest.model }, '[ABTest] Routing to variant');
      }

      decision = await intelligentRouter.route(optimizedRequest);
      const provider = pluginManager.getProvider(decision.providerId);
      
      if (!provider) {
        return reply.status(404).send({ error: 'Provider not found' });
      }

      // 3. Generate hash-based cache key (not full JSON)
      const cacheKeyHash = generateCacheHash(decision.providerId, decision.modelId, optimizedRequest.messages);

      // Try semantic cache first
      const lastUserMessage = optimizedRequest.messages.filter(m => m.role === 'user').pop()?.content;
      if (!isStream && typeof lastUserMessage === 'string') {
        const semCached = await semanticCache.get(lastUserMessage);
        if (semCached) {
          return reply.send(semCached);
        }
      }

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

      let response: any;
      try {
        response = await requestDeduplicator.dedupe(
          provider.id,
          decision.modelId,
          request,
          () => forwardToProvider(provider, decision.modelId, optimizedRequest, isStream, cavemanMode)
        );
      } catch (primaryError) {
        // Primary provider failed — use smart fallback chain
        logger.warn(
          { provider: provider.id, error: (primaryError as Error).message },
          '[Fallback] Primary provider failed, trying fallback chain...'
        );

        // Fire webhook for provider failure
        webhookManager.fire({
          type: 'provider.down',
          timestamp: new Date(),
          payload: { provider: provider.id, error: (primaryError as Error).message },
        }).catch(() => {});

        response = await forwardWithFallback(provider, decision, optimizedRequest, isStream, cavemanMode);
      }

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
        // Record quota usage
        quotaTracker.recordUsage(decision.providerId, decision.providerId, tokensIn, 0, 0);

        // Log request
        requestLogger.logRequest({
          provider: decision.providerId,
          model: decision.modelId,
          status: 'ok',
          input_tokens: tokensIn,
          output_tokens: 0,
          latency_ms: Date.now() - startTime,
          endpoint: '/v1/chat/completions',
        });

        // Fire success webhook
        webhookManager.fire({
          type: 'request.completed',
          timestamp: new Date(),
          payload: {
            provider: decision.providerId,
            model: decision.modelId,
            tokensIn,
            tokensOut: 0,
            latencyMs: Date.now() - startTime,
            stream: true,
          },
        }).catch(() => {});

        return reply;
      }

      if (!isStream && typeof response === 'object') {
        tokensOut = response.usage?.completion_tokens || 0;
        tokensIn = response.usage?.prompt_tokens || tokensIn;
        const costBreakdown = pricingTracker.calculateCost(decision.providerId, decision.modelId, {
          input_tokens: tokensIn,
          output_tokens: tokensOut,
          cached_tokens: response.usage?.cached_tokens || 0,
          reasoning_tokens: response.usage?.reasoning_tokens || 0,
        });
        actualCost = costBreakdown.totalCost;
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

      // Record quota usage
      quotaTracker.recordUsage(decision.providerId, decision.providerId, tokensIn, tokensOut, actualCost);

      // Record benchmark
      modelBenchmark.record({
        providerId: decision.providerId,
        modelId: decision.modelId,
        latencyMs: latency,
        tokensIn,
        tokensOut,
        cost: actualCost,
        success: true,
        timestamp: new Date(),
      });

      // Record virtual key usage
      if (vKey) {
        virtualKeyManager.recordUsage(vKey.id, tokensIn, tokensOut, actualCost);
      }

      // Store in semantic cache
      if (!isStream && typeof response === 'object' && lastUserMessage && typeof lastUserMessage === 'string') {
        await semanticCache.set(lastUserMessage, response, 600);
      }

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

      // Log request with request logger
      requestLogger.logRequest({
        provider: decision.providerId,
        model: decision.modelId,
        status: 'ok',
        input_tokens: tokensIn,
        output_tokens: tokensOut,
        cached_tokens: !isStream && typeof response === 'object' ? (response.usage?.cached_tokens || 0) : 0,
        reasoning_tokens: !isStream && typeof response === 'object' ? (response.usage?.reasoning_tokens || 0) : 0,
        cost: actualCost,
        latency_ms: latency,
        endpoint: '/v1/chat/completions',
      });

      // Fire success webhook
      webhookManager.fire({
        type: 'request.completed',
        timestamp: new Date(),
        payload: {
          provider: decision.providerId,
          model: decision.modelId,
          tokensIn,
          tokensOut,
          cost: actualCost,
          latencyMs: latency,
        },
      }).catch(() => {});

      // Record A/B test result if applicable
      if (activeAbTest) {
        abTestingManager.recordResult(activeAbTest.testId, activeAbTest.variant, {
          latencyMs: latency,
          tokensIn,
          tokensOut,
          cost: actualCost,
        });
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

      // Log failed request
      requestLogger.logRequest({
        provider: decision?.providerId || 'unknown',
        model: decision?.modelId || body.model,
        status: 'error',
        input_tokens: 0,
        output_tokens: 0,
        cost: 0,
        latency_ms: latency,
        endpoint: '/v1/chat/completions',
        meta: { error: error instanceof Error ? error.message : 'Unknown error', statusCode },
      });

      // Record A/B test failure result if applicable
      if (activeAbTest) {
        abTestingManager.recordResult(activeAbTest.testId, activeAbTest.variant, {
          latencyMs: latency,
          tokensIn: 0,
          tokensOut: 0,
          cost: 0,
          error: error instanceof Error ? error.message : 'Unknown error',
        });
      }

      return reply.status(statusCode).send({
        error: statusCode === 502 ? 'Bad Gateway' : statusCode === 503 ? 'Service Unavailable' : 'Internal server error',
        message: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  });

  app.get('/debug/logs', async (request, reply) => {
    const auth = request.headers['x-api-key'] as string;
    if (!safeCompare(auth || '', process.env.ADMIN_API_KEY || '')) {
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
      const modelId = plan.modelMapping.get(provider.id) || decision.modelId;
      
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

      // Record benchmark failure
      modelBenchmark.record({
        providerId: provider.id,
        modelId: decision.modelId,
        latencyMs: Date.now(),
        tokensIn: 0,
        tokensOut: 0,
        cost: 0,
        success: false,
        timestamp: new Date(),
      });
    }
  }
  
  throw new Error(`All providers failed. Last error: ${lastError?.message || 'Unknown'}`);
}

async function forwardToProvider(provider: any, modelId: string, request: ChatRequest, stream: boolean = false, cavemanMode: boolean = false): Promise<any> {
  const envKey = `${provider.id.toUpperCase()}_API_KEY`;

  // Circuit breaker check
  if (!circuitBreaker.allowRequest(provider.id)) {
    throw new Error(`Circuit breaker OPEN for provider "${provider.name}". Try again later.`);
  }

  // Provider rate limit check
  const canProceed = await providerRateLimiter.checkLimit(provider.id);
  if (!canProceed) {
    throw new Error(`Provider "${provider.name}" rate limit nearly exhausted. Queued.`);
  }

  // Track multi-account connection for success/failure marking
  let connectionId: string | null = null;

  // Try multi-account manager first for API key selection
  let apiKey: string | undefined;
  const multiConn = await multiAccountManager.getConnection(provider.id, modelId);
  if (multiConn) {
    connectionId = multiConn.id;
    apiKey = multiConn.data.api_key || multiConn.data.apiKey || multiConn.data.token || undefined;
  }

  // Fallback to keyManager for round-robin key rotation
  if (!apiKey) {
    apiKey = keyManager.getNextKey(provider.id);
  }
  
  // Fallback to OAuth token if available (for OAuth providers like claude, gemini, github)
  if (!apiKey && oauthManager.hasToken(provider.id)) {
    apiKey = await oauthManager.getAccessToken(provider.id);
  }

  // Fallback to cookie-based auth if available (for cookie providers like kiro)
  let cookieHeader: string | undefined;
  let cookieUserAgent: string | undefined;
  if (provider.authType === 'cookie' || oauthManager.hasCookies(provider.id)) {
    const cookieCred = oauthManager.getCookies(provider.id);
    if (cookieCred) {
      cookieHeader = cookieCred.cookies;
      cookieUserAgent = cookieCred.userAgent;
    }
  }
  
  if (!apiKey && !cookieHeader && provider.authType !== 'none') {
    throw new Error(`API key not configured for provider "${provider.name}". Set the ${envKey} environment variable, connect via OAuth, or submit cookies via /oauth/${provider.id}/cookie-entry.`);
  }
  
  const safeApiKey = apiKey || '';
  
  const headers: Record<string, string> = {
    'Content-Type': 'application/json'
  };
  
  // Optional: use stored user-agent for fingerprint matching on cookie-based providers
  if (cookieUserAgent) {
    headers['User-Agent'] = cookieUserAgent;
  }
  
  if (provider.authType === 'bearer') {
    headers['Authorization'] = `Bearer ${safeApiKey}`;
  } else if (provider.authType === 'apikey') {
    headers[provider.authHeader || 'Authorization'] = safeApiKey;
  } else if (provider.authType === 'cookie' && cookieHeader) {
    headers['Cookie'] = cookieHeader;
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
  } else if (targetFormat === 'ollama') {
    // Ollama native format uses /api/chat
    endpoint = '/chat';
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
        providerRateLimiter.parseHeaders(provider.id, response.headers);
        circuitBreaker.recordFailure(provider.id);
        throw new Error(`Provider error (${response.status}): ${error}`);
      }

      // Parse rate limit headers on success
      providerRateLimiter.parseHeaders(provider.id, response.headers);
      providerRateLimiter.decrement(provider.id);
      circuitBreaker.recordSuccess(provider.id);

      // Mark multi-account connection as successful
      if (connectionId) {
        multiAccountManager.markSuccess(connectionId).catch(() => {});
      }

      if (stream) {
        return response.body;
      }

      const nativeResponse = await response.json() as any;

      // Translate response back to OpenAI format
      return formatTranslator.translateResponse(nativeResponse, targetFormat);
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      circuitBreaker.recordFailure(provider.id);

      // Mark multi-account connection as unavailable on error
      if (connectionId) {
        const statusMatch = lastError.message.match(/\((\d{3})\)/);
        const status = statusMatch ? parseInt(statusMatch[1]) : 500;
        multiAccountManager.markUnavailable(connectionId, status, lastError.message, provider.id, modelId).catch(() => {});
      }

      if (attempt === 0) {
        logger.warn({ provider: provider.id, attempt: 1 }, '[Retry] Provider attempt 1 failed, retrying...');
        await new Promise(r => setTimeout(r, 500)); // 500ms backoff
      }
    }
  }
  
  clearTimeout(timeout);

  // All retries exhausted — fire webhook for circuit breaker / provider down
  webhookManager.fire({
    type: 'provider.down',
    timestamp: new Date(),
    payload: { provider: provider.id, error: lastError?.message || 'Unknown' },
  }).catch(() => {});

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
