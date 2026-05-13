/**
 * Real-time Quota Tracker — SQLite-backed
 * Tracks per-provider usage (requests, tokens, cost) in real-time.
 * Provides quota limits and alerts when approaching limits.
 */

import { logger } from './logger.js';
import { getDb } from './database.js';

export interface ProviderQuota {
  providerId: string;
  providerName: string;
  dailyLimit: number;
  monthlyLimit: number;
  dailyTokens: number;
  monthlyTokens: number;
  dailyCost: number;
  monthlyCost: number;
}

export interface ProviderUsage {
  providerId: string;
  requestsToday: number;
  requestsThisMonth: number;
  tokensInToday: number;
  tokensOutToday: number;
  tokensInThisMonth: number;
  tokensOutThisMonth: number;
  costToday: number;
  costThisMonth: number;
  lastUsed: Date;
}

const DEFAULT_DAILY_REQ_LIMIT = 10000;
const DEFAULT_MONTHLY_REQ_LIMIT = 100000;
const DEFAULT_DAILY_TOKEN_LIMIT = 10000000;
const DEFAULT_MONTHLY_TOKEN_LIMIT = 100000000;
const DEFAULT_DAILY_COST_LIMIT = 50;
const DEFAULT_MONTHLY_COST_LIMIT = 500;

function getDayKey(): string {
  return new Date().toISOString().slice(0, 10); // YYYY-MM-DD
}

function getMonthKey(): string {
  return new Date().toISOString().slice(0, 7); // YYYY-MM
}

class QuotaTracker {
  /**
   * Set quota for a provider
   */
  setQuota(providerId: string, providerName: string, overrides?: Partial<ProviderQuota>) {
    const db = getDb();
    db.prepare(`
      INSERT INTO provider_quotas (provider_id, provider_name, daily_limit_requests, monthly_limit_requests,
        daily_limit_tokens, monthly_limit_tokens, daily_limit_cost, monthly_limit_cost)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(provider_id) DO UPDATE SET
        provider_name = excluded.provider_name,
        daily_limit_requests = excluded.daily_limit_requests,
        monthly_limit_requests = excluded.monthly_limit_requests,
        daily_limit_tokens = excluded.daily_limit_tokens,
        monthly_limit_tokens = excluded.monthly_limit_tokens,
        daily_limit_cost = excluded.daily_limit_cost,
        monthly_limit_cost = excluded.monthly_limit_cost,
        updated_at = datetime('now')
    `).run(
      providerId, providerName,
      overrides?.dailyLimit ?? DEFAULT_DAILY_REQ_LIMIT,
      overrides?.monthlyLimit ?? DEFAULT_MONTHLY_REQ_LIMIT,
      overrides?.dailyTokens ?? DEFAULT_DAILY_TOKEN_LIMIT,
      overrides?.monthlyTokens ?? DEFAULT_MONTHLY_TOKEN_LIMIT,
      overrides?.dailyCost ?? DEFAULT_DAILY_COST_LIMIT,
      overrides?.monthlyCost ?? DEFAULT_MONTHLY_COST_LIMIT,
    );
  }

