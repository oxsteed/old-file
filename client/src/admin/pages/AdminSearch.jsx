import { useEffect, useState, useCallback, useRef } from 'react';
import { useSearchParams, Link }                    from 'react-router-dom';
import { Search, User, Briefcase, MessageSquare, Loader2 } from 'lucide-react';
import adminApi from '../../lib/adminApi';

// ── Helpers ───────────────────────────────────────────────────────────────────

function badge(text, colorClass) {
  return (
    <span className={`px-2 py-0.5 text-xs rounded-full font-medium ${colorClass}`}>
      {text}
    </span>
  );
}

function ts(dateStr) {
  if (!dateStr) return '—';
  return new Date(dateStr).toLocaleDateString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric',
  });
}

// ── Section components ────────────────────────────────────────────────────────

function UserResults({ users }) {
  if (!users?.length) return (
    <p className="text-sm text-gray-500 py-4 text-center">No users found.</p>
  );
  return (
    <div className="divide-y divide-gray-800">
      {users.map(u => (
        <Link
          key={u.id}
          to={`/admin/users/${u.id}`}
          className="flex items-center gap-3 py-3 px-4 hover:bg-gray-800/50
                     transition group"
        >
          <div className="w-8 h-8 rounded-full bg-gray-700 flex items-center
                          justify-center text-xs font-bold text-gray-300 shrink-0">
            {(u.first_name?.[0] || '?').toUpperCase()}
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium text-white truncate group-hover:text-orange-300 transition">
              {u.first_name} {u.last_name}
            </p>
            <p className="text-xs text-gray-400 truncate">{u.email}</p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {badge(u.role, 'bg-gray-700 text-gray-300')}
            {u.is_banned  && badge('Banned',   'bg-red-900 text-red-300')}
            {!u.is_active && badge('Inactive', 'bg-yellow-900 text-yellow-300')}
            <span className="text-xs text-gray-500">{ts(u.created_at)}</span>
          </div>
        </Link>
      ))}
    </div>
  );
}

function JobResults({ jobs }) {
  if (!jobs?.length) return (
    <p className="text-sm text-gray-500 py-4 text-center">No jobs found.</p>
  );

  const STATUS_COLOR = {
    published:   'bg-green-900 text-green-300',
    in_progress: 'bg-blue-900 text-blue-300',
    completed:   'bg-gray-700 text-gray-300',
    cancelled:   'bg-red-900 text-red-300',
  };

  return (
    <div className="divide-y divide-gray-800">
      {jobs.map(j => (
        <div key={j.id} className="py-3 px-4">
          <div className="flex items-start justify-between gap-3">
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-white truncate">{j.title}</p>
              <p className="text-xs text-gray-400 mt-0.5">
                {j.client_name} · {j.location_city}{j.location_state ? `, ${j.location_state}` : ''}
              </p>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              {badge(j.status, STATUS_COLOR[j.status] || 'bg-gray-700 text-gray-300')}
              <span className="text-xs text-gray-500">{ts(j.created_at)}</span>
            </div>
          </div>
          <p className="text-xs text-gray-500 mt-1">
            {j.category_name && <span className="mr-2">{j.category_name}</span>}
            {j.budget_min != null && (
              <span>${j.budget_min}–${j.budget_max}</span>
            )}
          </p>
        </div>
      ))}
    </div>
  );
}

