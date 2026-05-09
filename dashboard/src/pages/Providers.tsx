import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useStore } from '../stores/app';
import { Server, Check, X, Activity, Plus } from 'lucide-react';

export function Providers() {
  const navigate = useNavigate();
  const { providers, setProviders, adminKey } = useStore();

  useEffect(() => {
    fetchProviders();
    const interval = setInterval(fetchProviders, 10000);
    return () => clearInterval(interval);
  }, []);

  const fetchProviders = async () => {
    try {
      const res = await fetch('/v1/providers');
      const data = await res.json();
      setProviders(data.providers);
    } catch (err) {
      console.error('Failed to fetch providers:', err);
    }
  };

  const toggleProvider = async (id: string) => {
    try {
      await fetch(`/v1/admin/providers/${id}/toggle`, {
        method: 'PATCH',
        headers: {
          'x-api-key': adminKey || '',
        },
      });
      fetchProviders();
    } catch (err) {
      console.error('Failed to toggle provider:', err);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">Providers</h1>
          <p className="text-sm text-gray-500 mt-1">Manage AI providers and their health status</p>
        </div>
        <button
          onClick={() => navigate('/providers/add')}
          className="flex items-center gap-2 px-4 py-2 bg-white text-black rounded-lg font-medium hover:bg-gray-200 transition-colors"
        >
          <Plus className="w-4 h-4" />
          Add Provider
        </button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {providers.map((provider) => (
          <div key={provider.id} className="card-hover">
            <div className="flex items-start justify-between mb-4">
              <div className="flex items-center gap-3">
                <div className="p-3 bg-surface border border-border rounded-lg">
                  <Server className="w-6 h-6 text-white" />
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
                    ? 'bg-white/10 text-white hover:bg-white/20'
                    : 'bg-black text-gray-500 hover:bg-surface border border-border'
                }`}
              >
                {provider.isEnabled ? <Check className="w-5 h-5" /> : <X className="w-5 h-5" />}
              </button>
            </div>

            <div className="grid grid-cols-3 gap-4 mb-4">
              <div className="p-3 bg-black border border-border rounded-lg">
                <div className="flex items-center gap-2 mb-1">
                  <Activity className="w-4 h-4 text-gray-500" />
                  <span className="text-xs text-gray-500">Health</span>
                </div>
                <p className={`text-sm font-medium ${
                  provider.health.status === 'healthy' ? 'text-white' :
                  provider.health.status === 'degraded' ? 'text-gray-300' :
                  provider.health.status === 'unhealthy' ? 'text-gray-500' :
                  'text-gray-400'
                }`}>
                  {provider.health.status}
                </p>
              </div>
              <div className="p-3 bg-black border border-border rounded-lg">
                <p className="text-xs text-gray-500 mb-1">Latency</p>
                <p className="text-sm font-medium text-white">{provider.latency}ms</p>
              </div>
              <div className="p-3 bg-black border border-border rounded-lg">
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
                    className="px-2 py-1 text-xs bg-black border border-border text-gray-300 rounded-md"
                  >
                    {model.name}
                  </span>
                ))}
                {provider.models.length > 4 && (
                  <span className="px-2 py-1 text-xs bg-black border border-border text-gray-500 rounded-md">
                    +{provider.models.length - 4} more
                  </span>
                )}
              </div>
            </div>

            <div className="flex flex-wrap gap-2 mt-4">
              {provider.capabilities.map((cap) => (
                <span
                  key={cap}
                  className="px-2 py-1 text-xs bg-white/10 text-white rounded-md border border-white/10"
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
