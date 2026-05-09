import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useStore } from '../stores/app';
import { Plus, ArrowLeft, AlertCircle, Check } from 'lucide-react';

const CAPABILITIES = ['llm', 'embedding', 'image', 'imageToText', 'tts', 'stt', 'webSearch', 'webFetch'];

export function AddProvider() {
  const navigate = useNavigate();
  const { adminKey } = useStore();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  const [form, setForm] = useState({
    id: '',
    alias: '',
    name: '',
    type: 'apikey',
    baseUrl: '',
    authType: 'bearer',
    authHeader: 'Authorization',
    capabilities: ['llm'],
    modelId: '',
    modelName: '',
    contextWindow: 128000,
    supportsStreaming: true,
    supportsVision: false,
    supportsTools: true,
    supportsThinking: false,
    costPer1kInput: 0,
    costPer1kOutput: 0,
  });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    setSuccess('');

    try {
      const payload = {
        id: form.id,
        alias: form.alias || form.id,
        name: form.name,
        type: form.type,
        baseUrl: form.baseUrl,
        authType: form.authType,
        authHeader: form.authHeader,
        capabilities: form.capabilities,
        models: form.modelId ? [{
          id: form.modelId,
          name: form.modelName || form.modelId,
          contextWindow: Number(form.contextWindow),
          maxTokens: 4096,
          supportsStreaming: form.supportsStreaming,
          supportsVision: form.supportsVision,
          supportsTools: form.supportsTools,
          supportsThinking: form.supportsThinking,
          costPer1kInput: Number(form.costPer1kInput),
          costPer1kOutput: Number(form.costPer1kOutput),
        }] : [],
      };

      const res = await fetch('/v1/admin/providers', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': adminKey || '',
        },
        body: JSON.stringify(payload),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || data.message || 'Failed to add provider');
      }

      setSuccess(`Provider "${form.name}" added successfully!`);
      setTimeout(() => navigate('/providers'), 1500);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const toggleCapability = (cap: string) => {
    setForm(prev => ({
      ...prev,
      capabilities: prev.capabilities.includes(cap)
        ? prev.capabilities.filter(c => c !== cap)
        : [...prev.capabilities, cap]
    }));
  };

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <div className="flex items-center gap-4">
        <button
          onClick={() => navigate('/providers')}
          className="p-2 bg-surface border border-border rounded-lg hover:bg-white/5 transition-colors"
        >
          <ArrowLeft className="w-5 h-5 text-gray-400" />
        </button>
        <div>
          <h1 className="text-2xl font-bold text-white">Add Provider</h1>
          <p className="text-sm text-gray-500">Configure a new AI provider</p>
        </div>
      </div>

      {!adminKey && (
        <div className="p-4 bg-red-500/10 border border-red-500/20 rounded-lg flex items-start gap-3">
          <AlertCircle className="w-5 h-5 text-red-400 shrink-0 mt-0.5" />
          <div>
            <p className="text-sm text-red-400 font-medium">Admin key required</p>
            <p className="text-xs text-gray-500 mt-1">
              Go to Settings and enter your Admin API Key to add providers.
            </p>
          </div>
        </div>
      )}

      {error && (
        <div className="p-4 bg-red-500/10 border border-red-500/20 rounded-lg flex items-start gap-3">
          <AlertCircle className="w-5 h-5 text-red-400 shrink-0 mt-0.5" />
          <p className="text-sm text-red-400">{error}</p>
        </div>
      )}

      {success && (
        <div className="p-4 bg-white/10 border border-white/20 rounded-lg flex items-start gap-3">
          <Check className="w-5 h-5 text-white shrink-0 mt-0.5" />
          <p className="text-sm text-white">{success}</p>
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-6">
        {/* Basic Info */}
        <div className="p-6 bg-surface border border-border rounded-xl space-y-4">
          <h2 className="text-lg font-semibold text-white">Basic Info</h2>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm text-gray-400 mb-2">Provider ID *</label>
              <input
                type="text"
                value={form.id}
                onChange={e => setForm({ ...form, id: e.target.value })}
                placeholder="my-provider"
                className="w-full px-3 py-2 bg-black border border-border rounded-lg text-white text-sm focus:outline-none focus:border-white/30"
                required
              />
              <p className="text-xs text-gray-600 mt-1">Unique lowercase ID, e.g. "openai", "myai"</p>
            </div>
            <div>
              <label className="block text-sm text-gray-400 mb-2">Alias</label>
              <input
                type="text"
                value={form.alias}
                onChange={e => setForm({ ...form, alias: e.target.value })}
                placeholder="mp"
                className="w-full px-3 py-2 bg-black border border-border rounded-lg text-white text-sm focus:outline-none focus:border-white/30"
              />
              <p className="text-xs text-gray-600 mt-1">Short alias, e.g. "oa", "kr"</p>
            </div>
          </div>
          <div>
            <label className="block text-sm text-gray-400 mb-2">Name *</label>
            <input
              type="text"
              value={form.name}
              onChange={e => setForm({ ...form, name: e.target.value })}
              placeholder="My AI Provider"
              className="w-full px-3 py-2 bg-black border border-border rounded-lg text-white text-sm focus:outline-none focus:border-white/30"
              required
            />
          </div>
        </div>

        {/* Connection */}
        <div className="p-6 bg-surface border border-border rounded-xl space-y-4">
          <h2 className="text-lg font-semibold text-white">Connection</h2>
          <div>
            <label className="block text-sm text-gray-400 mb-2">Base URL *</label>
            <input
              type="url"
              value={form.baseUrl}
              onChange={e => setForm({ ...form, baseUrl: e.target.value })}
              placeholder="https://api.myai.com/v1"
              className="w-full px-3 py-2 bg-black border border-border rounded-lg text-white text-sm focus:outline-none focus:border-white/30"
              required
            />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm text-gray-400 mb-2">Auth Type</label>
              <select
                value={form.authType}
                onChange={e => setForm({ ...form, authType: e.target.value })}
                className="w-full px-3 py-2 bg-black border border-border rounded-lg text-white text-sm focus:outline-none focus:border-white/30"
              >
                <option value="bearer">Bearer Token</option>
                <option value="apikey">API Key Header</option>
                <option value="none">No Auth</option>
              </select>
            </div>
            <div>
              <label className="block text-sm text-gray-400 mb-2">Auth Header</label>
              <input
                type="text"
                value={form.authHeader}
                onChange={e => setForm({ ...form, authHeader: e.target.value })}
                placeholder="Authorization"
                className="w-full px-3 py-2 bg-black border border-border rounded-lg text-white text-sm focus:outline-none focus:border-white/30"
              />
            </div>
          </div>
          <p className="text-xs text-gray-600">
            API key is set via environment variable: <code className="bg-black px-1 py-0.5 rounded">{'{ID}'}_API_KEY</code>
          </p>
        </div>

        {/* Capabilities */}
        <div className="p-6 bg-surface border border-border rounded-xl space-y-4">
          <h2 className="text-lg font-semibold text-white">Capabilities</h2>
          <div className="flex flex-wrap gap-2">
            {CAPABILITIES.map(cap => (
              <button
                key={cap}
                type="button"
                onClick={() => toggleCapability(cap)}
                className={`px-3 py-1.5 text-xs rounded-lg border transition-colors ${
                  form.capabilities.includes(cap)
                    ? 'bg-white text-black border-white'
                    : 'bg-black text-gray-400 border-border hover:border-gray-600'
                }`}
              >
                {cap}
              </button>
            ))}
          </div>
        </div>

        {/* Model */}
        <div className="p-6 bg-surface border border-border rounded-xl space-y-4">
          <h2 className="text-lg font-semibold text-white">Default Model</h2>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm text-gray-400 mb-2">Model ID</label>
              <input
                type="text"
                value={form.modelId}
                onChange={e => setForm({ ...form, modelId: e.target.value })}
                placeholder="gpt-4o"
                className="w-full px-3 py-2 bg-black border border-border rounded-lg text-white text-sm focus:outline-none focus:border-white/30"
              />
            </div>
            <div>
              <label className="block text-sm text-gray-400 mb-2">Model Name</label>
              <input
                type="text"
                value={form.modelName}
                onChange={e => setForm({ ...form, modelName: e.target.value })}
                placeholder="GPT-4o"
                className="w-full px-3 py-2 bg-black border border-border rounded-lg text-white text-sm focus:outline-none focus:border-white/30"
              />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm text-gray-400 mb-2">Context Window</label>
              <input
                type="number"
                value={form.contextWindow}
                onChange={e => setForm({ ...form, contextWindow: Number(e.target.value) })}
                className="w-full px-3 py-2 bg-black border border-border rounded-lg text-white text-sm focus:outline-none focus:border-white/30"
              />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <label className="flex items-center gap-2 text-sm text-gray-400 cursor-pointer">
                <input
                  type="checkbox"
                  checked={form.supportsStreaming}
                  onChange={e => setForm({ ...form, supportsStreaming: e.target.checked })}
                  className="rounded border-border bg-black"
                />
                Streaming
              </label>
              <label className="flex items-center gap-2 text-sm text-gray-400 cursor-pointer">
                <input
                  type="checkbox"
                  checked={form.supportsVision}
                  onChange={e => setForm({ ...form, supportsVision: e.target.checked })}
                  className="rounded border-border bg-black"
                />
                Vision
              </label>
              <label className="flex items-center gap-2 text-sm text-gray-400 cursor-pointer">
                <input
                  type="checkbox"
                  checked={form.supportsTools}
                  onChange={e => setForm({ ...form, supportsTools: e.target.checked })}
                  className="rounded border-border bg-black"
                />
                Tools
              </label>
              <label className="flex items-center gap-2 text-sm text-gray-400 cursor-pointer">
                <input
                  type="checkbox"
                  checked={form.supportsThinking}
                  onChange={e => setForm({ ...form, supportsThinking: e.target.checked })}
                  className="rounded border-border bg-black"
                />
                Thinking
              </label>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm text-gray-400 mb-2">Cost per 1K Input ($)</label>
              <input
                type="number"
                step="0.00001"
                value={form.costPer1kInput}
                onChange={e => setForm({ ...form, costPer1kInput: Number(e.target.value) })}
                className="w-full px-3 py-2 bg-black border border-border rounded-lg text-white text-sm focus:outline-none focus:border-white/30"
              />
            </div>
            <div>
              <label className="block text-sm text-gray-400 mb-2">Cost per 1K Output ($)</label>
              <input
                type="number"
                step="0.00001"
                value={form.costPer1kOutput}
                onChange={e => setForm({ ...form, costPer1kOutput: Number(e.target.value) })}
                className="w-full px-3 py-2 bg-black border border-border rounded-lg text-white text-sm focus:outline-none focus:border-white/30"
              />
            </div>
          </div>
        </div>

        <button
          type="submit"
          disabled={loading || !adminKey}
          className="w-full flex items-center justify-center gap-2 px-6 py-3 bg-white text-black rounded-lg font-medium hover:bg-gray-200 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          {loading ? (
            <span className="w-5 h-5 border-2 border-black/30 border-t-black rounded-full animate-spin" />
          ) : (
            <Plus className="w-5 h-5" />
          )}
          {loading ? 'Adding...' : 'Add Provider'}
        </button>
      </form>
    </div>
  );
}
