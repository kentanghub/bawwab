import type { FastifyInstance } from 'fastify';
import { pluginManager } from '../plugins/manager.js';
import { metricsCollector } from '../services/metrics.js';
import { logger } from '../services/logger.js';

// Generic capability router for non-chat endpoints
async function routeCapability(
  capability: string,
  request: any,
  reply: any,
  endpoint: string,
  bodyTransformer?: (body: any, model: string) => any
): Promise<any> {
  const startTime = Date.now();

  // Find providers with this capability
  const providers = pluginManager.getProvidersByCapability(capability);
  if (providers.length === 0) {
    return reply.status(503).send({
      error: 'Service Unavailable',
      message: `No provider available for capability: ${capability}`
    });
  }

  // Pick best provider (first enabled, healthy one)
  const provider = providers.find(p =>
    p.healthStatus.status !== 'unhealthy' &&
    p.healthStatus.consecutiveFailures < 3
  ) || providers[0];

  const model = request.body?.model || provider.models[0]?.id || 'default';
  let lastError: Error | null = null;

  for (const tryProvider of [provider, ...providers.filter(p => p.id !== provider.id)].slice(0, 3)) {
    try {
      const result = await forwardToProvider(tryProvider, endpoint, request.body, bodyTransformer);

      metricsCollector.record({
        id: crypto.randomUUID(),
        timestamp: new Date(),
        providerId: tryProvider.id,
        modelId: model,
        endpoint: `/v1${endpoint}`,
        statusCode: 200,
        latencyMs: Date.now() - startTime,
        tokensIn: 0,
        tokensOut: 0,
        cost: 0,
        userAgent: request.headers['user-agent']?.toString(),
        clientIp: request.ip
      });

      return reply.send(result);
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      logger.warn({ provider: tryProvider.id, capability, error: lastError.message }, '[Capability] Provider failed, trying next...');
    }
  }

  metricsCollector.record({
    id: crypto.randomUUID(),
    timestamp: new Date(),
    providerId: 'unknown',
    modelId: model,
    endpoint: `/v1${endpoint}`,
    statusCode: 502,
    latencyMs: Date.now() - startTime,
    tokensIn: 0,
    tokensOut: 0,
    cost: 0,
    error: lastError?.message || 'All providers failed',
    userAgent: request.headers['user-agent']?.toString(),
    clientIp: request.ip
  });

  return reply.status(502).send({
    error: 'Bad Gateway',
    message: lastError?.message || `All ${capability} providers failed`
  });
}

async function forwardToProvider(
  provider: any,
  endpoint: string,
  body: any,
  bodyTransformer?: (body: any, model: string) => any
): Promise<any> {
  const envKey = `${provider.id.toUpperCase()}_API_KEY`;
  const apiKey = process.env[envKey];

  if (!apiKey && provider.authType !== 'none') {
    throw new Error(`API key not configured for provider "${provider.name}". Set the ${envKey} environment variable.`);
  }

  const headers: Record<string, string> = {
    'Content-Type': 'application/json'
  };

  if (provider.authType === 'bearer') {
    headers['Authorization'] = `Bearer ${apiKey || ''}`;
  } else if (provider.authType === 'apikey') {
    headers[provider.authHeader || 'Authorization'] = apiKey || '';
  }

  const model = body?.model || provider.models[0]?.id || 'default';
  const transformedBody = bodyTransformer ? bodyTransformer(body, model) : { ...body, model };

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 60000);

  try {
    const response = await fetch(`${provider.baseUrl}${endpoint}`, {
      method: 'POST',
      headers,
      body: JSON.stringify(transformedBody),
      signal: controller.signal
    });

    clearTimeout(timeout);

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Provider error (${response.status}): ${error}`);
    }

    return await response.json();
  } catch (err) {
    clearTimeout(timeout);
    throw err;
  }
}

// Forward GET requests (for web search / fetch)
async function forwardGetToProvider(
  provider: any,
  endpoint: string,
  queryParams: Record<string, string>
): Promise<any> {
  const envKey = `${provider.id.toUpperCase()}_API_KEY`;
  const apiKey = process.env[envKey];

  const headers: Record<string, string> = {};

  if (provider.authType === 'bearer') {
    headers['Authorization'] = `Bearer ${apiKey || ''}`;
  } else if (provider.authType === 'apikey') {
    headers[provider.authHeader || 'Authorization'] = apiKey || '';
  }

  const url = new URL(`${provider.baseUrl}${endpoint}`);
  Object.entries(queryParams).forEach(([k, v]) => url.searchParams.set(k, v));

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30000);

  try {
    const response = await fetch(url.toString(), {
      method: 'GET',
      headers,
      signal: controller.signal
    });

    clearTimeout(timeout);

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Provider error (${response.status}): ${error}`);
    }

    return await response.json();
  } catch (err) {
    clearTimeout(timeout);
    throw err;
  }
}

