import { useEffect, useState, useCallback } from 'react';
import { Link }          from 'react-router-dom';
import { Search, Download, UserPlus, X, MessageSquare } from 'lucide-react';
import { useAuth }       from '../../hooks/useAuth';
import adminApi          from '../../lib/adminApi';

const ROLES    = ['','client','helper','both','broker'];
const PLANS    = ['','starter','pro','elite','broker'];
const STATUSES = ['','active','banned'];

const NEW_ROLES = ['customer', 'helper', 'broker'];

function CreateUserModal({ onClose, onCreated }) {
  const [form, setForm]   = useState({ first_name: '', last_name: '', email: '', password: '', role: 'customer' });
  const [error, setError] = useState('');
  const [busy,  setBusy]  = useState(false);

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  const handleSubmit = async (e) => {
    e.preventDefault();
    setBusy(true); setError('');
    try {
      const { data } = await adminApi.post('/admin/super/users', form);
      onCreated(data.user);
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to create user.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
      onClick={() => !busy && onClose()}>
      <div className="bg-gray-900 border border-gray-700 rounded-2xl p-6 w-full max-w-md shadow-2xl"
        onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-5">
          <h3 className="font-bold text-white text-base">Create User Account</h3>
          <button onClick={onClose} disabled={busy} className="text-gray-500 hover:text-white transition">
            <X size={18} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            {[['first_name', 'First Name'], ['last_name', 'Last Name']].map(([k, label]) => (
              <div key={k}>
                <label className="block text-xs font-medium text-gray-400 mb-1">{label}</label>
                <input
                  required
                  value={form[k]}
                  onChange={e => set(k, e.target.value)}
                  className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-sm
                             text-white placeholder-gray-500 focus:outline-none focus:border-orange-500"
                />
              </div>
            ))}
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-400 mb-1">Email</label>
            <input
              type="email"
              required
              value={form.email}
              onChange={e => set('email', e.target.value)}
              className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-sm
                         text-white placeholder-gray-500 focus:outline-none focus:border-orange-500"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-400 mb-1">
              Password <span className="text-gray-600">(min 8 chars)</span>
            </label>
            <input
              type="password"
              required
              minLength={8}
              value={form.password}
              onChange={e => set('password', e.target.value)}
              className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-sm
                         text-white placeholder-gray-500 focus:outline-none focus:border-orange-500"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-400 mb-1">Role</label>
            <select
              value={form.role}
              onChange={e => set('role', e.target.value)}
              className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-sm
                         text-gray-300 focus:outline-none focus:border-orange-500"
            >
              {NEW_ROLES.map(r => (
                <option key={r} value={r} className="capitalize">{r}</option>
              ))}
            </select>
          </div>

          {error && <p className="text-red-400 text-xs">{error}</p>}

          <div className="flex gap-3 pt-1">
            <button type="button" onClick={onClose} disabled={busy}
              className="flex-1 px-4 py-2 bg-gray-800 border border-gray-700 text-gray-300
                         rounded-lg text-sm font-medium hover:bg-gray-700 transition disabled:opacity-50">
              Cancel
            </button>
            <button type="submit" disabled={busy}
              className="flex-1 px-4 py-2 bg-orange-500 hover:bg-orange-600 text-white
                         rounded-lg text-sm font-semibold transition disabled:opacity-50">
              {busy ? 'Creating…' : 'Create User'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export default function UsersList() {
  const { user: me }     = useAuth();
  const isSuper          = me?.role === 'super_admin';

  const [users,   setUsers]   = useState([]);
  const [total,   setTotal]   = useState(0);
  const [pages,   setPages]   = useState(1);
  const [loading, setLoading] = useState(true);
  const [filters, setFilters] = useState({
    search: '', role: '', status: '', plan: '', page: 1
  });
  const [showCreate, setShowCreate] = useState(false);
  const [showMsgModal, setShowMsgModal] = useState(false);
  const [selectedUser, setSelectedUser] = useState(null);
  const [msgText, setMsgText] = useState('');
  const [msgSending, setMsgSending] = useState(false);
  const [message, setMessage] = useState(null);

  const fetchUsers = useCallback(async () => {
    setLoading(true);
    try {
      const params = Object.fromEntries(
        Object.entries(filters).filter(([, v]) => v !== '')
      );
      const { data } = await adminApi.get('/admin/users', { params });
      setUsers(data.users);
      setTotal(data.total);
      setPages(data.pages);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, [filters]);

  useEffect(() => { fetchUsers(); }, [fetchUsers]);

  const update = (key, val) =>
    setFilters(f => ({ ...f, [key]: val, page: 1 }));

  const handleExport = async () => {
    try {
      const res = await adminApi.get('/admin/export/users', {
        responseType: 'blob'
      });
      const url  = URL.createObjectURL(res.data);
      const a    = document.createElement('a');
      a.href     = url;
      a.download = `oxsteed_users_${new Date().toISOString().split('T')[0]}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error(err);
    }
  };

  const openMessageModal = (user) => {
    setSelectedUser(user);
    setShowMsgModal(true);
    setMsgText('');
  };

  const closeMessageModal = () => {
    setShowMsgModal(false);
    setSelectedUser(null);
    setMsgText('');
  };

  const handleSendMessage = async (e) => {
    e.preventDefault();
    if (!msgText.trim() || !selectedUser) return;
    setMsgSending(true);
    try {
      await adminApi.post(`/admin/super/users/${selectedUser.id}/message`, {
        content: msgText.trim(),
      });
      setMessage({ type: 'success', text: `Message sent to ${selectedUser.first_name}.` });
      closeMessageModal();
    } catch (err) {
      setMessage({
        type: 'error',
        text: err.response?.data?.error || 'Failed to send message.',
      });
    } finally {
      setMsgSending(false);
    }
  };

  return (
    <div className="p-4 sm:p-8">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-white">Users</h1>
          <p className="text-gray-400 text-sm mt-1">
            {total.toLocaleString()} total users
          </p>
        </div>
        <div className="flex items-center gap-2">
          {isSuper && (
            <button
              onClick={() => setShowCreate(true)}
              className="flex items-center gap-2 px-4 py-2 bg-orange-500 hover:bg-orange-600
                         text-white text-sm font-semibold rounded-lg transition"
            >
              <UserPlus size={15} />
              Create User
            </button>
          )}
          {isSuper && (
            <button
              onClick={handleExport}
              className="flex items-center gap-2 px-4 py-2 bg-gray-700
                         text-gray-200 text-sm font-medium rounded-lg
                         hover:bg-gray-600 transition"
            >
              <Download size={15} />
              Export CSV
            </button>
          )}
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-3 mb-6">
        <div className="relative flex-1 min-w-48">
          <Search size={15} className="absolute left-3 top-1/2
                                       -translate-y-1/2 text-gray-500" />
          <input
            type="text"
            placeholder="Search name or email..."
            value={filters.search}
            onChange={e => update('search', e.target.value)}
            className="w-full pl-9 pr-4 py-2 bg-gray-800 border
                       border-gray-700 rounded-lg text-sm text-white
                       placeholder-gray-500 focus:outline-none
                       focus:border-orange-500"
          />
        </div>

        {[
          { key: 'role',   options: ROLES,    label: 'All Roles'   },
          { key: 'status', options: STATUSES, label: 'All Status'  },
          { key: 'plan',   options: PLANS,    label: 'All Plans'   },
        ].map(({ key, options, label }) => (
          <select
            key={key}
            value={filters[key]}
            onChange={e => update(key, e.target.value)}
            className="px-3 py-2 bg-gray-800 border border-gray-700
                       rounded-lg text-sm text-gray-300
                       focus:outline-none focus:border-orange-500"
          >
            <option value="">{label}</option>
            {options.filter(Boolean).map(o => (
              <option key={o} value={o} className="capitalize">{o}</option>
            ))}
          </select>
        ))}
      </div>

      {/* Table */}
      <div className="bg-gray-800 border border-gray-700 rounded-2xl
                      overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-700 text-gray-400
                             text-xs uppercase tracking-wider">
                <th className="px-4 py-3 text-left">User</th>
                <th className="px-4 py-3 text-left">Role</th>
                <th className="px-4 py-3 text-left">Plan</th>
                <th className="px-4 py-3 text-left">Jobs</th>
                <th className="px-4 py-3 text-left">Earnings</th>
                <th className="px-4 py-3 text-left">Status</th>
                <th className="px-4 py-3 text-left">Joined</th>
                <th className="px-4 py-3 text-left"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-700/50">
              {loading ? (
                <tr>
                  <td colSpan={8} className="px-4 py-12 text-center
                                             text-gray-500">
                    Loading...
                  </td>
                </tr>
              ) : users.length === 0 ? (
                <tr>
                  <td colSpan={8} className="px-4 py-12 text-center
                                             text-gray-500">
                    No users found.
                  </td>
                </tr>
              ) : users.map(user => (
                <tr key={user.id}
                    className="hover:bg-gray-750 transition-colors">
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-3">
                      <img
                        src={user.avatar_url || '/default-avatar.png'}
                        alt=""
                        className="w-8 h-8 rounded-full object-cover
                                   border border-gray-600"
                      />
                      <div>
                        <p className="font-medium text-white text-sm">
                          {user.first_name} {user.last_name}
                        </p>
                        <p className="text-xs text-gray-400">
                          {user.email}
                        </p>
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-3">
                                        <span className="px-2 py-0.5 rounded-full text-xs
                                     font-medium capitalize bg-gray-700
                                     text-gray-300">
                      {user.role}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    {user.plan_slug ? (
                      <span className={`px-2 py-0.5 rounded-full text-xs
                                        font-medium capitalize ${
                        user.plan_slug === 'elite'  ? 'bg-purple-900 text-purple-300' :
                        user.plan_slug === 'pro'    ? 'bg-blue-900   text-blue-300'   :
                        user.plan_slug === 'broker' ? 'bg-indigo-900 text-indigo-300' :
                                                      'bg-gray-700   text-gray-400'
                      }`}>
                        {user.plan_slug}
                      </span>
                    ) : (
                      <span className="text-gray-600 text-xs">Free</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-gray-300 text-xs">
                    <span title="Posted">
                      {user.jobs_posted ?? 0} posted
                    </span>
                    <span className="text-gray-600 mx-1">/</span>
                    <span title="Completed as helper">
                      {user.jobs_completed_as_helper ?? 0} done
                    </span>
                  </td>
                  <td className="px-4 py-3 text-gray-300 text-xs">
                    {user.earnings_total
                      ? `$${parseFloat(user.earnings_total).toFixed(2)}`
                      : <span className="text-gray-600">-</span>
                    }
                  </td>
                  <td className="px-4 py-3">
                    <span className={`px-2 py-0.5 rounded-full text-xs
                                      font-medium ${
                      user.is_active
                        ? 'bg-green-900 text-green-400'
                        : 'bg-red-900 text-red-400'
                    }`}>
                      {user.is_active ? 'Active' : 'Banned'}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-gray-400 text-xs">
                    {new Date(user.created_at).toLocaleDateString(
                      'en-US', { month: 'short', day: 'numeric', year: '2-digit' }
                    )}
                  </td>
                  <td className="px-4 py-3 flex items-center gap-2">
                    <button
                      onClick={() => openMessageModal(user)}
                      className="text-xs text-blue-400 hover:text-blue-300
                                 font-medium transition flex items-center gap-1"
                      title="Send message"
                    >
                      <MessageSquare size={14} />
                      Message
                    </button>
                    <Link
                      to={`/admin/users/${user.id}`}
                      className="text-xs text-orange-400 hover:text-orange-300
                                 font-medium transition"
                    >
                      View →
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        {pages > 1 && (
          <div className="flex items-center justify-between px-4 py-3
                          border-t border-gray-700">
            <p className="text-xs text-gray-500">
              Page {filters.page} of {pages}
            </p>
            <div className="flex gap-2">
              <button
                onClick={() => update('page', Math.max(1, filters.page - 1))}
                disabled={filters.page <= 1}
                className="px-3 py-1.5 bg-gray-700 text-gray-300 text-xs
                           rounded-lg disabled:opacity-40 hover:bg-gray-600
                           transition"
              >
                ← Prev
              </button>
              <button
                onClick={() => update('page', Math.min(pages, filters.page + 1))}
                disabled={filters.page >= pages}
                className="px-3 py-1.5 bg-gray-700 text-gray-300 text-xs
                           rounded-lg disabled:opacity-40 hover:bg-gray-600
                           transition"
              >
                Next →
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Message modal */}
      {showMsgModal && selectedUser && (
        <div className="fixed inset-0 z-50 flex items-center justify-center
                        p-4 bg-black/60">
          <div className="w-full max-w-md bg-gray-900 border border-gray-700
                          rounded-2xl shadow-2xl overflow-hidden">
            <div className="flex items-center justify-between px-5 py-4
                            border-b border-gray-800">
              <h2 className="font-semibold text-white flex items-center gap-2 text-sm">
                <MessageSquare size={15} className="text-blue-400" />
                Message {selectedUser.first_name}
              </h2>
              <button
                onClick={closeMessageModal}
                className="text-gray-500 hover:text-white transition p-1"
              >
                <X size={15} />
              </button>
            </div>
            {message && (
              <div className={`mx-5 mt-4 p-3 rounded-lg text-sm ${
                message.type === 'success'
                  ? 'bg-green-900/30 text-green-300'
                  : 'bg-red-900/30 text-red-300'
              }`}>
                {message.message}
              </div>
            )}
            <form
              onSubmit={handleSendMessage}
              className="p-5"
            >
              <p className="text-xs text-gray-400 mb-3">
                This message will appear in {selectedUser.first_name}'s inbox as a system message.
                It is logged in the audit trail.
              </p>
              <textarea
                autoFocus
                required
                rows={5}
                maxLength={4000}
                value={msgText}
                onChange={e => setMsgText(e.target.value)}
                placeholder={`Write a message to ${selectedUser.first_name}…`}
                className="w-full px-3 py-2.5 bg-gray-800 border border-gray-700
                           rounded-lg text-sm text-white placeholder-gray-500
                           focus:outline-none focus:border-blue-500 resize-none"
              />
              <div className="flex justify-between items-center mt-4">
                <span className="text-xs text-gray-500">
                  {msgText.length} / 4000
                </span>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={closeMessageModal}
                    disabled={msgSending}
                    className="px-4 py-2 text-sm rounded-lg bg-gray-700 text-gray-300
                              hover:bg-gray-600 disabled:opacity-50 disabled:cursor-not-allowed
                              transition"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={msgSending || !msgText.trim()}
                    className="px-4 py-2 text-sm rounded-lg bg-blue-600 text-white
                              hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed
                              transition font-medium"
                  >
                    {msgSending ? 'Sending…' : 'Send Message'}
                  </button>
                </div>
              </div>
            </form>
          </div>
        </div>
      )}

      {isSuper && showCreate && (
        <CreateUserModal
          onClose={() => setShowCreate(false)}
          onCreated={(newUser) => {
            setShowCreate(false);
            setUsers(prev => [newUser, ...prev]);
            setTotal(t => t + 1);
          }}
        />
      )}
    </div>
  );
}
