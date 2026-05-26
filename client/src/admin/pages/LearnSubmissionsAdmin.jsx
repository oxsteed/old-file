/**
 * LearnSubmissionsAdmin.jsx
 * Admin review queue for user-generated guide submissions.
 * Route: /admin/learn/submissions
 */

import { useState, useEffect, useCallback } from 'react';
import {
  BookOpen, CheckCircle, XCircle, Clock, ChevronDown, ChevronUp,
  RefreshCw, Filter, ExternalLink, MessageSquare,
} from 'lucide-react';
import api from '../../api/axios';

// ── Constants ──────────────────────────────────────────────────────────────────

const STATUS_OPTIONS = ['pending', 'approved', 'rejected', 'all'];

const STATUS_COLORS = {
  pending:  { bg: 'bg-yellow-100 text-yellow-800', dark: 'dark:bg-yellow-900/30 dark:text-yellow-300' },
  approved: { bg: 'bg-green-100  text-green-800',  dark: 'dark:bg-green-900/30  dark:text-green-300'  },
  rejected: { bg: 'bg-red-100    text-red-800',    dark: 'dark:bg-red-900/30    dark:text-red-300'    },
};

const DIFFICULTY_COLORS = {
  Easy:   'text-green-600  dark:text-green-400',
  Medium: 'text-yellow-600 dark:text-yellow-400',
  Hard:   'text-red-600    dark:text-red-400',
};

const CATEGORY_LABELS = {
  plumbing:    'Plumbing',
  electrical:  'Electrical',
  carpentry:   'Carpentry',
  hvac:        'HVAC',
  painting:    'Painting',
  'car-care':  'Car Care',
  landscaping: 'Landscaping',
  maintenance: 'Maintenance',
};

// ── Helper components ──────────────────────────────────────────────────────────