  /**
   * Record usage for a provider
   */
  recordUsage(
    providerId: string,
    providerName: string,
    tokensIn: number,
    tokensOut: number,
    cost: number
  ): { allowed: boolean; warnings: string[] } {
    const db = getDb();
    const dayKey = getDayKey();
    const monthKey = getMonthKey();

    // Ensure quota exists
    this.setQuota(providerId, providerName);

    // Ensure usage row exists and reset if day/month changed
    const existing = db.prepare('SELECT * FROM provider_usage WHERE provider_id = ?').get(providerId) as any;
    if (!existing) {
      db.prepare(`
        INSERT INTO provider_usage (provider_id, day_key, month_key)
        VALUES (?, ?, ?)
      `).run(providerId, dayKey, monthKey);
    } else {
      // Reset daily counters if new day
      if (existing.day_key !== dayKey) {
        db.prepare(`
          UPDATE provider_usage SET requests_today = 0, tokens_in_today = 0, tokens_out_today = 0,
            cost_today = 0, day_key = ? WHERE provider_id = ?
        `).run(dayKey, providerId);
      }
      // Reset monthly counters if new month
      if (existing.month_key !== monthKey) {
        db.prepare(`
          UPDATE provider_usage SET requests_this_month = 0, tokens_in_this_month = 0,
            tokens_out_this_month = 0, cost_this_month = 0, month_key = ? WHERE provider_id = ?
        `).run(monthKey, providerId);
      }
    }

    // Get current usage (after potential reset)
    const usage = db.prepare('SELECT * FROM provider_usage WHERE provider_id = ?').get(providerId) as any;
    const quota = db.prepare('SELECT * FROM provider_quotas WHERE provider_id = ?').get(providerId) as any;

    const warnings: string[] = [];

    // Check limits
    if (usage.requests_today + 1 > quota.daily_limit_requests) {
      warnings.push(`Daily request limit exceeded for ${providerName}`);
    }
    if (usage.requests_this_month + 1 > quota.monthly_limit_requests) {
      warnings.push(`Monthly request limit exceeded for ${providerName}`);
    }
    if (usage.tokens_in_today + usage.tokens_out_today + tokensIn + tokensOut > quota.daily_limit_tokens) {
      warnings.push(`Daily token limit exceeded for ${providerName}`);
    }
    if (usage.tokens_in_this_month + usage.tokens_out_this_month + tokensIn + tokensOut > quota.monthly_limit_tokens) {
      warnings.push(`Monthly token limit exceeded for ${providerName}`);
    }
    if (usage.cost_today + cost > quota.daily_limit_cost) {
      warnings.push(`Daily cost limit exceeded for ${providerName}`);
    }
    if (usage.cost_this_month + cost > quota.monthly_limit_cost) {
      warnings.push(`Monthly cost limit exceeded for ${providerName}`);
    }

    // Record usage
    db.prepare(`
      UPDATE provider_usage SET
        requests_today = requests_today + 1,
        requests_this_month = requests_this_month + 1,
        tokens_in_today = tokens_in_today + ?,
        tokens_out_today = tokens_out_today + ?,
        tokens_in_this_month = tokens_in_this_month + ?,
        tokens_out_this_month = tokens_out_this_month + ?,
        cost_today = cost_today + ?,
        cost_this_month = cost_this_month + ?,
        last_used_at = datetime('now'),
        updated_at = datetime('now')
      WHERE provider_id = ?
    `).run(tokensIn, tokensOut, tokensIn, tokensOut, cost, cost, providerId);

    const allowed = warnings.length === 0;
    if (!allowed) {
      logger.warn({ providerId, warnings }, '[QuotaTracker] Quota exceeded');
    }

    return { allowed, warnings };
  }

  /**
   * Get usage for a provider
   */
  getUsage(providerId: string): ProviderUsage | undefined {
    const db = getDb();
    const row = db.prepare('SELECT * FROM provider_usage WHERE provider_id = ?').get(providerId) as any;
    if (!row) return undefined;

    return {
      providerId: row.provider_id,
      requestsToday: row.requests_today,
      requestsThisMonth: row.requests_this_month,
      tokensInToday: row.tokens_in_today,
      tokensOutToday: row.tokens_out_today,
      tokensInThisMonth: row.tokens_in_this_month,
      tokensOutThisMonth: row.tokens_out_this_month,
      costToday: row.cost_today,
      costThisMonth: row.cost_this_month,
      lastUsed: row.last_used_at ? new Date(row.last_used_at) : new Date(),
    };
  }

