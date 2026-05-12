/**
 * OAuth Manager
 * Handles OAuth 2.0 device code flow for providers that require it:
 * - Claude (Anthropic)
 * - Gemini (Google)
 * - GitHub Copilot
 *
 * Flow:
 * 1. POST /oauth/{provider}/device-code → get user_code + verification_url
 * 2. User visits URL and authorizes
 * 3. Poll /oauth/{provider}/token until authorized
 * 4. Use access_token for API requests
 * 5. Auto-refresh when expired
 */

import { logger } from './logger.js';

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

// OAuth configurations per provider
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
const tokenOnlyStore: Map<string, string> = new Map();

// Cookie-based providers (session extracted from browser)
const COOKIE_PROVIDERS = ['kiro'];

export interface CookieCredential {
  cookies: string;         // Raw Cookie header value, e.g. "aor_session=xxx; aor_token=yyy"
  userAgent?: string;      // Optional: browser user-agent for fingerprint matching
  expiresAt?: Date;        // Optional: cookie expiry
  createdAt: Date;
}

const cookieStore: Map<string, CookieCredential> = new Map();

// In-memory token store (use DB in production)
const tokenStore: Map<string, OAuthToken> = new Map();

export class OAuthManager {
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

    const data = await response.json();

    // Normalize field names (different providers use different conventions)
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

    const data = await response.json();

    // If authorization pending
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

    tokenStore.set(provider, token);
    logger.info(`[OAuth] Token acquired for ${provider}`);
    return token;
  }

  /**
   * Refresh an expired token
   */
  async refreshToken(provider: string): Promise<OAuthToken> {
    const config = OAUTH_CONFIGS[provider];
    const existing = tokenStore.get(provider);

    if (!config || !existing?.refreshToken) {
      throw new Error(`Cannot refresh token for ${provider}`);
    }

    const params = new URLSearchParams({
      client_id: config.clientId,
      refresh_token: existing.refreshToken,
      grant_type: 'refresh_token'
    });

    if (config.clientSecret) {
      params.append('client_secret', config.clientSecret);
    }

    const response = await fetch(config.tokenUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: params.toString()
    });

    if (!response.ok) {
      throw new Error(`Token refresh failed for ${provider}`);
    }

    const data = await response.json();

    const token: OAuthToken = {
      accessToken: data.access_token,
      refreshToken: data.refresh_token || existing.refreshToken,
      expiresAt: new Date(Date.now() + (data.expires_in || 3600) * 1000),
      tokenType: data.token_type || 'Bearer'
    };

    tokenStore.set(provider, token);
    logger.info(`[OAuth] Token refreshed for ${provider}`);
    return token;
  }

  /**
   * Get valid access token (auto-refresh if expired)
   */
  async getAccessToken(provider: string): Promise<string | undefined> {
    const token = tokenStore.get(provider);
    if (!token) return undefined;

    // Refresh if expired or about to expire (5 min buffer)
    if (new Date(Date.now() + 300000) > token.expiresAt) {
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
    const token = tokenStore.get(provider);
    if (!token) return false;
    return new Date(Date.now() + 300000) <= token.expiresAt;
  }

  /**
   * Get OAuth + token status for all providers
   */
  getStatus(): Record<string, { connected: boolean; expiresAt?: Date; type: 'oauth' | 'token' | 'cookie' }> {
    const result: Record<string, { connected: boolean; expiresAt?: Date; type: 'oauth' | 'token' | 'cookie' }> = {};
    for (const provider of Object.keys(OAUTH_CONFIGS)) {
      const token = tokenStore.get(provider);
      result[provider] = {
        connected: token ? new Date(Date.now() + 300000) <= token.expiresAt : false,
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

  /**
   * Token-only providers: store API key directly
   */
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

  // ───────────────────────────────────────────────────────────────────────────
  // Cookie-based providers (browser session extraction)
  // ───────────────────────────────────────────────────────────────────────────

  /**
   * Store cookie credentials for a provider
   */
  setCookies(provider: string, cookies: string, userAgent?: string, expiresAt?: Date): void {
    if (!COOKIE_PROVIDERS.includes(provider)) {
      throw new Error(`Provider ${provider} does not support cookie-based auth`);
    }
    cookieStore.set(provider, {
      cookies,
      userAgent,
      expiresAt,
      createdAt: new Date()
    });
    logger.info(`[OAuth] Cookies stored for ${provider}`);
  }

  /**
   * Get cookie credentials for a provider
   */
  getCookies(provider: string): CookieCredential | undefined {
    const cred = cookieStore.get(provider);
    if (!cred) return undefined;
    // Check expiry
    if (cred.expiresAt && new Date() > cred.expiresAt) {
      logger.warn(`[OAuth] Cookies expired for ${provider}`);
      cookieStore.delete(provider);
      return undefined;
    }
    return cred;
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
    cookieStore.delete(provider);
    logger.info(`[OAuth] Cookies cleared for ${provider}`);
  }
}

export const oauthManager = new OAuthManager();
