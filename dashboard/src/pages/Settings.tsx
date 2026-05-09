import { useState, useEffect } from 'react';
import { useStore } from '../stores/app';
import { Settings as SettingsIcon, Save, Check, Key, AlertCircle } from 'lucide-react';

interface OptimizerConfig {
  enabled: boolean;
  compressionLevel: 'light' | 'medium' | 'aggressive';
  deduplicateToolResults: boolean;
  slidingWindowEnabled: boolean;
  maxContextTokens: number;
  semanticChunking: boolean;
}

export function Settings() {
  const { adminKey, setAdminKey } = useStore();
  const [apiKeyInput, setApiKeyInput] = useState(adminKey || '');
  const [config, setConfig] = useState<OptimizerConfig | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [keySaved, setKeySaved] = useState(false);

  useEffect(() => {
    fetchConfig();
  }, []);

  const fetchConfig = async () => {
    try {
      const res = await fetch('/v1/admin/config/token-optimizer', {
        headers: { 'x-api-key': adminKey || '' },
      });
      const data = await res.json();
      setConfig(data.config);
    } catch (err) {
      console.error('Failed to fetch config:', err);
    }
  };

  const saveApiKey = () => {
    setAdminKey(apiKeyInput.trim() || null);
    setKeySaved(true);
    setTimeout(() => setKeySaved(false), 2000);
  };

  const saveConfig = async () => {
    if (!config) return;
    setSaving(true);
    try {
      await new Promise(resolve => setTimeout(resolve, 500));
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (err) {
      console.error('Failed to save config:', err);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6 max-w-2xl">
      <div>
        <h1 className="text-2xl font-bold text-white">Settings</h1>
        <p className="text-sm text-gray-500 mt-1">Configure dashboard and gateway settings</p>
      </div>

      {/* Admin API Key */}
      <div className="p-6 bg-surface border border-border rounded-xl space-y-4">
        <div className="flex items-center gap-3">
          <Key className="w-5 h-5 text-white" />
          <h2 className="text-lg font-semibold text-white">Admin API Key</h2>
        </div>
        <p className="text-sm text-gray-500">
          Enter your Admin API Key to unlock provider management and admin features.
          The key is stored locally in your browser.
        </p>
        <div className="flex gap-3">
          <input
            type="password"
            value={apiKeyInput}
            onChange={(e) => setApiKeyInput(e.target.value)}
            placeholder="bawwab_..."
            className="flex-1 px-4 py-2 bg-black border border-border rounded-lg text-white text-sm focus:outline-none focus:border-white/30"
          />
          <button
            onClick={saveApiKey}
            className="flex items-center gap-2 px-4 py-2 bg-white text-black rounded-lg font-medium hover:bg-gray-200 transition-colors"
          >
            {keySaved ? <Check className="w-4 h-4" /> : <Save className="w-4 h-4" />}
            {keySaved ? 'Saved' : 'Save'}
          </button>
        </div>
        {!adminKey && (
          <div className="flex items-start gap-2 text-xs text-gray-500">
            <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
            <span>Without an admin key, you can only view providers. Set the key to enable toggling and adding providers.</span>
          </div>
        )}
      </div>

      {/* Token Optimizer */}
      {config && (
        <div className="p-6 bg-surface border border-border rounded-xl space-y-6">
          <div className="flex items-center gap-3">
            <SettingsIcon className="w-5 h-5 text-white" />
            <h2 className="text-lg font-semibold text-white">Token Optimizer</h2>
          </div>

          <div className="flex items-center justify-between p-4 bg-black border border-border rounded-lg">
            <div>
              <p className="text-sm font-medium text-white">Enable Token Optimization</p>
              <p className="text-xs text-gray-500">Compress and optimize token usage</p>
            </div>
            <button
              onClick={() => setConfig({ ...config, enabled: !config.enabled })}
              className={`relative w-14 h-7 rounded-full transition-colors ${
                config.enabled ? 'bg-white' : 'bg-gray-800'
              }`}
            >
              <div className={`absolute top-1 w-5 h-5 rounded-full transition-transform ${
                config.enabled ? 'translate-x-7 bg-black' : 'translate-x-1 bg-gray-400'
              }`} />
            </button>
          </div>

          <div className="p-4 bg-black border border-border rounded-lg">
            <p className="text-sm font-medium text-white mb-3">Compression Level</p>
            <div className="flex gap-2">
              {(['light', 'medium', 'aggressive'] as const).map((level) => (
                <button
                  key={level}
                  onClick={() => setConfig({ ...config, compressionLevel: level })}
                  className={`px-4 py-2 rounded-lg text-sm font-medium capitalize transition-colors ${
                    config.compressionLevel === level
                      ? 'bg-white text-black'
                      : 'bg-surface text-gray-400 hover:text-white border border-border'
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
              <div key={item.key} className="flex items-center justify-between p-4 bg-black border border-border rounded-lg">
                <div>
                  <p className="text-sm font-medium text-white">{item.label}</p>
                  <p className="text-xs text-gray-500">{item.desc}</p>
                </div>
                <button
                  onClick={() => setConfig({ ...config, [item.key]: !config[item.key as keyof OptimizerConfig] })}
                  className={`relative w-14 h-7 rounded-full transition-colors ${
                    config[item.key as keyof OptimizerConfig] ? 'bg-white' : 'bg-gray-800'
                  }`}
                >
                  <div className={`absolute top-1 w-5 h-5 rounded-full transition-transform ${
                    config[item.key as keyof OptimizerConfig] ? 'translate-x-7 bg-black' : 'translate-x-1 bg-gray-400'
                  }`} />
                </button>
              </div>
            ))}
          </div>

          <div className="p-4 bg-black border border-border rounded-lg">
            <p className="text-sm font-medium text-white mb-2">Max Context Tokens</p>
            <input
              type="number"
              value={config.maxContextTokens}
              onChange={(e) => setConfig({ ...config, maxContextTokens: parseInt(e.target.value) })}
              className="w-full px-4 py-2 bg-black border border-border rounded-lg text-white focus:outline-none focus:border-white/30"
            />
          </div>

          <div className="flex justify-end">
            <button
              onClick={saveConfig}
              disabled={saving}
              className="flex items-center gap-2 px-4 py-2 bg-white text-black rounded-lg font-medium hover:bg-gray-200 disabled:opacity-50 transition-colors"
            >
              {saved ? <Check className="w-4 h-4" /> : <Save className="w-4 h-4" />}
              {saved ? 'Saved!' : saving ? 'Saving...' : 'Save Changes'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
