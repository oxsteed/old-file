import { useEffect, useState, useCallback } from 'react';
import { Link }          from 'react-router-dom';
import { Search, Filter, Download } from 'lucide-react';
import { useAuth }       from '../../hooks/useAuth';
import adminApi          from '../../lib/adminApi';

const ROLES   = ['','client','helper','both','broker'];
const PLANS   = ['','starter','pro','elite','broker'];
const STATUSES = ['','active','banned'];

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

  return (
    <div className="p-8">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-white">Users</h1>
          <p className="text-gray-400 text-sm mt-1">
            {total.toLocaleString()} total users
          </p>
        </div>
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
                      : <span className="text-gray-600">—</span>
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
                  <td className="px-4 py-3">
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
    </div>
  );
}
