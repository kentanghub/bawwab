/**
 * A/B Testing for Models
 * Split traffic between models and track win rate (latency, cost, quality).
 */

import { logger } from './logger.js';

interface ABTest {
  id: string;
  name: string;
  modelA: { providerId: string; modelId: string };
  modelB: { providerId: string; modelId: string };
  splitA: number; // percentage 0-100
  active: boolean;
  results: ABResult[];
}

interface ABResult {
  variant: 'A' | 'B';
  latencyMs: number;
  cost: number;
  tokensIn: number;
  tokensOut: number;
  timestamp: Date;
}

const tests: Map<string, ABTest> = new Map();

class ABTesting {
  createTest(config: Omit<ABTest, 'id' | 'results'>): ABTest {
    const id = `ab_${Date.now()}`;
    const test: ABTest = { ...config, id, results: [] };
    tests.set(id, test);
    logger.info(`[ABTest] Created test ${id}: ${config.modelA.modelId} vs ${config.modelB.modelId}`);
    return test;
  }

  getVariant(testId: string): 'A' | 'B' {
    const test = tests.get(testId);
    if (!test || !test.active) return 'A';
    return Math.random() * 100 < test.splitA ? 'A' : 'B';
  }

  recordResult(testId: string, variant: 'A' | 'B', result: Omit<ABResult, 'variant' | 'timestamp'>): void {
    const test = tests.get(testId);
    if (!test) return;
    test.results.push({ ...result, variant, timestamp: new Date() });
  }

  getStats(testId: string): Record<string, any> | undefined {
    const test = tests.get(testId);
    if (!test) return undefined;

    const aResults = test.results.filter(r => r.variant === 'A');
    const bResults = test.results.filter(r => r.variant === 'B');

    const avg = (arr: number[]) => arr.length ? arr.reduce((s, v) => s + v, 0) / arr.length : 0;

    return {
      id: test.id,
      name: test.name,
      splitA: test.splitA,
      active: test.active,
      a: {
        count: aResults.length,
        avgLatency: avg(aResults.map(r => r.latencyMs)),
        avgCost: avg(aResults.map(r => r.cost)),
      },
      b: {
        count: bResults.length,
        avgLatency: avg(bResults.map(r => r.latencyMs)),
        avgCost: avg(bResults.map(r => r.cost)),
      },
      winner: avg(aResults.map(r => r.latencyMs)) < avg(bResults.map(r => r.latencyMs)) ? 'A' : 'B',
    };
  }

  getAllTests(): ABTest[] {
    return Array.from(tests.values());
  }
}

export const abTesting = new ABTesting();
