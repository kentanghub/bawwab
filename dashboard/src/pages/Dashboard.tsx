import { useEffect } from 'react';
import { useStore } from '../stores/app';
import { useWebSocket } from '../hooks/useWebSocket';
import { TrendingUp, Zap, DollarSign, Activity, Server, Wifi, WifiOff } from 'lucide-react';
import {
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, AreaChart, Area
} from 'recharts';

export function Dashboard() {
  const { providers, metrics, setProviders, setMetrics } = useStore();
  const { wsStatus } = useWebSocket();

  // Still poll providers via HTTP (more complex data structure)
  useEffect(() => {
    fetchProviders();
    const interval = setInterval(fetchProviders, 10000); // Poll every 10s instead of 5s
    return () => clearInterval(interval);
  }, []);
  
  // Fallback: fetch metrics via HTTP if WebSocket is disconnected
  useEffect(() => {
    if (wsStatus.metrics === 'connected') return;
    
    fetchMetrics();
    const interval = setInterval(fetchMetrics, 5000);
    return () => clearInterval(interval);
  }, [wsStatus.metrics]);

  const fetchProviders = async () => {
    try {
      const res = await fetch('/v1/providers');
      const data = await res.json();
      setProviders(data.providers);
    } catch (err) {
      console.error('Failed to fetch providers:', err);
    }
  };

  const fetchMetrics = async () => {
    try {
      const res = await fetch('/v1/admin/metrics');
      const data = await res.json();
      setMetrics(data.stats);
    } catch (err) {
      console.error('Failed to fetch metrics:', err);
    }
  };

  const stats = [
    { label: 'Total Requests', value: metrics?.totalRequests?.toLocaleString() || '0', icon: TrendingUp },
    { label: 'Total Tokens', value: metrics?.totalTokens?.toLocaleString() || '0', icon: Zap },
    { label: 'Total Cost', value: `$${(metrics?.totalCost || 0).toFixed(4)}`, icon: DollarSign },
    { label: 'Avg Latency', value: `${Math.round(metrics?.avgLatency || 0)}ms`, icon: Activity }
  ];

  const hourlyData = [
    { hour: '00:00', requests: 120, tokens: 45000 },
    { hour: '04:00', requests: 80, tokens: 32000 },
    { hour: '08:00', requests: 250, tokens: 98000 },
    { hour: '12:00', requests: 380, tokens: 142000 },
    { hour: '16:00', requests: 420, tokens: 165000 },
    { hour: '20:00', requests: 310, tokens: 118000 },
  ];

  return (
    <div className="space-y-6">
      {/* Connection Status */}
      <div className="flex items-center justify-end gap-2">
        <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-[#111111] border border-[#2a2a2a]">
          {wsStatus.metrics === 'connected' ? (
            <Wifi className="w-3 h-3 text-white" />
          ) : (
            <WifiOff className="w-3 h-3 text-[#555555]" />
          )}
          <span className={`text-xs ${wsStatus.metrics === 'connected' ? 'text-white' : 'text-[#555555]'}`}>
            {wsStatus.metrics === 'connected' ? 'Real-time' : 'Polling'}
          </span>
        </div>
      </div>
      
      {/* Stats Grid */}
      <div className="grid grid-cols-4 gap-4">
        {stats.map((stat) => {
          const Icon = stat.icon;
          return (
            <div key={stat.label} className="card">
              <div className="flex items-center justify-between mb-3">
                <div className="p-2.5 rounded-lg bg-[#1a1a1a] border border-[#2a2a2a]">
                  <Icon className="w-5 h-5 text-white" />
                </div>
              </div>
              <p className="text-xl font-bold text-white">{stat.value}</p>
              <p className="text-xs text-[#555555] mt-1">{stat.label}</p>
            </div>
          );
        })}
      </div>

      {/* Charts Row */}
      <div className="grid grid-cols-2 gap-4">
        <div className="card">
          <h3 className="text-sm font-medium text-white mb-4">Requests Over Time</h3>
          <ResponsiveContainer width="100%" height={280}>
            <AreaChart data={hourlyData}>
              <defs>
                <linearGradient id="requests" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#ffffff" stopOpacity={0.1}/>
                  <stop offset="95%" stopColor="#ffffff" stopOpacity={0}/>
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="#1a1a1a" />
              <XAxis dataKey="hour" stroke="#555555" fontSize={12} />
              <YAxis stroke="#555555" fontSize={12} />
              <Tooltip
                contentStyle={{ backgroundColor: '#111111', border: '1px solid #2a2a2a', borderRadius: '8px' }}
                labelStyle={{ color: '#888888' }}
                itemStyle={{ color: '#ffffff' }}
              />
              <Area type="monotone" dataKey="requests" stroke="#ffffff" strokeWidth={1.5} fillOpacity={1} fill="url(#requests)" />
            </AreaChart>
          </ResponsiveContainer>
        </div>

        <div className="card">
          <h3 className="text-sm font-medium text-white mb-4">Provider Health</h3>
          <div className="space-y-2">
            {providers.slice(0, 6).map((provider) => (
              <div key={provider.id} className="flex items-center justify-between p-2.5 bg-[#111111] rounded-lg border border-[#2a2a2a]">
                <div className="flex items-center gap-3">
                  <Server className="w-4 h-4 text-[#555555]" />
                  <div>
                    <p className="text-sm font-medium text-white">{provider.name}</p>
                    <p className="text-xs text-[#555555]">
                      {provider.models.length} models · {provider.latency}ms
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <div className={`w-1.5 h-1.5 rounded-full ${
                    provider.health.status === 'healthy' ? 'bg-white' :
                    provider.health.status === 'degraded' ? 'bg-[#888888]' :
                    provider.health.status === 'unhealthy' ? 'bg-[#555555]' :
                    'bg-[#2a2a2a]'
                  }`} />
                  <span className="text-xs text-[#888888]">
                    {provider.health.status}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Provider Breakdown */}
      <div className="card">
        <h3 className="text-sm font-medium text-white mb-4">Provider Usage</h3>
        <div className="grid grid-cols-4 gap-3">
          {Object.entries(metrics?.providerBreakdown || {}).map(([provider, data]) => (
            <div key={provider} className="p-3 bg-[#111111] rounded-lg border border-[#2a2a2a]">
              <p className="text-sm font-medium text-white capitalize">{provider}</p>
              <p className="text-xs text-[#555555] mt-1">{data.requests} requests</p>
              <p className="text-xs text-[#555555]">{data.tokens.toLocaleString()} tokens</p>
              <p className="text-xs text-white mt-1">${data.cost.toFixed(4)}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
