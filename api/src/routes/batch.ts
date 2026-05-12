import type { FastifyInstance } from 'fastify';
import { batchProcessor } from '../services/batch-processor.js';
import { modelBenchmark } from '../services/model-benchmark.js';
import { edgeCache } from '../services/edge-cache.js';

export async function batchRoutes(app: FastifyInstance) {
  // Batch chat completions
  app.post('/batch/chat', async (request, reply) => {
    const body = request.body as any;
    if (!body.items || !Array.isArray(body.items)) {
      return reply.status(400).send({ error: 'items[] required' });
    }

    // Forward each item through the normal chat handler
    const results = await batchProcessor.process(body.items, async (itemBody, stream) => {
      const res = await fetch(`http://localhost:${process.env.PORT || 3000}/v1/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-api-key': request.headers['x-api-key'] as string },
        body: JSON.stringify(itemBody),
      });
      return res.json();
    });

    return { results };
  });

  // Benchmark rankings
  app.get('/benchmarks', async () => {
    return modelBenchmark.getStats();
  });

  // Edge cache stats
  app.get('/edge-cache', async () => {
    return edgeCache.getStats();
  });
}
