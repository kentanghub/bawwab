import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import crypto from 'node:crypto';
import { getDb } from '../services/database.js';

// Simple hash for API keys (not bcrypt — keys are random UUIDs, not passwords)
function hashKey(key: string): string {
  return crypto.createHash('sha256').update(key).digest('hex');
}

function generateApiKey(): string {
  return 'bawwab_' + crypto.randomBytes(32).toString('base64url');
}

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

  // ========== API KEY MANAGEMENT (admin only) ==========

  // List all API keys
  app.get('/keys', async (request, reply) => {
    try {
      await request.jwtVerify();
      const payload = request.user as any;
      if (payload.role !== 'admin') {
        return reply.status(403).send({ error: 'Admin access required' });
      }

      const rows = getDb().prepare('SELECT id, name, role, is_active, rate_limit, created_at, last_used_at, usage_count FROM api_keys').all();
      return { keys: rows };
    } catch {
      return reply.status(401).send({ error: 'Unauthorized' });
    }
  });

  // Generate new API key
  app.post('/keys', {
    config: {
      rateLimit: { max: 10, timeWindow: '1 minute' }
    }
  }, async (request, reply) => {
    try {
      await request.jwtVerify();
      const payload = request.user as any;
      if (payload.role !== 'admin') {
        return reply.status(403).send({ error: 'Admin access required' });
      }

      const { name, role = 'user', rateLimit = 100 } = request.body as { name: string; role?: string; rateLimit?: number };
      
      if (!name || typeof name !== 'string') {
        return reply.status(400).send({ error: 'Name is required' });
      }

      const key = generateApiKey();
      const keyHash = hashKey(key);
      const id = crypto.randomUUID();

      getDb().prepare(`
        INSERT INTO api_keys (id, name, key_hash, role, is_active, rate_limit, created_at, usage_count)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).run(id, name, keyHash, role, 1, rateLimit, new Date().toISOString(), 0);

      return { id, name, key, role, rateLimit, createdAt: new Date().toISOString() };
    } catch {
      return reply.status(401).send({ error: 'Unauthorized' });
    }
  });

  // Revoke API key
  app.delete('/keys/:id', async (request, reply) => {
    try {
      await request.jwtVerify();
      const payload = request.user as any;
      if (payload.role !== 'admin') {
        return reply.status(403).send({ error: 'Admin access required' });
      }

      const { id } = request.params as { id: string };
      const result = getDb().prepare('UPDATE api_keys SET is_active = 0 WHERE id = ?').run(id);
      
      if (result.changes === 0) {
        return reply.status(404).send({ error: 'Key not found' });
      }

      return { success: true, message: 'API key revoked' };
    } catch {
      return reply.status(401).send({ error: 'Unauthorized' });
    }
  });

  // Verify an API key (for external validation)
  app.post('/keys/verify', async (request, reply) => {
    const { key } = request.body as { key?: string };
    
    if (!key || typeof key !== 'string') {
      return reply.status(400).send({ error: 'Key required' });
    }

    const keyHash = hashKey(key);
    const row = getDb().prepare('SELECT id, name, role, is_active, rate_limit, usage_count FROM api_keys WHERE key_hash = ?').get(keyHash) as any;

    if (!row || !row.is_active) {
      return reply.status(401).send({ valid: false });
    }

    // Update usage
    getDb().prepare('UPDATE api_keys SET usage_count = usage_count + 1, last_used_at = ? WHERE id = ?').run(new Date().toISOString(), row.id);

    return { valid: true, id: row.id, name: row.name, role: row.role };
  });
}
