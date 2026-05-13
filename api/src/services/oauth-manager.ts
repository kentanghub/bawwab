/**
 * OAuth Manager — SQLite-persistent with auto token refresh
 *
 * Handles OAuth 2.0 device code flow and token lifecycle for:
 * - Claude (Anthropic)
 * - Gemini (Google)
 * - GitHub
 * - Codex (OpenAI)
 * - Copilot (GitHub Copilot)
 * - Qwen (DashScope)
 *
 * Features:
 * - Persistent storage via SQLite (oauth_tokens + cookie_credentials tables)
 * - Proactive refresh: auto-refresh 5 minutes before expiry
 * - Reactive refresh: retry-on-401/403 with one refresh attempt
 * - Provider-specific refresh endpoints
 * - In-flight dedup: prevents parallel refresh for same token
 */

import { logger } from './logger.js';
import { getDb, genId } from './database.js';

// ─── Config ────────────────────────────────────────────────────────────────

export interface OAuthConfig {
  clientId: string;
  clientSecret?: string;
  deviceCodeUrl: string;
  tokenUrl: string;
  scope?: string;
}

export interface OAuthToken {
  accessToken: string;
  refreshToken?: string;
  expiresAt: Date;
  tokenType: string;
}

export interface DeviceCodeResponse {
  deviceCode: string;
  userCode: string;
  verificationUri: string;
  expiresIn: number;
  interval: number;
}

export interface CookieCredential {
  cookies: string;
  userAgent?: string;
  expiresAt?: Date;
  createdAt: Date;
}

const OAUTH_CONFIGS: Record<string, OAuthConfig> = {
  claude: {
    clientId: '9d1c250a-e61b-44d9-88ed-5944d1962f5e',
    deviceCodeUrl: 'https://api.anthropic.com/v1/oauth/device_code',
    tokenUrl: 'https://api.anthropic.com/v1/oauth/token',
    scope: 'openid profile user:read'
  },
  gemini: {
    clientId: process.env.GOOGLE_OAUTH_CLIENT_ID || 'YOUR_GOOGLE_CLIENT_ID',
    clientSecret: process.env.GOOGLE_OAUTH_CLIENT_SECRET || 'YOUR_GOOGLE_CLIENT_SECRET',
    deviceCodeUrl: 'https://oauth2.googleapis.com/device/code',
    tokenUrl: 'https://oauth2.googleapis.com/token',
    scope: 'https://www.googleapis.com/auth/cloud-platform'
  },
  github: {
    clientId: process.env.GITHUB_OAUTH_CLIENT_ID || 'Iv1.b507a08c87ecfe98',
    deviceCodeUrl: 'https://github.com/login/device/code',
    tokenUrl: 'https://github.com/login/oauth/access_token',
    scope: 'read:user'
  },
  codex: {
    clientId: process.env.OPENAI_OAUTH_CLIENT_ID || 'com.openai.codex',
    clientSecret: process.env.OPENAI_OAUTH_CLIENT_SECRET,
    deviceCodeUrl: 'https://api.openai.com/v1/oauth/device/code',
    tokenUrl: 'https://api.openai.com/v1/oauth/token',
    scope: 'api'
  },
  copilot: {
    clientId: process.env.GITHUB_COPILOT_CLIENT_ID || 'Iv23li8EpHSJsPc0tY6u',
    clientSecret: process.env.GITHUB_COPILOT_CLIENT_SECRET,
    deviceCodeUrl: 'https://github.com/login/device/code',
    tokenUrl: 'https://github.com/login/oauth/access_token',
    scope: 'read:user gist repo'
  },
  qwen: {
    clientId: process.env.QWEN_OAUTH_CLIENT_ID || 'qwen-dashscope',
    clientSecret: process.env.QWEN_OAUTH_CLIENT_SECRET,
    deviceCodeUrl: 'https://dashscope.aliyuncs.com/api/v1/oauth/device/code',
    tokenUrl: 'https://dashscope.aliyuncs.com/api/v1/oauth/token',
    scope: 'dashscope:all'
  }
};

