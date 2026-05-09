/**
 * Webhook Event System
 * Fire events: request.completed, quota.exceeded, provider.down, cost.threshold
 * Deliver to registered webhook URLs.
 */

import { logger } from './logger.js';

export type WebhookEventType =
  | 'request.completed'
  | 'quota.exceeded'
  | 'provider.down'
  | 'cost.threshold'
  | 'circuit.opened'
  | 'key.revoked';

interface WebhookSubscription {
  id: string;
  url: string;
  events: WebhookEventType[];
  secret?: string;
  active: boolean;
}

interface WebhookEvent {
  type: WebhookEventType;
  timestamp: Date;
  payload: Record<string, any>;
}

const subscriptions: Map<string, WebhookSubscription> = new Map();

class WebhookManager {
  subscribe(sub: Omit<WebhookSubscription, 'id'>): WebhookSubscription {
    const id = `wh_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    const subscription: WebhookSubscription = { ...sub, id };
    subscriptions.set(id, subscription);
    logger.info(`[Webhook] Subscribed ${id} to ${sub.events.join(', ')}`);
    return subscription;
  }

  unsubscribe(id: string): boolean {
    return subscriptions.delete(id);
  }

  async fire(event: WebhookEvent): Promise<void> {
    const matching = Array.from(subscriptions.values()).filter(
      s => s.active && s.events.includes(event.type)
    );

    await Promise.allSettled(
      matching.map(async sub => {
        try {
          const body = JSON.stringify({
            event: event.type,
            timestamp: event.timestamp.toISOString(),
            payload: event.payload,
          });

          await fetch(sub.url, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              ...(sub.secret ? { 'X-Webhook-Secret': sub.secret } : {}),
            },
            body,
          });
        } catch (err) {
          logger.warn(`[Webhook] Failed to deliver to ${sub.url}: ${(err as Error).message}`);
        }
      })
    );
  }

  getSubscriptions(): WebhookSubscription[] {
    return Array.from(subscriptions.values());
  }
}

export const webhookManager = new WebhookManager();
