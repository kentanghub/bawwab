/**
 * Model Performance Benchmarking
 * Track latency, token throughput, cost per 1K tokens, error rate per model.
 * Auto-rank models based on weighted score.
 */

import { logger } from './logger.js';

interface BenchmarkEntry {
  providerId: string;
  modelId: string;
  latencyMs: number;
  tokensIn: number;
  tokensOut: number;
  cost: number;
  success: boolean;
  timestamp: Date;
}

interface ModelScore {
  providerId: string;
  modelId: string;
  avgLatency: number;
  avgCostPer1k: number;
  errorRate: number;
  throughput: number; // tokens/sec
  score: number;
  samples: number;
}

class ModelBenchmark {
  private entries: BenchmarkEntry[] = [];
  private maxEntries = 5000;

  record(entry: BenchmarkEntry) {
    this.entries.push(entry);
    if (this.entries.length > this.maxEntries) {
      this.entries = this.entries.slice(-this.maxEntries);
    }
  }

  getRankings(): ModelScore[] {
    const grouped = new Map<string, BenchmarkEntry[]>();
    for (const e of this.entries) {
      const key = `${e.providerId}:${e.modelId}`;
      if (!grouped.has(key)) grouped.set(key, []);
      grouped.get(key)!.push(e);
    }

    const scores: ModelScore[] = [];
    for (const [key, items] of Array.from(grouped.entries())) {
      const [providerId, modelId] = key.split(':');
      const total = items.length;
      const successes = items.filter(i => i.success);
      const avgLatency = successes.reduce((s, i) => s + i.latencyMs, 0) / (successes.length || 1);
      const totalTokens = successes.reduce((s, i) => s + i.tokensIn + i.tokensOut, 0);
      const totalCost = successes.reduce((s, i) => s + i.cost, 0);
      const avgCostPer1k = totalTokens > 0 ? (totalCost / totalTokens) * 1000 : 0;
      const errorRate = (total - successes.length) / total;
      const totalLatency = successes.reduce((s, i) => s + i.latencyMs, 0);
      const throughput = totalLatency > 0 ? (totalTokens / totalLatency) * 1000 : 0;

      // Weighted score: lower latency/cost/error is better, higher throughput is better
      const score =
        (1000 / (avgLatency + 1)) * 0.3 +
        (10 / (avgCostPer1k + 0.001)) * 0.3 +
        (throughput * 0.2) +
        ((1 - errorRate) * 100) * 0.2;

      scores.push({ providerId, modelId, avgLatency, avgCostPer1k, errorRate, throughput, score, samples: total });
    }

    return scores.sort((a, b) => b.score - a.score);
  }

  getStats() {
    return { totalEntries: this.entries.length, rankings: this.getRankings() };
  }
}

export const modelBenchmark = new ModelBenchmark();
