/**
 * Batch Request Processing
 * Accept multiple chat completion requests in a single call.
 * Execute in parallel, return aggregated results.
 */

import { logger } from './logger.js';

export interface BatchItem {
  id: string;
  body: any;
  stream?: boolean;
}

export interface BatchResult {
  id: string;
  status: 'success' | 'error';
  response?: any;
  error?: string;
  latencyMs: number;
}

class BatchProcessor {
  async process(items: BatchItem[], handler: (body: any, stream: boolean) => Promise<any>): Promise<BatchResult[]> {
    const start = Date.now();
    logger.info({ count: items.length }, 'Processing batch requests');

    const results = await Promise.all(
      items.map(async (item) => {
        const itemStart = Date.now();
        try {
          const response = await handler(item.body, item.stream || false);
          return {
            id: item.id,
            status: 'success' as const,
            response,
            latencyMs: Date.now() - itemStart,
          };
        } catch (err: any) {
          return {
            id: item.id,
            status: 'error' as const,
            error: err.message || String(err),
            latencyMs: Date.now() - itemStart,
          };
        }
      })
    );

    logger.info({ count: items.length, totalLatency: Date.now() - start }, 'Batch complete');
    return results;
  }
}

export const batchProcessor = new BatchProcessor();
