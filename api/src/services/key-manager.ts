/**
 * Key Manager
 * Manages multiple API keys per provider with round-robin
 * and per-key health tracking.
 */

import { logger } from './logger.js';

export interface KeyState {
  key: string;
  index: number;
  failures: number;
  lastUsed: Date;
  healthy: boolean;
}

export class KeyManager {
  private keys: Map<string, KeyState[]> = new Map();
  private counters: Map<string, number> = new Map();

  /**
   * Load keys for a provider from environment variable
   * Supports comma-separated keys: KEY1,KEY2,KEY3
   */
  loadKeys(providerId: string): void {
    if (this.keys.has(providerId)) return;

    const envKey = `${providerId.toUpperCase()}_API_KEY`;
    const raw = process.env[envKey];
    if (!raw) return;

    const keyStrings = raw.split(',').map(s => s.trim()).filter(Boolean);
    if (keyStrings.length === 0) return;

    const states: KeyState[] = keyStrings.map((k, i) => ({
      key: k,
      index: i,
      failures: 0,
      lastUsed: new Date(0),
      healthy: true,
    }));

    this.keys.set(providerId, states);
    this.counters.set(providerId, -1);

    logger.info(
      `[KeyManager] Loaded ${states.length} key(s) for ${providerId}`
    );
  }

  /**
   * Get next key via round-robin (skips unhealthy keys)
   */
  getNextKey(providerId: string): string | undefined {
    this.loadKeys(providerId);
    const states = this.keys.get(providerId);
    if (!states || states.length === 0) return undefined;

    // Single key
    if (states.length === 1) {
      return states[0].healthy ? states[0].key : undefined;
    }

    // Find healthy keys
    const healthy = states.filter(s => s.healthy);
    if (healthy.length === 0) {
      // All failed - reset and try again
      states.forEach(s => { s.healthy = true; s.failures = 0; });
      logger.warn(`[KeyManager] All keys failed for ${providerId}, resetting...`);
      return states[0].key;
    }

    // Round-robin among healthy keys
    const counter = (this.counters.get(providerId) ?? -1) + 1;
    const selected = healthy[counter % healthy.length];
    this.counters.set(providerId, counter);
    selected.lastUsed = new Date();

    return selected.key;
  }

  /**
   * Report key failure - marks key unhealthy after 3 consecutive failures
   */
  reportFailure(providerId: string, key: string): void {
    const states = this.keys.get(providerId);
    if (!states) return;

    const state = states.find(s => s.key === key);
    if (!state) return;

    state.failures++;
    if (state.failures >= 3) {
      state.healthy = false;
      logger.warn(
        `[KeyManager] Key ${state.index} for ${providerId} marked unhealthy after 3 failures`
      );
    }
  }

  /**
   * Report key success - resets failure counter
   */
  reportSuccess(providerId: string, key: string): void {
    const states = this.keys.get(providerId);
    if (!states) return;

    const state = states.find(s => s.key === key);
    if (!state) return;

    state.failures = 0;
    state.healthy = true;
  }

  /**
   * Get key stats for dashboard
   */
  getKeyStats(providerId: string): { total: number; healthy: number; unhealthy: number } | undefined {
    const states = this.keys.get(providerId);
    if (!states) return undefined;

    return {
      total: states.length,
      healthy: states.filter(s => s.healthy).length,
      unhealthy: states.filter(s => !s.healthy).length,
    };
  }
}

export const keyManager = new KeyManager();
