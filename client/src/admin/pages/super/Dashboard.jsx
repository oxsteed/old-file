import { useEffect, useState } from 'react';
import {
  Users, Briefcase, DollarSign, TrendingUp,
  AlertTriangle, Flag, Activity, ArrowUpRight
} from 'lucide-react';
import RevenueChart from '../../components/RevenueChart';
import StatCard     from '../../components/StatCard';
import adminApi     from '../../../lib/adminApi';
import { useAuth }  from '../../../hooks/useAuth';

export default function SuperDashboard() {
  const { user }  = useAuth();
  const isSuper   = user?.role === 'super_admin';

  const [stats,   setStats]   = useState(null);
  const [mrr,     setMrr]     = useState(0);
  const [period,  setPeriod]  = useState('30d');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetch = async () => {
      try {
        // Super-admins get the full revenue dashboard; regular admins get the basic stats.
        const endpoint = isSuper ? '/admin/super/dashboard' : '/admin/dashboard';
        const { data } = await adminApi.get(endpoint);
        setStats(data.stats);
        setMrr(data.mrr || 0);
      } catch (err) {
        console.error(err);
      } finally {
        setLoading(false);
      }
    };
    fetch();
  }, [isSuper]);

  if (loading) return <AdminLoader />;

  const s = stats;

  return (
    <div className="p-4 sm:p-8">

      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-6 sm:mb-8">
        <div>
          <h1 className="text-2xl font-bold text-white">Platform Overview</h1>
          <p className="text-gray-400 text-sm mt-1">
            {new Date().toLocaleDateString('en-US', {
              weekday: 'long', month: 'long',
              day: 'numeric', year: 'numeric'
            })}
          </p>
        </div>
        {isSuper && (
          <div className="flex gap-3">
            {['7d','30d','90d','1y'].map(p => (
              <button
                key={p}
                onClick={() => setPeriod(p)}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold
                            transition ${
                  period === p
                    ? 'bg-orange-500 text-white'
                    : 'bg-gray-800 text-gray-400 hover:text-white'
                }`}
              >
                {p}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Revenue highlight — super_admin only */}
      {isSuper && (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
          <div className="sm:col-span-1 bg-gradient-to-br from-orange-500
                          to-orange-600 rounded-2xl p-6 text-white">
            <p className="text-orange-100 text-sm font-medium">
              Monthly Recurring Revenue
            </p>
            <p className="text-4xl font-extrabold mt-2">
              ${mrr.toLocaleString('en-US', { minimumFractionDigits: 2 })}
            </p>
            <p className="text-orange-100 text-xs mt-2">
              {s?.active_subscriptions} active subscribers
            </p>
          </div>
          <div className="bg-gray-800 rounded-2xl p-6">
            <p className="text-gray-400 text-sm">Revenue MTD</p>
            <p className="text-3xl font-bold text-white mt-2">
              ${((s?.revenue_mtd_cents || 0) / 100)
                .toLocaleString('en-US', { minimumFractionDigits: 2 })}
            </p>
            <p className="text-gray-500 text-xs mt-2">
              Sub: ${((s?.subscription_revenue_mtd_cents || 0) / 100)
                .toFixed(2)} · Jobs: ${(
                ((s?.revenue_mtd_cents || 0) -
                 (s?.subscription_revenue_mtd_cents || 0)) / 100
              ).toFixed(2)}
            </p>
          </div>
          <div className="bg-gray-800 rounded-2xl p-6">
            <p className="text-gray-400 text-sm">Total Revenue</p>
            <p className="text-3xl font-bold text-white mt-2">
              ${((s?.total_revenue_cents || 0) / 100)
                .toLocaleString('en-US', { minimumFractionDigits: 2 })}
            </p>
            <p className="text-gray-500 text-xs mt-2">
              Escrow held: ${parseFloat(s?.escrow_held || 0)
                .toLocaleString('en-US', { minimumFractionDigits: 2 })}
            </p>
          </div>
        </div>
      )}

      {/* Stats grid */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-8">
        {[
          ...(isSuper ? [
            { label: 'Total Users',    value: s?.total_users,      icon: Users,         color: 'text-blue-400'   },
            { label: 'New (30d)',      value: s?.new_users_30d,    icon: TrendingUp,    color: 'text-green-400'  },
            { label: 'Total Helpers',  value: s?.total_helpers,    icon: Activity,      color: 'text-orange-400' },
            { label: 'Brokers',        value: s?.total_brokers,    icon: Users,         color: 'text-purple-400' },
          ] : [
            { label: 'New Users (7d)', value: s?.new_users_7d,     icon: TrendingUp,    color: 'text-green-400'  },
            { label: 'New Jobs (7d)',  value: s?.new_jobs_7d,      icon: Briefcase,     color: 'text-yellow-400' },
          ]),
          { label: 'Open Jobs',      value: s?.open_jobs,        icon: Briefcase,     color: 'text-yellow-400' },
          { label: 'Active Jobs',    value: s?.active_jobs,      icon: Activity,      color: 'text-orange-400' },
          ...(isSuper ? [
            { label: 'Completed Jobs', value: s?.completed_jobs,   icon: Briefcase,     color: 'text-green-400'  },
          ] : []),
          { label: 'Open Disputes',  value: s?.open_disputes,    icon: AlertTriangle, color: 'text-red-400'    },
        ].map(({ label, value, icon: Icon, color }) => (
          <StatCard
            key={label}
            label={label}
            value={value ?? 0}
            icon={Icon}
            color={color}
          />
        ))}
      </div>

      {/* Revenue chart — super_admin only (endpoint is requireSuperAdmin gated) */}
      {isSuper && <RevenueChart period={period} />}

      {/* Alerts row */}
      {(parseInt(s?.open_disputes) > 0 ||
        parseInt(s?.pending_reports) > 0) && (
        <div className="mt-6 grid grid-cols-1 sm:grid-cols-2 gap-4">
          {parseInt(s?.open_disputes) > 0 && (
            <div className="bg-red-950 border border-red-800 rounded-xl
                            p-4 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <AlertTriangle size={18} className="text-red-400 shrink-0" />
                <div>
                  <p className="text-sm font-semibold text-white">
                    {s.open_disputes} Open Dispute{s.open_disputes !== 1 ? 's' : ''}
                  </p>
                  <p className="text-xs text-red-400">Requires attention</p>
                </div>
              </div>
              <a href="/admin/jobs?status=disputed"
                 className="text-xs text-red-400 hover:text-red-300
                            flex items-center gap-1 transition">
                View <ArrowUpRight size={12} />
              </a>
            </div>
          )}

          {parseInt(s?.pending_reports) > 0 && (
            <div className="bg-yellow-950 border border-yellow-800
                            rounded-xl p-4 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <Flag size={18} className="text-yellow-400 shrink-0" />
                <div>
                  <p className="text-sm font-semibold text-white">
                    {s.pending_reports} Pending Report{s.pending_reports !== 1 ? 's' : ''}
                  </p>
                  <p className="text-xs text-yellow-400">Awaiting review</p>
                </div>
              </div>
              <a href="/admin/reports"
                 className="text-xs text-yellow-400 hover:text-yellow-300
                            flex items-center gap-1 transition">
                Review <ArrowUpRight size={12} />
              </a>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function AdminLoader() {
  return (
    <div className="h-full flex items-center justify-center p-16">
      <div className="animate-spin w-8 h-8 border-4 border-orange-500
                      border-t-transparent rounded-full" />
    </div>
  );
}
