import { useEffect } from 'react';
import { useStore } from '../stores/app';
import { TrendingUp, Zap, DollarSign, Activity, Server } from 'lucide-react';
import {
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, AreaChart, Area
} from 'recharts';

export function Dashboard() {
  const { providers, metrics, setProviders, setMetrics } = useStore();

  useEffect(() => {
    fetchProviders();
    fetchMetrics();
    const interval = setInterval(() => {
      fetchProviders();
      fetchMetrics();
    }, 5000);
    return () => clearInterval(interval);
  }, []);

  const fetchProviders = async () => {
    try {
      const res = await fetch('/api/v1/providers');
      const data = await res.json();
      setProviders(data.providers);
    } catch (err) {
      console.error('Failed to fetch providers:', err);
    }
  };

  const fetchMetrics = async () => {
    try {
      const res = await fetch('/api/v1/admin/metrics');
      const data = await res.json();
      setMetrics(data.stats);
    } catch (err) {
      console.error('Failed to fetch metrics:', err);
    }
  };

  const stats = [
    {
      label: 'Total Requests',
      value: metrics?.totalRequests?.toLocaleString() || '0',
      icon: TrendingUp,
      color: 'text-emerald-400',
      bg: 'bg-emerald-500/10'
    },
    {
      label: 'Total Tokens',
      value: metrics?.totalTokens?.toLocaleString() || '0',
      icon: Zap,
      color: 'text-blue-400',
      bg: 'bg-blue-500/10'
    },
    {
      label: 'Total Cost',
      value: `$${(metrics?.totalCost || 0).toFixed(4)}`,
      icon: DollarSign,
      color: 'text-yellow-400',
      bg: 'bg-yellow-500/10'
    },
    {
      label: 'Avg Latency',
      value: `${Math.round(metrics?.avgLatency || 0)}ms`,
      icon: Activity,
      color: 'text-purple-400',
      bg: 'bg-purple-500/10'
    }
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
      {/* Stats Grid */}
      <div className="grid grid-cols-4 gap-6">
        {stats.map((stat) => {
          const Icon = stat.icon;
          return (
            <div key={stat.label} className="card">
              <div className="flex items-center justify-between mb-4">
                <div className={`p-3 rounded-lg ${stat.bg}`}>
                  <Icon className={`w-6 h-6 ${stat.color}`} />
                </div>
              </div>
              <p className="text-2xl font-bold text-white">{stat.value}</p>
              <p className="text-sm text-gray-500 mt-1">{stat.label}</p>
            </div>
          );
        })}
      </div>

      {/* Charts Row */}
      <div className="grid grid-cols-2 gap-6">
        <div className="card">
          <h3 className="text-lg font-semibold text-white mb-4">Requests Over Time</h3>
          <ResponsiveContainer width="100%" height={300}>
            <AreaChart data={hourlyData}>
              <defs>
                <linearGradient id="requests" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#10b981" stopOpacity={0.3}/>
                  <stop offset="95%" stopColor="#10b981" stopOpacity={0}/>
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="#1e1e2e" />
              <XAxis dataKey="hour" stroke="#6b7280" />
              <YAxis stroke="#6b7280" />
              <Tooltip
                contentStyle={{ backgroundColor: '#1e1e2e', border: '1px solid #2a2a3c' }}
                labelStyle={{ color: '#9ca3af' }}
              />
              <Area type="monotone" dataKey="requests" stroke="#10b981" fillOpacity={1} fill="url(#requests)" />
            </AreaChart>
          </ResponsiveContainer>
        </div>

        <div className="card">
          <h3 className="text-lg font-semibold text-white mb-4">Provider Health</h3>
          <div className="space-y-3">
            {providers.slice(0, 6).map((provider) => (
              <div key={provider.id} className="flex items-center justify-between p-3 bg-gray-850 rounded-lg">
                <div className="flex items-center gap-3">
                  <Server className="w-5 h-5 text-gray-500" />
                  <div>
                    <p className="text-sm font-medium text-white">{provider.name}</p>
                    <p className="text-xs text-gray-500">
                      {provider.models.length} models · {provider.latency}ms
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <div className={`w-2 h-2 rounded-full ${
                    provider.health.status === 'healthy' ? 'bg-emerald-400' :
                    provider.health.status === 'degraded' ? 'bg-yellow-400' :
                    provider.health.status === 'unhealthy' ? 'bg-red-400' :
                    'bg-gray-400'
                  }`} />
                  <span className={`text-xs ${
                    provider.health.status === 'healthy' ? 'text-emerald-400' :
                    provider.health.status === 'degraded' ? 'text-yellow-400' :
                    provider.health.status === 'unhealthy' ? 'text-red-400' :
                    'text-gray-400'
                  }`}>
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
        <h3 className="text-lg font-semibold text-white mb-4">Provider Usage</h3>
        <div className="grid grid-cols-4 gap-4">
          {Object.entries(metrics?.providerBreakdown || {}).map(([provider, data]) => (
            <div key={provider} className="p-4 bg-gray-850 rounded-lg">
              <p className="text-sm font-medium text-white capitalize">{provider}</p>
              <p className="text-xs text-gray-500 mt-1">{data.requests} requests</p>
              <p className="text-xs text-gray-500">{data.tokens.toLocaleString()} tokens</p>
              <p className="text-xs text-emerald-400 mt-1">${data.cost.toFixed(4)}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
