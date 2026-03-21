import { useEffect, useState }  from 'react';
import { useParams }            from 'react-router-dom';
import { Shield, Ban, CheckCircle,
         ExternalLink }         from 'lucide-react';
import adminApi                 from '../../../lib/adminApi';
import { useAuth }              from '../../../hooks/useAuth';

export default function UserDetail() {
  const { userId }           = useParams();
  const { user: me }         = useAuth();
  const isSuper              = me?.role === 'super_admin';
  const [data,    setData]   = useState(null);
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState(false);
  const [message, setMessage] = useState(null);

  const fetchUser = async () => {
    setLoading(true);
    try {
      const { data: res } = await adminApi.get(`/admin/users/${userId}`);
      setData(res);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchUser(); }, [userId]);

  const doAction = async (endpoint, payload = {}, label = '') => {
    if (!window.confirm(`Confirm: ${label}?`)) return;
    setWorking(true);
    setMessage(null);
    try {
      const { data: res } = await adminApi.post(
        `/admin/users/${userId}/${endpoint}`, payload
      );
      setMessage({ type: 'success', text: res.message });
      fetchUser();
    } catch (err) {
      setMessage({
        type: 'error',
        text: err.response?.data?.error || 'Action failed.'
      });
    } finally {
      setWorking(false);
    }
  };

  const changeRole = async (role) => {
    if (!window.confirm(`Change role to ${role}?`)) return;
    setWorking(true);
    try {
      const { data: res } = await adminApi.put(
        `/admin/users/${userId}/role`, { role }
      );
      setMessage({ type: 'success', text: res.message });
      fetchUser();
    } catch (err) {
      setMessage({
        type: 'error',
        text: err.response?.data?.error || 'Role change failed.'
      });
    } finally {
      setWorking(false);
    }
  };

  if (loading) return (
    <div className="p-8 text-center text-gray-500">Loading user...</div>
  );

  if (!data) return (
    <div className="p-8 text-center text-gray-500">User not found.</div>
  );

  const { user, recentJobs, recentPayouts, billing } = data;

  return (
    <div className="p-8 max-w-5xl">

      {/* Header */}
      <div className="flex items-start justify-between mb-8">
        <div className="flex items-center gap-4">
          <img
            src={user.avatar_url || '/default-avatar.png'}
            alt=""
            className="w-16 h-16 rounded-2xl object-cover border border-gray-700"
          />
          <div>
            <h1 className="text-2xl font-bold text-white">
              {user.first_name} {user.last_name}
            </h1>
            <p className="text-gray-400 text-sm">{user.email}</p>
            <div className="flex items-center gap-2 mt-2 flex-wrap">
              <span className="px-2 py-0.5 bg-gray-700 text-gray-300
                               text-xs rounded-full capitalize">
                {user.role}
              </span>
              {user.plan_slug && (
                <span className="px-2 py-0.5 bg-orange-900 text-orange-300
                                 text-xs rounded-full capitalize">
                  {user.plan_slug}
                </span>
              )}
              <span className={`px-2 py-0.5 text-xs rounded-full ${
                user.is_active
                  ? 'bg-green-900 text-green-400'
                  : 'bg-red-900 text-red-400'
              }`}>
                {user.is_active ? 'Active' : 'Banned'}
              </span>
              {user.id_verified && (
                <span className="px-2 py-0.5 bg-blue-900 text-blue-300
                                 text-xs rounded-full">
                  ✓ ID Verified
                </span>
              )}
              {user.background_check_status === 'passed' && (
                <span className="px-2 py-0.5 bg-green-900 text-green-400
                                 text-xs rounded-full">
                  ✓ Background Check
                </span>
              )}
            </div>
          </div>
        </div>

        {/* Super admin actions */}
        {isSuper && (
          <div className="flex flex-wrap gap-2">
            <button
              onClick={() => doAction(
                'ban',
                { reason: prompt('Reason (optional):') || '' },
                user.is_active ? 'Ban this user' : 'Unban this user'
              )}
              disabled={working}
              className={`flex items-center gap-1.5 px-3 py-2 rounded-lg
                          text-xs font-semibold transition disabled:opacity-50 ${
                user.is_active
                  ? 'bg-red-900 text-red-300 hover:bg-red-800'
                  : 'bg-green-900 text-green-300 hover:bg-green-800'
              }`}
            >
              {user.is_active ? <Ban size={13} /> : <CheckCircle size={13} />}
              {user.is_active ? 'Ban' : 'Unban'}
            </button>

            <button
              onClick={() => doAction(
                'verify',
                { field: 'id_verified' },
                'Mark ID as verified'
              )}
              disabled={working || user.id_verified}
              className="flex items-center gap-1.5 px-3 py-2 bg-blue-900
                         text-blue-300 hover:bg-blue-800 rounded-lg text-xs
                         font-semibold transition disabled:opacity-40"
            >
              <Shield size={13} />
              Verify ID
            </button>

            <select
              onChange={e => e.target.value && changeRole(e.target.value)}
              defaultValue=""
              disabled={working}
              className="px-3 py-2 bg-gray-700 border border-gray-600
                         text-gray-300 text-xs rounded-lg
                         focus:outline-none focus:border-orange-500"
            >
              <option value="">Change Role</option>
              {['client','helper','both','broker','admin'].map(r => (
                <option key={r} value={r} className="capitalize">{r}</option>
              ))}
            </select>
          </div>
        )}
      </div>

      {message && (
        <div className={`rounded-xl px-4 py-3 text-sm mb-6 ${
          message.type === 'success'
            ? 'bg-green-900 border border-green-700 text-green-300'
            : 'bg-red-900 border border-red-700 text-red-300'
        }`}>
          {message.text}
        </div>
      )}

      {/* Stats grid */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-8">
        {[
          { label: 'Rating',          value: user.average_rating
              ? `${parseFloat(user.average_rating).toFixed(1)} ★`
              : 'N/A' },
          { label: 'Jobs Completed',  value: user.completed_jobs ?? 0          },
          { label: 'Total Earnings',  value: user.earnings_total
              ? `$${parseFloat(user.earnings_total).toFixed(2)}`
              : '$0.00' },
          { label: 'Completion Rate', value: user.completion_rate
              ? `${(parseFloat(user.completion_rate) * 100).toFixed(0)}%`
              : 'N/A' },
        ].map(({ label, value }) => (
          <div key={label}
               className="bg-gray-800 border border-gray-700
                          rounded-xl p-4">
            <p className="text-xs text-gray-500 uppercase
                          tracking-wider mb-1">{label}</p>
            <p className="text-xl font-bold text-white">{value}</p>
          </div>
        ))}
      </div>

      {/* Two-column detail */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">

        {/* Recent jobs */}
        <div className="bg-gray-800 border border-gray-700 rounded-2xl p-5">
          <h3 className="font-semibold text-white mb-4">Recent Jobs</h3>
          {recentJobs.length === 0 ? (
            <p className="text-gray-500 text-sm text-center py-4">
              No jobs yet.
            </p>
          ) : (
            <div className="space-y-3">
              {recentJobs.map(job => (
                <div key={job.id}
                     className="flex items-center justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-white truncate">{job.title}</p>
                    <p className="text-xs text-gray-500">
                      {new Date(job.created_at).toLocaleDateString()}
                    </p>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    {job.final_price && (
                      <span className="text-xs text-gray-400">
                        ${parseFloat(job.final_price).toFixed(2)}
                      </span>
                    )}
                    <span className={`text-xs px-2 py-0.5 rounded-full ${
                      job.status === 'completed'
                        ? 'bg-green-900 text-green-400'
                        : job.status === 'in_progress'
                        ? 'bg-orange-900 text-orange-400'
                        : job.status === 'cancelled'
                        ? 'bg-gray-700 text-gray-500'
                        : 'bg-blue-900 text-blue-400'
                    }`}>
                                            {job.status}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Billing history */}
        <div className="bg-gray-800 border border-gray-700 rounded-2xl p-5">
          <h3 className="font-semibold text-white mb-4">Billing History</h3>
          {billing.length === 0 ? (
            <p className="text-gray-500 text-sm text-center py-4">
              No billing history.
            </p>
          ) : (
            <div className="space-y-3">
              {billing.map((item, i) => (
                <div key={i}
                     className="flex items-center justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-white capitalize">
                      {item.event_type.replace('invoice.','').replace('_',' ')}
                    </p>
                    <p className="text-xs text-gray-500">
                      {item.period_start
                        ? new Date(item.period_start).toLocaleDateString(
                            'en-US', { month: 'short', day: 'numeric' }
                          )
                        : '—'
                      }
                    </p>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <span className="text-sm font-semibold text-white">
                      ${((item.amount_cents || 0) / 100).toFixed(2)}
                    </span>
                    <span className={`text-xs px-2 py-0.5 rounded-full ${
                      item.status === 'paid'
                        ? 'bg-green-900 text-green-400'
                        : 'bg-red-900 text-red-400'
                    }`}>
                      {item.status}
                    </span>
                    {item.invoice_url && (
                      <a
                        href={item.invoice_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-gray-500 hover:text-gray-300 transition"
                      >
                        <ExternalLink size={12} />
                      </a>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Recent payouts */}
        {recentPayouts.length > 0 && (
          <div className="bg-gray-800 border border-gray-700 rounded-2xl p-5">
            <h3 className="font-semibold text-white mb-4">Recent Payouts</h3>
            <div className="space-y-3">
              {recentPayouts.map((payout, i) => (
                <div key={i}
                     className="flex items-center justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-white truncate">
                      {payout.job_title}
                    </p>
                    <p className="text-xs text-gray-500">
                      {payout.completed_at
                        ? new Date(payout.completed_at).toLocaleDateString()
                        : 'Pending'
                      }
                    </p>
                  </div>
                  <span className="text-sm font-bold text-green-400 shrink-0">
                    +${(payout.net_to_helper_cents / 100).toFixed(2)}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Stripe account */}
        {isSuper && (
          <div className="bg-gray-800 border border-gray-700 rounded-2xl p-5">
            <h3 className="font-semibold text-white mb-4">Stripe Account</h3>
            <div className="space-y-3 text-sm">
              {[
                { label: 'Account ID',       value: user.stripe_account_id || '—' },
                { label: 'Onboarding',       value: user.onboarding_complete
                    ? '✓ Complete' : '✗ Incomplete' },
                { label: 'Charges Enabled',  value: user.charges_enabled
                    ? '✓ Yes' : '✗ No' },
                { label: 'Payouts Enabled',  value: user.payouts_enabled
                    ? '✓ Yes' : '✗ No' },
                { label: 'Subscription ID',  value: user.stripe_subscription_id || '—' },
                { label: 'Sub Status',       value: user.subscription_status || '—' },
              ].map(({ label, value }) => (
                <div key={label}
                     className="flex items-center justify-between
                                border-b border-gray-700/50 pb-2
                                last:border-0 last:pb-0">
                  <span className="text-gray-400">{label}</span>
                  <span className="text-white font-mono text-xs
                                   truncate max-w-40 text-right">
                    {value}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
