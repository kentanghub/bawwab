import type { FastifyInstance } from 'fastify';
import { modelDiscovery } from '../services/model-discovery.js';
import { webhookManager } from '../services/webhooks.js';
import { contentSafety } from '../services/content-safety.js';
import { circuitBreaker } from '../services/circuit-breaker.js';
import { semanticCache } from '../services/semantic-cache.js';

export async function advancedRoutes(app: FastifyInstance) {
  // ─── Model Discovery ───
  app.post('/discovery/sync/:providerId', async (request, reply) => {
    const auth = request.headers['x-api-key'];
    if (auth !== process.env.ADMIN_API_KEY) return reply.status(401).send({ error: 'Unauthorized' });
    const { providerId } = request.params as { providerId: string };
    const added = await modelDiscovery.syncProviderModels(providerId);
    return { providerId, modelsAdded: added };
  });

  app.post('/discovery/sync-all', async (request, reply) => {
    const auth = request.headers['x-api-key'];
    if (auth !== process.env.ADMIN_API_KEY) return reply.status(401).send({ error: 'Unauthorized' });
    const results = await modelDiscovery.syncAll();
    return { results };
  });

  // ─── Webhooks ───
  app.get('/webhooks', async () => {
    return { subscriptions: webhookManager.getSubscriptions() };
  });

  app.post('/webhooks', async (request, reply) => {
    const body = request.body as any;
    if (!body.url || !body.events || !Array.isArray(body.events)) {
      return reply.status(400).send({ error: 'url and events[] required' });
    }
    const sub = webhookManager.subscribe({
      url: body.url,
      events: body.events,
      secret: body.secret,
      active: body.active !== false,
    });
    return reply.status(201).send(sub);
  });

  app.delete('/webhooks/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const ok = webhookManager.unsubscribe(id);
    if (!ok) return reply.status(404).send({ error: 'Not found' });
    return { success: true };
  });

  // ─── Content Safety Test ───
  app.post('/safety/scan', async (request) => {
    const body = request.body as any;
    const messages = body.messages || [];
    return contentSafety.scanRequest(messages);
  });

  // ─── Circuit Breaker Status ───
  app.get('/circuit-breaker', async () => {
    return circuitBreaker.getAllStates();
  });

  // ─── Semantic Cache Stats ───
  app.get('/semantic-cache', async () => {
    return semanticCache.getStats();
  });
}
