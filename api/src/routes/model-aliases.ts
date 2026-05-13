import type { FastifyInstance } from 'fastify';
import { modelAliasManager } from '../services/model-aliases.js';

export async function modelAliasRoutes(app: FastifyInstance) {
  // List all user-configurable aliases
  app.get('/aliases', async () => {
    return { aliases: modelAliasManager.listAliases() };
  });

  // Set an alias
  app.post('/aliases', async (request, reply) => {
    const { alias, target } = request.body as { alias?: string; target?: string };
    if (!alias || !target) {
      return reply.status(400).send({ error: 'Both alias and target are required' });
    }
    modelAliasManager.setAlias(alias, target);
    return { ok: true, alias, target };
  });

  // Remove an alias
  app.delete('/aliases/:alias', async (request, reply) => {
    const { alias } = request.params as { alias: string };
    const removed = modelAliasManager.removeAlias(alias);
    if (!removed) {
      return reply.status(404).send({ error: 'Alias not found' });
    }
    return { ok: true };
  });

  // Resolve a model string
  app.post('/aliases/resolve', async (request, reply) => {
    const { model } = request.body as { model?: string };
    if (!model) {
      return reply.status(400).send({ error: 'model is required' });
    }
    const resolved = modelAliasManager.resolveAlias(model);
    return { input: model, ...resolved };
  });

  // Also expose the hardcoded provider prefix aliases
  app.get('/aliases/providers', async () => {
    return { providers: modelAliasManager.getProviderPrefixAliases() };
  });
}
