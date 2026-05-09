import type { FastifyInstance } from 'fastify';

export async function authRoutes(app: FastifyInstance) {
  // Rate limit auth endpoints more strictly
  app.post('/token', {
    config: {
      rateLimit: {
        max: 10,
        timeWindow: '1 minute'
      }
    }
  }, async (request, reply) => {
    const { apiKey } = request.body as { apiKey?: string };
    
    if (!apiKey || typeof apiKey !== 'string') {
      return reply.status(400).send({ error: 'API key required' });
    }
    
    // Prevent DoS from extremely long keys
    if (apiKey.length > 1024) {
      return reply.status(400).send({ error: 'API key too long' });
    }
    
    if (apiKey !== process.env.ADMIN_API_KEY) {
      return reply.status(401).send({ error: 'Invalid API key' });
    }
    
    const token = await reply.jwtSign({ role: 'admin' });
    return { token };
  });

  app.get('/verify', async (request, reply) => {
    try {
      await request.jwtVerify();
      return { valid: true, payload: request.user };
    } catch {
      return reply.status(401).send({ valid: false });
    }
  });
}
