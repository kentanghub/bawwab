import React, { useEffect } from 'react';
import { useStore } from '../stores/app';
import { Server, Check, X, Activity } from 'lucide-react';

export function Providers() {
  const { providers, setProviders } = useStore();

  useEffect(() => {
    fetchProviders();
    const interval = setInterval(fetchProviders, 10000);
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

  const toggleProvider = async (id: string) => {
    try {
      await fetch(`/api/v1/providers/${id}/toggle`, { method: 'PATCH' });
      fetchProviders();
    } catch (err) {
      console.error('Failed to toggle provider:', err);
    }
  };

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {providers.map((provider) => (
          <div key={provider.id} className="card-hover">
            <div className="flex items-start justify-between mb-4">
              <div className="flex items-center gap-3">
                <div className="p-3 bg-gray-850 rounded-lg">
                  <Server className="w-6 h-6 text-emerald-400" />
                </div>
                <div>
                  <h3 className="text-lg font-semibold text-white">{provider.name}</h3>
                  <p className="text-sm text-gray-500">@{provider.alias}</p>
                </div>
              </div>
              <button
                onClick={() => toggleProvider(provider.id)}
                className={`p-2 rounded-lg transition-colors ${
                  provider.isEnabled
                    ? 'bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500/20'
                    : 'bg-gray-800 text-gray-500 hover:bg-gray-750'
                }`}
              >
                {provider.isEnabled ? <Check className="w-5 h-5" /> : <X className="w-5 h-5" />}
              </button>
            </div>

            <div className="grid grid-cols-3 gap-4 mb-4">
              <div className="p-3 bg-gray-850 rounded-lg">
                <div className="flex items-center gap-2 mb-1">
                  <Activity className="w-4 h-4 text-gray-500" />
                  <span className="text-xs text-gray-500">Health</span>
                </div>
                <p className={`text-sm font-medium ${
                  provider.health.status === 'healthy' ? 'text-emerald-400' :
                  provider.health.status === 'degraded' ? 'text-yellow-400' :
                  provider.health.status === 'unhealthy' ? 'text-red-400' :
                  'text-gray-400'
                }`}>
                  {provider.health.status}
                </p>
              </div>
              <div className="p-3 bg-gray-850 rounded-lg">
                <p className="text-xs text-gray-500 mb-1">Latency</p>
                <p className="text-sm font-medium text-white">{provider.latency}ms</p>
              </div>
              <div className="p-3 bg-gray-850 rounded-lg">
                <p className="text-xs text-gray-500 mb-1">Success Rate</p>
                <p className="text-sm font-medium text-white">{(provider.successRate * 100).toFixed(1)}%</p>
              </div>
            </div>

            <div className="space-y-2">
              <p className="text-sm text-gray-500">Models ({provider.models.length})</p>
              <div className="flex flex-wrap gap-2">
                {provider.models.slice(0, 4).map((model) => (
                  <span
                    key={model.id}
                    className="px-2 py-1 text-xs bg-gray-850 text-gray-300 rounded-md"
                  >
                    {model.name}
                  </span>
                ))}
                {provider.models.length > 4 && (
                  <span className="px-2 py-1 text-xs bg-gray-850 text-gray-500 rounded-md">
                    +{provider.models.length - 4} more
                  </span>
                )}
              </div>
            </div>

            <div className="flex flex-wrap gap-2 mt-4">
              {provider.capabilities.map((cap) => (
                <span
                  key={cap}
                  className="px-2 py-1 text-xs bg-emerald-500/10 text-emerald-400 rounded-md"
                >
                  {cap}
                </span>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
