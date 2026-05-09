import Fastify from 'fastify';
import cors from '@fastify/cors';
import jwt from '@fastify/jwt';
import rateLimit from '@fastify/rate-limit';
import websocket from '@fastify/websocket';
import compress from '@fastify/compress';
import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';
import dotenv from 'dotenv';
import crypto from 'node:crypto';
import { pluginManager } from './plugins/manager.js';
import { healthMonitor } from './services/health-monitor.js';
import { tokenOptimizer } from './services/token-optimizer.js';
import { intelligentRouter } from './services/intelligent-router.js';
import { cacheManager } from './services/cache-manager.js';
import { metricsCollector } from './services/metrics.js';
import { prometheusMetrics } from './services/prometheus.js';
import { initDatabase, closeDb } from './services/database.js';
import { authRoutes } from './routes/auth.js';
import { chatRoutes } from './routes/chat.js';
import { capabilityRoutes } from './routes/capabilities.js';
import { compareRoutes } from './routes/compare.js';
import { providerRoutes, adminRoutes, wsRoutes } from './routes/providers.js';

dotenv.config();

// Security: require JWT_SECRET in production
if (process.env.NODE_ENV === 'production' && !process.env.JWT_SECRET) {
  throw new Error('JWT_SECRET environment variable is required in production');
}
const JWT_SECRET = process.env.JWT_SECRET || crypto.randomUUID();

const app = Fastify({
  logger: {
    level: process.env.LOG_LEVEL || 'info',
    transport: process.env.NODE_ENV === 'development' ? {
      target: 'pino-pretty',
      options: { colorize: true }
    } : undefined
  },
  bodyLimit: 10485760 // 10MB max request body
});

// Request ID tracing
app.addHook('onRequest', async (request, reply) => {
  const requestId = request.headers['x-request-id']?.toString() || crypto.randomUUID();
  request.id = requestId;
  reply.header('x-request-id', requestId);
});

// Register plugins
await app.register(cors, { 
  origin: process.env.NODE_ENV === 'production' 
    ? (process.env.CORS_ORIGIN || false) 
    : true, 
  credentials: true 
});
await app.register(jwt, { secret: JWT_SECRET });
await app.register(rateLimit, {
  max: 100,
  timeWindow: '1 minute',
  keyGenerator: (req) => req.headers['x-api-key']?.toString() || req.ip
});
await app.register(websocket);
await app.register(compress, { global: true });

// Swagger docs
await app.register(swagger, {
  openapi: {
    info: {
      title: 'Bawwab API',
      description: 'Intelligent AI Gateway',
      version: '0.1.0'
    },
    tags: [
      { name: 'Auth', description: 'Authentication endpoints' },
      { name: 'Chat', description: 'Chat completion endpoints' },
      { name: 'Providers', description: 'Provider management' },
      { name: 'Admin', description: 'Administration' }
    ]
  }
});
await app.register(swaggerUi, { routePrefix: '/docs' });

// Prometheus metrics endpoint
app.get('/metrics', async (request, reply) => {
  reply.header('Content-Type', prometheusMetrics.getContentType());
  return prometheusMetrics.getMetrics();
});

// Initialize services
app.addHook('onReady', async () => {
  app.log.info('🚪 Bawwab Gateway starting...');
  
  initDatabase();
  app.log.info('🗄️ Database initialized');
  
  await pluginManager.loadPlugins();
  app.log.info(`📦 Loaded ${pluginManager.getAllProviders().length} providers`);
  
  await healthMonitor.start();
  app.log.info('💓 Health monitor started');
  
  await cacheManager.connect();
  app.log.info('💾 Cache manager connected');
  
  tokenOptimizer.initialize();
  app.log.info('🗜️ Token optimizer initialized');
  
  intelligentRouter.initialize();
  app.log.info('🧠 Intelligent router initialized');
  
  metricsCollector.initialize();
  app.log.info('📊 Metrics collector initialized');
  
  app.log.info('✅ Bawwab Gateway ready');
});

// Register routes
await app.register(authRoutes, { prefix: '/v1/auth' });
await app.register(chatRoutes, { prefix: '/v1' });
await app.register(capabilityRoutes, { prefix: '/v1' });
await app.register(compareRoutes, { prefix: '/v1' });
await app.register(providerRoutes, { prefix: '/v1/providers' });
await app.register(adminRoutes, { prefix: '/v1/admin' });
await app.register(wsRoutes, { prefix: '/ws' });

// Health check
app.get('/health', async () => ({
  status: 'healthy',
  version: '0.1.0',
  services: {
    cache: cacheManager.isConnected(),
    healthMonitor: healthMonitor.isRunning()
  }
}));

// Error handler
app.setErrorHandler((error, request, reply) => {
  app.log.error(error);
  reply.status(error.statusCode || 500).send({
    error: error.name,
    message: error.message,
    ...(process.env.NODE_ENV === 'development' && { stack: error.stack })
  });
});

// Graceful shutdown
app.addHook('onClose', async () => {
  await healthMonitor.stop();
  await cacheManager.disconnect();
  closeDb();
});

// SIGTERM / SIGINT handlers for Docker/Kubernetes graceful shutdown
const shutdown = async (signal: string) => {
  app.log.info(`Received ${signal}, shutting down gracefully...`);
  try {
    await app.close();
    app.log.info('Graceful shutdown complete');
    process.exit(0);
  } catch (err) {
    app.log.error(err, 'Error during graceful shutdown');
    process.exit(1);
  }
};

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

const PORT = parseInt(process.env.PORT || '3001');
const HOST = process.env.HOST || '0.0.0.0';

try {
  await app.listen({ port: PORT, host: HOST });
  app.log.info(`🚀 Bawwab API running on http://${HOST}:${PORT}`);
} catch (err) {
  app.log.error(err);
  process.exit(1);
}

export { app };
