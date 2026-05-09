import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { pluginManager } from '../plugins/manager.js';
import { healthMonitor } from '../services/health-monitor.js';
import { metricsCollector } from '../services/metrics.js';
import { getRecentLogs } from '../services/database.js';

// Auth middleware - verifies JWT token
async function requireAuth(request: FastifyRequest, reply: FastifyReply) {
  try {
    await request.jwtVerify();
    // Check if user has admin role
    const payload = request.user as any;
    if (payload.role !== 'admin') {
      return reply.status(403).send({ error: 'Forbidden - Admin access required' });
    }
  } catch {
    return reply.status(401).send({ error: 'Unauthorized - Valid JWT token required' });
  }
}

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

  app.get('/health', async () => {
    return { health: healthMonitor.getAllHealth() };
  });
}

export async function adminRoutes(app: FastifyInstance) {
  // Apply auth middleware to all admin routes
  app.addHook('preHandler', requireAuth);

  app.patch('/providers/:id/toggle', async (request, reply) => {
    const { id } = request.params as { id: string };
    const provider = pluginManager.getProvider(id);
    if (!provider) return reply.status(404).send({ error: 'Provider not found' });
    await pluginManager.updateProvider(id, { isEnabled: !provider.isEnabled });
    return { success: true, isEnabled: !provider.isEnabled };
  });

  app.get('/metrics', async () => {
    return {
      stats: metricsCollector.getStats(),
      hourly: metricsCollector.getHourlyStats()
    };
  });

  app.get('/logs', async (request) => {
    const { limit = '100' } = request.query as { limit?: string };
    return { logs: getRecentLogs(parseInt(limit)) };
  });

  // Token optimizer config endpoint
  app.get('/config/token-optimizer', async () => {
    return {
      config: {
        enabled: true,
        compressionLevel: 'medium',
        deduplicateToolResults: true,
        slidingWindowEnabled: true,
        maxContextTokens: 128000,
        semanticChunking: true
      }
    };
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

  // Real-time logs streaming
  app.get('/logs', { websocket: true }, (connection) => {
    let lastLogCount = 0;
    const interval = setInterval(() => {
      const logs = getRecentLogs(50);
      if (logs.length !== lastLogCount) {
        lastLogCount = logs.length;
        connection.socket.send(JSON.stringify({
          type: 'logs',
          data: logs,
          timestamp: Date.now()
        }));
      }
    }, 2000);

    connection.socket.on('close', () => clearInterval(interval));
  });
}
