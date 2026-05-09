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
  }
};

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
    const token = tokenStore.get(provider);
    if (!token) return false;
    return new Date(Date.now() + 300000) <= token.expiresAt;
  }

  /**
   * Get OAuth status for all providers
   */
  getStatus(): Record<string, { connected: boolean; expiresAt?: Date }> {
    const result: Record<string, { connected: boolean; expiresAt?: Date }> = {};
    for (const provider of Object.keys(OAUTH_CONFIGS)) {
      const token = tokenStore.get(provider);
      result[provider] = {
        connected: this.hasToken(provider),
        expiresAt: token?.expiresAt
      };
    }
    return result;
  }

  getSupportedProviders(): string[] {
    return Object.keys(OAUTH_CONFIGS);
  }
}

export const oauthManager = new OAuthManager();
