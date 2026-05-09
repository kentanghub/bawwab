import type { RequestLog } from '../types/index.js';

class MetricsCollector {
  private logs: RequestLog[] = [];
  private maxLogs = 10000;
  private initialized = false;

  initialize(): void {
    this.initialized = true;
  }

  record(log: RequestLog): void {
    this.logs.push(log);
    
    // Trim old logs
    if (this.logs.length > this.maxLogs) {
      this.logs = this.logs.slice(-this.maxLogs);
    }
  }

  getRecentLogs(limit = 100): RequestLog[] {
    return this.logs.slice(-limit).reverse();
  }

  getStats(): {
    totalRequests: number;
    totalTokens: number;
    totalCost: number;
    avgLatency: number;
    successRate: number;
    providerBreakdown: Record<string, { requests: number; tokens: number; cost: number }>;
  } {
    const totalRequests = this.logs.length;
    const totalTokens = this.logs.reduce((sum, log) => sum + (log.tokensIn + log.tokensOut), 0);
    const totalCost = this.logs.reduce((sum, log) => sum + log.cost, 0);
    const avgLatency = totalRequests > 0 
      ? this.logs.reduce((sum, log) => sum + log.latencyMs, 0) / totalRequests 
      : 0;
    const successCount = this.logs.filter(log => log.statusCode < 400).length;
    const successRate = totalRequests > 0 ? successCount / totalRequests : 1;

    const providerBreakdown: Record<string, { requests: number; tokens: number; cost: number }> = {};
    
    for (const log of this.logs) {
      const p = log.providerId;
      if (!providerBreakdown[p]) {
        providerBreakdown[p] = { requests: 0, tokens: 0, cost: 0 };
      }
      providerBreakdown[p].requests++;
      providerBreakdown[p].tokens += log.tokensIn + log.tokensOut;
      providerBreakdown[p].cost += log.cost;
    }

    return {
      totalRequests,
      totalTokens,
      totalCost,
      avgLatency,
      successRate,
      providerBreakdown
    };
  }

  getHourlyStats(): { hour: string; requests: number; tokens: number; cost: number }[] {
    const hourly = new Map<string, { requests: number; tokens: number; cost: number }>();
    
    for (const log of this.logs) {
      const hour = new Date(log.timestamp).toISOString().slice(0, 13) + ':00';
      const existing = hourly.get(hour) || { requests: 0, tokens: 0, cost: 0 };
      existing.requests++;
      existing.tokens += log.tokensIn + log.tokensOut;
      existing.cost += log.cost;
      hourly.set(hour, existing);
    }
    
    return Array.from(hourly.entries())
      .map(([hour, stats]) => ({ hour, ...stats }))
      .sort((a, b) => a.hour.localeCompare(b.hour));
  }
}

export const metricsCollector = new MetricsCollector();
