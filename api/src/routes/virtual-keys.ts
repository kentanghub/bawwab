import type { FastifyInstance } from 'fastify';
import { virtualKeyManager } from '../services/virtual-keys.js';

export async function virtualKeyRoutes(app: FastifyInstance) {
  // List keys (admin: all, user: own)
  app.get('/virtual-keys', async (request, reply) => {
    const auth = request.headers['x-api-key'];
    const isAdmin = auth === process.env.ADMIN_API_KEY;
    const owner = isAdmin ? undefined : (request.query as any).owner;
    const keys = virtualKeyManager.listKeys(owner).map(k => ({
      id: k.id,
      name: k.name,
      prefix: k.keyPrefix,
      owner: k.owner,
      createdAt: k.createdAt,
      expiresAt: k.expiresAt,
      revokedAt: k.revokedAt,
      quotas: k.quotas,
      rateLimits: k.rateLimits,
    }));
    return { keys };
  });

  // Create key
  app.post('/virtual-keys', async (request, reply) => {
    const auth = request.headers['x-api-key'];
    const isAdmin = auth === process.env.ADMIN_API_KEY;

    const body = request.body as any;
    if (!body.name || !body.owner) {
      return reply.status(400).send({ error: 'name and owner required' });
    }

    if (!isAdmin && body.owner !== (request as any).user?.id) {
      return reply.status(401).send({ error: 'Unauthorized' });
    }

    const { key, plainKey } = virtualKeyManager.createKey({
      name: body.name,
      owner: body.owner,
      quotas: body.quotas,
      rateLimits: body.rateLimits,
      expiresInDays: body.expiresInDays,
    });

    return reply.status(201).send({
      id: key.id,
      name: key.name,
      prefix: key.keyPrefix,
      plainKey, // ONLY returned on creation
      owner: key.owner,
      createdAt: key.createdAt,
      expiresAt: key.expiresAt,
      quotas: key.quotas,
      rateLimits: key.rateLimits,
    });
  });

  // Get single key usage
  app.get('/virtual-keys/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const summary = virtualKeyManager.getUsageSummary(id);
    if (!summary) return reply.status(404).send({ error: 'Key not found' });
    return summary;
  });

  // Revoke key
  app.post('/virtual-keys/:id/revoke', async (request, reply) => {
    const auth = request.headers['x-api-key'];
    if (auth !== process.env.ADMIN_API_KEY) {
      return reply.status(401).send({ error: 'Unauthorized' });
    }
    const { id } = request.params as { id: string };
    const ok = virtualKeyManager.revokeKey(id);
    if (!ok) return reply.status(404).send({ error: 'Key not found' });
    return { success: true };
  });

  // Delete key
  app.delete('/virtual-keys/:id', async (request, reply) => {
    const auth = request.headers['x-api-key'];
    if (auth !== process.env.ADMIN_API_KEY) {
      return reply.status(401).send({ error: 'Unauthorized' });
    }
    const { id } = request.params as { id: string };
    const ok = virtualKeyManager.deleteKey(id);
    if (!ok) return reply.status(404).send({ error: 'Key not found' });
    return { success: true };
  });
}
