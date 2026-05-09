import { useEffect, useState } from 'react';
import { Zap, ChevronRight, AlertTriangle, Plus, Trash2, Edit2 } from 'lucide-react';

interface Combo {
  id: string;
  name: string;
  description?: string;
  providerCount: number;
  createdAt: string;
}

interface ComboProvider {
  providerId: string;
  providerName: string;
  modelId: string;
  priority: number;
  healthy: boolean;
}

interface ComboDetail extends Combo {
  providers: ComboProvider[];
}

export function Combos() {
  const [combos, setCombos] = useState<Combo[]>([]);
  const [selectedCombo, setSelectedCombo] = useState<ComboDetail | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchCombos();
  }, []);

  const fetchCombos = async () => {
    try {
      const res = await fetch('/v1/combos');
      const data = await res.json();
      setCombos(data.combos || []);
    } catch (err) {
      console.error('Failed to fetch combos:', err);
    } finally {
      setLoading(false);
    }
  };

  const fetchComboDetail = async (id: string) => {
    try {
      const res = await fetch(`/v1/combos/${id}`);
      const data = await res.json();
      setSelectedCombo(data);
    } catch (err) {
      console.error('Failed to fetch combo detail:', err);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="w-8 h-8 border-2 border-white/20 border-t-white rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold text-white">Provider Combos</h2>
          <p className="text-sm text-[#555555]">Custom provider groupings with fallback priority</p>
        </div>
        <button className="flex items-center gap-2 px-4 py-2 bg-white text-black rounded-lg text-sm font-medium hover:bg-white/90 transition-colors">
          <Plus className="w-4 h-4" />
          New Combo
        </button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Combo List */}
        <div className="lg:col-span-1 space-y-3">
          {combos.map((combo) => (
            <button
              key={combo.id}
              onClick={() => fetchComboDetail(combo.id)}
              className={`w-full text-left p-4 rounded-xl border transition-all ${
                selectedCombo?.id === combo.id
                  ? 'bg-[#1a1a1a] border-white/20'
                  : 'bg-[#0a0a0a] border-[#2a2a2a] hover:border-[#3a3a3a]'
              }`}
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 bg-white/10 rounded-lg flex items-center justify-center">
                    <Zap className="w-4 h-4 text-white" />
                  </div>
                  <div>
                    <h3 className="text-sm font-medium text-white">{combo.name}</h3>
                    <p className="text-xs text-[#555555]">{combo.providerCount} providers</p>
                  </div>
                </div>
                <ChevronRight className="w-4 h-4 text-[#555555]" />
              </div>
              {combo.description && (
                <p className="text-xs text-[#555555] mt-2 ml-11">{combo.description}</p>
              )}
            </button>
          ))}
        </div>

        {/* Combo Detail */}
        <div className="lg:col-span-2">
          {selectedCombo ? (
            <div className="bg-[#0a0a0a] border border-[#2a2a2a] rounded-xl p-6">
              <div className="flex items-center justify-between mb-6">
                <div>
                  <h3 className="text-lg font-semibold text-white">{selectedCombo.name}</h3>
                  <p className="text-sm text-[#555555]">{selectedCombo.description}</p>
                </div>
                <div className="flex gap-2">
                  <button className="p-2 text-[#555555] hover:text-white transition-colors">
                    <Edit2 className="w-4 h-4" />
                  </button>
                  <button className="p-2 text-[#555555] hover:text-red-400 transition-colors">
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>

              <div className="space-y-3">
                <h4 className="text-xs font-medium text-[#555555] uppercase tracking-wider">
                  Provider Chain
                </h4>
                {selectedCombo.providers.map((provider, index) => (
                  <div
                    key={provider.providerId}
                    className="flex items-center gap-4 p-4 bg-[#111111] rounded-lg"
                  >
                    <div className="w-6 h-6 bg-white/10 rounded-full flex items-center justify-center text-xs font-bold text-white">
                      {index + 1}
                    </div>
                    <div className="flex-1">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium text-white">
                          {provider.providerName}
                        </span>
                        {!provider.healthy && (
                          <span className="flex items-center gap-1 text-xs text-amber-400">
                            <AlertTriangle className="w-3 h-3" />
                            Unhealthy
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-[#555555]">{provider.modelId}</p>
                    </div>
                    <div className="text-xs text-[#555555]">
                      Priority {provider.priority}
                    </div>
                  </div>
                ))}
              </div>

              <div className="mt-6 p-4 bg-[#111111] rounded-lg">
                <h4 className="text-xs font-medium text-[#555555] mb-2">How it works</h4>
                <p className="text-sm text-[#888888]">
                  Requests are sent to the first healthy provider in the chain.
                  If it fails, the gateway automatically tries the next provider.
                  This ensures maximum uptime for your workloads.
                </p>
              </div>
            </div>
          ) : (
            <div className="flex items-center justify-center h-96 bg-[#0a0a0a] border border-[#2a2a2a] rounded-xl">
              <div className="text-center">
                <Zap className="w-12 h-12 text-[#2a2a2a] mx-auto mb-4" />
                <p className="text-[#555555]">Select a combo to view details</p>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
