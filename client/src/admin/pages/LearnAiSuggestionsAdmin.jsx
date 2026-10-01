/**
 * LearnAiSuggestionsAdmin.jsx
 * Admin review queue for AI-generated marketplace suggestions (tools,
 * materials, services) before they appear on Learn guides.
 * Route: /admin/learn/ai-suggestions
 */

import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Sparkles, CheckCircle, XCircle, Clock, ChevronDown, ChevronUp,
  RefreshCw, Filter, ExternalLink, Wrench, Package, Briefcase,
} from 'lucide-react';
import adminApi from '../../lib/adminApi';
import { useAbortableFetch } from '../lib/useAbortableFetch';
import AdminErrorState from '../lib/AdminErrorState';

// ── Constants ──────────────────────────────────────────────────────────────────

const STATUS_OPTIONS = ['pending', 'approved', 'rejected', 'all'];

const STATUS_COLORS = {
  pending:  { bg: 'bg-yellow-100 text-yellow-800', dark: 'dark:bg-yellow-900/30 dark:text-yellow-300' },
  approved: { bg: 'bg-green-100  text-green-800',  dark: 'dark:bg-green-900/30  dark:text-green-300'  },
  rejected: { bg: 'bg-red-100    text-red-800',    dark: 'dark:bg-red-900/30    dark:text-red-300'    },
};

const KIND_ICONS = {
  tool:     Wrench,
  material: Package,
  service:  Briefcase,
};

const KIND_COLORS = {
  tool:     'bg-sky-100 text-sky-800 dark:bg-sky-900/30 dark:text-sky-300',
  material: 'bg-violet-100 text-violet-800 dark:bg-violet-900/30 dark:text-violet-300',
  service:  'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-300',
};

// ── Helper components ──────────────────────────────────────────────────────────

