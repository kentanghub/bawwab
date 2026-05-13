import type { FastifyInstance } from 'fastify';
import { cloudSync } from '../services/cloud-sync.js';

export async function cloudSyncRoutes(app: FastifyInstance) {
  // Get sync status
  app.get('/sync/status', async () => {
    return cloudSync.getSyncStatus();
  });

  // Export state
  app.post('/sync/export', async () => {
    return cloudSync.exportState();
  });

  // Import state
  app.post('/sync/import', async (request, reply) => {
    const data = request.body;
    if (!data || typeof data !== 'object') {
      return reply.status(400).send({ error: 'Request body must be a JSON object (exported state)' });
    }
    const result = cloudSync.importState(data as any);
    return { ok: true, ...result };
  });
}