// Token-only providers (no OAuth flow — users paste their own API keys)
const TOKEN_PROVIDERS = ['cursor', 'cline', 'antigravity'];

// Cookie-based providers (session extracted from browser)
const COOKIE_PROVIDERS = ['kiro'];

// Proactive refresh buffer (5 minutes)
const TOKEN_EXPIRY_BUFFER_MS = 5 * 60 * 1000;

// ─── In-memory stores for non-persistent types ─────────────────────────────

const tokenOnlyStore: Map<string, string> = new Map();

// ─── In-flight refresh dedup ────────────────────────────────────────────────

const refreshPromiseCache: Map<string, Promise<OAuthToken | null>> = new Map();

function getRefreshCacheKey(provider: string, refreshToken: string): string {
  return `${provider}:${refreshToken}`;
}

// ─── OAuthManager ───────────────────────────────────────────────────────────

export class OAuthManager {

  // ═══════════════════════════════════════════════════════════════════════════
  // Device code flow
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Request a device code for OAuth flow
   */
  async requestDeviceCode(provider: string): Promise<DeviceCodeResponse> {
    const config = OAUTH_CONFIGS[provider];
    if (!config) throw new Error(`OAuth not supported for provider: ${provider}`);

    const params = new URLSearchParams({
      client_id: config.clientId,
      scope: config.scope || ''
    });

    const response = await fetch(config.deviceCodeUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: params.toString()
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Device code request failed: ${error}`);
    }

    const data = await response.json() as any as any;

    const result: DeviceCodeResponse = {
      deviceCode: data.device_code || data.deviceCode,
      userCode: data.user_code || data.userCode,
      verificationUri: data.verification_uri || data.verification_url || data.verificationUri,
      expiresIn: data.expires_in || data.expiresIn,
      interval: data.interval || 5
    };

    logger.info(`[OAuth] Device code requested for ${provider}: ${result.userCode}`);
    return result;
  }

  /**
   * Poll for token after device code authorization
   */
  async pollToken(provider: string, deviceCode: string): Promise<OAuthToken | null> {
    const config = OAUTH_CONFIGS[provider];
    if (!config) throw new Error(`OAuth not supported for provider: ${provider}`);

    const params = new URLSearchParams({
      client_id: config.clientId,
      device_code: deviceCode,
      grant_type: 'urn:ietf:params:oauth:grant-type:device_code'
    });

    const response = await fetch(config.tokenUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Accept': 'application/json'
      },
      body: params.toString()
    });

    const data = await response.json() as any as any;

    if (data.error === 'authorization_pending' || data.error === 'slow_down') {
      return null;
    }

    if (data.error) {
      throw new Error(`OAuth error: ${data.error}`);
    }

    const token: OAuthToken = {
      accessToken: data.access_token,
      refreshToken: data.refresh_token,
      expiresAt: new Date(Date.now() + (data.expires_in || 3600) * 1000),
      tokenType: data.token_type || 'Bearer'
    };

    this._persistToken(provider, token, data);
    logger.info(`[OAuth] Token acquired for ${provider}`);
    return token;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Token storage (SQLite)
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Store token credentials in SQLite.
   * Called after poll or refresh to persist.
   */
  storeTokenCredentials(provider: string, token: OAuthToken, rawData?: Record<string, unknown>): void {
    this._persistToken(provider, token, rawData);
  }

  /**
   * Internal: upsert token into oauth_tokens table
   */
  private _persistToken(provider: string, token: OAuthToken, rawData?: Record<string, unknown>): void {
    const db = getDb();
    const existing = db.prepare('SELECT id FROM oauth_tokens WHERE provider = ?').get(provider) as { id: string } | undefined;
    const id = existing?.id ?? genId('ot');
    const expiresAt = token.expiresAt instanceof Date ? token.expiresAt.toISOString() : String(token.expiresAt);
    const data = JSON.stringify(rawData ?? {});

    if (existing) {
      db.prepare(`
        UPDATE oauth_tokens
        SET access_token = ?, refresh_token = ?, expires_at = ?, token_type = ?, data = ?, updated_at = datetime('now')
        WHERE id = ?
      `).run(token.accessToken, token.refreshToken ?? null, expiresAt, token.tokenType, data, id);
    } else {
      db.prepare(`
        INSERT INTO oauth_tokens (id, provider, access_token, refresh_token, expires_at, token_type, data)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(id, provider, token.accessToken, token.refreshToken ?? null, expiresAt, token.tokenType, data);
    }
  }