function MessageResults({ messages }) {
  if (!messages?.length) return (
    <p className="text-sm text-gray-500 py-4 text-center">No messages found.</p>
  );
  return (
    <div className="divide-y divide-gray-800">
      {messages.map(m => (
        <div key={m.id} className="py-3 px-4">
          <div className="flex items-start justify-between gap-3 mb-1">
            <p className="text-xs font-medium text-gray-300">
              {m.sender_name}
              <span className="text-gray-500 ml-1">({m.sender_email})</span>
            </p>
            <span className="text-xs text-gray-500 shrink-0">{ts(m.created_at)}</span>
          </div>
          <p className="text-sm text-gray-300 line-clamp-2">{m.content}</p>
        </div>
      ))}
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function AdminSearch() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [query,   setQuery]   = useState(searchParams.get('q') || '');
  const [input,   setInput]   = useState(searchParams.get('q') || '');
  const [results, setResults] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error,   setError]   = useState(null);
  const [types,   setTypes]   = useState(['users', 'jobs', 'messages']);
  // Track whether we've completed the initial mount so the types effect
  // doesn't fire a duplicate search alongside the searchParams effect.
  const initialMountRef = useRef(true);

  const ALL_TYPES = ['users', 'jobs', 'messages'];

  const doSearch = useCallback(async (q, entityTypes) => {
    if (!q || q.trim().length < 2) return;
    setLoading(true);
    setError(null);
    try {
      const { data } = await adminApi.get('/admin/search', {
        params: { q: q.trim(), types: entityTypes.join(',') },
      });
      setResults(data);
    } catch (err) {
      setError(err.response?.data?.error || 'Search failed.');
      setResults(null);
    } finally {
      setLoading(false);
    }
  }, []);

  // Run search when URL param changes (also handles initial mount)
  useEffect(() => {
    const q = searchParams.get('q') || '';
    setInput(q);
    setQuery(q);
    if (q.trim().length >= 2) {
      doSearch(q, types);
    }
    // After the first run, mark mount as complete so the types effect
    // knows not to duplicate this call.
    initialMountRef.current = false;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);

  const handleSubmit = (e) => {
    e.preventDefault();
    if (input.trim().length < 2) return;
    setSearchParams({ q: input.trim() });
  };

  const toggleType = (t) => {
    setTypes(prev => {
      const next = prev.includes(t) ? prev.filter(x => x !== t) : [...prev, t];
      return next.length ? next : prev; // require at least one
    });
  };

  // Re-run search when types change — but skip the initial mount to avoid
  // firing a duplicate request alongside the searchParams effect above.
  useEffect(() => {
    if (initialMountRef.current) return;
    if (query.trim().length >= 2) {
      doSearch(query, types);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [types]);

  const TYPE_META = {
    users:    { icon: User,          label: 'Users',    color: 'text-blue-400'   },
    jobs:     { icon: Briefcase,     label: 'Jobs',     color: 'text-green-400'  },
    messages: { icon: MessageSquare, label: 'Messages', color: 'text-purple-400' },
  };

  return (
    <div className="p-4 sm:p-8 max-w-4xl">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-white">Search</h1>
        <p className="text-gray-400 text-sm mt-1">
          Search users, jobs, and messages. All searches are logged.
        </p>
      </div>

      {/* Search form */}
      <form onSubmit={handleSubmit} className="flex gap-2 mb-4">
        <div className="relative flex-1">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2
                                       text-gray-500 pointer-events-none" />
          <input
            autoFocus
            value={input}
            onChange={e => setInput(e.target.value)}
            placeholder="Search users, jobs, messages…"
            className="w-full pl-9 pr-3 py-2.5 bg-gray-800 border border-gray-700
                       rounded-lg text-sm text-white placeholder-gray-500
                       focus:outline-none focus:border-orange-500"
          />
        </div>
        <button
          type="submit"
          disabled={loading || input.trim().length < 2}
          className="px-4 py-2 bg-orange-500 hover:bg-orange-600 text-white
                     text-sm font-semibold rounded-lg transition
                     disabled:opacity-40 disabled:cursor-not-allowed"
        >
          Search
        </button>
      </form>

      {/* Type filters */}
      <div className="flex gap-2 mb-6 flex-wrap">
        {ALL_TYPES.map(t => {
          const { icon: Icon, label } = TYPE_META[t];
          const active = types.includes(t);
          return (
            <button
              key={t}
              onClick={() => toggleType(t)}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs
                          font-medium border transition ${
                active
                  ? 'bg-gray-700 border-gray-600 text-white'
                  : 'bg-transparent border-gray-700 text-gray-500 hover:border-gray-500'
              }`}
            >
              <Icon size={12} />
              {label}
            </button>
          );
        })}
      </div>

      {/* Loading */}
      {loading && (
        <div className="flex items-center justify-center py-12">
          <Loader2 size={24} className="animate-spin text-orange-400" />
        </div>
      )}

      {/* Error */}
      {error && !loading && (
        <div className="p-4 bg-red-950 border border-red-800 rounded-xl
                        text-red-300 text-sm">
          {error}
        </div>
      )}

      {/* Results */}
      {!loading && results && (
        <>
          <p className="text-xs text-gray-500 mb-4">
            {results.total} result{results.total !== 1 ? 's' : ''} for{' '}
            <span className="text-white font-medium">"{results.query}"</span>
          </p>

          {ALL_TYPES.filter(t => types.includes(t)).map(t => {
            const { icon: Icon, label, color } = TYPE_META[t];
            const rows = results.results?.[t] || [];
            if (!rows.length && results.total > 0) return null;
            return (
              <div key={t} className="mb-6 bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
                <div className="flex items-center gap-2 px-4 py-3 border-b border-gray-800">
                  <Icon size={14} className={color} />
                  <h2 className="text-sm font-semibold text-white">{label}</h2>
                  <span className="ml-auto text-xs text-gray-500">
                    {rows.length} result{rows.length !== 1 ? 's' : ''}
                  </span>
                </div>
                {t === 'users'    && <UserResults    users={rows}    />}
                {t === 'jobs'     && <JobResults     jobs={rows}     />}
                {t === 'messages' && <MessageResults messages={rows} />}
              </div>
            );
          })}

          {results.total === 0 && (
            <div className="py-16 text-center">
              <Search size={36} className="mx-auto mb-3 text-gray-700" />
              <p className="text-gray-500 text-sm">No results for "{results.query}"</p>
            </div>
          )}
        </>
      )}

      {/* Empty state */}
      {!loading && !results && !error && (
        <div className="py-16 text-center">
          <Search size={36} className="mx-auto mb-3 text-gray-700" />
          <p className="text-gray-500 text-sm">Enter at least 2 characters to search.</p>
        </div>
      )}
    </div>
  );
}
