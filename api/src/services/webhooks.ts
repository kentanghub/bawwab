/**
 * Webhook Event System — SQLite-backed
 * Fire events with HMAC-SHA256 signed payloads.
 */
import { createHmac, randomBytes } from 'node:crypto';
import { getDb, genId } from './database.js';
import { logger } from './logger.js';

// ─── SSRF Protection ──────────────────────────────────────────────────────

function validateWebhookUrl(urlStr: string): boolean {
  try {
    const url = new URL(urlStr);
    if (!['http:', 'https:'].includes(url.protocol)) return false;
    const h = url.hostname;
    if (['localhost', '127.0.0.1', '0.0.0.0', '::1', '[::1]'].includes(h)) return false;
    if (h.startsWith('10.') || h.startsWith('192.168.')) return false;
    if (h.startsWith('169.254.')) return false;
    const parts = h.split('.');
    if (parts.length === 4 && parts[0] === '172') {
      const s = parseInt(parts[1]);
      if (s >= 16 && s <= 31) return false;
    }
    return true;
  } catch { return false; }
}

// ─── Types ──────────────────────────────────────────────────────────────────

export type WebhookEventType =
  | 'request.completed'
  | 'quota.exceeded'
  | 'provider.down'
  | 'cost.threshold'
  | 'circuit.opened'
  | 'key.revoked';

export interface WebhookSubscription {
  id: string;
  url: string;
  events: WebhookEventType[];
  secret: string | null;
  isActive: boolean;
  createdAt: string;
}

export interface WebhookEvent {
  type: WebhookEventType;
  timestamp: Date;
  payload: Record<string, any>;
}

interface WebhookRow {
  id: string;
  url: string;
  events: string;
  secret: string | null;
  is_active: number;
  created_at: string;
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function rowToSub(row: WebhookRow): WebhookSubscription {
  return {
    id: row.id,
    url: row.url,
    events: JSON.parse(row.events || '[]'),
    secret: row.secret,
    isActive: row.is_active === 1,
    createdAt: row.created_at,
  };
}

function signPayload(body: string, secret: string): string {
  return createHmac('sha256', secret).update(body).digest('hex');
}

// ─── Webhook Manager ────────────────────────────────────────────────────────

class WebhookManager {
  /**
   * Subscribe to webhook events.
   */
  subscribe(sub: {
    url: string;
    events: WebhookEventType[];
    secret?: string;
  }): WebhookSubscription {
    if (!validateWebhookUrl(sub.url)) {
      throw new Error('Invalid webhook URL: blocked internal/private network address');
    }
    const id = genId('wh');
    const secret = sub.secret || randomBytes(32).toString('hex');
    const db = getDb();

    db.prepare(`
      INSERT INTO webhooks (id, url, events, secret, is_active)
      VALUES (?, ?, ?, ?, 1)
    `).run(id, sub.url, JSON.stringify(sub.events), secret);

    logger.info(`[Webhook] Subscribed ${id} to ${sub.events.join(', ')}`);

    return {
      id,
      url: sub.url,
      events: sub.events,
      secret,
      isActive: true,
      createdAt: new Date().toISOString(),
    };
  }

  /**
   * Unsubscribe from webhook events.
   */
  unsubscribe(id: string): boolean {
    const db = getDb();
    const result = db.prepare('DELETE FROM webhooks WHERE id = ?').run(id);
    if (result.changes > 0) {
      logger.info(`[Webhook] Unsubscribed ${id}`);
      return true;
    }
    return false;
  }

  /**
   * List all webhook subscriptions.
   */
  list(): WebhookSubscription[] {
    const db = getDb();
    const rows = db.prepare('SELECT * FROM webhooks ORDER BY created_at DESC').all() as WebhookRow[];
    return rows.map(rowToSub);
  }

  /**
   * Fire a webhook event to all matching subscribers.
   * Posts HMAC-SHA256 signed JSON to each URL.
   */
  async fire(event: WebhookEvent): Promise<void> {
    const db = getDb();
    const rows = db.prepare(`
      SELECT * FROM webhooks WHERE is_active = 1
    `).all() as WebhookRow[];

    const matching = rows
      .map(rowToSub)
      .filter(sub => sub.events.includes(event.type));

    if (matching.length === 0) return;

    const body = JSON.stringify({
      event: event.type,
      timestamp: event.timestamp.toISOString(),
      payload: event.payload,
    });

    const promises = matching.map(async (sub) => {
      try {
        const headers: Record<string, string> = {
          'Content-Type': 'application/json',
          'X-Webhook-Event': event.type,
        };

        // HMAC-SHA256 signature
        if (sub.secret) {
          const signature = signPayload(body, sub.secret);
          headers['X-Webhook-Signature'] = `sha256=${signature}`;
        }

        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 10_000);

        const res = await fetch(sub.url, {
          method: 'POST',
          headers,
          body,
          signal: controller.signal,
        });

        clearTimeout(timeout);

        if (!res.ok) {
          logger.warn(`[Webhook] ${sub.url} returned ${res.status}`);
        }
      } catch (err) {
        logger.warn(`[Webhook] Failed to deliver to ${sub.url}: ${(err as Error).message}`);
      }
    });

    await Promise.allSettled(promises);
  }
}

export const webhookManager = new WebhookManager();
