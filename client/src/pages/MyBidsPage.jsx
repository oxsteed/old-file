import { useState, useEffect, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import api from '../api/axios';
import Navbar from '../components/Navbar';
import Footer from '../components/Footer';
import PageMeta from '../components/PageMeta';

const BID_STATUS_FILTERS = ['all', 'pending', 'accepted', 'rejected', 'withdrawn'];

const BID_STATUS_COLORS = {
  pending:   'bg-yellow-500/15 text-yellow-400',
  accepted:  'bg-emerald-500/15 text-emerald-400',
  rejected:  'bg-red-500/15 text-red-400',
  withdrawn: 'bg-gray-500/15 text-gray-400',
};

const JOB_STATUS_COLORS = {
  published:   'bg-blue-500/15 text-blue-400',
  matched:     'bg-blue-500/15 text-blue-400',
  accepted:    'bg-emerald-500/15 text-emerald-400',
  in_progress: 'bg-orange-500/15 text-orange-400',
  completed:   'bg-gray-500/15 text-gray-400',
  cancelled:   'bg-red-500/15 text-red-400',
};

function BidStatusBadge({ status }) {
  const { t } = useTranslation();
  const labels = {
    pending:   t('myBids.statusPending',   { defaultValue: 'Pending' }),
    accepted:  t('myBids.statusAccepted',  { defaultValue: 'Accepted' }),
    rejected:  t('myBids.statusRejected',  { defaultValue: 'Rejected' }),
    withdrawn: t('myBids.statusWithdrawn', { defaultValue: 'Withdrawn' }),
  };
  return (
    <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-[11px] font-semibold ${BID_STATUS_COLORS[status] || 'bg-gray-700 text-gray-400'}`}>
      {labels[status] || status}
    </span>
  );
}

function JobStatusBadge({ status }) {
  const { t } = useTranslation();
  const labels = {
    published:   t('myBids.jobOpen',        { defaultValue: 'Job Open' }),
    matched:     t('myBids.jobOpen',        { defaultValue: 'Job Open' }),
    accepted:    t('myBids.jobAwarded',     { defaultValue: 'Job Awarded' }),
    in_progress: t('myBids.jobInProgress',  { defaultValue: 'In Progress' }),
    completed:   t('myBids.jobCompleted',   { defaultValue: 'Completed' }),
    cancelled:   t('myBids.jobCancelled',   { defaultValue: 'Job Cancelled' }),
  };
  return (
    <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-[11px] font-semibold ${JOB_STATUS_COLORS[status] || 'bg-gray-700 text-gray-400'}`}>
      {labels[status] || status}
    </span>
  );
}

