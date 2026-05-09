import type { FastifyInstance } from 'fastify';
import { comboManager } from '../services/combo-manager.js';
import { logger } from '../services/logger.js';

export async function comboRoutes(app: FastifyInstance) {
  // List all combos
  app.get('/combos', async () => {
    return {
      combos: comboManager.getAllCombos().map(c => ({
        id: c.id,
        name: c.name,
        description: c.description,
        providerCount: c.providers.length,
        createdAt: c.createdAt,
      }))
    };
  });

  // Get single combo
  app.get('/combos/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const combo = comboManager.getCombo(id);

    if (!combo) {
      return reply.status(404).send({ error: 'Combo not found' });
    }

    return {
      ...combo,
      resolvedProviders: comboManager.getComboProviders(id).map(p => ({
        providerId: p.provider.id,
        providerName: p.provider.name,
        modelId: p.modelId,
        priority: p.priority,
        healthy: p.provider.healthStatus.status !== 'unhealthy',
      }))
    };
  });

  // Create combo
  app.post('/combos', async (request, reply) => {
    const auth = request.headers['x-api-key'];
    if (auth !== process.env.ADMIN_API_KEY) {
      return reply.status(401).send({ error: 'Unauthorized' });
    }

    const body = request.body as any;

    if (!body.id || !body.name || !body.providers || !Array.isArray(body.providers)) {
      return reply.status(400).send({
        error: 'Invalid request',
        message: 'id, name, and providers array are required'
      });
    }

    // Validate providers
    for (const p of body.providers) {
      if (!p.providerId || !p.modelId || typeof p.priority !== 'number') {
        return reply.status(400).send({
          error: 'Invalid provider entry',
          message: 'Each provider must have providerId, modelId, and priority'
        });
      }
    }

    try {
      const combo = comboManager.createCombo({
        id: body.id,
        name: body.name,
        description: body.description,
        providers: body.providers,
      });

      return reply.status(201).send(combo);
    } catch (error) {
      return reply.status(400).send({
        error: 'Failed to create combo',
        message: (error as Error).message
      });
    }
  });

  // Update combo
  app.patch('/combos/:id', async (request, reply) => {
    const auth = request.headers['x-api-key'];
    if (auth !== process.env.ADMIN_API_KEY) {
      return reply.status(401).send({ error: 'Unauthorized' });
    }

    const { id } = request.params as { id: string };
    const body = request.body as any;

    const updated = comboManager.updateCombo(id, {
      name: body.name,
      description: body.description,
      providers: body.providers,
    });

    if (!updated) {
      return reply.status(404).send({ error: 'Combo not found' });
    }

    return updated;
  });

  // Delete combo
  app.delete('/combos/:id', async (request, reply) => {
    const auth = request.headers['x-api-key'];
    if (auth !== process.env.ADMIN_API_KEY) {
      return reply.status(401).send({ error: 'Unauthorized' });
    }

    const { id } = request.params as { id: string };

    try {
      const deleted = comboManager.deleteCombo(id);
      if (!deleted) {
        return reply.status(404).send({ error: 'Combo not found' });
      }
      return { success: true, message: 'Combo deleted' };
    } catch (error) {
      return reply.status(400).send({
        error: 'Failed to delete combo',
        message: (error as Error).message
      });
    }
  });
}
