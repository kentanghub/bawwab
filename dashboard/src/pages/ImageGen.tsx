import { useState } from 'react';
import { Image, Download, Loader2, Wand2 } from 'lucide-react';

export function ImageGen() {
  const [prompt, setPrompt] = useState('');
  const [size, setSize] = useState('1024x1024');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState('');

  const generate = async () => {
    if (!prompt.trim()) return;
    setLoading(true);
    setError('');
    setResult(null);

    try {
      const res = await fetch('/v1/images/generations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: 'pollinations',
          prompt,
          n: 1,
          size
        })
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.message || 'Generation failed');
      }

      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      setResult(url);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      <div className="card">
        <div className="flex items-center gap-3 mb-6">
          <Wand2 className="w-5 h-5 text-white" />
          <h3 className="text-base font-semibold text-white">Image Generation</h3>
        </div>

        <div className="space-y-4">
          <div>
            <label className="block text-xs text-[#888888] mb-2 uppercase tracking-wider">Prompt</label>
            <textarea
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder="A serene mountain landscape at sunset..."
              className="input-field min-h-[100px] resize-none"
            />
          </div>

          <div>
            <label className="block text-xs text-[#888888] mb-2 uppercase tracking-wider">Size</label>
            <div className="flex gap-2">
              {['512x512', '1024x1024', '1024x1792'].map((s) => (
                <button
                  key={s}
                  onClick={() => setSize(s)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                    size === s
                      ? 'bg-white text-black'
                      : 'bg-[#111111] text-[#888888] border border-[#2a2a2a] hover:text-white'
                  }`}
                >
                  {s}
                </button>
              ))}
            </div>
          </div>

          <button
            onClick={generate}
            disabled={loading || !prompt.trim()}
            className="btn-primary w-full flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {loading ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                Generating...
              </>
            ) : (
              <>
                <Image className="w-4 h-4" />
                Generate Image
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
            <h3 className="text-sm font-medium text-white">Result</h3>
            <a
              href={result}
              download="generated.png"
              className="btn-secondary text-xs flex items-center gap-2"
            >
              <Download className="w-3.5 h-3.5" />
              Download
            </a>
          </div>
          <img
            src={result}
            alt="Generated"
            className="w-full rounded-lg border border-[#2a2a2a]"
          />
        </div>
      )}
    </div>
  );
}