  /**
   * Load token from SQLite
   */
  private _loadToken(provider: string): OAuthToken | null {
    const db = getDb();
    const row = db.prepare('SELECT access_token, refresh_token, expires_at, token_type FROM oauth_tokens WHERE provider = ?').get(provider) as {
      access_token: string | null;
      refresh_token: string | null;
      expires_at: string | null;
      token_type: string | null;
    } | undefined;

    if (!row || !row.access_token) return null;

    return {
      accessToken: row.access_token,
      refreshToken: row.refresh_token ?? undefined,
      expiresAt: row.expires_at ? new Date(row.expires_at) : new Date(0),
      tokenType: row.token_type || 'Bearer'
    };
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Token refresh (provider-specific)
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Check if token needs refresh (within 5-min buffer or already expired)
   */
  private _needsRefresh(token: OAuthToken): boolean {
    return new Date(Date.now() + TOKEN_EXPIRY_BUFFER_MS) >= token.expiresAt;
  }

  /**
   * Refresh token with in-flight dedup.
   * If a refresh is already in-flight for this provider+refreshToken, reuse it.
   */
  async refreshToken(provider: string): Promise<OAuthToken> {
    const existing = this._loadToken(provider);
    if (!existing?.refreshToken) {
      throw new Error(`Cannot refresh token for ${provider}: no refresh token available`);
    }

    const cacheKey = getRefreshCacheKey(provider, existing.refreshToken);

    // In-flight dedup
    if (refreshPromiseCache.has(cacheKey)) {
      logger.info(`[OAuth] Reusing in-flight refresh for ${provider}`);
      const result = await refreshPromiseCache.get(cacheKey)!;
      if (!result) throw new Error(`In-flight refresh failed for ${provider}`);
      return result;
    }

    const promise = this._doRefresh(provider, existing).finally(() => {
      refreshPromiseCache.delete(cacheKey);
    });

    refreshPromiseCache.set(cacheKey, promise);
    const result = await promise;
    if (!result) throw new Error(`Token refresh failed for ${provider}`);
    return result;
  }

  /**
   * Perform the actual refresh — dispatches to provider-specific logic
   */
  private async _doRefresh(provider: string, existing: OAuthToken): Promise<OAuthToken | null> {
    const refreshToken = existing.refreshToken!;
    const config = OAUTH_CONFIGS[provider];

    try {
      let result: { accessToken: string; refreshToken?: string; expiresIn?: number } | null = null;

      switch (provider) {
        case 'claude':
          result = await this._refreshClaude(refreshToken);
          break;
        case 'gemini':
          result = await this._refreshGemini(refreshToken, config);
          break;
        case 'github':
          result = await this._refreshGitHub(refreshToken, config);
          break;
        case 'codex':
          result = await this._refreshCodex(refreshToken, config);
          break;
        case 'copilot':
          result = await this._refreshCopilot(refreshToken);
          break;
        case 'qwen':
          result = await this._refreshQwen(refreshToken, config);
          break;
        default:
          // Generic refresh using provider's tokenUrl
          result = await this._refreshGeneric(refreshToken, config);
          break;
      }

      if (!result) return null;

      const token: OAuthToken = {
        accessToken: result.accessToken,
        refreshToken: result.refreshToken || refreshToken,
        expiresAt: new Date(Date.now() + (result.expiresIn || 3600) * 1000),
        tokenType: 'Bearer'
      };

      this._persistToken(provider, token);
      logger.info(`[OAuth] Token refreshed for ${provider}`);
      return token;
    } catch (err) {
      logger.error(`[OAuth] Token refresh error for ${provider}: ${(err as Error).message}`);
      return null;
    }
  }

  /** Claude (Anthropic) — POST JSON */
  private async _refreshClaude(refreshToken: string) {
    const config = OAUTH_CONFIGS.claude;
    const response = await fetch(config.tokenUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
      body: JSON.stringify({
        grant_type: 'refresh_token',
        refresh_token: refreshToken,
        client_id: config.clientId
      })
    });

    if (!response.ok) {
      const err = await response.text();
      logger.error(`[OAuth] Claude refresh failed: ${err}`);
      return null;
    }

    const data = await response.json() as any as any;
    return { accessToken: data.access_token, refreshToken: data.refresh_token, expiresIn: data.expires_in };
  }