  /**
   * Get all usage stats
   */
  getAllUsage(): Array<ProviderUsage & { quota: ProviderQuota; utilization: Record<string, number> }> {
    const db = getDb();
    const rows = db.prepare(`
      SELECT u.*, q.provider_name, q.daily_limit_requests, q.monthly_limit_requests,
        q.daily_limit_tokens, q.monthly_limit_tokens, q.daily_limit_cost, q.monthly_limit_cost
      FROM provider_usage u
      LEFT JOIN provider_quotas q ON u.provider_id = q.provider_id
      ORDER BY u.provider_id
    `).all() as any[];

    return rows.map(row => {
      const usage: ProviderUsage = {
        providerId: row.provider_id,
        requestsToday: row.requests_today,
        requestsThisMonth: row.requests_this_month,
        tokensInToday: row.tokens_in_today,
        tokensOutToday: row.tokens_out_today,
        tokensInThisMonth: row.tokens_in_this_month,
        tokensOutThisMonth: row.tokens_out_this_month,
        costToday: row.cost_today,
        costThisMonth: row.cost_this_month,
        lastUsed: row.last_used_at ? new Date(row.last_used_at) : new Date(),
      };

      const quota: ProviderQuota = {
        providerId: row.provider_id,
        providerName: row.provider_name || row.provider_id,
        dailyLimit: row.daily_limit_requests ?? DEFAULT_DAILY_REQ_LIMIT,
        monthlyLimit: row.monthly_limit_requests ?? DEFAULT_MONTHLY_REQ_LIMIT,
        dailyTokens: row.daily_limit_tokens ?? DEFAULT_DAILY_TOKEN_LIMIT,
        monthlyTokens: row.monthly_limit_tokens ?? DEFAULT_MONTHLY_TOKEN_LIMIT,
        dailyCost: row.daily_limit_cost ?? DEFAULT_DAILY_COST_LIMIT,
        monthlyCost: row.monthly_limit_cost ?? DEFAULT_MONTHLY_COST_LIMIT,
      };

      return {
        ...usage,
        quota,
        utilization: {
          dailyRequests: quota.dailyLimit > 0 ? (usage.requestsToday / quota.dailyLimit) * 100 : 0,
          monthlyRequests: quota.monthlyLimit > 0 ? (usage.requestsThisMonth / quota.monthlyLimit) * 100 : 0,
          dailyTokens: quota.dailyTokens > 0 ? ((usage.tokensInToday + usage.tokensOutToday) / quota.dailyTokens) * 100 : 0,
          monthlyTokens: quota.monthlyTokens > 0 ? ((usage.tokensInThisMonth + usage.tokensOutThisMonth) / quota.monthlyTokens) * 100 : 0,
          dailyCost: quota.dailyCost > 0 ? (usage.costToday / quota.dailyCost) * 100 : 0,
          monthlyCost: quota.monthlyCost > 0 ? (usage.costThisMonth / quota.monthlyCost) * 100 : 0,
        },
      };
    });
  }

  /**
   * Check if provider is within quota
   */
  isWithinQuota(providerId: string): boolean {
    const db = getDb();
    const usage = db.prepare('SELECT * FROM provider_usage WHERE provider_id = ?').get(providerId) as any;
    const quota = db.prepare('SELECT * FROM provider_quotas WHERE provider_id = ?').get(providerId) as any;

    if (!usage || !quota) return true;

    return (
      usage.requests_today < quota.daily_limit_requests &&
      usage.requests_this_month < quota.monthly_limit_requests &&
      (usage.tokens_in_today + usage.tokens_out_today) < quota.daily_limit_tokens &&
      (usage.tokens_in_this_month + usage.tokens_out_this_month) < quota.monthly_limit_tokens &&
      usage.cost_today < quota.daily_limit_cost &&
      usage.cost_this_month < quota.monthly_limit_cost
    );
  }

  /**
   * Reset all counters
   */
  reset(): void {
    const db = getDb();
    db.prepare('DELETE FROM provider_usage').run();
    db.prepare('DELETE FROM provider_quotas').run();
  }
}

export const quotaTracker = new QuotaTracker();
