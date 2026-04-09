import { useEffect, useState }  from 'react';
import { useParams, Link }      from 'react-router-dom';
import { Shield, Ban, CheckCircle,
         ExternalLink, AlertCircle,
         ChevronLeft, MessageSquare,
         X, Loader2 }           from 'lucide-react';
import adminApi                 from '../../../lib/adminApi';
import { useAuth }              from '../../../hooks/useAuth';

export default function UserDetail() {
  const { userId }           = useParams();
  const { user: me }         = useAuth();
  const isSuper              = me?.role === 'super_admin';
  const isAdmin              = me?.role === 'admin' || me?.role === 'super_admin';
  const [data,    setData]   = useState(null);
  const [loading, setLoading] = useState(true);
  const [error,   setError]  = useState(null);
  const [working, setWorking] = useState(false);
  const [message, setMessage] = useState(null);
  const [nameForm, setNameForm] = useState({ first_name: '', last_name: '' });
  const [showNameEdit, setShowNameEdit] = useState(false);
  const [nameSaving, setNameSaving] = useState(false);
  const [showMsgModal, setShowMsgModal] = useState(false);
  const [msgText,     setMsgText]     = useState('');
  const [msgSending,  setMsgSending]  = useState(false);

  const fetchUser = async () => {
    setLoading(true);
    setError(null);
    try {
      const { data: res } = await adminApi.get(`/admin/users/${userId}`);
      setData(res);
      setNameForm({ first_name: res.user?.first_name || '', last_name: res.user?.last_name || '' });
    } catch (err) {
      const msg = err.response?.data?.error || err.message || 'Failed to load user.';
      setError(msg);
    } finally {
      setLoading(false);
    }
  };

  const saveName = async (e) => {
    e.preventDefault();
    setNameSaving(true);
    setMessage(null);
    try {
      const { data: res } = await adminApi.put(`/admin/users/${userId}/name`, nameForm);
      setMessage({ type: 'success', text: res.message });
      setShowNameEdit(false);
      fetchUser();
    } catch (err) {
      setMessage({ type: 'error', text: err.response?.data?.error || 'Name update failed.' });
    } finally {
      setNameSaving(false);
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

  if (error) return (
    <div className="p-6 sm:p-8">
      <div className="flex items-start gap-3 bg-red-950 border border-red-800
                      rounded-xl p-4 text-red-300 max-w-lg">
        <AlertCircle size={18} className="shrink-0 mt-0.5" />
        <div>
          <p className="font-semibold text-sm">Failed to load user</p>
          <p className="text-xs mt-1 text-red-400">{error}</p>
          <button
            onClick={fetchUser}
            className="mt-3 text-xs underline hover:no-underline"
          >
            Try again
          </button>
        </div>
      </div>
    </div>
  );

  if (!data) return null;

  const { user, recentJobs = [], recentPayouts = [], billing = [], recentReviews = [] } = data;

  return (
    <div className="p-4 sm:p-8 max-w-5xl">

      {/* Back link */}
      <Link
        to="/admin/users"
        className="inline-flex items-center gap-1 text-xs text-gray-500
                   hover:text-gray-300 transition mb-4"
      >
        <ChevronLeft size={14} />
        Back to Users
      </Link>

      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between
                      gap-4 mb-6 sm:mb-8">
        <div className="flex items-start gap-3 sm:gap-4">
          <img
            src={user.avatar_url || '/default-avatar.png'}
            alt=""
            className="w-14 h-14 sm:w-16 sm:h-16 rounded-2xl object-cover
                       border border-gray-700 shrink-0"
          />
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-xl sm:text-2xl font-bold text-white">
                {user.first_name} {user.last_name}
              </h1>
              {isAdmin && (
                <button
                  onClick={() => { setShowNameEdit(v => !v); setNameForm({ first_name: user.first_name || '', last_name: user.last_name || '' }); }}
                  className="text-xs px-2 py-0.5 bg-gray-700 hover:bg-gray-600
                             text-gray-300 rounded transition"
                  title="Edit name"
                >
                  Edit
                </button>
              )}
            </div>
            {showNameEdit && (
              <form onSubmit={saveName} className="mt-2 flex flex-wrap items-center gap-2">
                <input
                  value={nameForm.first_name}
                  onChange={e => setNameForm(f => ({ ...f, first_name: e.target.value }))}
                  placeholder="First name"
                  required
                  className="px-2 py-1 bg-gray-700 border border-gray-600 rounded
                             text-white text-sm w-28 focus:outline-none
                             focus:border-orange-500"
                />
                <input
                  value={nameForm.last_name}
                  onChange={e => setNameForm(f => ({ ...f, last_name: e.target.value }))}
                  placeholder="Last name"
                  required
                  className="px-2 py-1 bg-gray-700 border border-gray-600 rounded
                             text-white text-sm w-28 focus:outline-none
                             focus:border-orange-500"
                />
                <button
                  type="submit"
                  disabled={nameSaving}
                  className="px-3 py-1 bg-orange-600 hover:bg-orange-700 text-white
                             text-xs rounded font-semibold transition disabled:opacity-50"
                >
                  {nameSaving ? 'Saving…' : 'Save'}
                </button>
                <button
                  type="button"
                  onClick={() => setShowNameEdit(false)}
                  className="px-3 py-1 bg-gray-700 hover:bg-gray-600 text-gray-300
                             text-xs rounded transition"
                >
                  Cancel
                </button>
              </form>
            )}
            <p className="text-gray-400 text-sm mt-0.5 truncate">{user.email}</p>
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
          <div className="flex flex-wrap gap-2 sm:shrink-0">
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
                { field: 'is_identity_verified' },
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

            <button
              onClick={() => setShowMsgModal(true)}
              className="flex items-center gap-1.5 px-3 py-2 bg-indigo-900
                         text-indigo-300 hover:bg-indigo-800 rounded-lg text-xs
                         font-semibold transition"
            >
              <MessageSquare size={13} />
              Message
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
              {['customer','helper','helper_pro','broker','admin'].map(r => (
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
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 sm:gap-4 mb-6 sm:mb-8">
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
                          rounded-xl p-3 sm:p-4">
            <p className="text-xs text-gray-500 uppercase
                          tracking-wider mb-1">{label}</p>
            <p className="text-lg sm:text-xl font-bold text-white">{value}</p>
          </div>
        ))}
      </div>

      {/* Two-column detail */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 sm:gap-6">

        {/* Recent jobs */}
        <div className="bg-gray-800 border border-gray-700 rounded-2xl p-4 sm:p-5">
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
        <div className="bg-gray-800 border border-gray-700 rounded-2xl p-4 sm:p-5">
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
          <div className="bg-gray-800 border border-gray-700 rounded-2xl p-4 sm:p-5">
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
          <div className="bg-gray-800 border border-gray-700 rounded-2xl p-4 sm:p-5">
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
                  <span className="text-gray-400 shrink-0">{label}</span>
                  <span className="text-white font-mono text-xs
                                   truncate max-w-[9rem] sm:max-w-40 text-right ml-2">
                    {value}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Message modal */}
      {showMsgModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center
                        p-4 bg-black/60">
          <div className="w-full max-w-md bg-gray-900 border border-gray-700
                          rounded-2xl shadow-2xl overflow-hidden">
            <div className="flex items-center justify-between px-5 py-4
                            border-b border-gray-800">
              <h2 className="font-semibold text-white flex items-center gap-2 text-sm">
                <MessageSquare size={15} className="text-indigo-400" />
                Message {user.first_name}
              </h2>
              <button
                onClick={() => { setShowMsgModal(false); setMsgText(''); }}
                className="text-gray-500 hover:text-white transition p-1"
              >
                <X size={15} />
              </button>
            </div>
            <form
              onSubmit={async (e) => {
                e.preventDefault();
                if (!msgText.trim()) return;
                setMsgSending(true);
                try {
                  await adminApi.post(`/admin/super/users/${user.id}/message`, {
                    content: msgText.trim(),
                  });
                  setMessage({ type: 'success', text: `Message sent to ${user.first_name}.` });
                  setShowMsgModal(false);
                  setMsgText('');
                } catch (err) {
                  setMessage({
                    type: 'error',
                    text: err.response?.data?.error || 'Failed to send message.',
                  });
                } finally {
                  setMsgSending(false);
                }
              }}
              className="p-5"
            >
              <p className="text-xs text-gray-400 mb-3">
                This message will appear in {user.first_name}'s inbox as a system message.
                It is logged in the audit trail.
              </p>
              <textarea
                autoFocus
                required
                rows={5}
                maxLength={4000}
                value={msgText}
                onChange={e => setMsgText(e.target.value)}
                placeholder={`Write a message to ${user.first_name}…`}
                className="w-full px-3 py-2.5 bg-gray-800 border border-gray-700
                           rounded-lg text-sm text-white placeholder-gray-500
                           focus:outline-none focus:border-indigo-500 resize-none"
              />
              <div className="flex items-center justify-between mt-1 mb-4">
                <span className="text-xs text-gray-600">{msgText.length}/4000</span>
              </div>
              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => { setShowMsgModal(false); setMsgText(''); }}
                  className="px-4 py-2 bg-gray-800 hover:bg-gray-700 text-gray-300
                             text-sm rounded-lg transition"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={msgSending || !msgText.trim()}
                  className="flex items-center gap-2 px-4 py-2 bg-indigo-600
                             hover:bg-indigo-700 text-white text-sm font-semibold
                             rounded-lg transition disabled:opacity-40"
                >
                  {msgSending
                    ? <Loader2 size={13} className="animate-spin" />
                    : <MessageSquare size={13} />
                  }
                  Send Message
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
