import type { Provider, HealthStatus } from '../types/index.js';
import { pluginManager } from '../plugins/manager.js';

class HealthMonitor {
  private running = false;
  private interval: NodeJS.Timeout | null = null;
  private checkIntervalMs = 30000; // 30 seconds

  start(): void {
    if (this.running) return;
    this.running = true;
    
    // Initial check
    this.checkAllProviders();
    
    // Periodic checks
    this.interval = setInterval(() => {
      this.checkAllProviders();
    }, this.checkIntervalMs);
  }

  stop(): void {
    this.running = false;
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
    }
  }

  isRunning(): boolean {
    return this.running;
  }

  private async checkAllProviders(): Promise<void> {
    const providers = pluginManager.getEnabledProviders();
    
    await Promise.allSettled(
      providers.map(p => this.checkProvider(p))
    );
  }

  private async checkProvider(provider: Provider): Promise<void> {
    const startTime = Date.now();
    
    try {
      // Simple health check - GET request to base URL (HEAD not supported by many APIs)
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 10000);
      
      // Try models endpoint first, fallback to base URL
      const healthUrls = [
        `${provider.baseUrl}/models`,
        provider.baseUrl
      ];
      
      let response: Response | null = null;
      for (const url of healthUrls) {
        try {
          response = await fetch(url, {
            method: 'GET',
            signal: controller.signal
          });
          if (response.status < 500) break;
        } catch {
          continue;
        }
      }
      
      clearTimeout(timeout);
      
      if (!response) {
        throw new Error('No health endpoint responded');
      }
      
      const latency = Date.now() - startTime;
      
      const isHealthy = response.status < 500;
      const status: HealthStatus = {
        status: isHealthy ? 'healthy' : 'degraded',
        lastChecked: new Date(),
        consecutiveFailures: isHealthy ? 0 : provider.healthStatus.consecutiveFailures + 1,
        lastError: isHealthy ? undefined : `HTTP ${response.status}`
      };

      await pluginManager.updateProvider(provider.id, {
        healthStatus: status,
        latencyMs: latency,
        ...(isHealthy && { successRate: Math.min(1, provider.successRate + 0.01) })
      });

    } catch (error) {
      const consecutiveFailures = provider.healthStatus.consecutiveFailures + 1;
      const status: HealthStatus = {
        status: consecutiveFailures >= 3 ? 'unhealthy' : 'degraded',
        lastChecked: new Date(),
        consecutiveFailures,
        lastError: error instanceof Error ? error.message : 'Unknown error'
      };

      await pluginManager.updateProvider(provider.id, {
        healthStatus: status,
        successRate: Math.max(0, provider.successRate - 0.05)
      });
    }
  }

  getProviderHealth(providerId: string): HealthStatus | undefined {
    const provider = pluginManager.getProvider(providerId);
    return provider?.healthStatus;
  }

  getAllHealth(): Record<string, HealthStatus> {
    const result: Record<string, HealthStatus> = {};
    for (const provider of pluginManager.getEnabledProviders()) {
      result[provider.id] = provider.healthStatus;
    }
    return result;
  }
}

export const healthMonitor = new HealthMonitor();
