import { useEffect, useState } from 'react';
import { AlertTriangle, TrendingUp, DollarSign, Hash, BarChart3 } from 'lucide-react';

interface QuotaUsage {
  providerId: string;
  providerName: string;
  usage: {
    requestsToday: number;
    requestsThisMonth: number;
    tokensInToday: number;
    tokensOutToday: number;
    tokensInThisMonth: number;
    tokensOutThisMonth: number;
    costToday: number;
    costThisMonth: number;
    lastUsed: string;
  };
  limits: {
    dailyRequests: number;
    monthlyRequests: number;
    dailyTokens: number;
    monthlyTokens: number;
    dailyCost: number;
    monthlyCost: number;
  };
  utilization: {
    dailyRequests: number;
    monthlyRequests: number;
    dailyTokens: number;
    monthlyTokens: number;
    dailyCost: number;
    monthlyCost: number;
  };
}

interface QuotaSummary {
  summary: {
    requestsToday: number;
    requestsThisMonth: number;
    tokensInToday: number;
    tokensOutToday: number;
    costToday: number;
    costThisMonth: number;
  };
  activeProviders: Array<{
    providerId: string;
    providerName: string;
    requestsToday: number;
    utilization: {
      requests: number;
      tokens: number;
      cost: number;
    };
  }>;
  warnings: Array<{
    providerId: string;
    providerName: string;
    highestUtilization: number;
    metrics: {
      requests: number;
      tokens: number;
      cost: number;
    };
  }>;
  totalProviders: number;
  activeCount: number;
  warningCount: number;
}