  /** Gemini (Google) — POST form-urlencoded with client_secret */
  private async _refreshGemini(refreshToken: string, config: OAuthConfig) {
    const params = new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
      client_id: config.clientId
    });
    if (config.clientSecret) params.append('client_secret', config.clientSecret);

    const response = await fetch(config.tokenUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Accept': 'application/json' },
      body: params.toString()
    });

    if (!response.ok) {
      const err = await response.text();
      logger.error(`[OAuth] Gemini refresh failed: ${err}`);
      return null;
    }

    const data = await response.json() as any as any;
    return { accessToken: data.access_token, refreshToken: data.refresh_token, expiresIn: data.expires_in };
  }

  /** GitHub — POST form-urlencoded */
  private async _refreshGitHub(refreshToken: string, config: OAuthConfig) {
    const params: Record<string, string> = {
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
      client_id: config.clientId
    };
    if (config.clientSecret) params.client_secret = config.clientSecret;

    const response = await fetch(config.tokenUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Accept': 'application/json' },
      body: new URLSearchParams(params).toString()
    });

    if (!response.ok) {
      const err = await response.text();
      logger.error(`[OAuth] GitHub refresh failed: ${err}`);
      return null;
    }

    const data = await response.json() as any as any;
    return { accessToken: data.access_token, refreshToken: data.refresh_token, expiresIn: data.expires_in };
  }

  /**
   * Codex (OpenAI) — POST form-urlencoded with rotating refresh tokens.
   * Detects refresh_token_reused → returns null so callers can force re-auth.
   */
  private async _refreshCodex(refreshToken: string, config: OAuthConfig) {
    const params = new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
      client_id: config.clientId,
      scope: 'openid profile email offline_access api'
    });

    const response = await fetch(config.tokenUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Accept': 'application/json' },
      body: params.toString()
    });

    if (!response.ok) {
      const errText = await response.text();
      let errorCode: string | null = null;
      try {
        const parsed = JSON.parse(errText);
        errorCode = parsed?.error?.code || (typeof parsed?.error === 'string' ? parsed.error : null);
      } catch {}

      if (errorCode === 'refresh_token_reused' || errorCode === 'invalid_grant' ||
          errorCode === 'token_expired' || errorCode === 'invalid_token') {
        logger.error(`[OAuth] Codex refresh token unrecoverable (${errorCode}). Re-auth required.`);
        return null;
      }

      logger.error(`[OAuth] Codex refresh failed: ${errText}`);
      return null;
    }

    const data = await response.json() as any as any;
    return { accessToken: data.access_token, refreshToken: data.refresh_token, expiresIn: data.expires_in };
  }

  /**
   * Copilot — exchange GitHub access token for Copilot token via
   * api.github.com/copilot_internal/v2/token
   * The "refreshToken" here is actually a GitHub OAuth access token.
   */
  private async _refreshCopilot(githubAccessToken: string) {
    const response = await fetch('https://api.github.com/copilot_internal/v2/token', {
      method: 'GET',
      headers: {
        'Authorization': `token ${githubAccessToken}`,
        'User-Agent': 'bawwab/1.0.0',
        'Editor-Version': 'vscode/1.95.0',
        'Editor-Plugin-Version': 'copilot-chat/0.22.0',
        'Accept': 'application/json'
      }
    });

    if (!response.ok) {
      const err = await response.text();
      logger.error(`[OAuth] Copilot token exchange failed: ${err}`);
      return null;
    }

    const data = await response.json() as any as any;
    // Copilot returns token + expires_at (epoch seconds)
    const expiresIn = data.expires_at ? Math.max(0, data.expires_at - Math.floor(Date.now() / 1000)) : 3600;
    return {
      accessToken: data.token,
      // Copilot tokens don't have their own refresh — re-use the GitHub token
      refreshToken: githubAccessToken,
      expiresIn
    };
  }

  /** Qwen (DashScope) — POST form-urlencoded */
  private async _refreshQwen(refreshToken: string, config: OAuthConfig) {
    const params = new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
      client_id: config.clientId
    });

    const response = await fetch(config.tokenUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Accept': 'application/json' },
      body: params.toString()
    });

    if (!response.ok) {
      const err = await response.text();
      logger.error(`[OAuth] Qwen refresh failed: ${err}`);
      return null;
    }

    const data = await response.json() as any as any;
    return { accessToken: data.access_token, refreshToken: data.refresh_token, expiresIn: data.expires_in };
  }

  /** Generic refresh using the provider's tokenUrl */
  private async _refreshGeneric(refreshToken: string, config: OAuthConfig) {
    const params = new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
      client_id: config.clientId
    });
    if (config.clientSecret) params.append('client_secret', config.clientSecret);

    const response = await fetch(config.tokenUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Accept': 'application/json' },
      body: params.toString()
    });

    if (!response.ok) {
      const err = await response.text();
      logger.error(`[OAuth] Generic refresh failed: ${err}`);
      return null;
    }

    const data = await response.json() as any as any;
    return { accessToken: data.access_token, refreshToken: data.refresh_token, expiresIn: data.expires_in };
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Token access
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Get valid access token (auto-refresh if expired or about to expire)
   */
  async getAccessToken(provider: string): Promise<string | undefined> {
    const token = this._loadToken(provider);
    if (!token) return undefined;

    if (this._needsRefresh(token)) {
      try {
        const refreshed = await this.refreshToken(provider);
        return refreshed.accessToken;
      } catch {
        return undefined;
      }
    }

    return token.accessToken;
  }

  /**
   * Check if provider has valid OAuth token
   */
  hasToken(provider: string): boolean {
    if (TOKEN_PROVIDERS.includes(provider)) {
      return tokenOnlyStore.has(provider);
    }
    if (COOKIE_PROVIDERS.includes(provider)) {
      return this.hasCookies(provider);
    }
    const token = this._loadToken(provider);
    if (!token) return false;
    return !this._needsRefresh(token);
  }

  /**
   * Get OAuth + token status for all providers
   */
  getStatus(): Record<string, { connected: boolean; expiresAt?: Date; type: 'oauth' | 'token' | 'cookie' }> {
    const result: Record<string, { connected: boolean; expiresAt?: Date; type: 'oauth' | 'token' | 'cookie' }> = {};

    for (const provider of Object.keys(OAUTH_CONFIGS)) {
      const token = this._loadToken(provider);
      result[provider] = {
        connected: token ? !this._needsRefresh(token) : false,
        expiresAt: token?.expiresAt,
        type: 'oauth'
      };
    }

    for (const provider of TOKEN_PROVIDERS) {
      result[provider] = {
        connected: tokenOnlyStore.has(provider),
        type: 'token'
      };
    }

    for (const provider of COOKIE_PROVIDERS) {
      const cred = this.getCookies(provider);
      result[provider] = {
        connected: !!cred,
        expiresAt: cred?.expiresAt,
        type: 'cookie'
      };
    }

    return result;
  }

  getSupportedProviders(): string[] {
    return Object.keys(OAUTH_CONFIGS);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Token-only providers (API key entry)
  // ═══════════════════════════════════════════════════════════════════════════

  setToken(provider: string, apiKey: string): void {
    if (!TOKEN_PROVIDERS.includes(provider)) {
      throw new Error(`Provider ${provider} does not support direct token entry`);
    }
    tokenOnlyStore.set(provider, apiKey);
    logger.info(`[OAuth] Token stored for ${provider}`);
  }

  getToken(provider: string): string | undefined {
    return tokenOnlyStore.get(provider);
  }

  getTokenOnlyProviders(): string[] {
    return [...TOKEN_PROVIDERS];
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Cookie-based providers (SQLite)
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Store cookie credentials in SQLite
   */
  setCookies(provider: string, cookies: string, userAgent?: string, expiresAt?: Date): void {
    if (!COOKIE_PROVIDERS.includes(provider)) {
      throw new Error(`Provider ${provider} does not support cookie-based auth`);
    }

    const db = getDb();
    const existing = db.prepare('SELECT id FROM cookie_credentials WHERE provider = ?').get(provider) as { id: string } | undefined;
    const id = existing?.id ?? genId('cc');

    const headersData = JSON.stringify({
      userAgent: userAgent ?? null,
      expiresAt: expiresAt?.toISOString() ?? null
    });

    if (existing) {
      db.prepare(`
        UPDATE cookie_credentials SET cookies = ?, headers = ?, updated_at = datetime('now') WHERE id = ?
      `).run(cookies, headersData, id);
    } else {
      db.prepare(`
        INSERT INTO cookie_credentials (id, provider, cookies, headers) VALUES (?, ?, ?, ?)
      `).run(id, provider, cookies, headersData);
    }

    logger.info(`[OAuth] Cookies stored for ${provider}`);
  }

  /**
   * Get cookie credentials from SQLite
   */
  getCookies(provider: string): CookieCredential | undefined {
    const db = getDb();
    const row = db.prepare('SELECT cookies, headers FROM cookie_credentials WHERE provider = ?').get(provider) as {
      cookies: string;
      headers: string;
    } | undefined;

    if (!row) return undefined;

    let headers: { userAgent?: string | null; expiresAt?: string | null } = {};
    try { headers = JSON.parse(row.headers); } catch {}

    const expiresAt = headers.expiresAt ? new Date(headers.expiresAt) : undefined;

    // Check expiry
    if (expiresAt && new Date() > expiresAt) {
      logger.warn(`[OAuth] Cookies expired for ${provider}`);
      db.prepare('DELETE FROM cookie_credentials WHERE provider = ?').run(provider);
      return undefined;
    }

    return {
      cookies: row.cookies,
      userAgent: headers.userAgent ?? undefined,
      expiresAt,
      createdAt: new Date() // We don't store created_at in this schema, use now
    };
  }

  /**
   * Check if provider has valid cookie credentials
   */
  hasCookies(provider: string): boolean {
    return this.getCookies(provider) !== undefined;
  }

  /**
   * Get cookie-based providers list
   */
  getCookieProviders(): string[] {
    return [...COOKIE_PROVIDERS];
  }

  /**
   * Clear cookie credentials for a provider
   */
  clearCookies(provider: string): void {
    const db = getDb();
    db.prepare('DELETE FROM cookie_credentials WHERE provider = ?').run(provider);
    logger.info(`[OAuth] Cookies cleared for ${provider}`);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Reactive refresh on auth failure
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Call this when a request to a provider returns 401/403.
   * Attempts a single token refresh and returns the new access token,
   * or null if refresh is not possible.
   */
  async handleAuthFailure(provider: string): Promise<string | null> {
    const token = this._loadToken(provider);
    if (!token?.refreshToken) return null;

    try {
      const refreshed = await this.refreshToken(provider);
      return refreshed.accessToken;
    } catch {
      return null;
    }
  }

  /**
   * Execute a request with automatic reactive refresh on 401/403.
   * Calls `requestFn(accessToken)`, and if it returns a Response with
   * status 401/403, refreshes the token and retries once.
   */
  async fetchWithRefresh(
    provider: string,
    requestFn: (accessToken: string) => Promise<Response>
  ): Promise<Response> {
    const accessToken = await this.getAccessToken(provider);
    if (!accessToken) throw new Error(`No access token for ${provider}`);

    let response = await requestFn(accessToken);

    // Reactive refresh on auth failure
    if (response.status === 401 || response.status === 403) {
      const newToken = await this.handleAuthFailure(provider);
      if (newToken) {
        response = await requestFn(newToken);
      }
    }

    return response;
  }
}

export const oauthManager = new OAuthManager();