function StatusBadge({ status }) {
  const c = STATUS_COLORS[status] ?? STATUS_COLORS.pending;
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-700 ${c.bg} ${c.dark}`}>
      {status === 'pending'  && <Clock      size={11} />}
      {status === 'approved' && <CheckCircle size={11} />}
      {status === 'rejected' && <XCircle    size={11} />}
      {status.charAt(0).toUpperCase() + status.slice(1)}
    </span>
  );
}

function ExpandedSubmission({ sub, onReview }) {
  const [note, setNote]         = useState('');
  const [loading, setLoading]   = useState(false);
  const [localErr, setLocalErr] = useState('');

  const submit = async (action) => {
    setLoading(true);
    setLocalErr('');
    try {
      await onReview(sub.id, action, note.trim() || undefined);
    } catch (e) {
      setLocalErr(e?.response?.data?.message ?? 'Action failed. Try again.');
    } finally {
      setLoading(false);
    }
  };

  const steps  = Array.isArray(sub.steps)  ? sub.steps  : JSON.parse(sub.steps  ?? '[]');
  const skills = Array.isArray(sub.skills) ? sub.skills : JSON.parse(sub.skills ?? '[]');
  const tools  = Array.isArray(sub.tools)  ? sub.tools  : JSON.parse(sub.tools  ?? 'null') ?? [];

  return (
    <div className="border-t border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900/40 px-5 py-4 space-y-4">

      {/* Meta row */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
        <div>
          <p className="text-xs font-700 uppercase tracking-wide text-gray-500 dark:text-gray-400 mb-0.5">Category</p>
          <p className="font-600 text-gray-800 dark:text-gray-200">{CATEGORY_LABELS[sub.category] ?? sub.category}</p>
        </div>
        <div>
          <p className="text-xs font-700 uppercase tracking-wide text-gray-500 dark:text-gray-400 mb-0.5">Difficulty</p>
          <p className={`font-700 ${DIFFICULTY_COLORS[sub.difficulty] ?? ''}`}>{sub.difficulty}</p>
        </div>
        <div>
          <p className="text-xs font-700 uppercase tracking-wide text-gray-500 dark:text-gray-400 mb-0.5">Est. time</p>
          <p className="font-600 text-gray-800 dark:text-gray-200">{sub.estimated_minutes} min</p>
        </div>
        <div>
          <p className="text-xs font-700 uppercase tracking-wide text-gray-500 dark:text-gray-400 mb-0.5">Submitted</p>
          <p className="font-600 text-gray-800 dark:text-gray-200">
            {new Date(sub.submitted_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
          </p>
        </div>
      </div>

      {/* Intro */}
      <div>
        <p className="text-xs font-700 uppercase tracking-wide text-gray-500 dark:text-gray-400 mb-1">Intro</p>
        <p className="text-sm text-gray-700 dark:text-gray-300 leading-relaxed">{sub.intro}</p>
      </div>

      {/* Steps */}
      <div>
        <p className="text-xs font-700 uppercase tracking-wide text-gray-500 dark:text-gray-400 mb-2">
          Steps ({steps.length})
        </p>
        <ol className="space-y-1.5">
          {steps.map((s, i) => (
            <li key={i} className="flex items-start gap-2 text-sm text-gray-700 dark:text-gray-300">
              <span className="flex-shrink-0 w-5 h-5 rounded bg-orange-100 dark:bg-orange-900/30 text-orange-600 dark:text-orange-400 text-xs font-800 flex items-center justify-center mt-0.5">
                {i + 1}
              </span>
              {s}
            </li>
          ))}
        </ol>
      </div>

      {/* Skills */}
      <div>
        <p className="text-xs font-700 uppercase tracking-wide text-gray-500 dark:text-gray-400 mb-2">Skills</p>
        <div className="flex flex-wrap gap-1.5">
          {skills.map((sk, i) => (
            <span key={i} className="px-2 py-0.5 rounded-full bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300 text-xs font-600">
              {sk}
            </span>
          ))}
        </div>
      </div>

      {/* Tools (if any) */}
      {tools.length > 0 && (
        <div>
          <p className="text-xs font-700 uppercase tracking-wide text-gray-500 dark:text-gray-400 mb-2">Tools</p>
          <div className="space-y-1">
            {tools.map((t, i) => (
              <div key={i} className="flex items-center gap-2 text-sm">
                <span className="text-gray-700 dark:text-gray-300 flex-1">{t.name}</span>
                {t.buy_url && (
                  <a href={t.buy_url} target="_blank" rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 text-xs font-700 text-orange-600 dark:text-orange-400 hover:underline">
                    Buy <ExternalLink size={10} />
                  </a>
                )}
                {t.rent_url && (
                  <a href={t.rent_url} target="_blank" rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 text-xs font-700 text-sky-600 dark:text-sky-400 hover:underline">
                    Rent <ExternalLink size={10} />
                  </a>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Video */}
      {sub.video_url && (
        <div>
          <p className="text-xs font-700 uppercase tracking-wide text-gray-500 dark:text-gray-400 mb-1">Video</p>
          <a href={sub.video_url} target="_blank" rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-sm text-blue-600 dark:text-blue-400 hover:underline">
            {sub.video_url.slice(0, 60)}{sub.video_url.length > 60 ? '…' : ''}
            <ExternalLink size={12} />
          </a>
        </div>
      )}

      {/* License note */}
      {sub.license_note && (
        <div>
          <p className="text-xs font-700 uppercase tracking-wide text-gray-500 dark:text-gray-400 mb-1">License Note</p>
          <p className="text-sm text-yellow-800 dark:text-yellow-300 bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-700 rounded-lg px-3 py-2">
            {sub.license_note}
          </p>
        </div>
      )}

      {/* Existing reviewer note */}
      {sub.reviewer_note && (
        <div>
          <p className="text-xs font-700 uppercase tracking-wide text-gray-500 dark:text-gray-400 mb-1">Prior Reviewer Note</p>
          <p className="text-sm text-gray-600 dark:text-gray-400 italic">{sub.reviewer_note}</p>
        </div>
      )}

      {/* Review actions (only when pending) */}
      {sub.status === 'pending' && (
        <div className="border-t border-gray-200 dark:border-gray-700 pt-4 space-y-3">
          <p className="text-xs font-700 uppercase tracking-wide text-gray-500 dark:text-gray-400 flex items-center gap-1">
            <MessageSquare size={12} /> Review Note (optional)
          </p>
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            rows={2}
            placeholder="Feedback for the submitter…"
            className="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600
              bg-white dark:bg-gray-800 text-gray-800 dark:text-gray-200
              text-sm resize-none focus:outline-none focus:border-orange-500"
          />
          {localErr && (
            <p className="text-sm text-red-600 dark:text-red-400 font-600">{localErr}</p>
          )}
          <div className="flex items-center gap-2">
            <button
              disabled={loading}
              onClick={() => submit('approve')}
              className="inline-flex items-center gap-1.5 px-4 py-1.5 rounded-lg bg-green-600
                hover:bg-green-700 text-white text-sm font-700 transition-colors disabled:opacity-50">
              <CheckCircle size={14} />
              {loading ? 'Saving…' : 'Approve'}
            </button>
            <button
              disabled={loading}
              onClick={() => submit('reject')}
              className="inline-flex items-center gap-1.5 px-4 py-1.5 rounded-lg bg-red-600
                hover:bg-red-700 text-white text-sm font-700 transition-colors disabled:opacity-50">
              <XCircle size={14} />
              {loading ? 'Saving…' : 'Reject'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Main page ──────────────────────────────────────────────────────────────────

export default function LearnSubmissionsAdmin() {
  const [submissions, setSubmissions] = useState([]);
  const [total,       setTotal]       = useState(0);
  const [status,      setStatus]      = useState('pending');
  const [loading,     setLoading]     = useState(false);
  const [error,       setError]       = useState('');
  const [expanded,    setExpanded]    = useState(null);   // submission id
  const [page,        setPage]        = useState(0);

  const PAGE_SIZE = 25;

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const { data } = await api.get('/api/learn/admin/submissions', {
        params: { status, limit: PAGE_SIZE, offset: page * PAGE_SIZE },
      });
      setSubmissions(data.submissions ?? []);
      setTotal(data.total ?? 0);
    } catch (e) {
      setError(e?.response?.data?.message ?? 'Failed to load submissions.');
    } finally {
      setLoading(false);
    }
  }, [status, page]);

  useEffect(() => { load(); }, [load]);

  const handleReview = async (id, action, reviewer_note) => {
    await api.patch(`/api/learn/admin/submissions/${id}`, { action, reviewer_note });
    // Refresh to reflect new status
    load();
    setExpanded(null);
  };

  const totalPages = Math.ceil(total / PAGE_SIZE);

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-6">

      {/* Header */}
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-900 text-gray-900 dark:text-white flex items-center gap-2">
            <BookOpen size={22} className="text-orange-500" />
            Learn Guide Submissions
          </h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">
            Review user-submitted guides before publishing to Learn Mode.
          </p>
        </div>

        <button
          onClick={load}
          disabled={loading}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-gray-300
            dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-600 dark:text-gray-400
            text-sm font-600 hover:bg-gray-50 dark:hover:bg-gray-750 transition-colors disabled:opacity-50">
          <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
          Refresh
        </button>
      </div>

      {/* Filter bar */}
      <div className="flex items-center gap-2 flex-wrap">
        <Filter size={14} className="text-gray-400" />
        {STATUS_OPTIONS.map((s) => (
          <button
            key={s}
            onClick={() => { setStatus(s); setPage(0); setExpanded(null); }}
            className={`px-3 py-1 rounded-full text-xs font-700 capitalize transition-colors ${
              status === s
                ? 'bg-orange-500 text-white'
                : 'bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-700'
            }`}>
            {s}
            {s === 'pending' && total > 0 && status !== 'pending' && (
              <span className="ml-1 opacity-70">·</span>
            )}
          </button>
        ))}
        <span className="ml-auto text-xs text-gray-400">
          {total} {total === 1 ? 'submission' : 'submissions'}
        </span>
      </div>

      {/* Error */}
      {error && (
        <div className="rounded-lg bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800
          px-4 py-3 text-sm text-red-700 dark:text-red-300 font-600">
          {error}
        </div>
      )}

      {/* Submissions list */}
      {loading && submissions.length === 0 ? (
        <div className="flex items-center justify-center py-12 text-gray-400">
          <RefreshCw size={18} className="animate-spin mr-2" />
          Loading…
        </div>
      ) : submissions.length === 0 ? (
        <div className="text-center py-14 text-gray-400">
          <BookOpen size={36} className="mx-auto mb-3 opacity-40" />
          <p className="font-600">No {status === 'all' ? '' : status} submissions</p>
          <p className="text-sm mt-1">Check back later or change the filter.</p>
        </div>
      ) : (
        <div className="rounded-xl border border-gray-200 dark:border-gray-700 overflow-hidden">
          {/* Table header */}
          <div className="grid grid-cols-[2fr_1fr_1fr_1fr_auto] gap-x-4 px-5 py-2.5
            bg-gray-50 dark:bg-gray-800/50 border-b border-gray-200 dark:border-gray-700
            text-xs font-700 uppercase tracking-wide text-gray-500 dark:text-gray-400">
            <span>Title / Submitter</span>
            <span>Category</span>
            <span>Difficulty</span>
            <span>Status</span>
            <span />
          </div>

          {/* Rows */}
          {submissions.map((sub) => {
            const isOpen = expanded === sub.id;
            return (
              <div key={sub.id} className="border-b border-gray-200 dark:border-gray-700 last:border-0">
                <button
                  onClick={() => setExpanded(isOpen ? null : sub.id)}
                  className="w-full grid grid-cols-[2fr_1fr_1fr_1fr_auto] gap-x-4 items-center
                    px-5 py-3.5 text-left bg-white dark:bg-gray-900 hover:bg-gray-50
                    dark:hover:bg-gray-800/60 transition-colors">

                  {/* Title + submitter */}
                  <div className="min-w-0">
                    <p className="text-sm font-700 text-gray-900 dark:text-white truncate">{sub.title}</p>
                    <p className="text-xs text-gray-500 dark:text-gray-400 truncate">
                      {sub.submitter_name ?? 'Unknown'} · {sub.submitter_email ?? ''}
                    </p>
                  </div>

                  {/* Category */}
                  <span className="text-sm text-gray-700 dark:text-gray-300 capitalize">
                    {CATEGORY_LABELS[sub.category] ?? sub.category}
                  </span>

                  {/* Difficulty */}
                  <span className={`text-sm font-700 ${DIFFICULTY_COLORS[sub.difficulty] ?? ''}`}>
                    {sub.difficulty}
                  </span>

                  {/* Status */}
                  <StatusBadge status={sub.status} />

                  {/* Chevron */}
                  <span className="text-gray-400">
                    {isOpen ? <ChevronUp size={15} /> : <ChevronDown size={15} />}
                  </span>
                </button>

                {/* Expanded detail */}
                {isOpen && (
                  <ExpandedSubmission sub={sub} onReview={handleReview} />
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-2">
          <button
            disabled={page === 0}
            onClick={() => setPage((p) => p - 1)}
            className="px-3 py-1 rounded-lg border border-gray-300 dark:border-gray-600
              text-sm font-600 text-gray-600 dark:text-gray-400 disabled:opacity-40
              hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors">
            ← Prev
          </button>
          <span className="text-sm text-gray-500 dark:text-gray-400">
            Page {page + 1} of {totalPages}
          </span>
          <button
            disabled={page >= totalPages - 1}
            onClick={() => setPage((p) => p + 1)}
            className="px-3 py-1 rounded-lg border border-gray-300 dark:border-gray-600
              text-sm font-600 text-gray-600 dark:text-gray-400 disabled:opacity-40
              hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors">
            Next →
          </button>
        </div>
      )}
    </div>
  );
}
