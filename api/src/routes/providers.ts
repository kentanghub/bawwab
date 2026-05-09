import type { FastifyInstance } from 'fastify';
import { pluginManager } from '../plugins/manager.js';
import { healthMonitor } from '../services/health-monitor.js';
import { metricsCollector } from '../services/metrics.js';

export async function providerRoutes(app: FastifyInstance) {
  app.get('/', async () => {
    return {
      providers: pluginManager.getAllProviders().map(p => ({
        id: p.id,
        alias: p.alias,
        name: p.name,
        type: p.type,
        capabilities: p.capabilities,
        health: p.healthStatus,
        latency: p.latencyMs,
        successRate: p.successRate,
        costPer1kTokens: p.costPer1kTokens,
        isEnabled: p.isEnabled,
        models: p.models.map(m => ({
          id: m.id,
          name: m.name,
          contextWindow: m.contextWindow,
          supportsStreaming: m.supportsStreaming,
          supportsVision: m.supportsVision,
          supportsTools: m.supportsTools
        }))
      }))
    };
  });

  app.get('/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const provider = pluginManager.getProvider(id);
    if (!provider) return reply.status(404).send({ error: 'Provider not found' });
    return { provider };
  });

  app.patch('/:id/toggle', async (request, reply) => {
    const { id } = request.params as { id: string };
    const provider = pluginManager.getProvider(id);
    if (!provider) return reply.status(404).send({ error: 'Provider not found' });
    await pluginManager.updateProvider(id, { isEnabled: !provider.isEnabled });
    return { success: true, isEnabled: !provider.isEnabled };
  });

  app.get('/health', async () => {
    return { health: healthMonitor.getAllHealth() };
  });
}

export async function adminRoutes(app: FastifyInstance) {
  app.get('/metrics', async () => {
    return {
      stats: metricsCollector.getStats(),
      hourly: metricsCollector.getHourlyStats()
    };
  });

  app.get('/logs', async (request) => {
    const { limit = '100' } = request.query as { limit?: string };
    return { logs: metricsCollector.getRecentLogs(parseInt(limit)) };
  });
}

export async function wsRoutes(app: FastifyInstance) {
  app.get('/metrics', { websocket: true }, (connection) => {
    const interval = setInterval(() => {
      const stats = metricsCollector.getStats();
      connection.socket.send(JSON.stringify({
        type: 'metrics',
        data: stats,
        timestamp: Date.now()
      }));
    }, 5000);

    connection.socket.on('close', () => clearInterval(interval));
  });

  app.get('/health', { websocket: true }, (connection) => {
    const interval = setInterval(() => {
      const health = healthMonitor.getAllHealth();
      connection.socket.send(JSON.stringify({
        type: 'health',
        data: health,
        timestamp: Date.now()
      }));
    }, 10000);

    connection.socket.on('close', () => clearInterval(interval));
  });
}
