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
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import fastifyStatic from '@fastify/static';
import cookie from '@fastify/cookie';
import { pluginManager } from './plugins/manager.js';
import { healthMonitor } from './services/health-monitor.js';
import { tokenOptimizer } from './services/token-optimizer.js';
import { intelligentRouter } from './services/intelligent-router.js';
import { cacheManager } from './services/cache-manager.js';
import { metricsCollector } from './services/metrics.js';
import { prometheusMetrics } from './services/prometheus.js';
import { initDatabase, closeDb, hashKey, safeCompare } from './services/database.js';
import { authRoutes } from './routes/auth.js';
import { chatRoutes } from './routes/chat.js';
import { capabilityRoutes } from './routes/capabilities.js';
import { compareRoutes } from './routes/compare.js';
import { oauthRoutes } from './routes/oauth.js';
import { comboRoutes } from './routes/combos.js';
import { quotaRoutes } from './routes/quota.js';
import { virtualKeyRoutes } from './routes/virtual-keys.js';
import { advancedRoutes } from './routes/advanced.js';
import { batchRoutes } from './routes/batch.js';
import { providerRoutes, adminRoutes, wsRoutes } from './routes/providers.js';
import { checkRateLimit, checkQuota, incrementUsage } from './services/rate-limiter.js';
import { rtkRoutes } from './routes/rtk.js';
import { webhookRoutes } from './routes/webhooks.js';
import { abTestingRoutes } from './routes/ab-testing.js';
import { modelAliasRoutes } from './routes/model-aliases.js';
import { pricingRoutes } from './routes/pricing.js';
import { cloudSyncRoutes } from './routes/cloud-sync.js';
import { requestLogger } from './services/request-logger.js';
import { dashboardAuthRoutes } from './routes/dashboard-auth.js';
import { initErrorTracker, captureError } from './services/error-tracker.js';
import { pricingTracker } from './services/pricing-tracker.js';
import { modelAliasManager } from './services/model-aliases.js';

dotenv.config();

// Initialize error tracking (no-op if SENTRY_DSN not set)
initErrorTracker();

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

// Per-API-key rate limiting and quota
app.addHook('preHandler', async (request, reply) => {
  const apiKey = request.headers['x-api-key']?.toString();
  if (!apiKey) return;

  // Skip rate limit check for admin endpoints with admin key
  if (request.url.startsWith('/v1/admin') && safeCompare(apiKey, process.env.ADMIN_API_KEY || '')) {
    return;
  }

  const { getDb } = await import('./services/database.js');
  const db = getDb();

  // Get key row (including default limits if key not in DB)
  const keyRow = db.prepare('SELECT rate_limit_rpm, monthly_quota_requests FROM api_keys WHERE key_hash = ?').get(hashKey(apiKey)) as any;
  const rateLimitVal = keyRow?.rate_limit || 60;

  const rl = checkRateLimit(apiKey, rateLimitVal);
  if (!rl.allowed) {
    reply.header('X-RateLimit-Limit', rl.limit);
    reply.header('X-RateLimit-Remaining', 0);
    reply.header('X-RateLimit-Reset', Math.ceil(rl.resetAt / 1000));
    reply.status(429).send({
      error: 'RATE_LIMIT_EXCEEDED',
      message: `Rate limit exceeded. Retry after ${rl.retryAfter}s.`,
      retryAfter: rl.retryAfter
    });
    return;
  }

  const quota = checkQuota(apiKey);
  if (!quota.allowed) {
    reply.header('X-Quota-Limit', quota.monthlyQuota);
    reply.header('X-Quota-Remaining', 0);
    reply.header('X-Quota-Reset', quota.resetAt);
    reply.status(429).send({
      error: 'QUOTA_EXCEEDED',
      message: `Monthly quota exceeded. Resets at ${quota.resetAt}.`,
      resetAt: quota.resetAt
    });
    return;
  }

  reply.header('X-RateLimit-Limit', rl.limit);
  reply.header('X-RateLimit-Remaining', rl.remaining);
  reply.header('X-RateLimit-Reset', Math.ceil(rl.resetAt / 1000));
  reply.header('X-Quota-Limit', quota.monthlyQuota);
  reply.header('X-Quota-Remaining', quota.remaining);
  reply.header('X-Quota-Reset', quota.resetAt);

  // Increment usage after successful check
  incrementUsage(apiKey);
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
await app.register(cookie, { secret: JWT_SECRET });

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

  // Pricing tracker uses DB + hardcoded models — ready on import
  pricingTracker.listCanonicalPricing(); // ensure DB table exists
  app.log.info('💰 Pricing tracker ready');

  // Model alias manager reads from DB — ready on import
  modelAliasManager.listAliases(); // ensure DB table exists
  app.log.info('🔗 Model alias manager ready');

  // Request logger auto-initializes (creates log dir, rotation)
  app.log.info('📝 Request logger ready');

  app.log.info('✅ Bawwab Gateway ready');
});

// Register routes
await app.register(authRoutes, { prefix: '/v1/auth' });
await app.register(chatRoutes, { prefix: '/v1' });
await app.register(capabilityRoutes, { prefix: '/v1' });
await app.register(compareRoutes, { prefix: '/v1' });
await app.register(oauthRoutes, { prefix: '/v1' });
await app.register(comboRoutes, { prefix: '/v1' });
await app.register(quotaRoutes, { prefix: '/v1' });
await app.register(virtualKeyRoutes, { prefix: '/v1' });
await app.register(advancedRoutes, { prefix: '/v1' });
await app.register(batchRoutes, { prefix: '/v1' });
await app.register(providerRoutes, { prefix: '/v1/providers' });
await app.register(adminRoutes, { prefix: '/v1/admin' });
await app.register(wsRoutes, { prefix: '/ws' });
await app.register(rtkRoutes, { prefix: '/v1/rtk' });
await app.register(webhookRoutes, { prefix: '/v1/webhooks' });
await app.register(abTestingRoutes, { prefix: '/v1/ab-tests' });
await app.register(modelAliasRoutes, { prefix: '/v1/model-aliases' });
await app.register(pricingRoutes, { prefix: '/v1/pricing' });
await app.register(cloudSyncRoutes, { prefix: '/v1/sync' });

// Dashboard auth (must be before static serving)
await app.register(dashboardAuthRoutes);

// Serve dashboard static files (single-port self-hosted mode)
const __dirname = dirname(fileURLToPath(import.meta.url));
const dashboardDistPath = join(__dirname, '../../dashboard/dist');
await app.register(fastifyStatic, {
  root: dashboardDistPath,
  prefix: '/',
  wildcard: false
});

// SPA fallback for React Router
app.setNotFoundHandler((request, reply) => {
  const apiPrefixes = ['/v1/', '/ws/', '/health', '/metrics', '/docs'];
  const isApi = apiPrefixes.some(p => request.url.startsWith(p));
  if (isApi) {
    reply.code(404).send({ error: 'Not Found' });
  } else {
    reply.sendFile('index.html');
  }
});

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
  const err = error as any;
  app.log.error(err);
  captureError(err, { method: request.method, url: request.url });
  reply.status(err.statusCode || 500).send({
    error: err.name || 'InternalError',
    message: err.message || 'An unexpected error occurred',
    ...(process.env.NODE_ENV === 'development' && { stack: err.stack })
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
