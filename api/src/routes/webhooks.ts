/**
 * Webhook Routes
 */
import type { FastifyInstance } from 'fastify';
import { safeCompare } from '../services/database.js';
import { webhookManager } from '../services/webhooks.js';
import type { WebhookEventType } from '../services/webhooks.js';

const VALID_EVENTS: WebhookEventType[] = [
  'request.completed',
  'quota.exceeded',
  'provider.down',
  'cost.threshold',
  'circuit.opened',
  'key.revoked',
];

export async function webhookRoutes(app: FastifyInstance) {
  // List all webhook subscriptions
  app.get('/v1/webhooks', async () => {
    const subs = webhookManager.list();
    return { webhooks: subs };
  });

  // Subscribe to webhook events
  app.post('/v1/webhooks', async (request, reply) => {
    const auth = request.headers['authorization']?.replace('Bearer ', '') || request.headers['x-api-key'] as string || '';
    if (!safeCompare(auth, process.env.ADMIN_API_KEY || '')) {
      return reply.status(401).send({ error: 'Unauthorized' });
    }
    const body = request.body as {
      url?: string;
      events?: string[];
      secret?: string;
    };

    if (!body.url) {
      return reply.status(400).send({ error: 'url is required' });
    }
    if (!body.events || !Array.isArray(body.events) || body.events.length === 0) {
      return reply.status(400).send({ error: 'events[] is required' });
    }

    // Validate event types
    const invalid = body.events.filter(e => !VALID_EVENTS.includes(e as WebhookEventType));
    if (invalid.length > 0) {
      return reply.status(400).send({
        error: `Invalid event types: ${invalid.join(', ')}`,
        validEvents: VALID_EVENTS,
      });
    }

    const sub = webhookManager.subscribe({
      url: body.url,
      events: body.events as WebhookEventType[],
      secret: body.secret,
    });

    return reply.status(201).send(sub);
  });

  // Unsubscribe
  app.delete('/v1/webhooks/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const ok = webhookManager.unsubscribe(id);
    if (!ok) return reply.status(404).send({ error: 'Webhook not found' });
    return { success: true };
  });
}
