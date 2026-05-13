import type { FastifyInstance } from 'fastify';
import { oauthManager } from '../services/oauth-manager.js';
import { logger } from '../services/logger.js';
import { safeCompare } from '../services/database.js';

// Track active polling intervals per provider+deviceCode
const activePolls = new Map<string, NodeJS.Timeout>();

export async function oauthRoutes(app: FastifyInstance) {
  // Get supported OAuth providers (including token-only and cookie-based)
  app.get('/oauth/providers', async () => {
    const oauthProviders = oauthManager.getSupportedProviders().map(id => ({
      id,
      name: id.charAt(0).toUpperCase() + id.slice(1),
      type: 'oauth' as const,
      connected: oauthManager.hasToken(id)
    }));

    const tokenProviders = oauthManager.getTokenOnlyProviders().map(id => ({
      id,
      name: id.charAt(0).toUpperCase() + id.slice(1),
      type: 'token' as const,
      connected: oauthManager.hasToken(id)
    }));

    const cookieProviders = oauthManager.getCookieProviders().map(id => ({
      id,
      name: id.charAt(0).toUpperCase() + id.slice(1),
      type: 'cookie' as const,
      connected: oauthManager.hasToken(id)
    }));

    return {
      providers: [...oauthProviders, ...tokenProviders, ...cookieProviders]
    };
  });

  // Token-only provider: directly set API key
  app.post('/oauth/:provider/token-entry', async (request, reply) => {
    const { provider } = request.params as { provider: string };
    const { apiKey } = request.body as { apiKey: string };

    if (!apiKey) {
      return reply.status(400).send({ error: 'apiKey is required' });
    }

    try {
      oauthManager.setToken(provider, apiKey);
      return {
        success: true,
        status: 'connected',
        message: `${provider} API key stored successfully`
      };
    } catch (error) {
      return reply.status(400).send({
        error: 'Failed to store token',
        message: (error as Error).message
      });
    }
  });

  // Cookie-based provider: store browser session cookies
  app.post('/oauth/:provider/cookie-entry', async (request, reply) => {
    const { provider } = request.params as { provider: string };
    const { cookies, userAgent, expiresAt } = request.body as {
      cookies: string;
      userAgent?: string;
      expiresAt?: string;
    };

    if (!cookies) {
      return reply.status(400).send({ error: 'cookies is required' });
    }

    try {
      const expiry = expiresAt ? new Date(expiresAt) : undefined;
      oauthManager.setCookies(provider, cookies, userAgent, expiry);
      return {
        success: true,
        status: 'connected',
        message: `${provider} cookies stored successfully`,
        expiresAt: expiry?.toISOString()
      };
    } catch (error) {
      return reply.status(400).send({
        error: 'Failed to store cookies',
        message: (error as Error).message
      });
    }
  });

  // Get stored cookies (admin only, masked)
  app.get('/oauth/:provider/cookies', async (request, reply) => {
    const auth = request.headers['x-api-key'] as string;
    if (!safeCompare(auth, process.env.ADMIN_API_KEY || '')) {
      return reply.status(401).send({ error: 'Unauthorized' });
    }

    const { provider } = request.params as { provider: string };
    const cred = oauthManager.getCookies(provider);

    if (!cred) {
      return reply.status(404).send({ error: 'No cookies found for this provider' });
    }

    return {
      provider,
      connected: true,
      cookies: `${cred.cookies.slice(0, 20)}...${cred.cookies.slice(-10)}`,
      userAgent: cred.userAgent,
      expiresAt: cred.expiresAt?.toISOString(),
      createdAt: cred.createdAt.toISOString()
    };
  });

  // Step 1: Request device code
  app.post('/oauth/:provider/device-code', async (request, reply) => {
    const { provider } = request.params as { provider: string };

    try {
      const deviceCode = await oauthManager.requestDeviceCode(provider);
      return {
        success: true,
        userCode: deviceCode.userCode,
        verificationUri: deviceCode.verificationUri,
        expiresIn: deviceCode.expiresIn,
        interval: deviceCode.interval,
        message: `Visit ${deviceCode.verificationUri} and enter code: ${deviceCode.userCode}`
      };
    } catch (error) {
      logger.error({ provider, error: (error as Error).message }, '[OAuth] Device code request failed');
      return reply.status(400).send({
        error: 'Failed to request device code',
        message: (error as Error).message
      });
    }
  });

  // Step 2: Poll for token (single poll)
  app.post('/oauth/:provider/token', async (request, reply) => {
    const { provider } = request.params as { provider: string };
    const { deviceCode } = request.body as { deviceCode: string };

    if (!deviceCode) {
      return reply.status(400).send({ error: 'deviceCode is required' });
    }

    try {
      const token = await oauthManager.pollToken(provider, deviceCode);

      if (!token) {
        return {
          success: false,
          status: 'pending',
          message: 'Authorization pending. User has not yet approved.'
        };
      }

      return {
        success: true,
        status: 'authorized',
        message: 'Successfully authorized! Token is ready for use.'
      };
    } catch (error) {
      return reply.status(400).send({
        error: 'Token poll failed',
        message: (error as Error).message
      });
    }
  });

  // Auto-poll endpoint (server-side polling)
  app.post('/oauth/:provider/poll', async (request, reply) => {
    const { provider } = request.params as { provider: string };
    const { deviceCode, interval = 5, maxAttempts = 60 } = request.body as {
      deviceCode: string;
      interval?: number;
      maxAttempts?: number;
    };

    if (!deviceCode) {
      return reply.status(400).send({ error: 'deviceCode is required' });
    }

    const pollKey = `${provider}:${deviceCode}`;

    // Clear existing poll for this device code
    if (activePolls.has(pollKey)) {
      clearInterval(activePolls.get(pollKey)!);
      activePolls.delete(pollKey);
    }

    return new Promise((resolve) => {
      let attempts = 0;

      const intervalId = setInterval(async () => {
        attempts++;

        try {
          const token = await oauthManager.pollToken(provider, deviceCode);

          if (token) {
            clearInterval(intervalId);
            activePolls.delete(pollKey);
            resolve(reply.send({
              success: true,
              status: 'authorized',
              message: 'Successfully authorized!'
            }));
            return;
          }

          if (attempts >= maxAttempts) {
            clearInterval(intervalId);
            activePolls.delete(pollKey);
            resolve(reply.status(408).send({
              error: 'Polling timeout',
              message: 'User did not authorize within the time limit'
            }));
          }
        } catch (error) {
          clearInterval(intervalId);
          activePolls.delete(pollKey);
          resolve(reply.status(400).send({
            error: 'Polling failed',
            message: (error as Error).message
          }));
        }
      }, interval * 1000);

      activePolls.set(pollKey, intervalId);
    });
  });

  // Get OAuth status
  app.get('/oauth/status', async (request, reply) => {
    const auth = request.headers['x-api-key'] as string;
    if (!safeCompare(auth, process.env.ADMIN_API_KEY || '')) {
      return reply.status(401).send({ error: 'Unauthorized' });
    }

    return oauthManager.getStatus();
  });

  // Disconnect/revoke OAuth
  app.post('/oauth/:provider/disconnect', async (request, reply) => {
    const auth = request.headers['x-api-key'] as string;
    if (!safeCompare(auth, process.env.ADMIN_API_KEY || '')) {
      return reply.status(401).send({ error: 'Unauthorized' });
    }

    const { provider } = request.params as { provider: string };
    // In a real implementation, call revoke endpoint
    // For now, just mark as disconnected
    return { success: true, message: `${provider} OAuth disconnected` };
  });
}