export default function MyBidsPage() {
  const { t } = useTranslation();

  const [bids, setBids] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [filter, setFilter] = useState('all');

  const fetchBids = useCallback(async () => {
    setLoading(true);
    setError(false);
    try {
      const res = await api.get('/bids/me');
      const data = Array.isArray(res.data) ? res.data : (res.data?.bids || []);
      setBids(data);
    } catch (err) {
      console.error('MyBidsPage: failed to load bids', err);
      setError(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchBids(); }, [fetchBids]);

  const displayed = filter === 'all'
    ? bids
    : bids.filter(b => b.status === filter);

  const counts = BID_STATUS_FILTERS.reduce((acc, s) => {
    acc[s] = s === 'all' ? bids.length : bids.filter(b => b.status === s).length;
    return acc;
  }, {});

  const pendingCount  = counts.pending  || 0;
  const acceptedCount = counts.accepted || 0;

  return (
    <div className="min-h-screen flex flex-col bg-gray-950">
      <PageMeta title={t('myBids.title', { defaultValue: 'My Bids' })} noIndex />
      <Navbar />
      <main className="flex-1 max-w-3xl mx-auto w-full px-4 py-8">

        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold text-white">{t('myBids.title', { defaultValue: 'My Bids' })}</h1>
            <p className="text-sm text-gray-500 mt-0.5">
              {t('myBids.subtitle', { defaultValue: 'Jobs you have placed bids on' })}
            </p>
          </div>
          <Link
            to="/jobs"
            className="flex items-center gap-1.5 bg-orange-500 hover:bg-orange-600 text-white text-sm font-semibold px-4 py-2 rounded-xl transition"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
              <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
            </svg>
            {t('helperDashboard.findJobs', { defaultValue: 'Find Jobs' })}
          </Link>
        </div>

        {/* Summary strip */}
        {!loading && !error && bids.length > 0 && (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
            <div className="bg-gray-900/50 border border-gray-700/40 rounded-xl p-3 text-center">
              <p className="text-xl font-bold text-white">{bids.length}</p>
              <p className="text-[10px] text-gray-500 uppercase tracking-wider mt-0.5">{t('myBids.totalBids', { defaultValue: 'Total' })}</p>
            </div>
            <div className="bg-gray-900/50 border border-gray-700/40 rounded-xl p-3 text-center">
              <p className="text-xl font-bold text-yellow-400">{pendingCount}</p>
              <p className="text-[10px] text-gray-500 uppercase tracking-wider mt-0.5">{t('myBids.statusPending', { defaultValue: 'Pending' })}</p>
            </div>
            <div className="bg-gray-900/50 border border-gray-700/40 rounded-xl p-3 text-center">
              <p className="text-xl font-bold text-emerald-400">{acceptedCount}</p>
              <p className="text-[10px] text-gray-500 uppercase tracking-wider mt-0.5">{t('myBids.statusAccepted', { defaultValue: 'Accepted' })}</p>
            </div>
            <div className="bg-gray-900/50 border border-gray-700/40 rounded-xl p-3 text-center">
              <p className="text-xl font-bold text-red-400">{counts.rejected || 0}</p>
              <p className="text-[10px] text-gray-500 uppercase tracking-wider mt-0.5">{t('myBids.statusRejected', { defaultValue: 'Rejected' })}</p>
            </div>
          </div>
        )}

        {/* Filter tabs */}
        <div className="flex gap-2 mb-6 overflow-x-auto pb-1">
          {BID_STATUS_FILTERS.map(s => (
            <button
              key={s}
              onClick={() => setFilter(s)}
              className={`flex-shrink-0 px-3 py-1.5 rounded-lg text-xs font-semibold transition ${
                filter === s
                  ? 'bg-orange-500 text-white'
                  : 'bg-gray-800 text-gray-400 hover:text-white hover:bg-gray-700'
              }`}
            >
              {s === 'all'
                ? `${t('dashboard.jobs.all', { defaultValue: 'All' })} (${counts.all})`
                : `${t(`myBids.status${s.charAt(0).toUpperCase()}${s.slice(1)}`, { defaultValue: s })} (${counts[s] || 0})`
              }
            </button>
          ))}
        </div>

        {/* Error */}
        {error && (
          <div className="mb-4 p-3 bg-red-500/10 border border-red-500/20 rounded-xl text-sm text-red-400 flex items-center justify-between">
            <span>{t('myBids.loadError', { defaultValue: 'Failed to load bids.' })}</span>
            <button onClick={fetchBids} className="text-orange-400 hover:text-orange-300 font-medium">
              {t('dashboard.pulse.retry')}
            </button>
          </div>
        )}

        {/* Loading skeletons */}
        {loading && (
          <div className="space-y-3">
            {[1, 2, 3].map(i => (
              <div key={i} className="bg-gray-900/60 border border-gray-700/40 rounded-2xl p-5 animate-pulse">
                <div className="h-4 bg-gray-800 rounded w-2/5 mb-3" />
                <div className="h-3 bg-gray-800 rounded w-3/5" />
              </div>
            ))}
          </div>
        )}

        {/* Empty state */}
        {!loading && !error && displayed.length === 0 && (
          <div className="bg-gray-900/50 border border-gray-700/40 rounded-2xl p-12 text-center">
            <svg className="w-12 h-12 text-gray-700 mx-auto mb-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
            </svg>
            <p className="text-gray-400 text-sm mb-4">
              {filter === 'all'
                ? t('myBids.noBids', { defaultValue: 'You have not placed any bids yet.' })
                : t('myBids.noBidsInStatus', { status: filter, defaultValue: `No ${filter} bids.` })}
            </p>
            {filter === 'all' && (
              <Link
                to="/jobs"
                className="inline-flex items-center gap-1.5 bg-orange-500 hover:bg-orange-600 text-white text-sm font-semibold px-4 py-2 rounded-xl transition"
              >
                {t('myBids.findJobsToBid', { defaultValue: 'Find Jobs to Bid On' })}
              </Link>
            )}
          </div>
        )}

        {/* Bid list */}
        {!loading && displayed.length > 0 && (
          <div className="space-y-3">
            {displayed.map(bid => {
              const isAccepted = bid.status === 'accepted';
              const isPending  = bid.status === 'pending';
              const jobStillOpen = bid.job_status === 'published' || bid.job_status === 'matched';
              return (
                <div
                  key={bid.id}
                  className={`bg-gray-900/50 border rounded-2xl p-5 transition group ${
                    isAccepted
                      ? 'border-emerald-500/30 hover:border-emerald-500/60'
                      : 'border-gray-700/40 hover:border-gray-600'
                  }`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      {/* Status badges */}
                      <div className="flex items-center gap-2 flex-wrap mb-1">
                        <BidStatusBadge status={bid.status} />
                        <JobStatusBadge status={bid.job_status} />
                      </div>

                      {/* Job title */}
                      <h2 className="text-white font-semibold text-base group-hover:text-orange-400 transition truncate">
                        {bid.job_title || t('myBids.untitledJob', { defaultValue: 'Untitled Job' })}
                      </h2>

                      {/* Job meta */}
                      <p className="text-xs text-gray-500 mt-0.5">
                        {[bid.job_category, bid.location_city, bid.location_state].filter(Boolean).join(' · ')}
                      </p>

                      {/* Bid amount */}
                      <p className="text-sm font-semibold text-emerald-400 mt-1">
                        {bid.amount
                          ? `$${parseFloat(bid.amount).toFixed(2)}`
                          : t('myBids.noAmount', { defaultValue: 'No amount specified' })}
                        {bid.eta_hours && (
                          <span className="text-gray-500 font-normal ml-2">
                            · {bid.eta_hours}h {t('myBids.estimated', { defaultValue: 'est.' })}
                          </span>
                        )}
                      </p>

                      {/* Bid message preview */}
                      {bid.message && (
                        <p className="text-xs text-gray-500 mt-1.5 line-clamp-2 italic">
                          "{bid.message}"
                        </p>
                      )}

                      {/* Bid date */}
                      <p className="text-[11px] text-gray-600 mt-1.5">
                        {t('myBids.bidPlaced', { defaultValue: 'Bid placed' })}{' '}
                        {new Date(bid.created_at).toLocaleDateString()}
                      </p>
                    </div>

                    {/* Actions */}
                    <div className="flex flex-col gap-2 flex-shrink-0">
                      <Link
                        to={`/jobs/${bid.job_id}`}
                        className="text-xs font-semibold px-3 py-1.5 rounded-lg bg-gray-800 hover:bg-gray-700 text-gray-300 hover:text-white transition text-center"
                      >
                        {t('common.view', { defaultValue: 'View' })}
                      </Link>
                      {isAccepted && (
                        <Link
                          to={`/jobs/${bid.job_id}`}
                          className="text-xs font-semibold px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white transition text-center"
                        >
                          {t('myBids.viewJob', { defaultValue: 'View Job' })}
                        </Link>
                      )}
                      {isPending && jobStillOpen && (
                        <span className="text-[10px] text-yellow-500/70 text-center px-1">
                          {t('myBids.awaitingResponse', { defaultValue: 'Awaiting response' })}
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </main>
      <Footer />
    </div>
  );
}
