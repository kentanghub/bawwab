import { create } from 'zustand';

interface Provider {
  id: string;
  alias: string;
  name: string;
  type: string;
  capabilities: string[];
  health: {
    status: 'healthy' | 'degraded' | 'unhealthy' | 'unknown';
    lastChecked: string;
    consecutiveFailures: number;
  };
  latency: number;
  successRate: number;
  costPer1kTokens: number;
  isEnabled: boolean;
  models: any[];
}

interface Metrics {
  totalRequests: number;
  totalTokens: number;
  totalCost: number;
  avgLatency: number;
  successRate: number;
  providerBreakdown: Record<string, { requests: number; tokens: number; cost: number }>;
}

interface AppState {
  providers: Provider[];
  metrics: Metrics | null;
  isConnected: boolean;
  setProviders: (providers: Provider[]) => void;
  setMetrics: (metrics: Metrics) => void;
  setConnected: (connected: boolean) => void;
}

export const useStore = create<AppState>((set) => ({
  providers: [],
  metrics: null,
  isConnected: false,
  setProviders: (providers) => set({ providers }),
  setMetrics: (metrics) => set({ metrics }),
  setConnected: (isConnected) => set({ isConnected })
}));
