import type { FastifyInstance } from 'fastify';

export async function authRoutes(app: FastifyInstance) {
  app.post('/token', async (request, reply) => {
    const { apiKey } = request.body as { apiKey?: string };
    
    if (!apiKey) {
      return reply.status(400).send({ error: 'API key required' });
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
