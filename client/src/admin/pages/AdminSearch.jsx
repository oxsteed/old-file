import { useEffect, useState, useCallback, useRef } from 'react';
import { useSearchParams, Link } from 'react-router-dom';
import {
  Search, User, Briefcase, MessageSquare, Loader2,
  AlertTriangle, CreditCard, LifeBuoy, Star, Gavel,
  ChevronLeft, ChevronRight,
} from 'lucide-react';
import adminApi from '../../lib/adminApi';

// ── Helpers ───────────────────────────────────────────────────────────────────

function Badge({ text, colorClass }) {
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

function money(val) {
  if (val == null) return '—';
  return `$${parseFloat(val).toFixed(2)}`;
}

// ── Result section components ─────────────────────────────────────────────────

function UserResults({ users }) {
  if (!users?.length) return <Empty />;
  return (
    <div className="divide-y divide-gray-800">
      {users.map(u => (
        <Link
          key={u.id}
          to={`/admin/users/${u.id}`}
          className="flex items-center gap-3 py-3 px-4 hover:bg-gray-800/50 transition group"
        >
          <div className="w-8 h-8 rounded-full bg-gray-700 flex items-center justify-center text-xs font-bold text-gray-300 shrink-0">
            {(u.first_name?.[0] || '?').toUpperCase()}
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium text-white truncate group-hover:text-orange-300 transition">
              {u.first_name} {u.last_name}
            </p>
            <p className="text-xs text-gray-400 truncate">{u.email}</p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <Badge text={u.role} colorClass="bg-gray-700 text-gray-300" />
            {u.is_banned  && <Badge text="Banned"   colorClass="bg-red-900 text-red-300" />}
            {!u.is_active && <Badge text="Inactive" colorClass="bg-yellow-900 text-yellow-300" />}
            <span className="text-xs text-gray-500">{ts(u.created_at)}</span>
          </div>
        </Link>
      ))}
    </div>
  );
}

function JobResults({ jobs }) {
  if (!jobs?.length) return <Empty />;
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
              <Badge text={j.status} colorClass={STATUS_COLOR[j.status] || 'bg-gray-700 text-gray-300'} />
              <span className="text-xs text-gray-500">{ts(j.created_at)}</span>
            </div>
          </div>
          <p className="text-xs text-gray-500 mt-1">
            {j.category_name && <span className="mr-2">{j.category_name}</span>}
            {j.budget_min != null && <span>{money(j.budget_min)}–{money(j.budget_max)}</span>}
          </p>
        </div>
      ))}
    </div>
  );
}

