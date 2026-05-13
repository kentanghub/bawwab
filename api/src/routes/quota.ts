import type { FastifyInstance } from 'fastify';
import { quotaTracker } from '../services/quota-tracker.js';
import { pluginManager } from '../plugins/manager.js';
import { safeCompare } from '../services/database.js';

export async function quotaRoutes(app: FastifyInstance) {
  // Get all quota usage
  app.get('/quota', async () => {
    const usage = quotaTracker.getAllUsage();
    return {
      quotas: usage.map(u => ({
        providerId: u.providerId,
        providerName: u.quota.providerName,
        usage: {
          requestsToday: u.requestsToday,
          requestsThisMonth: u.requestsThisMonth,
          tokensInToday: u.tokensInToday,
          tokensOutToday: u.tokensOutToday,
          tokensInThisMonth: u.tokensInThisMonth,
          tokensOutThisMonth: u.tokensOutThisMonth,
          costToday: Number(u.costToday.toFixed(4)),
          costThisMonth: Number(u.costThisMonth.toFixed(4)),
          lastUsed: u.lastUsed,
        },
        limits: {
          dailyRequests: u.quota.dailyLimit,
          monthlyRequests: u.quota.monthlyLimit,
          dailyTokens: u.quota.dailyTokens,
          monthlyTokens: u.quota.monthlyTokens,
          dailyCost: u.quota.dailyCost,
          monthlyCost: u.quota.monthlyCost,
        },
        utilization: {
          dailyRequests: Number(u.utilization.dailyRequests.toFixed(2)),
          monthlyRequests: Number(u.utilization.monthlyRequests.toFixed(2)),
          dailyTokens: Number(u.utilization.dailyTokens.toFixed(2)),
          monthlyTokens: Number(u.utilization.monthlyTokens.toFixed(2)),
          dailyCost: Number(u.utilization.dailyCost.toFixed(2)),
          monthlyCost: Number(u.utilization.monthlyCost.toFixed(2)),
        }
      }))
    };
  });

  // Get quota for specific provider
  app.get('/quota/:providerId', async (request, reply) => {
    const { providerId } = request.params as { providerId: string };
    const usage = quotaTracker.getUsage(providerId);

    if (!usage) {
      return reply.status(404).send({
        error: 'No usage data for provider',
        providerId
      });
    }

    const allUsage = quotaTracker.getAllUsage().find(u => u.providerId === providerId);
    return allUsage || { providerId, usage };
  });

  // Get quota summary (for dashboard)
  app.get('/quota/summary', async () => {
    const usage = quotaTracker.getAllUsage();
    const providers = pluginManager.getAllProviders();

    const total = {
      requestsToday: usage.reduce((sum, u) => sum + u.requestsToday, 0),
      requestsThisMonth: usage.reduce((sum, u) => sum + u.requestsThisMonth, 0),
      tokensInToday: usage.reduce((sum, u) => sum + u.tokensInToday, 0),
      tokensOutToday: usage.reduce((sum, u) => sum + u.tokensOutToday, 0),
      costToday: Number(usage.reduce((sum, u) => sum + u.costToday, 0).toFixed(4)),
      costThisMonth: Number(usage.reduce((sum, u) => sum + u.costThisMonth, 0).toFixed(4)),
    };

    // Active providers (used today)
    const activeProviders = usage
      .filter(u => u.requestsToday > 0)
      .map(u => ({
        providerId: u.providerId,
        providerName: u.quota.providerName,
        requestsToday: u.requestsToday,
        utilization: {
          requests: Number(u.utilization.dailyRequests.toFixed(2)),
          tokens: Number(u.utilization.dailyTokens.toFixed(2)),
          cost: Number(u.utilization.dailyCost.toFixed(2)),
        }
      }));

    // Providers near limit (>80% utilization)
    const warnings = usage
      .filter(u =>
        u.utilization.dailyRequests > 80 ||
        u.utilization.dailyTokens > 80 ||
        u.utilization.dailyCost > 80
      )
      .map(u => ({
        providerId: u.providerId,
        providerName: u.quota.providerName,
        highestUtilization: Math.max(
          u.utilization.dailyRequests,
          u.utilization.dailyTokens,
          u.utilization.dailyCost
        ),
        metrics: {
          requests: Number(u.utilization.dailyRequests.toFixed(2)),
          tokens: Number(u.utilization.dailyTokens.toFixed(2)),
          cost: Number(u.utilization.dailyCost.toFixed(2)),
        }
      }));

    return {
      summary: total,
      activeProviders,
      warnings,
      totalProviders: providers.length,
      activeCount: activeProviders.length,
      warningCount: warnings.length,
    };
  });

  // Set quota for provider (admin only)
  app.post('/quota/:providerId', async (request, reply) => {
    const auth = request.headers['x-api-key'] as string;
    if (!safeCompare(auth, process.env.ADMIN_API_KEY || '')) {
      return reply.status(401).send({ error: 'Unauthorized' });
    }

    const { providerId } = request.params as { providerId: string };
    const body = request.body as any;

    quotaTracker.setQuota(providerId, body.providerName || providerId, {
      dailyLimit: body.dailyLimit,
      monthlyLimit: body.monthlyLimit,
      dailyTokens: body.dailyTokens,
      monthlyTokens: body.monthlyTokens,
      dailyCost: body.dailyCost,
      monthlyCost: body.monthlyCost,
    });

    return { success: true, message: `Quota set for ${providerId}` };
  });
}