export function Quota() {
  const [quotas, setQuotas] = useState<QuotaUsage[]>([]);
  const [summary, setSummary] = useState<QuotaSummary | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, 30000); // Refresh every 30s
    return () => clearInterval(interval);
  }, []);

  const fetchData = async () => {
    try {
      const [quotasRes, summaryRes] = await Promise.all([
        fetch('/v1/quota'),
        fetch('/v1/quota/summary'),
      ]);
      const quotasData = await quotasRes.json();
      const summaryData = await summaryRes.json();
      setQuotas(quotasData.quotas || []);
      setSummary(summaryData);
    } catch (err) {
      console.error('Failed to fetch quota data:', err);
    } finally {
      setLoading(false);
    }
  };

  const formatNumber = (n: number) => {
    if (n >= 1e6) return (n / 1e6).toFixed(1) + 'M';
    if (n >= 1e3) return (n / 1e3).toFixed(1) + 'K';
    return n.toString();
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
      <div>
        <h2 className="text-lg font-semibold text-white">Quota Tracker</h2>
        <p className="text-sm text-[#555555]">Real-time usage monitoring across all providers</p>
      </div>

      {/* Summary Cards */}
      {summary && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <SummaryCard
            icon={Hash}
            label="Requests Today"
            value={formatNumber(summary.summary.requestsToday)}
            subvalue={`${formatNumber(summary.summary.requestsThisMonth)} this month`}
          />
          <SummaryCard
            icon={BarChart3}
            label="Tokens Today"
            value={formatNumber(summary.summary.tokensInToday + summary.summary.tokensOutToday)}
            subvalue="In + Out"
          />
          <SummaryCard
            icon={DollarSign}
            label="Cost Today"
            value={`$${summary.summary.costToday.toFixed(2)}`}
            subvalue={`$${summary.summary.costThisMonth.toFixed(2)} this month`}
          />
          <SummaryCard
            icon={TrendingUp}
            label="Active Providers"
            value={`${summary.activeCount}`}
            subvalue={`of ${summary.totalProviders} total`}
          />
        </div>
      )}

      {/* Warnings */}
      {summary && summary.warnings.length > 0 && (
        <div className="bg-[#1a1a0a] border border-amber-400/20 rounded-xl p-4">
          <div className="flex items-center gap-2 mb-3">
            <AlertTriangle className="w-4 h-4 text-amber-400" />
            <h3 className="text-sm font-medium text-amber-400">
              {summary.warnings.length} provider{summary.warnings.length > 1 ? 's' : ''} near limit
            </h3>
          </div>
          <div className="space-y-2">
            {summary.warnings.map((w) => (
              <div key={w.providerId} className="flex items-center justify-between text-sm">
                <span className="text-white">{w.providerName}</span>
                <span className="text-amber-400">
                  {w.highestUtilization.toFixed(1)}% utilized
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Provider Quotas */}
      <div className="bg-[#0a0a0a] border border-[#2a2a2a] rounded-xl overflow-hidden">
        <div className="px-6 py-4 border-b border-[#2a2a2a]">
          <h3 className="text-sm font-medium text-white">Per-Provider Usage</h3>
        </div>
        <div className="divide-y divide-[#2a2a2a]">
          {quotas.length === 0 && (
            <div className="px-6 py-12 text-center text-[#555555]">
              No usage data yet. Make some requests to see quotas.
            </div>
          )}
          {quotas.map((q) => (
            <div key={q.providerId} className="px-6 py-4">
              <div className="flex items-center justify-between mb-3">
                <div>
                  <h4 className="text-sm font-medium text-white">{q.providerName}</h4>
                  <p className="text-xs text-[#555555]">
                    Last used: {q.usage.lastUsed ? new Date(q.usage.lastUsed).toLocaleTimeString() : 'Never'}
                  </p>
                </div>
                <div className="text-right">
                  <p className="text-sm text-white">${q.usage.costToday.toFixed(2)}</p>
                  <p className="text-xs text-[#555555]">today</p>
                </div>
              </div>

              {/* Utilization bars */}
              <div className="grid grid-cols-3 gap-4">
                <UtilBar
                  label="Requests"
                  current={q.usage.requestsToday}
                  limit={q.limits.dailyRequests}
                  percent={q.utilization.dailyRequests}
                />
                <UtilBar
                  label="Tokens"
                  current={q.usage.tokensInToday + q.usage.tokensOutToday}
                  limit={q.limits.dailyTokens}
                  percent={q.utilization.dailyTokens}
                />
                <UtilBar
                  label="Cost"
                  current={q.usage.costToday}
                  limit={q.limits.dailyCost}
                  percent={q.utilization.dailyCost}
                  prefix="$"
                />
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function SummaryCard({
  icon: Icon,
  label,
  value,
  subvalue,
}: {
  icon: React.ElementType;
  label: string;
  value: string;
  subvalue: string;
}) {
  return (
    <div className="bg-[#0a0a0a] border border-[#2a2a2a] rounded-xl p-4">
      <div className="flex items-center gap-2 mb-2">
        <Icon className="w-4 h-4 text-[#555555]" />
        <span className="text-xs text-[#555555]">{label}</span>
      </div>
      <p className="text-2xl font-bold text-white">{value}</p>
      <p className="text-xs text-[#555555] mt-1">{subvalue}</p>
    </div>
  );
}

function UtilBar({
  label,
  current,
  limit,
  percent,
  prefix = '',
}: {
  label: string;
  current: number;
  limit: number;
  percent: number;
  prefix?: string;
}) {
  const getUtilColor = (pct: number) => {
    if (pct >= 90) return 'text-red-400';
    if (pct >= 75) return 'text-amber-400';
    if (pct >= 50) return 'text-yellow-400';
    return 'text-green-400';
  };

  const getUtilBarColor = (pct: number) => {
    if (pct >= 90) return 'bg-red-400';
    if (pct >= 75) return 'bg-amber-400';
    if (pct >= 50) return 'bg-yellow-400';
    return 'bg-green-400';
  };

  return (
    <div>
      <div className="flex items-center justify-between text-xs mb-1">
        <span className="text-[#555555]">{label}</span>
        <span className={getUtilColor(percent)}>
          {prefix}{current.toLocaleString()} / {prefix}{limit.toLocaleString()}
        </span>
      </div>
      <div className="h-1.5 bg-[#1a1a1a] rounded-full overflow-hidden">
        <div
          className={`h-full ${getUtilBarColor(percent)} rounded-full transition-all duration-500`}
          style={{ width: `${Math.min(percent, 100)}%` }}
        />
      </div>
      <p className={`text-xs mt-0.5 ${getUtilColor(percent)}`}>
        {percent.toFixed(1)}%
      </p>
    </div>
  );
}
