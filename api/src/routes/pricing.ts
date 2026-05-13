import type { FastifyInstance } from 'fastify';
import { pricingTracker } from '../services/pricing-tracker.js';

export async function pricingRoutes(app: FastifyInstance) {
  // List all pricing (canonical + patterns + overrides)
  app.get('/pricing', async () => {
    return {
      canonical: pricingTracker.listCanonicalPricing(),
      patterns: pricingTracker.listPatternPricing(),
      overrides: pricingTracker.listOverrides(),
    };
  });

  // Set a pricing override
  app.post('/pricing', async (request, reply) => {
    const { provider, model, input, output, cached, reasoning } = request.body as {
      provider?: string;
      model?: string;
      input?: number;
      output?: number;
      cached?: number;
      reasoning?: number;
    };
    if (!provider || !model) {
      return reply.status(400).send({ error: 'provider and model are required' });
    }
    pricingTracker.setOverride(provider, model, {
      input: input ?? 0,
      output: output ?? 0,
      cached: cached ?? 0,
      reasoning: reasoning ?? 0,
    });
    return { ok: true };
  });

  // Delete a pricing override
  app.delete('/pricing', async (request, reply) => {
    const { provider, model } = request.body as { provider?: string; model?: string };
    if (!provider || !model) {
      return reply.status(400).send({ error: 'provider and model are required' });
    }
    const removed = pricingTracker.removeOverride(provider, model);
    if (!removed) {
      return reply.status(404).send({ error: 'Override not found' });
    }
    return { ok: true };
  });

  // Calculate cost for given usage
  app.post('/pricing/calculate', async (request, reply) => {
    const { provider, model, usage } = request.body as {
      provider?: string;
      model?: string;
      usage?: {
        input_tokens?: number;
        output_tokens?: number;
        cached_tokens?: number;
        reasoning_tokens?: number;
      };
    };
    if (!model) {
      return reply.status(400).send({ error: 'model is required' });
    }
    const cost = pricingTracker.calculateCost(provider || '', model, usage || {});
    const pricing = pricingTracker.getPricing(provider || '', model);
    return { model, provider: provider || '', pricing, cost };
  });
}
