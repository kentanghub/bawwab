/**
 * Real-time Quota Tracker
 * Tracks per-provider usage (requests, tokens, cost) in real-time.
 * Provides quota limits and alerts when approaching limits.
 */

import { logger } from './logger.js';

export interface ProviderQuota {
  providerId: string;
  providerName: string;
  dailyLimit: number;      // Max requests per day
  monthlyLimit: number;    // Max requests per month
  dailyTokens: number;     // Max tokens per day
  monthlyTokens: number;   // Max tokens per month
  dailyCost: number;       // Max cost per day ($)
  monthlyCost: number;     // Max cost per month ($)
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

// Default quotas (can be overridden per provider via env vars)
const DEFAULT_DAILY_REQ_LIMIT = 10000;
const DEFAULT_MONTHLY_REQ_LIMIT = 100000;
const DEFAULT_DAILY_TOKEN_LIMIT = 10000000; // 10M tokens
const DEFAULT_MONTHLY_TOKEN_LIMIT = 100000000; // 100M tokens
const DEFAULT_DAILY_COST_LIMIT = 50; // $50/day
const DEFAULT_MONTHLY_COST_LIMIT = 500; // $500/month

class QuotaTracker {
  private quotas: Map<string, ProviderQuota> = new Map();
  private usage: Map<string, ProviderUsage> = new Map();
  private dayStart: Date;
  private monthStart: Date;

  constructor() {
    this.dayStart = this.getDayStart();
    this.monthStart = this.getMonthStart();
  }

  private getDayStart(): Date {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d;
  }

  private getMonthStart(): Date {
    const d = new Date();
    d.setDate(1);
    d.setHours(0, 0, 0, 0);
    return d;
  }

  private resetIfNeeded() {
    const now = new Date();
    const currentDayStart = this.getDayStart();
    const currentMonthStart = this.getMonthStart();

    if (currentDayStart > this.dayStart) {
      // New day - reset daily counters
      Array.from(this.usage.values()).forEach(usage => {
        usage.requestsToday = 0;
        usage.tokensInToday = 0;
        usage.tokensOutToday = 0;
        usage.costToday = 0;
      });
      this.dayStart = currentDayStart;
      logger.info('[QuotaTracker] Daily counters reset');
    }

    if (currentMonthStart > this.monthStart) {
      // New month - reset monthly counters
      Array.from(this.usage.values()).forEach(usage => {
        usage.requestsThisMonth = 0;
        usage.tokensInThisMonth = 0;
        usage.tokensOutThisMonth = 0;
        usage.costThisMonth = 0;
      });
      this.monthStart = currentMonthStart;
      logger.info('[QuotaTracker] Monthly counters reset');
    }
  }

