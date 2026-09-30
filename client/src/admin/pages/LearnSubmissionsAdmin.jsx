/**
 * LearnSubmissionsAdmin.jsx
 * Admin review queue for user-generated guide submissions.
 * Route: /admin/learn/submissions
 */

import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import {
  BookOpen, CheckCircle, XCircle, Clock, ChevronDown, ChevronUp,
  RefreshCw, Filter, ExternalLink, MessageSquare,
} from 'lucide-react';
import adminApi from '../../lib/adminApi';
import { useAbortableFetch } from '../lib/useAbortableFetch';
import AdminErrorState from '../lib/AdminErrorState';

/** Parse a value that may be an array, a JSON-encoded array string, or garbage. */
function safeList(value) {
  if (Array.isArray(value)) return value;
  if (typeof value !== 'string' || !value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

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

const getCategoryLabels = (t) => ({
  plumbing:    t('adminLearnSubmissions.categoryPlumbing'),
  electrical:  t('adminLearnSubmissions.categoryElectrical'),
  carpentry:   t('adminLearnSubmissions.categoryCarpentry'),
  hvac:        t('adminLearnSubmissions.categoryHvac'),
  painting:    t('adminLearnSubmissions.categoryPainting'),
  'car-care':  t('adminLearnSubmissions.categoryCarCare'),
  landscaping: t('adminLearnSubmissions.categoryLandscaping'),
  maintenance: t('adminLearnSubmissions.categoryMaintenance'),
});

// ── Helper components ──────────────────────────────────────────────────────────

function StatusBadge({ status }) {
  const { t } = useTranslation();
  const c = STATUS_COLORS[status] ?? STATUS_COLORS.pending;
  const label =
    status === 'pending' ? t('adminLearnSubmissions.statusPending') :
    status === 'approved' ? t('adminLearnSubmissions.statusApproved') :
    status === 'rejected' ? t('adminLearnSubmissions.statusRejected') :
    status.charAt(0).toUpperCase() + status.slice(1);
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-700 ${c.bg} ${c.dark}`}>
      {status === 'pending'  && <Clock      size={11} />}
      {status === 'approved' && <CheckCircle size={11} />}
      {status === 'rejected' && <XCircle    size={11} />}
      {label}
    </span>
  );
}

function ExpandedSubmission({ sub, onReview }) {
  const { t } = useTranslation();
  const [note, setNote]         = useState('');
  const [loading, setLoading]   = useState(false);
  const [localErr, setLocalErr] = useState('');

  const submit = async (action) => {
    setLoading(true);
    setLocalErr('');
    try {
      await onReview(sub.id, action, note.trim() || undefined);
    } catch (e) {
      setLocalErr(e?.response?.data?.message ?? t('adminLearnSubmissions.actionFailed'));
    } finally {
      setLoading(false);
    }
  };

  const steps  = safeList(sub.steps);
  const skills = safeList(sub.skills);
  const tools  = safeList(sub.tools);
  const CATEGORY_LABELS = getCategoryLabels(t);
  const difficultyLabels = {
    Easy:   t('adminLearnSubmissions.difficultyEasy'),
    Medium: t('adminLearnSubmissions.difficultyMedium'),
    Hard:   t('adminLearnSubmissions.difficultyHard'),
  };

  return (
    <div className="border-t border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900/40 px-5 py-4 space-y-4">

      {/* Meta row */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
        <div>
          <p className="text-xs font-700 uppercase tracking-wide text-gray-500 dark:text-gray-400 mb-0.5">{t('adminLearnSubmissions.labelCategory')}</p>
          <p className="font-600 text-gray-800 dark:text-gray-200">{CATEGORY_LABELS[sub.category] ?? sub.category}</p>
        </div>
        <div>
          <p className="text-xs font-700 uppercase tracking-wide text-gray-500 dark:text-gray-400 mb-0.5">{t('adminLearnSubmissions.labelDifficulty')}</p>
          <p className={`font-700 ${DIFFICULTY_COLORS[sub.difficulty] ?? ''}`}>{difficultyLabels[sub.difficulty] ?? sub.difficulty}</p>
        </div>
        <div>
          <p className="text-xs font-700 uppercase tracking-wide text-gray-500 dark:text-gray-400 mb-0.5">{t('adminLearnSubmissions.labelEstTime')}</p>
          <p className="font-600 text-gray-800 dark:text-gray-200">{t('adminLearnSubmissions.estMinutes', { minutes: sub.estimated_minutes })}</p>
        </div>
        <div>
          <p className="text-xs font-700 uppercase tracking-wide text-gray-500 dark:text-gray-400 mb-0.5">{t('adminLearnSubmissions.labelSubmitted')}</p>
          <p className="font-600 text-gray-800 dark:text-gray-200">
            {new Date(sub.submitted_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
          </p>
        </div>
      </div>

      {/* Intro */}
      <div>
        <p className="text-xs font-700 uppercase tracking-wide text-gray-500 dark:text-gray-400 mb-1">{t('adminLearnSubmissions.labelIntro')}</p>
        <p className="text-sm text-gray-700 dark:text-gray-300 leading-relaxed">{sub.intro}</p>
      </div>

      {/* Steps */}
      <div>
        <p className="text-xs font-700 uppercase tracking-wide text-gray-500 dark:text-gray-400 mb-2">
          {t('adminLearnSubmissions.stepsCount', { count: steps.length })}
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
        <p className="text-xs font-700 uppercase tracking-wide text-gray-500 dark:text-gray-400 mb-2">{t('adminLearnSubmissions.labelSkills')}</p>
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
          <p className="text-xs font-700 uppercase tracking-wide text-gray-500 dark:text-gray-400 mb-2">{t('adminLearnSubmissions.labelTools')}</p>
          <div className="space-y-1">
            {tools.map((t, i) => (
              <div key={i} className="flex items-center gap-2 text-sm">
                <span className="text-gray-700 dark:text-gray-300 flex-1">{t.name}</span>
                {t.buy_url && (
                  <a href={t.buy_url} target="_blank" rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 text-xs font-700 text-orange-600 dark:text-orange-400 hover:underline">
                    {t('adminLearnSubmissions.buy')} <ExternalLink size={10} />
                  </a>
                )}
                {t.rent_url && (
                  <a href={t.rent_url} target="_blank" rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 text-xs font-700 text-sky-600 dark:text-sky-400 hover:underline">
                    {t('adminLearnSubmissions.rent')} <ExternalLink size={10} />
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
          <p className="text-xs font-700 uppercase tracking-wide text-gray-500 dark:text-gray-400 mb-1">{t('adminLearnSubmissions.labelVideo')}</p>
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
          <p className="text-xs font-700 uppercase tracking-wide text-gray-500 dark:text-gray-400 mb-1">{t('adminLearnSubmissions.labelLicenseNote')}</p>
          <p className="text-sm text-yellow-800 dark:text-yellow-300 bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-700 rounded-lg px-3 py-2">
            {sub.license_note}
          </p>
        </div>
      )}

      {/* Existing reviewer note */}
      {sub.reviewer_note && (
        <div>
          <p className="text-xs font-700 uppercase tracking-wide text-gray-500 dark:text-gray-400 mb-1">{t('adminLearnSubmissions.labelPriorReviewerNote')}</p>
          <p className="text-sm text-gray-600 dark:text-gray-400 italic">{sub.reviewer_note}</p>
        </div>
      )}

      {/* Review actions (only when pending) */}
      {sub.status === 'pending' && (
        <div className="border-t border-gray-200 dark:border-gray-700 pt-4 space-y-3">
          <p className="text-xs font-700 uppercase tracking-wide text-gray-500 dark:text-gray-400 flex items-center gap-1">
            <MessageSquare size={12} /> {t('adminLearnSubmissions.labelReviewNote')}
          </p>
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            rows={2}
            placeholder={t('adminLearnSubmissions.reviewNotePlaceholder')}
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
              {loading ? t('adminLearnSubmissions.saving') : t('adminLearnSubmissions.approve')}
            </button>
            <button
              disabled={loading}
              onClick={() => submit('reject')}
              className="inline-flex items-center gap-1.5 px-4 py-1.5 rounded-lg bg-red-600
                hover:bg-red-700 text-white text-sm font-700 transition-colors disabled:opacity-50">
              <XCircle size={14} />
              {loading ? t('adminLearnSubmissions.saving') : t('adminLearnSubmissions.reject')}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Main page ──────────────────────────────────────────────────────────────────

export default function LearnSubmissionsAdmin() {
  const { t } = useTranslation();
  const [submissions, setSubmissions] = useState([]);
  const [total,       setTotal]       = useState(0);
  const [status,      setStatus]      = useState('pending');
  const [expanded,    setExpanded]    = useState(null);   // submission id
  const [page,        setPage]        = useState(0);

  const PAGE_SIZE = 25;
  const CATEGORY_LABELS = getCategoryLabels(t);
  const difficultyLabels = {
    Easy:   t('adminLearnSubmissions.difficultyEasy'),
    Medium: t('adminLearnSubmissions.difficultyMedium'),
    Hard:   t('adminLearnSubmissions.difficultyHard'),
  };
  const statusLabels = {
    pending:  t('adminLearnSubmissions.statusPending'),
    approved: t('adminLearnSubmissions.statusApproved'),
    rejected: t('adminLearnSubmissions.statusRejected'),
    all:      t('adminLearnSubmissions.statusAll'),
  };

  // Abortable submissions load. A failed refetch keeps the previous list on
  // screen and surfaces a retryable error instead of clearing it.
  const { data: submissionsData, error, loading, reload } = useAbortableFetch(async (signal) => {
    const { data } = await adminApi.get('/learn/admin/submissions', {
      params: { status, limit: PAGE_SIZE, offset: page * PAGE_SIZE },
      signal,
    });
    return { submissions: data.submissions ?? [], total: data.total ?? 0 };
  }, [status, page]);

  useEffect(() => {
    if (submissionsData) {
      setSubmissions(submissionsData.submissions);
      setTotal(submissionsData.total);
    }
  }, [submissionsData]);

  const load = reload;

  const handleReview = async (id, action, reviewer_note) => {
    await adminApi.patch(`/learn/admin/submissions/${id}`, { action, reviewer_note });
    // Refresh to reflect new status
    reload();
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
            {t('adminLearnSubmissions.title')}
          </h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">
            {t('adminLearnSubmissions.description')}
          </p>
        </div>

        <button
          onClick={load}
          disabled={loading}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-gray-300
            dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-600 dark:text-gray-400
            text-sm font-600 hover:bg-gray-50 dark:hover:bg-gray-750 transition-colors disabled:opacity-50">
          <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
          {t('common.refresh')}
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
            {statusLabels[s] ?? s}
            {s === 'pending' && total > 0 && status !== 'pending' && (
              <span className="ml-1 opacity-70">·</span>
            )}
          </button>
        ))}
        <span className="ml-auto text-xs text-gray-400">
          {t('adminLearnSubmissions.totalCount', { count: total })}
        </span>
      </div>

      {/* Error */}
      {error && (
        <div className="rounded-lg">
          <AdminErrorState onRetry={reload} />
        </div>
      )}

      {/* Submissions list */}
      {loading && submissions.length === 0 ? (
        <div className="flex items-center justify-center py-12 text-gray-400">
          <RefreshCw size={18} className="animate-spin mr-2" />
          {t('adminLearnSubmissions.loading')}
        </div>
      ) : !error && submissions.length === 0 ? (
        <div className="text-center py-14 text-gray-400">
          <BookOpen size={36} className="mx-auto mb-3 opacity-40" />
          <p className="font-600">{status === 'all' ? t('adminLearnSubmissions.emptyAll') : t('adminLearnSubmissions.emptyFiltered', { status: statusLabels[status] ?? status })}</p>
          <p className="text-sm mt-1">{t('adminLearnSubmissions.emptyHint')}</p>
        </div>
      ) : submissions.length > 0 ? (
        <div className="rounded-xl border border-gray-200 dark:border-gray-700 overflow-hidden">
          {/* Table header */}
          <div className="grid grid-cols-[2fr_1fr_1fr_1fr_auto] gap-x-4 px-5 py-2.5
            bg-gray-50 dark:bg-gray-800/50 border-b border-gray-200 dark:border-gray-700
            text-xs font-700 uppercase tracking-wide text-gray-500 dark:text-gray-400">
            <span>{t('adminLearnSubmissions.colTitleSubmitter')}</span>
            <span>{t('adminLearnSubmissions.colCategory')}</span>
            <span>{t('adminLearnSubmissions.colDifficulty')}</span>
            <span>{t('adminLearnSubmissions.colStatus')}</span>
            <span />
          </div>

          {/* Rows */}
          {submissions.map((sub) => {
            const isOpen = expanded === sub.id;
            return (
              <div key={sub.id} className="border-b border-gray-200 dark:border-gray-700 last:border-0">
                <button
                  onClick={() => setExpanded(isOpen ? null : sub.id)}
                  aria-expanded={isOpen}
                  aria-controls={`submission-detail-${sub.id}`}
                  className="w-full grid grid-cols-[2fr_1fr_1fr_1fr_auto] gap-x-4 items-center
                    px-5 py-3.5 text-left bg-white dark:bg-gray-900 hover:bg-gray-50
                    dark:hover:bg-gray-800/60 transition-colors">

                  {/* Title + submitter */}
                  <div className="min-w-0">
                    <p className="text-sm font-700 text-gray-900 dark:text-white truncate">{sub.title}</p>
                    <p className="text-xs text-gray-500 dark:text-gray-400 truncate">
                      {sub.submitter_name ?? t('adminLearnSubmissions.unknownSubmitter')} · {sub.submitter_email ?? ''}
                    </p>
                  </div>

                  {/* Category */}
                  <span className="text-sm text-gray-700 dark:text-gray-300 capitalize">
                    {CATEGORY_LABELS[sub.category] ?? sub.category}
                  </span>

                  {/* Difficulty */}
                  <span className={`text-sm font-700 ${DIFFICULTY_COLORS[sub.difficulty] ?? ''}`}>
                    {difficultyLabels[sub.difficulty] ?? sub.difficulty}
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
                  <div id={`submission-detail-${sub.id}`}>
                    <ExpandedSubmission sub={sub} onReview={handleReview} />
                  </div>
                )}
              </div>
            );
          })}
        </div>
      ) : null}

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-2">
          <button
            disabled={page === 0}
            onClick={() => setPage((p) => p - 1)}
            className="px-3 py-1 rounded-lg border border-gray-300 dark:border-gray-600
              text-sm font-600 text-gray-600 dark:text-gray-400 disabled:opacity-40
              hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors">
            {t('adminLearnSubmissions.prev')}
          </button>
          <span className="text-sm text-gray-500 dark:text-gray-400">
            {t('adminLearnSubmissions.pageOf', { page: page + 1, pages: totalPages })}
          </span>
          <button
            disabled={page >= totalPages - 1}
            onClick={() => setPage((p) => p + 1)}
            className="px-3 py-1 rounded-lg border border-gray-300 dark:border-gray-600
              text-sm font-600 text-gray-600 dark:text-gray-400 disabled:opacity-40
              hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors">
            {t('adminLearnSubmissions.next')}
          </button>
        </div>
      )}
    </div>
  );
}
