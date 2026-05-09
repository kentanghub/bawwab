/**
 * Request Deduplication
 * If multiple identical requests arrive concurrently, only forward one to the provider.
 * Broadcast the result to all waiting clients.
 */

import { logger } from './logger.js';

interface PendingRequest {
  key: string;
  promise: Promise<any>;
  resolvers: Array<(value: any) => void>;
  rejecters: Array<(reason: any) => void>;
  createdAt: Date;
}

const pending = new Map<string, PendingRequest>();

class RequestDeduplicator {
  private generateKey(providerId: string, modelId: string, request: any): string {
    const normalized = JSON.stringify({
      p: providerId,
      m: modelId,
      msgs: request.messages?.map((m: any) => ({ r: m.role, c: typeof m.content === 'string' ? m.content : JSON.stringify(m.content) })),
      t: request.temperature,
      max: request.max_tokens,
      tools: request.tools?.map((t: any) => t.function?.name),
    });
    return normalized;
  }

  /**
   * Execute function with deduplication
   */
  async dedupe<T>(
    providerId: string,
    modelId: string,
    request: any,
    fn: () => Promise<T>
  ): Promise<T> {
    const key = this.generateKey(providerId, modelId, request);

    // If there's a pending identical request, wait for it
    const existing = pending.get(key);
    if (existing) {
      logger.info(`[Dedup] Joining pending request: ${key.slice(0, 40)}...`);
      return new Promise((resolve, reject) => {
        existing.resolvers.push(resolve);
        existing.rejecters.push(reject);
      });
    }

    // Create new pending request
    const promise = fn().finally(() => {
      pending.delete(key);
    });

    const entry: PendingRequest = {
      key,
      promise,
      resolvers: [],
      rejecters: [],
      createdAt: new Date(),
    };

    pending.set(key, entry);

    try {
      const result = await promise;
      // Broadcast to all waiting clients
      entry.resolvers.forEach(r => r(result));
      return result;
    } catch (error) {
      entry.rejecters.forEach(r => r(error));
      throw error;
    }
  }

  getPendingCount(): number {
    return pending.size;
  }
}

export const requestDeduplicator = new RequestDeduplicator();
