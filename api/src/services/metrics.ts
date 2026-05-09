import type { RequestLog } from '../types/index.js';
import { insertLog, getRecentLogs, getStats, getHourlyStats } from './database.js';

class MetricsCollector {
  private initialized = false;

  initialize(): void {
    this.initialized = true;
  }

  record(log: RequestLog): void {
    try {
      insertLog(log);
    } catch (err) {
      // Fallback: don't crash if DB is unavailable
    }
  }

  getRecentLogs(limit = 100): RequestLog[] {
    return getRecentLogs(limit);
  }

  getStats(): ReturnType<typeof getStats> {
    return getStats();
  }

  getHourlyStats(): ReturnType<typeof getHourlyStats> {
    return getHourlyStats();
  }
}

export const metricsCollector = new MetricsCollector();
