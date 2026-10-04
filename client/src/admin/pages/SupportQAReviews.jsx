import { useCallback, useEffect, useState, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import adminApi from '../../lib/adminApi';
import toast from 'react-hot-toast';
import { CheckCircle2, ClipboardCheck, RefreshCw } from 'lucide-react';
import {
  SupportEmptyState,
  SupportPageShell,
  SupportPanel,
  SupportTag,
} from '../components/support/SupportPageChrome';
import { SuggestDropdown } from '../../components/SuggestDropdown';
import '../lib/suggestDropdownAdmin.css';

function formatDate(value, fallback) {
  if (!value) return fallback;
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value));
}

function ReviewCard({ review, onSaved }) {
  const { t } = useTranslation();
  const [score, setScore] = useState(review.qa_score == null ? '' : String(review.qa_score));
  const [notes, setNotes] = useState(review.qa_notes || '');
  const [saving, setSaving] = useState(false);
  const completed = review.qa_review_id != null;

  const save = async (event) => {
    event.preventDefault();
    setSaving(true);
    try {
      await adminApi.post(`/support/qa/reviews/${review.conversation_id}`, {
        score: Number(score),
        notes: notes.trim() || null,
      });
      toast.success(t('adminSupportQA.toastSaved'));
      await onSaved();
    } catch (error) {
      toast.error(error?.response?.data?.error || t('adminSupportQA.toastSaveFailed'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <article className="rounded-2xl border border-gray-800 bg-gray-900/70 p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="font-semibold text-white">{review.subject || t('adminSupportQA.defaultSubject')}</h3>
            <SupportTag tone={review.priority === 'urgent' ? 'red' : 'blue'}>{review.priority || t('adminSupportQA.priorityNormal')}</SupportTag>
          </div>
          <p className="mt-1 text-sm text-gray-400">
            {t('adminSupportQA.reviewMeta', {
              customer: review.customer_name,
              agent: review.agent_name,
              date: formatDate(review.closed_at || review.resolved_at, t('adminSupportQA.notAvailable')),
            })}
          </p>
        </div>
        {completed && <SupportTag tone="green"><CheckCircle2 size={12} /> {t('adminSupportQA.reviewedScore', { score: review.qa_score })}</SupportTag>}
      </div>

      <form onSubmit={save} className="mt-4 grid gap-4 md:grid-cols-[140px_1fr_auto] md:items-end">
        <label className="text-xs font-medium uppercase tracking-wider text-gray-500">
          {t('adminSupportQA.labelQaScore')}
          <input
            type="number"
            min="0"
            max="100"
            required
            value={score}
            onChange={(event) => setScore(event.target.value)}
            className="mt-1 w-full rounded-xl border border-gray-700 bg-gray-950 px-3 py-2.5 text-sm text-white focus:border-orange-500 focus:outline-none"
          />
        </label>
        <label className="text-xs font-medium uppercase tracking-wider text-gray-500">
          {t('adminSupportQA.labelNotes')}
          <textarea
            maxLength={2000}
            rows={2}
            value={notes}
            onChange={(event) => setNotes(event.target.value)}
            placeholder={t('adminSupportQA.notesPlaceholder')}
            className="mt-1 w-full resize-y rounded-xl border border-gray-700 bg-gray-950 px-3 py-2.5 text-sm text-white focus:border-orange-500 focus:outline-none"
          />
        </label>
        <button
          type="submit"
          disabled={saving || score === ''}
          className="inline-flex items-center justify-center gap-2 rounded-xl bg-orange-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-orange-500 disabled:opacity-40"
        >
          {saving ? <RefreshCw size={15} className="animate-spin" /> : <ClipboardCheck size={15} />}
          {completed ? t('adminSupportQA.updateReview') : t('adminSupportQA.reviewConversation')}
        </button>
      </form>
    </article>
  );
}

export default function SupportQAReviews() {
  const { t } = useTranslation();
  const [status, setStatus] = useState('pending');
  const [search, setSearch] = useState('');
  const [reviews, setReviews] = useState([]);

  // Typeahead suggestions from the latest loaded QA review rows.
  const qaReviewSuggestItems = useMemo(() => {
    const seen = new Set();
    const items = [];
    for (const review of reviews) {
      const id = review.conversation_id;
      if (id == null || seen.has(id)) continue;
      seen.add(id);
      const title = review.subject || review.customer_name || String(id);
      items.push({ id, title, meta: review.customer_email || review.agent_name || undefined });
    }
    return items;
  }, [reviews]);
  const [loading, setLoading] = useState(true);

  const loadReviews = useCallback(async () => {
    setLoading(true);
    try {
      const response = await adminApi.get('/support/qa/reviews', { params: { status } });
      const query = search.trim().toLowerCase();
      setReviews((response.data.reviews || []).filter((review) => {
        if (!query) return true;
        return [review.subject, review.customer_name, review.customer_email, review.agent_name]
          .filter(Boolean)
          .join(' ')
          .toLowerCase()
          .includes(query);
      }));
    } catch (error) {
      toast.error(error?.response?.data?.error || t('adminSupportQA.toastLoadFailed'));
      setReviews([]);
    } finally {
      setLoading(false);
    }
  }, [search, status, t]);

  useEffect(() => {
    loadReviews();
  }, [loadReviews]);

  return (
    <SupportPageShell>
      <div className="flex flex-col gap-6">
        <div className="flex flex-col justify-between gap-4 md:flex-row md:items-end">
          <div>
            <div className="flex items-center gap-2 text-sm font-medium text-orange-300"><ClipboardCheck size={16} /> {t('adminSupportQA.eyebrow')}</div>
            <h1 className="mt-2 text-3xl font-semibold text-white">{t('adminSupportQA.title')}</h1>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-gray-400">{t('adminSupportQA.description')}</p>
          </div>
          <button type="button" onClick={loadReviews} disabled={loading} className="inline-flex items-center justify-center gap-2 rounded-xl border border-gray-700 px-4 py-2.5 text-sm font-semibold text-gray-200 hover:border-orange-500 disabled:opacity-50">
            <RefreshCw size={15} className={loading ? 'animate-spin' : ''} /> {t('common.refresh')}
          </button>
        </div>

        <SupportPanel title={t('adminSupportQA.panelTitle')} subtitle={t('adminSupportQA.panelSubtitle')}>
          <div className="mb-5 grid gap-3 md:grid-cols-[180px_1fr]">
            <select value={status} onChange={(event) => setStatus(event.target.value)} className="rounded-xl border border-gray-700 bg-gray-950 px-3 py-2.5 text-sm text-white focus:border-orange-500 focus:outline-none">
              <option value="pending">{t('adminSupportQA.statusPending')}</option>
              <option value="completed">{t('adminSupportQA.statusCompleted')}</option>
              <option value="all">{t('adminSupportQA.statusAll')}</option>
            </select>
            <SuggestDropdown
              id="support-qa-search"
              items={qaReviewSuggestItems}
              value={search}
              onQueryChange={setSearch}
              onSelect={(item) => setSearch(item.title || '')}
              recentsKey="oxsteed_admin_support_qa_search_recents"
              placeholder={t('adminSupportQA.searchPlaceholder')}
              ariaLabel={t('adminSupportQA.searchPlaceholder')}
              className="sd-admin-dark"
            />
          </div>
          {loading ? (
            <div className="flex min-h-48 items-center justify-center"><RefreshCw className="animate-spin text-orange-400" /></div>
          ) : reviews.length === 0 ? (
            <SupportEmptyState icon={ClipboardCheck} title={status === 'pending' ? t('adminSupportQA.emptyPending') : t('adminSupportQA.emptyOther')} body={t('adminSupportQA.emptyBody')} />
          ) : (
            <div className="space-y-4">{reviews.map((review) => <ReviewCard key={review.conversation_id} review={review} onSaved={loadReviews} />)}</div>
          )}
        </SupportPanel>
      </div>
    </SupportPageShell>
  );
}