export async function capabilityRoutes(app: FastifyInstance) {
  // ═══════════════════════════════════════════════
  // IMAGE GENERATION
  // ═══════════════════════════════════════════════
  app.post('/images/generations', async (request, reply) => {
    const startTime = Date.now();
    const body = request.body as any;
    const prompt = body?.prompt;

    if (!prompt) {
      return reply.status(400).send({ error: 'Missing prompt' });
    }

    const providers = pluginManager.getProvidersByCapability('image');
    if (providers.length === 0) {
      return reply.status(503).send({ error: 'No image provider available' });
    }

    // Try OpenAI-style providers first
    const openaiStyle = providers.find(p => p.id === 'openai' || p.id === 'gemini');
    const pollinations = providers.find(p => p.id === 'pollinations');

    let lastError: Error | null = null;

    // Try OpenAI-style POST endpoint
    if (openaiStyle) {
      try {
        const envKey = `${openaiStyle.id.toUpperCase()}_API_KEY`;
        const apiKey = process.env[envKey];
        const headers: Record<string, string> = { 'Content-Type': 'application/json' };
        if (openaiStyle.authType === 'bearer' && apiKey) headers['Authorization'] = `Bearer ${apiKey}`;
        else if (openaiStyle.authType === 'apikey' && apiKey) headers[openaiStyle.authHeader || 'Authorization'] = apiKey;

        const response = await fetch(`${openaiStyle.baseUrl}/images/generations`, {
          method: 'POST',
          headers,
          body: JSON.stringify({
            prompt,
            model: body.model || 'dall-e-3',
            n: body.n || 1,
            size: body.size || '1024x1024'
          })
        });

        if (response.ok) {
          const result = await response.json();
          metricsCollector.record({
            id: crypto.randomUUID(),
            timestamp: new Date(),
            providerId: openaiStyle.id,
            modelId: body.model || 'dall-e-3',
            endpoint: '/v1/images/generations',
            statusCode: 200,
            latencyMs: Date.now() - startTime,
            tokensIn: 0,
            tokensOut: 0,
            cost: 0,
            userAgent: request.headers['user-agent']?.toString(),
            clientIp: request.ip
          });
          return reply.send(result);
        }
      } catch (err) {
        lastError = err instanceof Error ? err : new Error(String(err));
      }
    }

    // Fallback to Pollinations (free, returns binary image)
    if (pollinations) {
      try {
        const model = body.model || 'flux';
        const width = body.width || 1024;
        const height = body.height || 1024;
        const seed = body.seed || Math.floor(Math.random() * 1000000);

        const url = `https://image.pollinations.ai/prompt/${encodeURIComponent(prompt)}?model=${model}&width=${width}&height=${height}&seed=${seed}&nologo=true`;

        const response = await fetch(url, { method: 'GET' });
        if (response.ok) {
          const contentType = response.headers.get('content-type') || 'image/png';
          const buffer = await response.arrayBuffer();

          metricsCollector.record({
            id: crypto.randomUUID(),
            timestamp: new Date(),
            providerId: 'pollinations',
            modelId: model,
            endpoint: '/v1/images/generations',
            statusCode: 200,
            latencyMs: Date.now() - startTime,
            tokensIn: 0,
            tokensOut: 0,
            cost: 0,
            userAgent: request.headers['user-agent']?.toString(),
            clientIp: request.ip
          });

          reply.header('Content-Type', contentType);
          return reply.send(Buffer.from(buffer));
        }
      } catch (err) {
        lastError = err instanceof Error ? err : new Error(String(err));
      }
    }

    return reply.status(502).send({
      error: 'Image generation failed',
      message: lastError?.message || 'All providers failed'
    });
  });

  app.post('/images/edits', async (request, reply) => {
    return routeCapability('image', request, reply, '/images/edits');
  });

  app.post('/images/variations', async (request, reply) => {
    return routeCapability('image', request, reply, '/images/variations');
  });

  // ═══════════════════════════════════════════════
  // TEXT-TO-SPEECH (TTS)
  // ═══════════════════════════════════════════════
  app.post('/audio/speech', async (request, reply) => {
    const startTime = Date.now();
    const providers = pluginManager.getProvidersByCapability('tts');

    if (providers.length === 0) {
      return reply.status(503).send({ error: 'No TTS provider available' });
    }

    const provider = providers[0];
    const envKey = `${provider.id.toUpperCase()}_API_KEY`;
    const apiKey = process.env[envKey];

    const headers: Record<string, string> = {
      'Content-Type': 'application/json'
    };
    if (provider.authType === 'bearer') headers['Authorization'] = `Bearer ${apiKey || ''}`;
    else if (provider.authType === 'apikey') headers[provider.authHeader || 'Authorization'] = apiKey || '';

    const body = request.body as any;
    const transformedBody = {
      ...body,
      model: body.model || provider.models.find((m: any) => m.id.includes('tts'))?.id || provider.models[0]?.id
    };

    try {
      const response = await fetch(`${provider.baseUrl}/audio/speech`, {
        method: 'POST',
        headers,
        body: JSON.stringify(transformedBody)
      });

      if (!response.ok) {
        const err = await response.text();
        throw new Error(`TTS error: ${err}`);
      }

      // Stream audio back
      reply.header('Content-Type', response.headers.get('content-type') || 'audio/mpeg');
      const buffer = await response.arrayBuffer();

      metricsCollector.record({
        id: crypto.randomUUID(),
        timestamp: new Date(),
        providerId: provider.id,
        modelId: transformedBody.model,
        endpoint: '/v1/audio/speech',
        statusCode: 200,
        latencyMs: Date.now() - startTime,
        tokensIn: 0,
        tokensOut: 0,
        cost: 0,
        userAgent: request.headers['user-agent']?.toString(),
        clientIp: request.ip
      });

      return reply.send(Buffer.from(buffer));
    } catch (err: any) {
      return reply.status(502).send({ error: 'TTS failed', message: err.message });
    }
  });

  // ═══════════════════════════════════════════════
  // SPEECH-TO-TEXT (STT / Transcriptions)
  // ═══════════════════════════════════════════════
  app.post('/audio/transcriptions', async (request, reply) => {
    const startTime = Date.now();
    const providers = pluginManager.getProvidersByCapability('stt');

    if (providers.length === 0) {
      return reply.status(503).send({ error: 'No STT provider available' });
    }

    const provider = providers[0];
    const envKey = `${provider.id.toUpperCase()}_API_KEY`;
    const apiKey = process.env[envKey];

    // Forward multipart body directly
    const response = await fetch(`${provider.baseUrl}/audio/transcriptions`, {
      method: 'POST',
      headers: {
        ...(provider.authType === 'bearer' && apiKey ? { 'Authorization': `Bearer ${apiKey}` } : {}),
        ...(provider.authType === 'apikey' && apiKey ? { [provider.authHeader || 'Authorization']: apiKey } : {})
      },
      body: request.body as any
    });

    if (!response.ok) {
      const err = await response.text();
      return reply.status(502).send({ error: 'STT failed', message: err });
    }

    const result = await response.json();
    const body = request.body as any;

    metricsCollector.record({
      id: crypto.randomUUID(),
      timestamp: new Date(),
      providerId: provider.id,
      modelId: body?.model || 'whisper-1',
      endpoint: '/v1/audio/transcriptions',
      statusCode: 200,
      latencyMs: Date.now() - startTime,
      tokensIn: 0,
      tokensOut: 0,
      cost: 0,
      userAgent: request.headers['user-agent']?.toString(),
      clientIp: request.ip
    });

    return reply.send(result);
  });

  app.post('/audio/translations', async (request, reply) => {
    return routeCapability('stt', request, reply, '/audio/translations');
  });

  // ═══════════════════════════════════════════════
  // EMBEDDINGS
  // ═══════════════════════════════════════════════
  app.post('/embeddings', async (request, reply) => {
    return routeCapability('embedding', request, reply, '/embeddings');
  });

  // ═══════════════════════════════════════════════
  // WEB SEARCH
  // ═══════════════════════════════════════════════
  app.post('/web/search', async (request, reply) => {
    const startTime = Date.now();
    const body = request.body as any;
    const query = body?.query || body?.q;

    if (!query) {
      return reply.status(400).send({ error: 'Missing query parameter' });
    }

    const providers = pluginManager.getProvidersByCapability('webSearch');
    if (providers.length === 0) {
      // Fallback: use webFetch with DuckDuckGo HTML scraping via SearXNG or similar
      return reply.status(503).send({ error: 'No web search provider configured' });
    }

    let lastError: Error | null = null;
    for (const provider of providers) {
      try {
        const result = await forwardToProvider(provider, '/search', request.body);
        metricsCollector.record({
          id: crypto.randomUUID(),
          timestamp: new Date(),
          providerId: provider.id,
          modelId: 'search',
          endpoint: '/v1/web/search',
          statusCode: 200,
          latencyMs: Date.now() - startTime,
          tokensIn: 0,
          tokensOut: 0,
          cost: 0,
          userAgent: request.headers['user-agent']?.toString(),
          clientIp: request.ip
        });
        return reply.send(result);
      } catch (err) {
        lastError = err instanceof Error ? err : new Error(String(err));
      }
    }

    return reply.status(502).send({ error: 'Search failed', message: lastError?.message });
  });

  // ═══════════════════════════════════════════════
  // WEB FETCH
  // ═══════════════════════════════════════════════
  app.post('/web/fetch', async (request, reply) => {
    const startTime = Date.now();
    const body = request.body as any;
    const url = body?.url;

    if (!url) {
      return reply.status(400).send({ error: 'Missing url parameter' });
    }

    // Try direct fetch first
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 15000);

      const response = await fetch(url, {
        method: 'GET',
        headers: {
          'User-Agent': 'BawwabBot/1.0 (+https://bawwab.dev)'
        },
        signal: controller.signal,
        redirect: 'follow'
      });

      clearTimeout(timeout);

      const contentType = response.headers.get('content-type') || '';
      let result: any;

      if (contentType.includes('application/json')) {
        result = { type: 'json', data: await response.json() };
      } else {
        const text = await response.text();
        // Truncate if too large
        result = {
          type: 'html',
          url: response.url,
          status: response.status,
          title: text.match(/<title[^>]*>([^<]*)<\/title>/i)?.[1] || '',
          content: text.slice(0, 50000), // 50KB limit
          length: text.length
        };
      }

      metricsCollector.record({
        id: crypto.randomUUID(),
        timestamp: new Date(),
        providerId: 'direct',
        modelId: 'fetch',
        endpoint: '/v1/web/fetch',
        statusCode: 200,
        latencyMs: Date.now() - startTime,
        tokensIn: 0,
        tokensOut: 0,
        cost: 0,
        userAgent: request.headers['user-agent']?.toString(),
        clientIp: request.ip
      });

      return reply.send(result);
    } catch (err: any) {
      // Fallback to webFetch providers if direct fetch fails
      const providers = pluginManager.getProvidersByCapability('webFetch');
      if (providers.length > 0) {
        for (const provider of providers) {
          try {
            const result = await forwardToProvider(provider, '/fetch', request.body);
            return reply.send(result);
          } catch {
            continue;
          }
        }
      }

      return reply.status(502).send({
        error: 'Fetch failed',
        message: err.message
      });
    }
  });

  // ═══════════════════════════════════════════════
  // IMAGE-TO-TEXT (Vision / OCR)
  // ═══════════════════════════════════════════════
  app.post('/images/vision', async (request, reply) => {
    return routeCapability('imageToText', request, reply, '/vision');
  });
}
