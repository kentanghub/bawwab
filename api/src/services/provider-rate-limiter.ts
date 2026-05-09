/**
 * Provider Rate Limit Respect
 * Parse rate limit headers from providers and throttle before hitting 429.
 */

import { logger } from './logger.js';

interface ProviderRateLimit {
  providerId: string;
  remainingRequests: number;
  limitRequests: number;
  resetAt: Date;
  remainingTokens: number;
  limitTokens: number;
  retryAfter?: number;
}

const rateLimitStore = new Map<string, ProviderRateLimit>();
const requestQueues = new Map<string, Array<() => void>>();

class ProviderRateLimiter {
  parseHeaders(providerId: string, headers: Headers): void {
    const remaining = headers.get('x-ratelimit-remaining') ||
                     headers.get('x-ratelimit-remaining-requests') ||
                     headers.get('ratelimit-remaining');
    const limit = headers.get('x-ratelimit-limit') ||
                  headers.get('x-ratelimit-limit-requests') ||
                  headers.get('ratelimit-limit');
    const reset = headers.get('x-ratelimit-reset') ||
                  headers.get('ratelimit-reset');
    const retryAfter = headers.get('retry-after');

    if (remaining || limit || reset) {
      const state: ProviderRateLimit = {
        providerId,
        remainingRequests: remaining ? parseInt(remaining, 10) : 999999,
        limitRequests: limit ? parseInt(limit, 10) : 999999,
        resetAt: reset ? new Date(parseInt(reset, 10) * 1000) : new Date(Date.now() + 60000),
        remainingTokens: 999999,
        limitTokens: 999999,
        retryAfter: retryAfter ? parseInt(retryAfter, 10) : undefined,
      };
      rateLimitStore.set(providerId, state);
    }
  }

  /**
   * Check if we should throttle before sending
   */
  async checkLimit(providerId: string): Promise<boolean> {
    const state = rateLimitStore.get(providerId);
    if (!state) return true;

    // If reset time passed, reset counters
    if (new Date() > state.resetAt) {
      state.remainingRequests = state.limitRequests;
      state.remainingTokens = state.limitTokens;
    }

    // If very low remaining, queue request
    if (state.remainingRequests <= 2) {
      logger.warn(`[RateLimiter] ${providerId} almost exhausted. Queueing...`);
      return false;
    }

    return true;
  }

  /**
   * Decrement remaining after sending
   */
  decrement(providerId: string, tokens: number = 0): void {
    const state = rateLimitStore.get(providerId);
    if (state) {
      state.remainingRequests = Math.max(0, state.remainingRequests - 1);
      state.remainingTokens = Math.max(0, state.remainingTokens - tokens);
    }
  }

  getState(providerId: string): ProviderRateLimit | undefined {
    return rateLimitStore.get(providerId);
  }
}

export const providerRateLimiter = new ProviderRateLimiter();
