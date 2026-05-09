import { useEffect, useState } from 'react';
import { FileText, Clock, AlertCircle } from 'lucide-react';

interface Log {
  id: string;
  timestamp: string;
  providerId: string;
  modelId: string;
  endpoint: string;
  statusCode: number;
  latencyMs: number;
  tokensIn: number;
  tokensOut: number;
  cost: number;
  error?: string;
}

export function Logs() {
  const [logs, setLogs] = useState<Log[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchLogs();
    const interval = setInterval(fetchLogs, 5000);
    return () => clearInterval(interval);
  }, []);

  const fetchLogs = async () => {
    try {
      const res = await fetch('/api/v1/admin/logs?limit=50');
      const data = await res.json();
      setLogs(data.logs);
    } catch (err) {
      console.error('Failed to fetch logs:', err);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="card">
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <FileText className="w-6 h-6 text-emerald-400" />
          <h3 className="text-lg font-semibold text-white">Request Logs</h3>
        </div>
        <span className="text-sm text-gray-500">{logs.length} entries</span>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full">
          <thead>
            <tr className="border-b border-gray-800">
              <th className="text-left text-xs font-medium text-gray-500 uppercase py-3 px-4">Time</th>
              <th className="text-left text-xs font-medium text-gray-500 uppercase py-3 px-4">Provider</th>
              <th className="text-left text-xs font-medium text-gray-500 uppercase py-3 px-4">Model</th>
              <th className="text-left text-xs font-medium text-gray-500 uppercase py-3 px-4">Status</th>
              <th className="text-left text-xs font-medium text-gray-500 uppercase py-3 px-4">Latency</th>
              <th className="text-left text-xs font-medium text-gray-500 uppercase py-3 px-4">Tokens</th>
              <th className="text-left text-xs font-medium text-gray-500 uppercase py-3 px-4">Cost</th>
            </tr>
          </thead>
          <tbody>
            {logs.map((log) => (
              <tr key={log.id} className="border-b border-gray-800/50 hover:bg-gray-850/50">
                <td className="py-3 px-4">
                  <div className="flex items-center gap-2">
                    <Clock className="w-4 h-4 text-gray-500" />
                    <span className="text-sm text-gray-300">
                      {new Date(log.timestamp).toLocaleTimeString()}
                    </span>
                  </div>
                </td>
                <td className="py-3 px-4">
                  <span className="text-sm text-white capitalize">{log.providerId}</span>
                </td>
                <td className="py-3 px-4">
                  <span className="text-sm text-gray-300">{log.modelId}</span>
                </td>
                <td className="py-3 px-4">
                  <div className="flex items-center gap-2">
                    {log.statusCode >= 400 ? (
                      <AlertCircle className="w-4 h-4 text-red-400" />
                    ) : (
                      <div className="w-2 h-2 rounded-full bg-emerald-400" />
                    )}
                    <span className={`text-sm ${
                      log.statusCode >= 400 ? 'text-red-400' : 'text-emerald-400'
                    }`}>
                      {log.statusCode}
                    </span>
                  </div>
                </td>
                <td className="py-3 px-4">
                  <span className="text-sm text-gray-300">{log.latencyMs}ms</span>
                </td>
                <td className="py-3 px-4">
                  <span className="text-sm text-gray-300">
                    {log.tokensIn + log.tokensOut}
                  </span>
                </td>
                <td className="py-3 px-4">
                  <span className="text-sm text-emerald-400">${log.cost.toFixed(4)}</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {logs.length === 0 && !loading && (
        <div className="text-center py-12">
          <FileText className="w-12 h-12 text-gray-700 mx-auto mb-4" />
          <p className="text-gray-500">No logs yet</p>
        </div>
      )}
    </div>
  );
}
