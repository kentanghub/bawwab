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

interface WebSocketStatus {
  metrics: 'connecting' | 'connected' | 'disconnected';
  health: 'connecting' | 'connected' | 'disconnected';
}

interface AppState {
  providers: Provider[];
  metrics: Metrics | null;
  isConnected: boolean;
  wsStatus: WebSocketStatus;
  wsError: string | null;
  adminKey: string | null;
  setProviders: (providers: Provider[]) => void;
  setMetrics: (metrics: Metrics) => void;
  setConnected: (connected: boolean) => void;
  setWsStatus: (status: Partial<WebSocketStatus>) => void;
  setWsError: (error: string | null) => void;
  setAdminKey: (key: string | null) => void;
}

export const useStore = create<AppState>((set) => ({
  providers: [],
  metrics: null,
  isConnected: false,
  wsStatus: { metrics: 'disconnected', health: 'disconnected' },
  wsError: null,
  adminKey: localStorage.getItem('bawwab_admin_key'),
  setProviders: (providers) => set({ providers }),
  setMetrics: (metrics) => set({ metrics }),
  setConnected: (isConnected) => set({ isConnected }),
  setWsStatus: (status) => set((state) => ({ 
    wsStatus: { ...state.wsStatus, ...status } 
  })),
  setWsError: (error) => set({ wsError: error }),
  setAdminKey: (key) => {
    if (key) localStorage.setItem('bawwab_admin_key', key);
    else localStorage.removeItem('bawwab_admin_key');
    set({ adminKey: key });
  }
}));