function MessageResults({ messages }) {
  if (!messages?.length) return <Empty />;
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

function DisputeResults({ disputes }) {
  if (!disputes?.length) return <Empty />;
  const STATUS_COLOR = {
    open:         'bg-yellow-900 text-yellow-300',
    under_review: 'bg-blue-900 text-blue-300',
    escalated:    'bg-orange-900 text-orange-300',
    resolved_poster: 'bg-green-900 text-green-300',
    resolved_helper: 'bg-green-900 text-green-300',
    closed:       'bg-gray-700 text-gray-400',
  };
  return (
    <div className="divide-y divide-gray-800">
      {disputes.map(d => (
        <Link
          key={d.id}
          to={`/admin/disputes/${d.id}`}
          className="block py-3 px-4 hover:bg-gray-800/50 transition group"
        >
          <div className="flex items-start justify-between gap-3">
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-white truncate group-hover:text-orange-300 transition">
                {d.job_title}
              </p>
              <p className="text-xs text-gray-400 mt-0.5">
                {d.raised_by_name} vs {d.against_name}
              </p>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <Badge text={d.status} colorClass={STATUS_COLOR[d.status] || 'bg-gray-700 text-gray-300'} />
              <span className="text-xs text-gray-500">{ts(d.created_at)}</span>
            </div>
          </div>
          <p className="text-xs text-gray-500 mt-1 line-clamp-1">
            <span className="capitalize mr-1">{d.reason}</span>·{' '}
            {d.description}
          </p>
          {d.refund_amount && (
            <p className="text-xs text-blue-400 mt-0.5">Refund: {money(d.refund_amount)}</p>
          )}
        </Link>
      ))}
    </div>
  );
}

function PaymentResults({ payments }) {
  if (!payments?.length) return <Empty />;
  const STATUS_COLOR = {
    pending:    'bg-yellow-900 text-yellow-300',
    authorized: 'bg-blue-900 text-blue-300',
    captured:   'bg-green-900 text-green-300',
    released:   'bg-green-900 text-green-300',
    refunded:   'bg-orange-900 text-orange-300',
    disputed:   'bg-red-900 text-red-300',
    failed:     'bg-red-900 text-red-400',
  };
  return (
    <div className="divide-y divide-gray-800">
      {payments.map(p => (
        <div key={p.id} className="py-3 px-4">
          <div className="flex items-start justify-between gap-3">
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-white truncate">{p.job_title}</p>
              <p className="text-xs text-gray-400 mt-0.5">
                {p.payer_name} → {p.payee_name}
              </p>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <span className="text-sm font-semibold text-white">{money(p.amount)}</span>
              <Badge text={p.status} colorClass={STATUS_COLOR[p.status] || 'bg-gray-700 text-gray-300'} />
              <span className="text-xs text-gray-500">{ts(p.created_at)}</span>
            </div>
          </div>
          {p.stripe_payment_intent_id && (
            <p className="text-xs text-gray-600 font-mono mt-1 truncate">
              {p.stripe_payment_intent_id}
            </p>
          )}
          <p className="text-xs text-gray-500 mt-0.5">
            Fee: {money(p.platform_fee)} · Payout: {money(p.helper_payout)}
          </p>
        </div>
      ))}
    </div>
  );
}

function SupportResults({ tickets }) {
  if (!tickets?.length) return <Empty />;
  const PRIORITY_COLOR = {
    low:    'bg-gray-700 text-gray-400',
    normal: 'bg-blue-900 text-blue-300',
    high:   'bg-orange-900 text-orange-300',
    urgent: 'bg-red-900 text-red-300',
  };
  const STATUS_COLOR = {
    open:         'bg-yellow-900 text-yellow-300',
    assigned:     'bg-blue-900 text-blue-300',
    in_progress:  'bg-blue-900 text-blue-300',
    waiting_user: 'bg-purple-900 text-purple-300',
    resolved:     'bg-green-900 text-green-300',
    closed:       'bg-gray-700 text-gray-400',
  };
  return (
    <div className="divide-y divide-gray-800">
      {tickets.map(t => (
        <Link
          key={t.id}
          to={`/admin/support`}
          className="block py-3 px-4 hover:bg-gray-800/50 transition group"
        >
          <div className="flex items-start justify-between gap-3">
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-white truncate group-hover:text-orange-300 transition">
                #{t.ticket_number} · {t.subject}
              </p>
              <p className="text-xs text-gray-400 mt-0.5">
                {t.name} ({t.email})
              </p>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <Badge text={t.priority} colorClass={PRIORITY_COLOR[t.priority] || 'bg-gray-700 text-gray-300'} />
              <Badge text={t.status}   colorClass={STATUS_COLOR[t.status]     || 'bg-gray-700 text-gray-300'} />
              <span className="text-xs text-gray-500">{ts(t.created_at)}</span>
            </div>
          </div>
          <p className="text-xs text-gray-500 mt-0.5 capitalize">{t.category}</p>
        </Link>
      ))}
    </div>
  );
}

function ReviewResults({ reviews }) {
  if (!reviews?.length) return <Empty />;
  return (
    <div className="divide-y divide-gray-800">
      {reviews.map(r => (
        <div key={r.id} className="py-3 px-4">
          <div className="flex items-start justify-between gap-3">
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-white truncate">{r.job_title}</p>
              <p className="text-xs text-gray-400 mt-0.5">
                {r.reviewer_name} → {r.reviewee_name}
              </p>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <span className="text-yellow-400 text-xs font-semibold">{'★'.repeat(r.rating)}{'☆'.repeat(5 - r.rating)}</span>
              {!r.is_public && <Badge text="Hidden" colorClass="bg-gray-700 text-gray-400" />}
              <span className="text-xs text-gray-500">{ts(r.created_at)}</span>
            </div>
          </div>
          {r.comment && (
            <p className="text-xs text-gray-400 mt-1 line-clamp-2">{r.comment}</p>
          )}
        </div>
      ))}
    </div>
  );
}

function BidResults({ bids }) {
  if (!bids?.length) return <Empty />;
  const STATUS_COLOR = {
    pending:   'bg-yellow-900 text-yellow-300',
    accepted:  'bg-green-900 text-green-300',
    rejected:  'bg-red-900 text-red-300',
    withdrawn: 'bg-gray-700 text-gray-400',
    expired:   'bg-gray-700 text-gray-500',
  };
  return (
    <div className="divide-y divide-gray-800">
      {bids.map(b => (
        <div key={b.id} className="py-3 px-4">
          <div className="flex items-start justify-between gap-3">
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-white truncate">{b.job_title}</p>
              <p className="text-xs text-gray-400 mt-0.5">{b.helper_name} ({b.helper_email})</p>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <span className="text-sm font-semibold text-white">{money(b.amount)}</span>
              <Badge text={b.status} colorClass={STATUS_COLOR[b.status] || 'bg-gray-700 text-gray-300'} />
              <span className="text-xs text-gray-500">{ts(b.created_at)}</span>
            </div>
          </div>
          {b.message && (
            <p className="text-xs text-gray-500 mt-1 line-clamp-1">{b.message}</p>
          )}
        </div>
      ))}
    </div>
  );
}

function Empty() {
  return <p className="text-sm text-gray-500 py-4 text-center">No results found.</p>;
}

// ── Pagination control ────────────────────────────────────────────────────────

function Pagination({ type, page, total, limit, onPage }) {
  const pages = Math.ceil(total / limit);
  if (pages <= 1) return null;
  return (
    <div className="flex items-center justify-between px-4 py-2 border-t border-gray-800 text-xs text-gray-500">
      <span>
        Page {page} of {pages} ({total} total)
      </span>
      <div className="flex gap-1">
        <button
          onClick={() => onPage(type, page - 1)}
          disabled={page <= 1}
          className="p-1 rounded hover:bg-gray-700 disabled:opacity-30 transition"
        >
          <ChevronLeft size={14} />
        </button>
        <button
          onClick={() => onPage(type, page + 1)}
          disabled={page >= pages}
          className="p-1 rounded hover:bg-gray-700 disabled:opacity-30 transition"
        >
          <ChevronRight size={14} />
        </button>
      </div>
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

const ALL_TYPES = [
  'users', 'jobs', 'messages',
  'disputes', 'payments', 'support_tickets', 'reviews', 'bids',
];

const TYPE_META = {
  users:           { icon: User,          label: 'Users',           color: 'text-blue-400'   },
  jobs:            { icon: Briefcase,     label: 'Jobs',            color: 'text-green-400'  },
  messages:        { icon: MessageSquare, label: 'Messages',        color: 'text-purple-400' },
  disputes:        { icon: AlertTriangle, label: 'Disputes',        color: 'text-orange-400' },
  payments:        { icon: CreditCard,    label: 'Payments',        color: 'text-emerald-400'},
  support_tickets: { icon: LifeBuoy,      label: 'Support',         color: 'text-sky-400'    },
  reviews:         { icon: Star,          label: 'Reviews',         color: 'text-yellow-400' },
  bids:            { icon: Gavel,         label: 'Bids',            color: 'text-rose-400'   },
};

const RESULT_COMPONENT = {
  users:           (rows) => <UserResults    users={rows}    />,
  jobs:            (rows) => <JobResults     jobs={rows}     />,
  messages:        (rows) => <MessageResults messages={rows} />,
  disputes:        (rows) => <DisputeResults disputes={rows} />,
  payments:        (rows) => <PaymentResults payments={rows} />,
  support_tickets: (rows) => <SupportResults tickets={rows}  />,
  reviews:         (rows) => <ReviewResults  reviews={rows}  />,
  bids:            (rows) => <BidResults     bids={rows}     />,
};

export default function AdminSearch() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [query,   setQuery]   = useState(searchParams.get('q') || '');
  const [input,   setInput]   = useState(searchParams.get('q') || '');
  const [results, setResults] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error,   setError]   = useState(null);
  const [types,   setTypes]   = useState([...ALL_TYPES]);
  // Per-type page state
  const [pages, setPages]     = useState(
    Object.fromEntries(ALL_TYPES.map(t => [t, 1]))
  );
  const initialMountRef = useRef(true);
  const LIMIT = 10;

  const doSearch = useCallback(async (q, entityTypes, pageMap) => {
    if (!q || q.trim().length < 2) return;
    setLoading(true);
    setError(null);
    try {
      // Fan out one request per type that needs a non-default page,
      // or a single combined request when all active pages are 1.
      // Only check active (included) types — deactivated types may retain
      // a stale page > 1 from a previous session without affecting this query.
      const allPage1 = entityTypes.every(t => (pageMap[t] || 1) === 1);

      if (allPage1) {
        const { data } = await adminApi.get('/admin/search', {
          params: { q: q.trim(), types: entityTypes.join(','), limit: LIMIT, page: 1 },
        });
        setResults(data);
      } else {
        // For paginated state, fetch each active type individually so we can
        // honour their individual page numbers, then merge.
        const responses = await Promise.allSettled(
          entityTypes.map(t =>
            adminApi.get('/admin/search', {
              params: { q: q.trim(), types: t, limit: LIMIT, page: pageMap[t] || 1 },
            })
          )
        );

        const merged = {
          query: q.trim(),
          entity_types: entityTypes,
          total: 0,
          totals: {},
          page: 1,
          limit: LIMIT,
          results: Object.fromEntries(ALL_TYPES.map(t => [t, []])),
        };
        responses.forEach((res, i) => {
          if (res.status === 'fulfilled') {
            const d = res.value.data;
            const t = entityTypes[i];
            merged.results[t] = d.results[t] || [];
            merged.totals[t]  = d.totals?.[t] || 0;
            merged.total     += (d.results[t] || []).length;
          }
        });
        setResults(merged);
      }
    } catch (err) {
      setError(err.response?.data?.error || 'Search failed.');
      setResults(null);
    } finally {
      setLoading(false);
    }
  }, []);

  // Run search when URL param changes.
  // Always reset per-type pages to 1 here so that sidebar navigation
  // (which bypasses handleSubmit) never carries stale page offsets into
  // a new query.
  useEffect(() => {
    const q = searchParams.get('q') || '';
    setInput(q);
    setQuery(q);
    if (q.trim().length >= 2) {
      const freshPages = Object.fromEntries(ALL_TYPES.map(t => [t, 1]));
      setPages(freshPages);
      doSearch(q, types, freshPages);
    }
    initialMountRef.current = false;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);

  const handleSubmit = (e) => {
    e.preventDefault();
    if (input.trim().length < 2) return;
    // Reset pages on new query
    setPages(Object.fromEntries(ALL_TYPES.map(t => [t, 1])));
    setSearchParams({ q: input.trim() });
  };

  const toggleType = (t) => {
    setTypes(prev => {
      const next = prev.includes(t) ? prev.filter(x => x !== t) : [...prev, t];
      return next.length ? next : prev;
    });
  };

  // Re-run when types change (after mount)
  useEffect(() => {
    if (initialMountRef.current) return;
    if (query.trim().length >= 2) doSearch(query, types, pages);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [types]);

  const handlePageChange = useCallback((type, newPage) => {
    const updated = { ...pages, [type]: newPage };
    setPages(updated);
    doSearch(query, types, updated);
  }, [pages, query, types, doSearch]);

  return (
    <div className="p-4 sm:p-8 max-w-4xl">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-white">Search</h1>
        <p className="text-gray-400 text-sm mt-1">
          Search across users, jobs, messages, disputes, payments, support tickets, reviews, and bids.
          All searches are logged.
        </p>
      </div>

      {/* Search form */}
      <form onSubmit={handleSubmit} className="flex gap-2 mb-4">
        <div className="relative flex-1">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500 pointer-events-none" />
          <input
            autoFocus
            value={input}
            onChange={e => setInput(e.target.value)}
            placeholder="Search users, jobs, disputes, payments…"
            className="w-full pl-9 pr-3 py-2.5 bg-gray-800 border border-gray-700 rounded-lg
                       text-sm text-white placeholder-gray-500 focus:outline-none focus:border-orange-500"
          />
        </div>
        <button
          type="submit"
          disabled={loading || input.trim().length < 2}
          className="px-4 py-2 bg-orange-500 hover:bg-orange-600 text-white text-sm
                     font-semibold rounded-lg transition disabled:opacity-40 disabled:cursor-not-allowed"
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
              {results?.totals?.[t] > 0 && active && (
                <span className="ml-1 bg-gray-600 text-gray-300 rounded-full px-1.5 py-0.5 text-[10px] font-semibold">
                  {results.totals[t]}
                </span>
              )}
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
        <div className="p-4 bg-red-950 border border-red-800 rounded-xl text-red-300 text-sm">
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
            const rows  = results.results?.[t] || [];
            const total = results.totals?.[t]  || rows.length;
            if (!rows.length) return null;
            return (
              <div key={t} className="mb-6 bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
                <div className="flex items-center gap-2 px-4 py-3 border-b border-gray-800">
                  <Icon size={14} className={color} />
                  <h2 className="text-sm font-semibold text-white">{label}</h2>
                  <span className="ml-auto text-xs text-gray-500">
                    {rows.length} of {total}
                  </span>
                </div>
                {RESULT_COMPONENT[t](rows)}
                <Pagination
                  type={t}
                  page={pages[t] || 1}
                  total={total}
                  limit={LIMIT}
                  onPage={handlePageChange}
                />
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
