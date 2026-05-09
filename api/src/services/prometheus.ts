import { Registry, Counter, Histogram, Gauge, collectDefaultMetrics } from 'prom-client';

const register = new Registry();

// Collect default Node.js metrics
collectDefaultMetrics({ register });

// Custom metrics
export const httpRequestsTotal = new Counter({
  name: 'bawwab_http_requests_total',
  help: 'Total number of HTTP requests',
  labelNames: ['method', 'route', 'status_code'],
  registers: [register]
});

export const httpRequestDuration = new Histogram({
  name: 'bawwab_http_request_duration_seconds',
  help: 'Duration of HTTP requests in seconds',
  labelNames: ['method', 'route'],
  buckets: [0.01, 0.05, 0.1, 0.5, 1, 2, 5, 10],
  registers: [register]
});

export const chatRequestsTotal = new Counter({
  name: 'bawwab_chat_requests_total',
  help: 'Total number of chat completion requests',
  labelNames: ['provider', 'model', 'status'],
  registers: [register]
});

export const tokensUsed = new Counter({
  name: 'bawwab_tokens_used_total',
  help: 'Total number of tokens used',
  labelNames: ['provider', 'model', 'type'],
  registers: [register]
});

export const activeProviders = new Gauge({
  name: 'bawwab_active_providers',
  help: 'Number of currently enabled providers',
  registers: [register]
});

export const providerHealth = new Gauge({
  name: 'bawwab_provider_health',
  help: 'Health status of providers (1=healthy, 0.5=degraded, 0=unhealthy)',
  labelNames: ['provider'],
  registers: [register]
});

export const cacheHits = new Counter({
  name: 'bawwab_cache_hits_total',
  help: 'Total number of cache hits',
  registers: [register]
});

export const cacheMisses = new Counter({
  name: 'bawwab_cache_misses_total',
  help: 'Total number of cache misses',
  registers: [register]
});

export const prometheusMetrics = {
  getMetrics: () => register.metrics(),
  getContentType: () => register.contentType,
  httpRequestsTotal,
  httpRequestDuration,
  chatRequestsTotal,
  tokensUsed,
  activeProviders,
  providerHealth,
  cacheHits,
  cacheMisses
};
