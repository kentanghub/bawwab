/**
 * Error Tracking Service — Sentry wrapper
 * Only initializes if SENTRY_DSN env var is set.
 */
import * as Sentry from '@sentry/node';

let initialized = false;

export function initErrorTracker(): void {
  const dsn = process.env.SENTRY_DSN;
  if (!dsn) return;

  Sentry.init({
    dsn,
    environment: process.env.NODE_ENV || 'development',
    tracesSampleRate: process.env.NODE_ENV === 'production' ? 0.1 : 1.0,
    release: process.env.SENTRY_RELEASE || undefined,
  });

  initialized = true;
}

export function captureError(error: Error, context?: Record<string, any>): void {
  if (!initialized) return;
  Sentry.withScope((scope) => {
    if (context) {
      for (const [key, value] of Object.entries(context)) {
        scope.setExtra(key, value);
      }
    }
    Sentry.captureException(error);
  });
}

export function captureMessage(message: string, level: Sentry.SeverityLevel = 'info'): void {
  if (!initialized) return;
  Sentry.captureMessage(message, level);
}

export function setUser(user: { id: string; email?: string; ip_address?: string }): void {
  if (!initialized) return;
  Sentry.setUser(user);
}

export { Sentry };
