/**
 * Debug Logger
 * Detailed request/response logging for troubleshooting.
 * Stores last N requests in memory ring buffer.
 * Activated via X-Debug-Mode header or DEBUG_MODE env var.
 */

import { logger } from './logger.js';

export interface DebugLogEntry {
  id: string;
  timestamp: Date;
  method: string;
  path: string;
  headers: Record<string, string>;
  requestBody: any;
  providerId?: string;
  modelId?: string;
  responseStatus?: number;
  responseBody?: any;
  error?: string;
  latencyMs: number;
  format?: string;
  cavemanMode?: boolean;
  cacheHit?: boolean;
  fallbackCount?: number;
  compressedTokens?: number;
}

const MAX_ENTRIES = 100;

class DebugLogger {
  private logs: DebugLogEntry[] = [];
  private enabled: boolean;

  constructor() {
    this.enabled = process.env.DEBUG_MODE === 'true' || process.env.DEBUG_MODE === '1';
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  setEnabled(value: boolean): void {
    this.enabled = value;
  }

  log(entry: DebugLogEntry): void {
    if (!this.enabled) return;

    this.logs.unshift(entry);
    if (this.logs.length > MAX_ENTRIES) {
      this.logs.pop();
    }

    // Also log to main logger
    logger.debug(
      { id: entry.id, provider: entry.providerId, model: entry.modelId, latency: entry.latencyMs },
      `[Debug] ${entry.method} ${entry.path} → ${entry.responseStatus || 'error'}`
    );
  }

  getLogs(limit: number = 50): DebugLogEntry[] {
    return this.logs.slice(0, limit);
  }

  getLogById(id: string): DebugLogEntry | undefined {
    return this.logs.find(l => l.id === id);
  }

  clear(): void {
    this.logs = [];
  }

  getStats(): {
    total: number;
    avgLatency: number;
    errorRate: number;
    cacheHitRate: number;
  } {
    if (this.logs.length === 0) {
      return { total: 0, avgLatency: 0, errorRate: 0, cacheHitRate: 0 };
    }

    const total = this.logs.length;
    const avgLatency = this.logs.reduce((s, l) => s + l.latencyMs, 0) / total;
    const errors = this.logs.filter(l => l.error || l.responseStatus && l.responseStatus >= 400).length;
    const cacheHits = this.logs.filter(l => l.cacheHit).length;

    return {
      total,
      avgLatency: Math.round(avgLatency),
      errorRate: Math.round((errors / total) * 100),
      cacheHitRate: Math.round((cacheHits / total) * 100),
    };
  }
}

export const debugLogger = new DebugLogger();
