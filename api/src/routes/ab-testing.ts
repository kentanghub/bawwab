/**
 * A/B Testing Routes
 */
import type { FastifyInstance } from 'fastify';
import { safeCompare } from '../services/database.js';
import { abTestingManager } from '../services/ab-testing.js';

export async function abTestingRoutes(app: FastifyInstance) {
  // List all tests
  app.get('/v1/ab-tests', async () => {
    const tests = abTestingManager.listTests();
    return { tests };
  });

  // Create a new test
  app.post('/v1/ab-tests', async (request, reply) => {
    const body = request.body as {
      name?: string;
      modelA?: string;
      modelB?: string;
      splitPercent?: number;
    };

    if (!body.name) {
      return reply.status(400).send({ error: 'name is required' });
    }
    if (!body.modelA || !body.modelB) {
      return reply.status(400).send({ error: 'modelA and modelB are required' });
    }
    if (body.splitPercent !== undefined && (body.splitPercent < 0 || body.splitPercent > 100)) {
      return reply.status(400).send({ error: 'splitPercent must be between 0 and 100' });
    }

    const test = abTestingManager.createTest({
      name: body.name,
      modelA: body.modelA,
      modelB: body.modelB,
      splitPercent: body.splitPercent,
    });

    return reply.status(201).send(test);
  });

  // Get test stats with winner
  app.get('/v1/ab-tests/:id/stats', async (request, reply) => {
    const { id } = request.params as { id: string };
    const stats = abTestingManager.getStats(id);
    if (!stats) return reply.status(404).send({ error: 'Test not found' });
    return stats;
  });

  // Delete a test
  app.delete('/v1/ab-tests/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const ok = abTestingManager.deleteTest(id);
    if (!ok) return reply.status(404).send({ error: 'Test not found' });
    return { success: true };
  });
}
