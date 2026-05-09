import { useState } from 'react';
import { BrainCircuit, Loader2, Send, Copy, Check } from 'lucide-react';

export function Embeddings() {
  const [text, setText] = useState('');
  const [model, setModel] = useState('text-embedding-3-small');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<number[] | null>(null);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);

  const generate = async () => {
    if (!text.trim()) return;
    setLoading(true);
    setError('');
    setResult(null);

    try {
      const res = await fetch('/v1/embeddings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model,
          input: text
        })
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.message || 'Embedding failed');
      }

      const data = await res.json();
      setResult(data.data?.[0]?.embedding || []);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const copyToClipboard = () => {
    if (!result) return;
    navigator.clipboard.writeText(JSON.stringify(result, null, 2));
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const formatVector = (vec: number[]) => {
    if (vec.length <= 6) return JSON.stringify(vec);
    const first = vec.slice(0, 3).map(v => v.toFixed(4));
    const last = vec.slice(-3).map(v => v.toFixed(4));
    return `[${first.join(', ')}, ..., ${last.join(', ')}]`;
  };

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      <div className="card">
        <div className="flex items-center gap-3 mb-6">
          <BrainCircuit className="w-5 h-5 text-white" />
          <h3 className="text-base font-semibold text-white">Embeddings Tester</h3>
        </div>

        <div className="space-y-4">
          <div>
            <label className="block text-xs text-[#888888] mb-2 uppercase tracking-wider">Text</label>
            <textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder="Enter text to embed..."
              className="input-field min-h-[100px] resize-none"
            />
          </div>

          <div>
            <label className="block text-xs text-[#888888] mb-2 uppercase tracking-wider">Model</label>
            <input
              type="text"
              value={model}
              onChange={(e) => setModel(e.target.value)}
              className="input-field"
            />
          </div>

          <button
            onClick={generate}
            disabled={loading || !text.trim()}
            className="btn-primary w-full flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {loading ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                Generating embedding...
              </>
            ) : (
              <>
                <Send className="w-4 h-4" />
                Generate Embedding
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

      {result && (
        <div className="card">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h3 className="text-sm font-medium text-white">Embedding Vector</h3>
              <p className="text-xs text-[#555555] mt-1">{result.length} dimensions</p>
            </div>
            <button
              onClick={copyToClipboard}
              className="btn-secondary text-xs flex items-center gap-2"
            >
              {copied ? (
                <>
                  <Check className="w-3.5 h-3.5" />
                  Copied
                </>
              ) : (
                <>
                  <Copy className="w-3.5 h-3.5" />
                  Copy
                </>
              )}
            </button>
          </div>

          <div className="bg-[#111111] rounded-lg p-4 border border-[#2a2a2a] overflow-x-auto">
            <code className="text-xs text-[#888888] font-mono whitespace-pre">
              {formatVector(result)}
            </code>
          </div>
        </div>
      )}
    </div>
  );
}
