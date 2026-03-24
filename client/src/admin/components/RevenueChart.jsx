import { useEffect, useState } from 'react';
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, Legend
} from 'recharts';
import adminApi from '../../lib/adminApi';

export default function RevenueChart({ period }) {
  const [data,    setData]    = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetch = async () => {
      setLoading(true);
      try {
        const { data: res } = await adminApi.get(
          `/admin/super/revenue-chart?period=${period}`
        );
        // Convert cents to dollars and format period label
        const formatted = res.chart.map(row => ({
          period: new Date(row.period).toLocaleDateString('en-US', {
            month: 'short',
            day:   period === '1y' ? undefined : 'numeric'
          }),
          'Job Fees':      parseFloat((row.job_fee_cents      / 100).toFixed(2)),
          'Subscriptions': parseFloat((row.subscription_cents / 100).toFixed(2)),
          'Refunds':       parseFloat((row.refunds_cents      / 100).toFixed(2)),
        }));
        setData(formatted);
      } catch (err) {
        console.error(err);
      } finally {
        setLoading(false);
      }
    };
    fetch();
  }, [period]);

  if (loading) {
    return (
      <div className="bg-gray-800 border border-gray-700 rounded-2xl
                      p-6 h-72 flex items-center justify-center">
        <div className="animate-spin w-6 h-6 border-4 border-orange-500
                        border-t-transparent rounded-full" />
      </div>
    );
  }

  return (
    <div className="bg-gray-800 border border-gray-700 rounded-2xl p-6">
      <h3 className="font-semibold text-white mb-5">Revenue Breakdown</h3>
      <ResponsiveContainer width="100%" height={280}>
        <AreaChart data={data}
                   margin={{ top: 5, right: 10, left: 0, bottom: 5 }}>
          <defs>
            <linearGradient id="jobFee" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%"  stopColor="#f97316" stopOpacity={0.4} />
              <stop offset="95%" stopColor="#f97316" stopOpacity={0}   />
            </linearGradient>
            <linearGradient id="subGrad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%"  stopColor="#a855f7" stopOpacity={0.4} />
              <stop offset="95%" stopColor="#a855f7" stopOpacity={0}   />
            </linearGradient>
            <linearGradient id="refundGrad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%"  stopColor="#ef4444" stopOpacity={0.3} />
              <stop offset="95%" stopColor="#ef4444" stopOpacity={0}   />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3"
                         stroke="#374151" vertical={false} />
          <XAxis dataKey="period"
                 tick={{ fill: '#9ca3af', fontSize: 11 }}
                 axisLine={false} tickLine={false} />
          <YAxis
            tick={{ fill: '#9ca3af', fontSize: 11 }}
            axisLine={false} tickLine={false}
            tickFormatter={v => `$${v}`}
          />
          <Tooltip
            contentStyle={{
              backgroundColor: '#1f2937',
              border:          '1px solid #374151',
              borderRadius:    '12px',
              color:           '#f9fafb'
            }}
            formatter={(value, name) => [`$${value.toFixed(2)}`, name]}
          />
          <Legend
            wrapperStyle={{ color: '#9ca3af', fontSize: 12 }}
          />
          <Area type="monotone" dataKey="Job Fees"
                stroke="#f97316" strokeWidth={2}
                fill="url(#jobFee)" />
          <Area type="monotone" dataKey="Subscriptions"
                stroke="#a855f7" strokeWidth={2}
                fill="url(#subGrad)" />
          <Area type="monotone" dataKey="Refunds"
                stroke="#ef4444" strokeWidth={2}
                fill="url(#refundGrad)" />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