function StatusBadge({ status }) {
  const { t } = useTranslation();
  const c = STATUS_COLORS[status] ?? STATUS_COLORS.pending;
  const label =
    status === 'pending'  ? t('adminLearnAi.statusPending',  { defaultValue: 'Pending' }) :
    status === 'approved' ? t('adminLearnAi.statusApproved', { defaultValue: 'Approved' }) :
    status === 'rejected' ? t('adminLearnAi.statusRejected', { defaultValue: 'Rejected' }) :
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

function KindBadge({ kind }) {
  const { t } = useTranslation();
  const Icon = KIND_ICONS[kind] ?? Sparkles;
  const label =
    kind === 'tool'     ? t('adminLearnAi.kindTool',     { defaultValue: 'Tool' }) :
    kind === 'material' ? t('adminLearnAi.kindMaterial', { defaultValue: 'Material' }) :
    kind === 'service'  ? t('adminLearnAi.kindService',  { defaultValue: 'Service' }) :
    kind;
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-700 ${KIND_COLORS[kind] ?? 'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300'}`}>
      <Icon size={11} />
      {label}
    </span>
  );
}

function ExpandedSuggestion({ suggestion, onReview }) {
  const { t } = useTranslation();
  const [loading, setLoading]   = useState(false);
  const [localErr, setLocalErr] = useState('');

  const submit = async (action) => {
    setLoading(true);
    setLocalErr('');
    try {
      await onReview(suggestion.id, action);
    } catch {
      setLocalErr(t('adminLearnAi.actionFailed', { defaultValue: "That didn't work. Please try again." }));
    } finally {
      setLoading(false);
    }
  };

  const confidencePct = typeof suggestion.confidence === 'number'
    ? Math.round(suggestion.confidence * 100)
    : null;

  return (
    <div className="border-t border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900/40 px-5 py-4 space-y-4">

      {/* Why this fits */}
      {suggestion.detail && (
        <div>
          <p className="text-xs font-700 uppercase tracking-wide text-gray-500 dark:text-gray-400 mb-1">
            {t('adminLearnAi.detailLabel', { defaultValue: 'Why this fits' })}
          </p>
          <p className="text-sm text-gray-700 dark:text-gray-300 leading-relaxed">{suggestion.detail}</p>
        </div>
      )}

      {/* Meta row */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
        <div>
          <p className="text-xs font-700 uppercase tracking-wide text-gray-500 dark:text-gray-400 mb-0.5">
            {t('adminLearnAi.confidenceLabel', { defaultValue: 'Confidence' })}
          </p>
          <p className="font-700 text-gray-800 dark:text-gray-200">
            {confidencePct !== null ? `${confidencePct}%` : '—'}
          </p>
        </div>
        <div>
          <p className="text-xs font-700 uppercase tracking-wide text-gray-500 dark:text-gray-400 mb-0.5">
            {t('adminLearnAi.matchedRental', { defaultValue: 'Matched rental' })}
          </p>
          <p className="font-600 text-gray-800 dark:text-gray-200">{suggestion.matched_rental_slug ?? '—'}</p>
        </div>
        <div>
          <p className="text-xs font-700 uppercase tracking-wide text-gray-500 dark:text-gray-400 mb-0.5">
            {t('adminLearnAi.matchedDirect', { defaultValue: 'Matched Direct service' })}
          </p>
          <p className="font-600 text-gray-800 dark:text-gray-200">{suggestion.matched_direct_category ?? '—'}</p>
        </div>
        <div>
          <p className="text-xs font-700 uppercase tracking-wide text-gray-500 dark:text-gray-400 mb-0.5">
            {t('adminLearnAi.suggestedLabel', { defaultValue: 'Suggested on' })}
          </p>
          <p className="font-600 text-gray-800 dark:text-gray-200">
            {suggestion.created_at
              ? new Date(suggestion.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
              : '—'}
          </p>
        </div>
      </div>

      {/* Suggested URLs */}
      {(suggestion.suggested_rent_url || suggestion.suggested_buy_url) && (
        <div className="space-y-1.5">
          {suggestion.suggested_rent_url && (
            <div className="flex items-center gap-2 text-sm">
              <span className="text-xs font-700 uppercase tracking-wide text-gray-500 dark:text-gray-400 w-28">
                {t('adminLearnAi.suggestedRent', { defaultValue: 'Rent link' })}
              </span>
              <a href={suggestion.suggested_rent_url} target="_blank" rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-sky-600 dark:text-sky-400 hover:underline break-all">
                {suggestion.suggested_rent_url.slice(0, 60)}{suggestion.suggested_rent_url.length > 60 ? '…' : ''}
                <ExternalLink size={12} className="flex-shrink-0" />
              </a>
            </div>
          )}
          {suggestion.suggested_buy_url && (
            <div className="flex items-center gap-2 text-sm">
              <span className="text-xs font-700 uppercase tracking-wide text-gray-500 dark:text-gray-400 w-28">
                {t('adminLearnAi.suggestedBuy', { defaultValue: 'Buy link' })}
              </span>
              <a href={suggestion.suggested_buy_url} target="_blank" rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-orange-600 dark:text-orange-400 hover:underline break-all">
                {suggestion.suggested_buy_url.slice(0, 60)}{suggestion.suggested_buy_url.length > 60 ? '…' : ''}
                <ExternalLink size={12} className="flex-shrink-0" />
              </a>
            </div>
          )}
        </div>
      )}

      {/* Review actions (only when pending) */}
      {suggestion.status === 'pending' && (
        <div className="border-t border-gray-200 dark:border-gray-700 pt-4">
          {localErr && (
            <p className="text-sm text-red-600 dark:text-red-400 font-600 mb-3">{localErr}</p>
          )}
          <div className="flex items-center gap-2">
            <button
              disabled={loading}
              onClick={() => submit('approve')}
              className="inline-flex items-center gap-1.5 px-4 py-1.5 rounded-lg bg-green-600
                hover:bg-green-700 text-white text-sm font-700 transition-colors disabled:opacity-50">
              <CheckCircle size={14} />
              {loading
                ? t('adminLearnAi.saving', { defaultValue: 'Saving…' })
                : t('adminLearnAi.approve', { defaultValue: 'Approve' })}
            </button>
            <button
              disabled={loading}
              onClick={() => submit('reject')}
              className="inline-flex items-center gap-1.5 px-4 py-1.5 rounded-lg bg-red-600
                hover:bg-red-700 text-white text-sm font-700 transition-colors disabled:opacity-50">
              <XCircle size={14} />
              {loading
                ? t('adminLearnAi.saving', { defaultValue: 'Saving…' })
                : t('adminLearnAi.reject', { defaultValue: 'Reject' })}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Main page ──────────────────────────────────────────────────────────────────

export default function LearnAiSuggestionsAdmin() {
  const { t } = useTranslation();
  const [suggestions, setSuggestions] = useState([]);
  const [total,       setTotal]       = useState(0);
  const [status,      setStatus]      = useState('pending');
  const [guideFilter, setGuideFilter] = useState('all');
  const [expanded,    setExpanded]   = useState(null);   // suggestion id
  const [guides,      setGuides]     = useState([]);

  // Analyze-with-AI state
  const [analyzeGuideId, setAnalyzeGuideId] = useState('');
  const [analyzing,      setAnalyzing]      = useState(false);
  const [analyzeResult,  setAnalyzeResult]  = useState('');
  const [analyzeError,   setAnalyzeError]   = useState('');

  const statusLabels = {
    pending:  t('adminLearnAi.statusPending',  { defaultValue: 'Pending' }),
    approved: t('adminLearnAi.statusApproved', { defaultValue: 'Approved' }),
    rejected: t('adminLearnAi.statusRejected', { defaultValue: 'Rejected' }),
    all:      t('adminLearnAi.statusAll',      { defaultValue: 'All' }),
  };

  // Guide list for the analyzer dropdown and the guide filter.
  const { data: guidesData } = useAbortableFetch(async (signal) => {
    const { data } = await adminApi.get('/learn/admin/guides', { signal });
    return { guides: data.guides ?? [] };
  }, []);

  useEffect(() => {
    if (guidesData) setGuides(guidesData.guides);
  }, [guidesData]);

  // Suggestions load.
  const { data: suggestionsData, error, loading, reload } = useAbortableFetch(async (signal) => {
    const params = { status };
    if (guideFilter !== 'all') params.guide_id = guideFilter;
    const { data } = await adminApi.get('/learn/admin/ai-suggestions', { params, signal });
    return { suggestions: data.suggestions ?? [], total: data.total ?? (data.suggestions ?? []).length };
  }, [status, guideFilter]);

  useEffect(() => {
    if (suggestionsData) {
      setSuggestions(suggestionsData.suggestions);
      setTotal(suggestionsData.total);
    }
  }, [suggestionsData]);

  const handleReview = async (id, action) => {
    await adminApi.post(`/learn/admin/ai-suggestions/${id}/${action}`);
    reload();
    setExpanded(null);
  };

  const handleAnalyze = async () => {
    if (!analyzeGuideId || analyzing) return;
    setAnalyzing(true);
    setAnalyzeResult('');
    setAnalyzeError('');
    try {
      const { data } = await adminApi.post(`/learn/admin/guides/${analyzeGuideId}/tag`);
      setAnalyzeResult(t('adminLearnAi.analyzeResult', {
        defaultValue: 'Created {{created}} new suggestions ({{skipped}} already existed).',
        created: data.created ?? 0,
        skipped: data.skipped ?? 0,
      }));
      reload();
    } catch {
      setAnalyzeError(t('adminLearnAi.analyzeFailed', { defaultValue: 'Analysis failed. Please try again.' }));
    } finally {
      setAnalyzing(false);
    }
  };

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-6">

      {/* Header */}
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-900 text-gray-900 dark:text-white flex items-center gap-2">
            <Sparkles size={22} className="text-orange-500" />
            {t('adminLearnAi.title', { defaultValue: 'AI Suggestions' })}
          </h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">
            {t('adminLearnAi.description', {
              defaultValue: 'Review AI-generated tool, material, and service suggestions before they appear on Learn guides.',
            })}
          </p>
        </div>

        <button
          onClick={reload}
          disabled={loading}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-gray-300
            dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-600 dark:text-gray-400
            text-sm font-600 hover:bg-gray-50 dark:hover:bg-gray-750 transition-colors disabled:opacity-50">
          <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
          {t('common.refresh')}
        </button>
      </div>

      {/* Analyze with AI */}
      <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 p-5 space-y-4">
        <div>
          <h2 className="text-sm font-800 text-gray-900 dark:text-white flex items-center gap-1.5">
            <Sparkles size={14} className="text-orange-500" />
            {t('adminLearnAi.analyzeTitle', { defaultValue: 'Analyze a guide with AI' })}
          </h2>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">
            {t('adminLearnAi.analyzeDescription', {
              defaultValue: 'Pick a guide and let the AI suggest tools, materials, and matching services.',
            })}
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <label htmlFor="ai-guide-select" className="sr-only">
            {t('adminLearnAi.guideLabel', { defaultValue: 'Guide' })}
          </label>
          <select
            id="ai-guide-select"
            value={analyzeGuideId}
            onChange={(e) => setAnalyzeGuideId(e.target.value)}
            className="flex-1 min-w-[200px] px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600
              bg-white dark:bg-gray-800 text-gray-800 dark:text-gray-200 text-sm
              focus:outline-none focus:border-orange-500">
            <option value="">
              {t('adminLearnAi.guidePlaceholder', { defaultValue: 'Select a guide…' })}
            </option>
            {guides.map((g) => (
              <option key={g.id} value={g.id}>{g.title}</option>
            ))}
          </select>
          <button
            onClick={handleAnalyze}
            disabled={!analyzeGuideId || analyzing}
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-orange-500
              hover:bg-orange-600 text-white text-sm font-700 transition-colors disabled:opacity-50">
            <Sparkles size={14} className={analyzing ? 'animate-pulse' : ''} />
            {analyzing
              ? t('adminLearnAi.analyzing', { defaultValue: 'Analyzing…' })
              : t('adminLearnAi.analyzeButton', { defaultValue: 'Analyze with AI' })}
          </button>
        </div>
        {analyzeResult && (
          <p className="text-sm text-green-700 dark:text-green-400 font-600">{analyzeResult}</p>
        )}
        {analyzeError && (
          <p className="text-sm text-red-600 dark:text-red-400 font-600">{analyzeError}</p>
        )}
      </div>

      {/* Filter bar */}
      <div className="flex items-center gap-2 flex-wrap">
        <Filter size={14} className="text-gray-400" />
        {STATUS_OPTIONS.map((s) => (
          <button
            key={s}
            onClick={() => { setStatus(s); setExpanded(null); }}
            className={`px-3 py-1 rounded-full text-xs font-700 capitalize transition-colors ${
              status === s
                ? 'bg-orange-500 text-white'
                : 'bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-700'
            }`}>
            {statusLabels[s] ?? s}
          </button>
        ))}
        <select
          value={guideFilter}
          onChange={(e) => { setGuideFilter(e.target.value); setExpanded(null); }}
          aria-label={t('adminLearnAi.filterGuide', { defaultValue: 'Filter by guide' })}
          className="ml-2 px-2.5 py-1 rounded-full text-xs font-700 bg-gray-100 dark:bg-gray-800
            text-gray-600 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-700
            border-0 focus:outline-none focus:ring-1 focus:ring-orange-500 max-w-[220px]">
          <option value="all">{t('adminLearnAi.allGuides', { defaultValue: 'All guides' })}</option>
          {guides.map((g) => (
            <option key={g.id} value={g.id}>{g.title}</option>
          ))}
        </select>
        <span className="ml-auto text-xs text-gray-400">
          {t('adminLearnAi.totalCount', { defaultValue: '{{count}} suggestions', count: total })}
        </span>
      </div>

      {/* Error */}
      {error && (
        <div className="rounded-lg">
          <AdminErrorState onRetry={reload} />
        </div>
      )}

      {/* Suggestions list */}
      {loading && suggestions.length === 0 ? (
        <div className="flex items-center justify-center py-12 text-gray-400">
          <RefreshCw size={18} className="animate-spin mr-2" />
          {t('adminLearnAi.loading', { defaultValue: 'Loading suggestions…' })}
        </div>
      ) : !error && suggestions.length === 0 ? (
        <div className="text-center py-14 text-gray-400">
          <Sparkles size={36} className="mx-auto mb-3 opacity-40" />
          <p className="font-600">
            {status === 'all'
              ? t('adminLearnAi.emptyAll', { defaultValue: 'No suggestions yet.' })
              : t('adminLearnAi.emptyFiltered', {
                  defaultValue: 'No {{status}} suggestions.',
                  status: (statusLabels[status] ?? status).toLowerCase(),
                })}
          </p>
          <p className="text-sm mt-1">
            {t('adminLearnAi.emptyHint', { defaultValue: 'Analyze a guide above to generate some.' })}
          </p>
        </div>
      ) : suggestions.length > 0 ? (
        <div className="rounded-xl border border-gray-200 dark:border-gray-700 overflow-hidden">
          {/* Table header */}
          <div className="grid grid-cols-[2fr_1fr_1fr_1fr_auto] gap-x-4 px-5 py-2.5
            bg-gray-50 dark:bg-gray-800/50 border-b border-gray-200 dark:border-gray-700
            text-xs font-700 uppercase tracking-wide text-gray-500 dark:text-gray-400">
            <span>{t('adminLearnAi.colName', { defaultValue: 'Suggestion' })}</span>
            <span>{t('adminLearnAi.colKind', { defaultValue: 'Type' })}</span>
            <span>{t('adminLearnAi.colConfidence', { defaultValue: 'Confidence' })}</span>
            <span>{t('adminLearnAi.colStatus', { defaultValue: 'Status' })}</span>
            <span />
          </div>

          {/* Rows */}
          {suggestions.map((sug) => {
            const isOpen = expanded === sug.id;
            const confidencePct = typeof sug.confidence === 'number'
              ? `${Math.round(sug.confidence * 100)}%`
              : '—';
            return (
              <div key={sug.id} className="border-b border-gray-200 dark:border-gray-700 last:border-0">
                <button
                  onClick={() => setExpanded(isOpen ? null : sug.id)}
                  aria-expanded={isOpen}
                  aria-controls={`suggestion-detail-${sug.id}`}
                  className="w-full grid grid-cols-[2fr_1fr_1fr_1fr_auto] gap-x-4 items-center
                    px-5 py-3.5 text-left bg-white dark:bg-gray-900 hover:bg-gray-50
                    dark:hover:bg-gray-800/60 transition-colors">

                  {/* Name + guide */}
                  <div className="min-w-0">
                    <p className="text-sm font-700 text-gray-900 dark:text-white truncate">{sug.name}</p>
                    <p className="text-xs text-gray-500 dark:text-gray-400 truncate">
                      {sug.guide_title ?? sug.guide_id}
                    </p>
                  </div>

                  {/* Kind */}
                  <span><KindBadge kind={sug.kind} /></span>

                  {/* Confidence */}
                  <span className="text-sm font-700 text-gray-700 dark:text-gray-300">{confidencePct}</span>

                  {/* Status */}
                  <StatusBadge status={sug.status} />

                  {/* Chevron */}
                  <span className="text-gray-400">
                    {isOpen ? <ChevronUp size={15} /> : <ChevronDown size={15} />}
                  </span>
                </button>

                {/* Expanded detail */}
                {isOpen && (
                  <div id={`suggestion-detail-${sug.id}`}>
                    <ExpandedSuggestion suggestion={sug} onReview={handleReview} />
                  </div>
                )}
              </div>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
