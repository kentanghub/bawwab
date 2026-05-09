import { useState } from 'react';
import { Scale, Send, Loader2, Clock, Zap } from 'lucide-react';

interface CompareResult {
  provider: string;
  model: string;
  response: string;
  latency: number;
  tokens: number;
  success: boolean;
  error?: string;
}

export function Compare() {
  const [prompt, setPrompt] = useState('');
  const [models, setModels] = useState('gpt-4o,gemini-pro,deepseek-chat');
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState<CompareResult[]>([]);
  const [error, setError] = useState('');

  const compare = async () => {
    if (!prompt.trim()) return;
    setLoading(true);
    setError('');
    setResults([]);

    try {
      const res = await fetch('/v1/compare', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: [{ role: 'user', content: prompt }],
          models: models.split(',').map(m => m.trim()).filter(Boolean)
        })
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.message || 'Comparison failed');
      }

      const data = await res.json();
      setResults(data.results || []);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      <div className="card">
        <div className="flex items-center gap-3 mb-6">
          <Scale className="w-5 h-5 text-white" />
          <h3 className="text-base font-semibold text-white">Multi-Model Comparison</h3>
        </div>

        <div className="space-y-4">
          <div>
            <label className="block text-xs text-[#888888] mb-2 uppercase tracking-wider">Prompt</label>
            <textarea
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder="Explain quantum computing in simple terms..."
              className="input-field min-h-[80px] resize-none"
            />
          </div>

          <div>
            <label className="block text-xs text-[#888888] mb-2 uppercase tracking-wider">Models (comma-separated)</label>
            <input
              type="text"
              value={models}
              onChange={(e) => setModels(e.target.value)}
              className="input-field"
            />
          </div>

          <button
            onClick={compare}
            disabled={loading || !prompt.trim()}
            className="btn-primary w-full flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {loading ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                Running comparison...
              </>
            ) : (
              <>
                <Send className="w-4 h-4" />
                Compare Models
              </>
            )}
          </button>
        </div>
      </div>

      {error && (
        <div className="p-4 rounded-lg bg-[#111111] border border-[#2a2a2a] text-white text-sm">
          {error}
        </div>
      )}

      {results.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {results.map((r, i) => (
            <div key={i} className="card">
              <div className="flex items-center justify-between mb-3">
                <div>
                  <p className="text-sm font-medium text-white">{r.provider}</p>
                  <p className="text-xs text-[#555555]">{r.model}</p>
                </div>
                {r.success ? (
                  <div className="flex items-center gap-1 text-[#888888]">
                    <Clock className="w-3 h-3" />
                    <span className="text-xs">{r.latency}ms</span>
                  </div>
                ) : (
                  <span className="text-xs text-[#555555]">Failed</span>
                )}
              </div>

              {r.success ? (
                <div className="bg-[#111111] rounded-lg p-3 border border-[#2a2a2a]">
                  <p className="text-sm text-white whitespace-pre-wrap leading-relaxed">{r.response}</p>
                </div>
              ) : (
                <div className="bg-[#111111] rounded-lg p-3 border border-[#2a2a2a]">
                  <p className="text-sm text-[#555555]">{r.error || 'Request failed'}</p>
                </div>
              )}

              {r.success && (
                <div className="flex items-center gap-1 mt-3 text-[#555555]">
                  <Zap className="w-3 h-3" />
                  <span className="text-xs">{r.tokens} tokens</span>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
