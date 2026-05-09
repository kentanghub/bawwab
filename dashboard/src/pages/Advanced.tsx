import { useState, useEffect } from 'react';
import { Shield, Activity, Brain, Globe, RefreshCw, Trash2, Plus } from 'lucide-react';

export default function Advanced() {
  const [cbState, setCbState] = useState<Record<string, any>>({});
  const [cacheStats, setCacheStats] = useState<any>({});
  const [webhooks, setWebhooks] = useState<any[]>([]);
  const [safetyResult, setSafetyResult] = useState<any>(null);
  const [safetyInput, setSafetyInput] = useState('');
  const [loading, setLoading] = useState(false);

  const fetchAll = async () => {
    setLoading(true);
    try {
      const [cb, cache, wh] = await Promise.all([
        fetch('/api/v1/circuit-breaker').then(r => r.json()),
        fetch('/api/v1/semantic-cache').then(r => r.json()),
        fetch('/api/v1/webhooks').then(r => r.json()),
      ]);
      setCbState(cb || {});
      setCacheStats(cache || {});
      setWebhooks(wh.subscriptions || []);
    } catch {}
    setLoading(false);
  };

  const testSafety = async () => {
    try {
      const res = await fetch('/api/v1/safety/scan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: [{ role: 'user', content: safetyInput }] }),
      });
      setSafetyResult(await res.json());
    } catch {}
  };

  const addWebhook = async () => {
    const url = prompt('Webhook URL?');
    if (!url) return;
    const events = prompt('Events (comma separated)?', 'request.completed,provider.down') || '';
    await fetch('/api/v1/webhooks', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url, events: events.split(',').map(e => e.trim()) }),
    });
    fetchAll();
  };

  const deleteWebhook = async (id: string) => {
    await fetch(`/api/v1/webhooks/${id}`, { method: 'DELETE' });
    fetchAll();
  };

  useEffect(() => { fetchAll(); }, []);

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold text-white flex items-center gap-2">
          <Shield className="w-6 h-6 text-emerald-400" />
          Advanced Features
        </h1>
        <p className="text-slate-400">Circuit breaker, semantic cache, webhooks, and content safety.</p>
      </div>

      {loading && <div className="text-center text-slate-400"><RefreshCw className="w-5 h-5 animate-spin inline mr-2" /> Loading...</div>}

      {/* Circuit Breaker */}
      <section className="bg-slate-800 border border-slate-700 rounded-xl p-6">
        <h2 className="text-lg font-semibold text-white flex items-center gap-2 mb-4">
          <Activity className="w-5 h-5 text-red-400" /> Circuit Breaker Status
        </h2>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {Object.entries(cbState).map(([provider, state]: [string, any]) => (
            <div key={provider} className="bg-slate-900 rounded-lg p-3 border border-slate-700">
              <div className="text-slate-300 text-sm font-medium">{provider}</div>
              <div className={`mt-1 inline-block px-2 py-0.5 rounded text-xs font-bold ${state.state === 'CLOSED' ? 'bg-green-500/20 text-green-400' : state.state === 'OPEN' ? 'bg-red-500/20 text-red-400' : 'bg-yellow-500/20 text-yellow-400'}`}>
                {state.state}
              </div>
              <div className="text-xs text-slate-500 mt-1">Fails: {state.failureCount}/{state.threshold}</div>
            </div>
          ))}
          {Object.keys(cbState).length === 0 && <p className="text-slate-500 text-sm col-span-full">No circuit breaker data yet.</p>}
        </div>
      </section>

      {/* Semantic Cache */}
      <section className="bg-slate-800 border border-slate-700 rounded-xl p-6">
        <h2 className="text-lg font-semibold text-white flex items-center gap-2 mb-4">
          <Brain className="w-5 h-5 text-blue-400" /> Semantic Cache
        </h2>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div className="bg-slate-900 rounded-lg p-3 border border-slate-700 text-center">
            <div className="text-2xl font-bold text-blue-400">{cacheStats.entries || 0}</div>
            <div className="text-xs text-slate-500">Entries</div>
          </div>
          <div className="bg-slate-900 rounded-lg p-3 border border-slate-700 text-center">
            <div className="text-2xl font-bold text-green-400">{cacheStats.hits || 0}</div>
            <div className="text-xs text-slate-500">Hits</div>
          </div>
          <div className="bg-slate-900 rounded-lg p-3 border border-slate-700 text-center">
            <div className="text-2xl font-bold text-red-400">{cacheStats.misses || 0}</div>
            <div className="text-xs text-slate-500">Misses</div>
          </div>
          <div className="bg-slate-900 rounded-lg p-3 border border-slate-700 text-center">
            <div className="text-2xl font-bold text-purple-400">{cacheStats.hitRate ? `${(cacheStats.hitRate * 100).toFixed(1)}%` : '0%'}</div>
            <div className="text-xs text-slate-500">Hit Rate</div>
          </div>
        </div>
      </section>

      {/* Webhooks */}
      <section className="bg-slate-800 border border-slate-700 rounded-xl p-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-white flex items-center gap-2">
            <Globe className="w-5 h-5 text-indigo-400" /> Webhooks
          </h2>
          <button onClick={addWebhook} className="flex items-center gap-1 px-3 py-1.5 bg-indigo-600 text-white rounded-lg text-sm hover:bg-indigo-500 transition">
            <Plus className="w-4 h-4" /> Add
          </button>
        </div>
        {webhooks.length === 0 ? (
          <p className="text-slate-500 text-sm">No webhooks registered.</p>
        ) : (
          <div className="space-y-2">
            {webhooks.map((wh: any) => (
              <div key={wh.id} className="flex items-center justify-between bg-slate-900 rounded-lg p-3 border border-slate-700">
                <div>
                  <div className="text-slate-300 text-sm">{wh.url}</div>
                  <div className="text-xs text-slate-500">{wh.events?.join(', ')}</div>
                </div>
                <button onClick={() => deleteWebhook(wh.id)} className="text-red-400 hover:text-red-300">
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Content Safety */}
      <section className="bg-slate-800 border border-slate-700 rounded-xl p-6">
        <h2 className="text-lg font-semibold text-white flex items-center gap-2 mb-4">
          <Shield className="w-5 h-5 text-orange-400" /> Content Safety Test
        </h2>
        <div className="flex gap-2">
          <input
            value={safetyInput}
            onChange={e => setSafetyInput(e.target.value)}
            placeholder="Enter prompt to scan..."
            className="flex-1 bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-slate-200 focus:outline-none focus:border-orange-500"
          />
          <button onClick={testSafety} className="px-4 py-2 bg-orange-600 text-white rounded-lg hover:bg-orange-500 transition">Scan</button>
        </div>
        {safetyResult && (
          <div className="mt-3 bg-slate-900 rounded-lg p-3 border border-slate-700 text-sm space-y-1">
            <div className="flex items-center gap-2">
              <span className="text-slate-400">Safe:</span>
              <span className={safetyResult.safe ? 'text-green-400 font-bold' : 'text-red-400 font-bold'}>{safetyResult.safe ? 'YES' : 'NO'}</span>
            </div>
            {safetyResult.warnings?.length > 0 && (
              <div className="text-yellow-400">Warnings: {safetyResult.warnings.join(', ')}</div>
            )}
            {safetyResult.injectionDetected && <div className="text-red-400">⚠️ Prompt injection detected</div>}
            {safetyResult.toxicDetected && <div className="text-red-400">⚠️ Toxic content detected</div>}
          </div>
        )}
      </section>
    </div>
  );
}
