/**
 * RTK Token Saver Routes
 *
 * GET  /v1/rtk/stats  — return current and lifetime RTK stats
 * POST /v1/rtk/toggle — enable/disable RTK
 * POST /v1/rtk/test   — test compression on sample text
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import {
  compressMessages,
  testCompression,
  setRtkEnabled,
  isRtkEnabled,
  getRtkStats,
  getRtkLifetimeStats,
} from '../services/rtk-token-saver.js';
import { logger } from '../services/logger.js';

export async function rtkRoutes(app: FastifyInstance) {
  /**
   * GET /v1/rtk/stats
   * Returns current and lifetime RTK compression statistics.
   */
  app.get('/v1/rtk/stats', async (_request: FastifyRequest, reply: FastifyReply) => {
    const lastStats = getRtkStats();
    const lifetime = getRtkLifetimeStats();

    return reply.send({
      ok: true,
      data: {
        enabled: lifetime.enabled,
        last: lastStats,
        lifetime,
      },
    });
  });

  /**
   * POST /v1/rtk/toggle
   * Enable or disable RTK compression.
   * Body: { enabled: boolean }
   */
  app.post('/v1/rtk/toggle', {
    schema: {
      body: {
        type: 'object',
        properties: {
          enabled: { type: 'boolean' },
        },
      },
    },
  }, async (request: FastifyRequest<{ Body: { enabled?: boolean } }>, reply: FastifyReply) => {
    const { enabled } = request.body || {};

    if (typeof enabled !== 'boolean') {
      return reply.status(400).send({
        ok: false,
        error: 'Request body must include "enabled" as a boolean',
      });
    }

    setRtkEnabled(enabled);

    logger.info({ enabled, action: 'rtk-toggle' }, '[RTK] Toggled via API');

    return reply.send({
      ok: true,
      data: {
        enabled: isRtkEnabled(),
      },
    });
  });

  /**
   * POST /v1/rtk/test
   * Test compression on sample text.
   * Body: { text: string }
   * Or sends a default sample if no text provided.
   */
  app.post('/v1/rtk/test', {
    schema: {
      body: {
        type: 'object',
        properties: {
          text: { type: 'string' },
          messages: { type: 'array' },
        },
      },
    },
  }, async (request: FastifyRequest<{ Body: { text?: string; messages?: any[] } }>, reply: FastifyReply) => {
    const { text, messages } = request.body || {};

    // If messages are provided, test full message compression
    if (Array.isArray(messages)) {
      const result = compressMessages(messages, true);
      return reply.send({
        ok: true,
        data: {
          type: 'messages',
          stats: result.stats,
          messagesCount: messages.length,
          compressedMessagesPreview: result.messages.slice(0, 3),
        },
      });
    }

    // If text is provided, test single text compression
    const sampleText = text || getSampleText();
    const result = testCompression(sampleText);

    return reply.send({
      ok: true,
      data: {
        type: 'text',
        filter: result.filter,
        originalBytes: result.originalBytes,
        compressedBytes: result.compressedBytes,
        savedBytes: result.savedBytes,
        savedPercent: result.savedPercent,
        preview: {
          original: result.original.slice(0, 200),
          compressed: result.compressed.slice(0, 200),
        },
      },
    });
  });
}

/** Default sample text for testing when no text is provided */
function getSampleText(): string {
  const lines: string[] = [];
  lines.push('diff --git a/src/services/rtk.ts b/src/services/rtk.ts');
  lines.push('index abc1234..def5678 100644');
  lines.push('--- a/src/services/rtk.ts');
  lines.push('+++ b/src/services/rtk.ts');
  lines.push('@@ -10,6 +10,8 @@');
  lines.push(' import { FastifyInstance } from "fastify";');
  lines.push(' import { compressMessages } from "./rtk-token-saver.js";');
  lines.push('+import { logger } from "./logger.js";');
  lines.push('+');
  lines.push(' export async function setupRtk(app: FastifyInstance) {');
  lines.push('   // Setup RTK routes');
  lines.push('   app.get("/v1/rtk/stats", async () => {');
  lines.push('     return { ok: true };');
  lines.push('   });');
  lines.push(' }');
  return lines.join('\n');
}
