/**
 * A/B Testing for Models — SQLite-backed
 * Split traffic between models and track latency, cost, and quality.
 */
import { getDb, genId } from './database.js';
import { logger } from './logger.js';

// ─── Types ──────────────────────────────────────────────────────────────────

export interface ABTest {
  id: string;
  name: string;
  modelA: string;
  modelB: string;
  splitPercent: number;
  isActive: boolean;
  createdAt: string;
}

export interface ABResult {
  variant: 'A' | 'B';
  latencyMs: number;
  tokensIn: number;
  tokensOut: number;
  cost: number;
  error?: string;
  recordedAt: string;
}

export interface ABStats {
  id: string;
  name: string;
  modelA: string;
  modelB: string;
  splitPercent: number;
  isActive: boolean;
  a: VariantStats;
  b: VariantStats;
  winner: 'A' | 'B' | 'tie';
}

interface VariantStats {
  count: number;
  avgLatency: number;
  avgCost: number;
  totalTokens: number;
  errorRate: number;
}

interface TestRow {
  id: string;
  name: string;
  model_a: string;
  model_b: string;
  split_percent: number;
  is_active: number;
  created_at: string;
}

interface ResultRow {
  id: number;
  test_id: string;
  variant: 'A' | 'B';
  latency_ms: number | null;
  tokens_in: number | null;
  tokens_out: number | null;
  cost: number | null;
  error: string | null;
  recorded_at: string;
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function rowToTest(row: TestRow): ABTest {
  return {
    id: row.id,
    name: row.name,
    modelA: row.model_a,
    modelB: row.model_b,
    splitPercent: row.split_percent,
    isActive: row.is_active === 1,
    createdAt: row.created_at,
  };
}

function computeVariantStats(rows: ResultRow[]): VariantStats {
  if (rows.length === 0) {
    return { count: 0, avgLatency: 0, avgCost: 0, totalTokens: 0, errorRate: 0 };
  }

  const latencies = rows.map(r => r.latency_ms ?? 0);
  const costs = rows.map(r => r.cost ?? 0);
  const totalTokens = rows.reduce((sum, r) => sum + (r.tokens_in ?? 0) + (r.tokens_out ?? 0), 0);
  const errorCount = rows.filter(r => r.error !== null).length;

  return {
    count: rows.length,
    avgLatency: latencies.reduce((s, v) => s + v, 0) / rows.length,
    avgCost: costs.reduce((s, v) => s + v, 0) / rows.length,
    totalTokens,
    errorRate: errorCount / rows.length,
  };
}

// ─── A/B Testing Manager ────────────────────────────────────────────────────

class ABTestingManager {
  /**
   * Create a new A/B test.
   */
  createTest(config: {
    name: string;
    modelA: string;
    modelB: string;
    splitPercent?: number;
  }): ABTest {
    const id = genId('ab');
    const db = getDb();

    db.prepare(`
      INSERT INTO ab_tests (id, name, model_a, model_b, split_percent, is_active)
      VALUES (?, ?, ?, ?, ?, 1)
    `).run(id, config.name, config.modelA, config.modelB, config.splitPercent ?? 50);

    logger.info(`[ABTest] Created test ${id}: ${config.modelA} vs ${config.modelB}`);

    return {
      id,
      name: config.name,
      modelA: config.modelA,
      modelB: config.modelB,
      splitPercent: config.splitPercent ?? 50,
      isActive: true,
      createdAt: new Date().toISOString(),
    };
  }

  /**
   * Get variant assignment for a test.
   */
  getVariant(testId: string): 'A' | 'B' {
    const db = getDb();
    const row = db.prepare('SELECT split_percent, is_active FROM ab_tests WHERE id = ?')
      .get(testId) as { split_percent: number; is_active: number } | undefined;

    if (!row || !row.is_active) return 'A';
    return Math.random() * 100 < row.split_percent ? 'A' : 'B';
  }

  /**
   * Record a result for a test variant.
   */
  recordResult(testId: string, variant: 'A' | 'B', result: {
    latencyMs: number;
    tokensIn: number;
    tokensOut: number;
    cost: number;
    error?: string;
  }): void {
    const db = getDb();
    db.prepare(`
      INSERT INTO ab_test_results (test_id, variant, latency_ms, tokens_in, tokens_out, cost, error)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(testId, variant, result.latencyMs, result.tokensIn, result.tokensOut, result.cost, result.error ?? null);
  }

  /**
   * Get statistics for a test, including winner determination.
   */
  getStats(testId: string): ABStats | undefined {
    const db = getDb();
    const testRow = db.prepare('SELECT * FROM ab_tests WHERE id = ?').get(testId) as TestRow | undefined;
    if (!testRow) return undefined;

    const resultRows = db.prepare(`
      SELECT * FROM ab_test_results WHERE test_id = ? ORDER BY recorded_at DESC
    `).all(testId) as ResultRow[];

    const aResults = resultRows.filter(r => r.variant === 'A');
    const bResults = resultRows.filter(r => r.variant === 'B');

    const aStats = computeVariantStats(aResults);
    const bStats = computeVariantStats(bResults);

    // Winner: lower latency preferred; if tied, lower error rate; if tied, lower cost
    let winner: 'A' | 'B' | 'tie' = 'tie';
    if (aStats.count > 0 && bStats.count > 0) {
      if (aStats.avgLatency < bStats.avgLatency * 0.95) {
        winner = 'A';
      } else if (bStats.avgLatency < aStats.avgLatency * 0.95) {
        winner = 'B';
      } else if (aStats.errorRate < bStats.errorRate) {
        winner = 'A';
      } else if (bStats.errorRate < aStats.errorRate) {
        winner = 'B';
      } else if (aStats.avgCost < bStats.avgCost) {
        winner = 'A';
      } else if (bStats.avgCost < aStats.avgCost) {
        winner = 'B';
      }
    }

    return {
      id: testRow.id,
      name: testRow.name,
      modelA: testRow.model_a,
      modelB: testRow.model_b,
      splitPercent: testRow.split_percent,
      isActive: testRow.is_active === 1,
      a: aStats,
      b: bStats,
      winner,
    };
  }

  /**
   * List all tests.
   */
  listTests(): ABTest[] {
    const db = getDb();
    const rows = db.prepare('SELECT * FROM ab_tests ORDER BY created_at DESC').all() as TestRow[];
    return rows.map(rowToTest);
  }

  /**
   * Delete a test (cascade deletes results).
   */
  deleteTest(id: string): boolean {
    const db = getDb();
    const result = db.prepare('DELETE FROM ab_tests WHERE id = ?').run(id);
    if (result.changes > 0) {
      logger.info(`[ABTest] Deleted test ${id}`);
      return true;
    }
    return false;
  }
}

export const abTestingManager = new ABTestingManager();
