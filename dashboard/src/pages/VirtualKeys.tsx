import { useState, useEffect } from 'react';
import { Key, Plus, Trash2, RefreshCw, Eye, EyeOff } from 'lucide-react';

interface VirtualKey {
  id: string;
  name: string;
  key: string;
  status: 'active' | 'revoked' | 'expired';
  createdAt: string;
  expiresAt?: string;
  lastUsedAt?: string;
  limits: any;
  usage: any;
}

export default function VirtualKeys() {
  const [keys, setKeys] = useState<VirtualKey[]>([]);
  const [loading, setLoading] = useState(false);
  const [showKey, setShowKey] = useState<string | null>(null);

  const fetchKeys = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/v1/virtual-keys');
      const data = await res.json();
      setKeys(data.keys || []);
    } catch {
      setKeys([]);
    }
    setLoading(false);
  };

  const createKey = async () => {
    const name = prompt('Key name?');
    if (!name) return;
    try {
      const res = await fetch('/api/v1/virtual-keys', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name }),
      });
      const data = await res.json();
      if (data.key) alert(`New key created: ${data.key.key}`);
      fetchKeys();
    } catch {
      alert('Failed to create key');
    }
  };

  const revokeKey = async (id: string) => {
    if (!confirm('Revoke this key?')) return;
    await fetch(`/api/v1/virtual-keys/${id}`, { method: 'DELETE' });
    fetchKeys();
  };

  useEffect(() => {
    fetchKeys();
  }, []);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white flex items-center gap-2">
            <Key className="w-6 h-6 text-purple-400" />
            Virtual API Keys
          </h1>
          <p className="text-slate-400">Manage per-key quotas and rate limits.</p>
        </div>
        <button onClick={createKey} className="flex items-center gap-2 px-4 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-500 transition">
          <Plus className="w-4 h-4" /> New Key
        </button>
      </div>

      {loading ? (
        <div className="text-center py-12 text-slate-400"><RefreshCw className="w-6 h-6 animate-spin mx-auto mb-2" /> Loading...</div>
      ) : keys.length === 0 ? (
        <div className="bg-slate-800 border border-slate-700 rounded-xl p-8 text-center">
          <Key className="w-12 h-12 text-slate-500 mx-auto mb-3" />
          <p className="text-slate-400">No virtual API keys yet.</p>
        </div>
      ) : (
        <div className="bg-slate-800 border border-slate-700 rounded-xl overflow-hidden">
          <table className="w-full text-left">
            <thead className="bg-slate-700/50">
              <tr>
                <th className="px-4 py-3 text-slate-300 font-medium">Name</th>
                <th className="px-4 py-3 text-slate-300 font-medium">Key</th>
                <th className="px-4 py-3 text-slate-300 font-medium">Status</th>
                <th className="px-4 py-3 text-slate-300 font-medium">Usage</th>
                <th className="px-4 py-3 text-slate-300 font-medium">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-700">
              {keys.map((k) => (
                <tr key={k.id} className="hover:bg-slate-700/30">
                  <td className="px-4 py-3 text-slate-200">{k.name}</td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <code className="bg-slate-900 px-2 py-1 rounded text-sm text-slate-300">
                        {showKey === k.id ? k.key : `${k.key.slice(0, 8)}...`}
                      </code>
                      <button onClick={() => setShowKey(showKey === k.id ? null : k.id)} className="text-slate-400 hover:text-white">
                        {showKey === k.id ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                      </button>
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <span className={`px-2 py-1 rounded-full text-xs font-medium ${k.status === 'active' ? 'bg-green-500/20 text-green-400' : 'bg-red-500/20 text-red-400'}`}>
                      {k.status}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-slate-400 text-sm">
                    {k.usage?.today?.requests || 0} req today
                  </td>
                  <td className="px-4 py-3">
                    <button onClick={() => revokeKey(k.id)} className="text-red-400 hover:text-red-300">
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
