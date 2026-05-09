import { useState, useEffect } from 'react';
import { Settings as SettingsIcon, Save, Check } from 'lucide-react';

interface OptimizerConfig {
  enabled: boolean;
  compressionLevel: 'light' | 'medium' | 'aggressive';
  deduplicateToolResults: boolean;
  slidingWindowEnabled: boolean;
  maxContextTokens: number;
  semanticChunking: boolean;
}

export function Settings() {
  const [config, setConfig] = useState<OptimizerConfig | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    fetchConfig();
  }, []);

  const fetchConfig = async () => {
    try {
      const res = await fetch('/api/v1/admin/config/token-optimizer');
      const data = await res.json();
      setConfig(data.config);
    } catch (err) {
      console.error('Failed to fetch config:', err);
    }
  };

  const saveConfig = async () => {
    if (!config) return;
    setSaving(true);
    try {
      // In a real implementation, this would POST to update the config
      await new Promise(resolve => setTimeout(resolve, 500));
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (err) {
      console.error('Failed to save config:', err);
    } finally {
      setSaving(false);
    }
  };

  if (!config) {
    return (
      <div className="card">
        <div className="animate-pulse space-y-4">
          <div className="h-4 bg-gray-800 rounded w-1/4" />
          <div className="h-10 bg-gray-800 rounded" />
          <div className="h-10 bg-gray-800 rounded" />
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="card">
        <div className="flex items-center gap-3 mb-6">
          <SettingsIcon className="w-6 h-6 text-emerald-400" />
          <h3 className="text-lg font-semibold text-white">Token Optimizer</h3>
        </div>

        <div className="space-y-6">
          <div className="flex items-center justify-between p-4 bg-gray-850 rounded-lg">
            <div>
              <p className="text-sm font-medium text-white">Enable Token Optimization</p>
              <p className="text-xs text-gray-500">Compress and optimize token usage</p>
            </div>
            <button
              onClick={() => setConfig({ ...config, enabled: !config.enabled })}
              className={`relative w-14 h-7 rounded-full transition-colors ${
                config.enabled ? 'bg-emerald-500' : 'bg-gray-700'
              }`}
            >
              <div className={`absolute top-1 w-5 h-5 bg-white rounded-full transition-transform ${
                config.enabled ? 'translate-x-7' : 'translate-x-1'
              }`} />
            </button>
          </div>

          <div className="p-4 bg-gray-850 rounded-lg">
            <p className="text-sm font-medium text-white mb-3">Compression Level</p>
            <div className="flex gap-2">
              {(['light', 'medium', 'aggressive'] as const).map((level) => (
                <button
                  key={level}
                  onClick={() => setConfig({ ...config, compressionLevel: level })}
                  className={`px-4 py-2 rounded-lg text-sm font-medium capitalize transition-colors ${
                    config.compressionLevel === level
                      ? 'bg-emerald-500 text-white'
                      : 'bg-gray-800 text-gray-400 hover:bg-gray-750'
                  }`}
                >
                  {level}
                </button>
              ))}
            </div>
          </div>

          <div className="space-y-4">
            {[
              { key: 'deduplicateToolResults', label: 'Deduplicate Tool Results', desc: 'Remove duplicate tool outputs' },
              { key: 'slidingWindowEnabled', label: 'Sliding Window', desc: 'Limit conversation history' },
              { key: 'semanticChunking', label: 'Semantic Chunking', desc: 'Merge related short messages' },
            ].map((item) => (
              <div key={item.key} className="flex items-center justify-between p-4 bg-gray-850 rounded-lg">
                <div>
                  <p className="text-sm font-medium text-white">{item.label}</p>
                  <p className="text-xs text-gray-500">{item.desc}</p>
                </div>
                <button
                  onClick={() => setConfig({ ...config, [item.key]: !config[item.key as keyof OptimizerConfig] })}
                  className={`relative w-14 h-7 rounded-full transition-colors ${
                    config[item.key as keyof OptimizerConfig] ? 'bg-emerald-500' : 'bg-gray-700'
                  }`}
                >
                  <div className={`absolute top-1 w-5 h-5 bg-white rounded-full transition-transform ${
                    config[item.key as keyof OptimizerConfig] ? 'translate-x-7' : 'translate-x-1'
                  }`} />
                </button>
              </div>
            ))}
          </div>

          <div className="p-4 bg-gray-850 rounded-lg">
            <p className="text-sm font-medium text-white mb-2">Max Context Tokens</p>
            <input
              type="number"
              value={config.maxContextTokens}
              onChange={(e) => setConfig({ ...config, maxContextTokens: parseInt(e.target.value) })}
              className="w-full px-4 py-2 bg-gray-800 border border-gray-700 rounded-lg text-white focus:outline-none focus:border-emerald-500"
            />
          </div>

          <div className="flex justify-end">
            <button
              onClick={saveConfig}
              disabled={saving}
              className="btn-primary flex items-center gap-2"
            >
              {saved ? <Check className="w-4 h-4" /> : <Save className="w-4 h-4" />}
              {saved ? 'Saved!' : saving ? 'Saving...' : 'Save Changes'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
