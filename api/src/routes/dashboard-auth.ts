/**
 * Dashboard Auth — Password protection for the web dashboard
 * Only active when DASHBOARD_PASSWORD env var is set.
 * Uses HMAC-signed session cookies (no external dependencies).
 */
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { safeCompare } from '../services/database.js';

const COOKIE_NAME = 'bawwab_session';
const SESSION_DURATION = 7 * 24 * 60 * 60 * 1000; // 7 days

function getSecret(): string {
  return process.env.JWT_SECRET || process.env.ADMIN_API_KEY || 'bawwab-default-secret';
}

function signToken(password: string): string {
  const expires = Date.now() + SESSION_DURATION;
  const payload = `${expires}`;
  const sig = createHmac('sha256', getSecret()).update(payload).digest('hex').slice(0, 32);
  return `${payload}.${sig}`;
}

function verifyToken(token: string): boolean {
  const parts = token.split('.');
  if (parts.length !== 2) return false;
  const [expires, sig] = parts;
  const expected = createHmac('sha256', getSecret()).update(expires).digest('hex').slice(0, 32);
  if (!timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return false;
  return Date.now() < parseInt(expires, 10);
}

function loginPage(error?: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Bawwab — Login</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      background: #0f0f0f; color: #e0e0e0; display: flex; align-items: center;
      justify-content: center; min-height: 100vh; }
    .login-box { background: #1a1a1a; border: 1px solid #333; border-radius: 12px;
      padding: 40px; width: 100%; max-width: 380px; }
    h1 { font-size: 24px; margin-bottom: 8px; color: #fff; }
    p.sub { color: #888; margin-bottom: 24px; font-size: 14px; }
    input[type="password"] { width: 100%; padding: 12px 16px; background: #111;
      border: 1px solid #333; border-radius: 8px; color: #fff; font-size: 16px;
      margin-bottom: 16px; outline: none; }
    input[type="password"]:focus { border-color: #555; }
    button { width: 100%; padding: 12px; background: #2563eb; color: #fff;
      border: none; border-radius: 8px; font-size: 16px; cursor: pointer;
      font-weight: 600; }
    button:hover { background: #1d4ed8; }
    .error { background: #2d1b1b; border: 1px solid #5c2b2b; color: #f87171;
      padding: 10px 14px; border-radius: 8px; margin-bottom: 16px; font-size: 14px; }
  </style>
</head>
<body>
  <div class="login-box">
    <h1>🔐 Bawwab</h1>
    <p class="sub">Enter password to access the dashboard</p>
    ${error ? `<div class="error">${error}</div>` : ''}
    <form method="POST" action="/dashboard/login">
      <input type="password" name="password" placeholder="Password" autofocus required>
      <button type="submit">Login</button>
    </form>
  </div>
</body>
</html>`;
}

const API_PREFIXES = ['/v1/', '/ws/', '/health', '/metrics', '/docs', '/dashboard/login'];

function isApiPath(url: string): boolean {
  return API_PREFIXES.some(p => url.startsWith(p));
}

export async function dashboardAuthRoutes(app: FastifyInstance) {
  const password = process.env.DASHBOARD_PASSWORD;
  if (!password) return; // No password set = no auth

  // Login page
  app.get('/dashboard/login', async (request, reply) => {
    reply.header('Content-Type', 'text/html');
    return loginPage();
  });

  // Login handler
  app.post('/dashboard/login', async (request, reply) => {
    const body = request.body as any;
    const submitted = body?.password || '';

    if (!safeCompare(submitted, password)) {
      reply.header('Content-Type', 'text/html');
      reply.code(401);
      return loginPage('Invalid password');
    }

    const token = signToken(password);
    reply.setCookie(COOKIE_NAME, token, {
      path: '/',
      httpOnly: true,
      sameSite: 'lax',
      maxAge: SESSION_DURATION / 1000,
    });
    reply.redirect('/');
    return reply;
  });

  // Auth guard — preHandler for all non-API routes
  app.addHook('preHandler', async (request, reply) => {
    if (isApiPath(request.url)) return;

    const session = request.cookies?.[COOKIE_NAME];
    if (session && verifyToken(session)) return;

    // Not authenticated — redirect to login
    reply.redirect('/dashboard/login');
    return reply;
  });
}
