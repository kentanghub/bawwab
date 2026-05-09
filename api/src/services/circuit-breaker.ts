/**
 * Circuit Breaker
 * States: CLOSED → OPEN → HALF_OPEN → CLOSED
 * - CLOSED: requests flow normally
 * - OPEN: requests blocked, fast-fail
 * - HALF_OPEN: allow 1 probe request
 * - If probe succeeds → CLOSED, if fails → OPEN
 */

import { logger } from './logger.js';

type CBState = 'CLOSED' | 'OPEN' | 'HALF_OPEN';

interface CircuitState {
  state: CBState;
  failures: number;
  successes: number;
  lastFailureTime?: Date;
  lastStateChange: Date;
  totalRequests: number;
  totalFailures: number;
}

const circuits = new Map<string, CircuitState>();

const CONFIG = {
  failureThreshold: 5,      // failures to OPEN
  successThreshold: 3,      // successes in HALF_OPEN to CLOSE
  timeoutMs: 30000,         // time in OPEN before HALF_OPEN
  halfOpenMaxRequests: 1,   // max requests in HALF_OPEN
};

class CircuitBreaker {
  private getCircuit(providerId: string): CircuitState {
    if (!circuits.has(providerId)) {
      circuits.set(providerId, {
        state: 'CLOSED',
        failures: 0,
        successes: 0,
        lastStateChange: new Date(),
        totalRequests: 0,
        totalFailures: 0,
      });
    }
    return circuits.get(providerId)!;
  }

  /**
   * Check if request allowed through circuit
   */
  allowRequest(providerId: string): boolean {
    const circuit = this.getCircuit(providerId);
    const now = new Date();

    switch (circuit.state) {
      case 'CLOSED':
        return true;

      case 'OPEN':
        if (circuit.lastFailureTime && now.getTime() - circuit.lastFailureTime.getTime() > CONFIG.timeoutMs) {
          this.transition(providerId, 'HALF_OPEN');
          return true;
        }
        return false;

      case 'HALF_OPEN':
        return circuit.successes < CONFIG.halfOpenMaxRequests;
    }
  }

  /**
   * Record success → move toward CLOSED
   */
  recordSuccess(providerId: string): void {
    const circuit = this.getCircuit(providerId);
    circuit.totalRequests++;

    if (circuit.state === 'HALF_OPEN') {
      circuit.successes++;
      if (circuit.successes >= CONFIG.successThreshold) {
        this.transition(providerId, 'CLOSED');
      }
    } else {
      circuit.failures = 0;
    }
  }

  /**
   * Record failure → move toward OPEN
   */
  recordFailure(providerId: string): void {
    const circuit = this.getCircuit(providerId);
    circuit.totalRequests++;
    circuit.totalFailures++;
    circuit.failures++;
    circuit.lastFailureTime = new Date();

    if (circuit.state === 'HALF_OPEN') {
      this.transition(providerId, 'OPEN');
    } else if (circuit.failures >= CONFIG.failureThreshold) {
      this.transition(providerId, 'OPEN');
    }
  }

  getState(providerId: string): CircuitState {
    return this.getCircuit(providerId);
  }

  getAllStates(): Record<string, CircuitState> {
    const result: Record<string, CircuitState> = {};
    circuits.forEach((state, id) => {
      result[id] = state;
    });
    return result;
  }

  private transition(providerId: string, newState: CBState): void {
    const circuit = this.getCircuit(providerId);
    const oldState = circuit.state;
    circuit.state = newState;
    circuit.lastStateChange = new Date();
    if (newState === 'CLOSED') {
      circuit.failures = 0;
      circuit.successes = 0;
    } else if (newState === 'OPEN') {
      circuit.successes = 0;
    }
    logger.info(`[CircuitBreaker] ${providerId}: ${oldState} → ${newState}`);
  }
}

export const circuitBreaker = new CircuitBreaker();
