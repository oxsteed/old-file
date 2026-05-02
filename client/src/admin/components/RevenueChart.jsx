import { useEffect, useState } from 'react';
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, Legend
} from 'recharts';
import adminApi from '../../lib/adminApi';

function fmt$(cents) {
  return '$' + (cents / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export default function RevenueChart({ period }) {
  const [data,    setData]    = useState([]);
  const [totals,  setTotals]  = useState(null);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true); setError(false);
    adminApi.get(`/admin/super/revenue-chart?period=${period}`)
      .then(({ data: res }) => {
        if (cancelled) return;
        const formatted = res.chart.map(row => ({
          period: new Date(row.period).toLocaleDateString('en-US', {
            month: 'short',
            day:   period === '1y' ? undefined : 'numeric',
          }),
          'Job Fees':      parseFloat(((row.job_fee_cents      || 0) / 100).toFixed(2)),
          'Subscriptions': parseFloat(((row.subscription_cents || 0) / 100).toFixed(2)),
          'Refunds':       parseFloat(((row.refunds_cents      || 0) / 100).toFixed(2)),
        }));
        setData(formatted);
        setTotals(res.totals || { job_fee: 0, subscription: 0, refunds: 0 });
      })
      .catch(() => { if (!cancelled) setError(true); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [period]);

  const isEmpty = !loading && !error && data.length === 0;
  const hasData = !loading && !error && data.length > 0 && (
    data.some(d => d['Job Fees'] > 0 || d['Subscriptions'] > 0)
  );

  return (
    <div className="bg-[#111318] border border-gray-800 rounded-2xl p-5 sm:p-6">
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3 mb-5">
        <h3 className="font-semibold text-white text-sm">Revenue Breakdown</h3>
        {totals && (
          <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-gray-400">
            <span>Total: <span className="text-white font-semibold">{fmt$(totals.job_fee + totals.subscription)}</span></span>
            <span>Job Fees: <span className="text-orange-400 font-medium">{fmt$(totals.job_fee)}</span></span>
            <span>Subscriptions: <span className="text-purple-400 font-medium">{fmt$(totals.subscription)}</span></span>
            {totals.refunds > 0 && <span>Refunds: <span className="text-red-400 font-medium">-{fmt$(totals.refunds)}</span></span>}
          </div>
        )}
      </div>

      {loading && (
        <div className="h-64 flex items-center justify-center">
          <div className="animate-spin w-6 h-6 border-4 border-orange-500 border-t-transparent rounded-full" />
        </div>
      )}

      {error && (
        <div className="h-64 flex items-center justify-center text-gray-500 text-sm">
          Failed to load chart data.
        </div>
      )}

      {isEmpty && (
        <div className="h-64 flex flex-col items-center justify-center gap-3 text-center">
          {/* Placeholder axes hint */}
          <div className="w-full h-40 relative border border-dashed border-gray-700 rounded-xl flex items-end px-6 pb-4 gap-2">
            {[0, 0, 0, 0, 0, 0, 0].map((_, i) => (
              <div key={i} className="flex-1 bg-gray-700/30 rounded-sm" style={{ height: `${(i % 3 + 1) * 8}px` }} />
            ))}
            <div className="absolute inset-0 flex items-center justify-center">
              <div className="text-center">
                <p className="text-sm font-medium text-gray-400">No revenue data yet</p>
                <p className="text-xs text-gray-600 mt-1 max-w-xs">Revenue will appear here once the first transaction is recorded for this period.</p>
              </div>
            </div>
          </div>
          {!totals && (
            <div className="flex gap-4 text-xs text-gray-600">
              <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-orange-500" />Job Fees</span>
              <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-purple-500" />Subscriptions</span>
              <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-red-500" />Refunds</span>
            </div>
          )}
        </div>
      )}

      {hasData && (
        <ResponsiveContainer width="100%" height={260}>
          <AreaChart data={data} margin={{ top: 5, right: 10, left: 0, bottom: 5 }}>
            <defs>
              <linearGradient id="jobFee" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%"  stopColor="#f97316" stopOpacity={0.35} />
                <stop offset="95%" stopColor="#f97316" stopOpacity={0} />
              </linearGradient>
              <linearGradient id="subGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%"  stopColor="#a855f7" stopOpacity={0.35} />
                <stop offset="95%" stopColor="#a855f7" stopOpacity={0} />
              </linearGradient>
              <linearGradient id="refundGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%"  stopColor="#ef4444" stopOpacity={0.25} />
                <stop offset="95%" stopColor="#ef4444" stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="#1f2937" vertical={false} />
            <XAxis dataKey="period" tick={{ fill: '#6b7280', fontSize: 11 }} axisLine={false} tickLine={false} />
            <YAxis tick={{ fill: '#6b7280', fontSize: 11 }} axisLine={false} tickLine={false} tickFormatter={v => `$${v}`} width={55} />
            <Tooltip
              contentStyle={{ backgroundColor: '#1a1d24', border: '1px solid #374151', borderRadius: '12px', color: '#f9fafb', fontSize: 12 }}
              formatter={(value, name) => [`$${value.toFixed(2)}`, name]}
            />
            <Legend wrapperStyle={{ color: '#6b7280', fontSize: 12, paddingTop: 8 }} />
            <Area type="monotone" dataKey="Job Fees"      stroke="#f97316" strokeWidth={2} fill="url(#jobFee)"    />
            <Area type="monotone" dataKey="Subscriptions" stroke="#a855f7" strokeWidth={2} fill="url(#subGrad)"   />
            <Area type="monotone" dataKey="Refunds"       stroke="#ef4444" strokeWidth={1.5} fill="url(#refundGrad)" strokeDasharray="4 2" />
          </AreaChart>
        </ResponsiveContainer>
      )}
    </div>
  );
}
