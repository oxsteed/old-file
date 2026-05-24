import { useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { DollarSign, LineChart, ShieldCheck, Wallet } from 'lucide-react';
import { useAuth } from '../hooks/useAuth';

function StatCard({ icon: Icon, title, value, note }) {
  return (
    <div className="rounded-xl border border-gray-800 bg-gray-900 p-4">
      <div className="flex items-center justify-between mb-2">
        <p className="text-xs uppercase tracking-wide text-gray-400">{title}</p>
        <Icon size={16} className="text-emerald-300" />
      </div>
      <p className="text-2xl font-bold text-white">{value}</p>
      <p className="text-xs text-gray-500 mt-1">{note}</p>
    </div>
  );
}

export default function InvestorDashboardPage() {
  const { user, switchRole } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    if (!user) return;
    if (user.default_mode !== 'investor') {
      switchRole('investor').catch(() => {
        navigate('/dashboard', { replace: true });
      });
    }
  }, [user, switchRole, navigate]);

  return (
    <div className="min-h-screen bg-gray-950 text-white px-4 py-8 md:px-8">
      <div className="max-w-6xl mx-auto space-y-6">
        <div className="rounded-2xl border border-emerald-600/30 bg-gradient-to-br from-emerald-950/40 to-gray-900 p-6">
          <p className="text-xs uppercase tracking-widest text-emerald-300">Investor Mode</p>
          <h1 className="text-3xl font-bold mt-2">OxSteed Investor Dashboard</h1>
          <p className="text-gray-300 mt-2 max-w-2xl">
            Dedicated workspace for portfolio visibility, capital deployment tracking, and platform-performance monitoring.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
          <StatCard icon={DollarSign} title="Capital Deployed" value="$0" note="Connect live finance feeds to activate" />
          <StatCard icon={LineChart} title="Portfolio Growth" value="0.0%" note="Quarter-over-quarter trend" />
          <StatCard icon={Wallet} title="Open Commitments" value="0" note="Pending investment commitments" />
          <StatCard icon={ShieldCheck} title="Compliance Checks" value="0" note="Due diligence items pending" />
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <div className="rounded-xl border border-gray-800 bg-gray-900 p-5">
            <h2 className="text-lg font-semibold">Investor Actions</h2>
            <div className="mt-4 flex flex-wrap gap-3">
              <Link to="/admin/super/financials" className="px-3 py-2 rounded-lg bg-gray-800 hover:bg-gray-700 text-sm">Review Platform Financials</Link>
              <Link to="/admin/super/revenue" className="px-3 py-2 rounded-lg bg-gray-800 hover:bg-gray-700 text-sm">Revenue Intelligence</Link>
              <Link to="/admin/super/audit-log" className="px-3 py-2 rounded-lg bg-gray-800 hover:bg-gray-700 text-sm">Audit + Governance</Link>
            </div>
          </div>

          <div className="rounded-xl border border-gray-800 bg-gray-900 p-5">
            <h2 className="text-lg font-semibold">Investor Notes</h2>
            <p className="text-sm text-gray-400 mt-3">
              This dashboard is now route-ready and mode-ready for investor accounts. Next passes can wire live investment tables,
              KPI cards, and board-report exports from finance APIs.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