  /**
   * Set quota for a provider
   */
  setQuota(providerId: string, providerName: string, overrides?: Partial<ProviderQuota>) {
    const quota: ProviderQuota = {
      providerId,
      providerName,
      dailyLimit: overrides?.dailyLimit || DEFAULT_DAILY_REQ_LIMIT,
      monthlyLimit: overrides?.monthlyLimit || DEFAULT_MONTHLY_REQ_LIMIT,
      dailyTokens: overrides?.dailyTokens || DEFAULT_DAILY_TOKEN_LIMIT,
      monthlyTokens: overrides?.monthlyTokens || DEFAULT_MONTHLY_TOKEN_LIMIT,
      dailyCost: overrides?.dailyCost || DEFAULT_DAILY_COST_LIMIT,
      monthlyCost: overrides?.monthlyCost || DEFAULT_MONTHLY_COST_LIMIT,
    };
    this.quotas.set(providerId, quota);
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
    this.resetIfNeeded();

    // Initialize usage if not exists
    if (!this.usage.has(providerId)) {
      this.usage.set(providerId, {
        providerId,
        requestsToday: 0,
        requestsThisMonth: 0,
        tokensInToday: 0,
        tokensOutToday: 0,
        tokensInThisMonth: 0,
        tokensOutThisMonth: 0,
        costToday: 0,
        costThisMonth: 0,
        lastUsed: new Date(),
      });
    }

    // Initialize quota if not exists
    if (!this.quotas.has(providerId)) {
      this.setQuota(providerId, providerName);
    }

    const usage = this.usage.get(providerId)!;
    const quota = this.quotas.get(providerId)!;
    const warnings: string[] = [];

    // Check limits before recording
    if (usage.requestsToday + 1 > quota.dailyLimit) {
      warnings.push(`Daily request limit exceeded for ${providerName}`);
    }
    if (usage.requestsThisMonth + 1 > quota.monthlyLimit) {
      warnings.push(`Monthly request limit exceeded for ${providerName}`);
    }
    if (usage.tokensInToday + usage.tokensOutToday + tokensIn + tokensOut > quota.dailyTokens) {
      warnings.push(`Daily token limit exceeded for ${providerName}`);
    }
    if (usage.tokensInThisMonth + usage.tokensOutThisMonth + tokensIn + tokensOut > quota.monthlyTokens) {
      warnings.push(`Monthly token limit exceeded for ${providerName}`);
    }
    if (usage.costToday + cost > quota.dailyCost) {
      warnings.push(`Daily cost limit exceeded for ${providerName}`);
    }
    if (usage.costThisMonth + cost > quota.monthlyCost) {
      warnings.push(`Monthly cost limit exceeded for ${providerName}`);
    }

    // Record usage
    usage.requestsToday++;
    usage.requestsThisMonth++;
    usage.tokensInToday += tokensIn;
    usage.tokensOutToday += tokensOut;
    usage.tokensInThisMonth += tokensIn;
    usage.tokensOutThisMonth += tokensOut;
    usage.costToday += cost;
    usage.costThisMonth += cost;
    usage.lastUsed = new Date();

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
    this.resetIfNeeded();
    return this.usage.get(providerId);
  }

  /**
   * Get all usage stats
   */
  getAllUsage(): Array<ProviderUsage & { quota: ProviderQuota; utilization: Record<string, number> }> {
    this.resetIfNeeded();

    return Array.from(this.usage.values()).map(u => {
      const quota = this.quotas.get(u.providerId);
      return {
        ...u,
        quota: quota || this.quotas.get(u.providerId) || {
          providerId: u.providerId,
          providerName: u.providerId,
          dailyLimit: DEFAULT_DAILY_REQ_LIMIT,
          monthlyLimit: DEFAULT_MONTHLY_REQ_LIMIT,
          dailyTokens: DEFAULT_DAILY_TOKEN_LIMIT,
          monthlyTokens: DEFAULT_MONTHLY_TOKEN_LIMIT,
          dailyCost: DEFAULT_DAILY_COST_LIMIT,
          monthlyCost: DEFAULT_MONTHLY_COST_LIMIT,
        },
        utilization: {
          dailyRequests: quota ? (u.requestsToday / quota.dailyLimit) * 100 : 0,
          monthlyRequests: quota ? (u.requestsThisMonth / quota.monthlyLimit) * 100 : 0,
          dailyTokens: quota ? ((u.tokensInToday + u.tokensOutToday) / quota.dailyTokens) * 100 : 0,
          monthlyTokens: quota ? ((u.tokensInThisMonth + u.tokensOutThisMonth) / quota.monthlyTokens) * 100 : 0,
          dailyCost: quota ? (u.costToday / quota.dailyCost) * 100 : 0,
          monthlyCost: quota ? (u.costThisMonth / quota.monthlyCost) * 100 : 0,
        }
      };
    });
  }

  /**
   * Check if provider is within quota
   */
  isWithinQuota(providerId: string): boolean {
    this.resetIfNeeded();
    const usage = this.usage.get(providerId);
    const quota = this.quotas.get(providerId);

    if (!usage || !quota) return true;

    return (
      usage.requestsToday < quota.dailyLimit &&
      usage.requestsThisMonth < quota.monthlyLimit &&
      (usage.tokensInToday + usage.tokensOutToday) < quota.dailyTokens &&
      (usage.tokensInThisMonth + usage.tokensOutThisMonth) < quota.monthlyTokens &&
      usage.costToday < quota.dailyCost &&
      usage.costThisMonth < quota.monthlyCost
    );
  }

  /**
   * Reset all counters (for testing)
   */
  reset(): void {
    this.usage.clear();
    this.quotas.clear();
    this.dayStart = this.getDayStart();
    this.monthStart = this.getMonthStart();
  }
}

export const quotaTracker = new QuotaTracker();
