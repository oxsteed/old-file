import { useCallback, useEffect, useState } from 'react';
import adminApi from '../../lib/adminApi';
import toast from 'react-hot-toast';
import { CheckCircle2, ClipboardCheck, RefreshCw, Search } from 'lucide-react';
import {
  SupportEmptyState,
  SupportPageShell,
  SupportPanel,
  SupportTag,
} from '../components/support/SupportPageChrome';

function formatDate(value) {
  if (!value) return 'Not available';
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value));
}

function ReviewCard({ review, onSaved }) {
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
      toast.success('QA review saved');
      await onSaved();
    } catch (error) {
      toast.error(error?.response?.data?.error || 'Could not save QA review');
    } finally {
      setSaving(false);
    }
  };

  return (
    <article className="rounded-2xl border border-gray-800 bg-gray-900/70 p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="font-semibold text-white">{review.subject || 'Support conversation'}</h3>
            <SupportTag tone={review.priority === 'urgent' ? 'red' : 'blue'}>{review.priority || 'normal'}</SupportTag>
          </div>
          <p className="mt-1 text-sm text-gray-400">
            {review.customer_name} · {review.agent_name} · finished {formatDate(review.closed_at || review.resolved_at)}
          </p>
        </div>
        {completed && <SupportTag tone="green"><CheckCircle2 size={12} /> Reviewed {review.qa_score}/100</SupportTag>}
      </div>

      <form onSubmit={save} className="mt-4 grid gap-4 md:grid-cols-[140px_1fr_auto] md:items-end">
        <label className="text-xs font-medium uppercase tracking-wider text-gray-500">
          QA score
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
          Coaching notes
          <textarea
            maxLength={2000}
            rows={2}
            value={notes}
            onChange={(event) => setNotes(event.target.value)}
            placeholder="What was done well and what should improve?"
            className="mt-1 w-full resize-y rounded-xl border border-gray-700 bg-gray-950 px-3 py-2.5 text-sm text-white focus:border-orange-500 focus:outline-none"
          />
        </label>
        <button
          type="submit"
          disabled={saving || score === ''}
          className="inline-flex items-center justify-center gap-2 rounded-xl bg-orange-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-orange-500 disabled:opacity-40"
        >
          {saving ? <RefreshCw size={15} className="animate-spin" /> : <ClipboardCheck size={15} />}
          {completed ? 'Update review' : 'Review conversation'}
        </button>
      </form>
    </article>
  );
}

export default function SupportQAReviews() {
  const [status, setStatus] = useState('pending');
  const [search, setSearch] = useState('');
  const [reviews, setReviews] = useState([]);
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
      toast.error(error?.response?.data?.error || 'Could not load QA queue');
      setReviews([]);
    } finally {
      setLoading(false);
    }
  }, [search, status]);

  useEffect(() => {
    loadReviews();
  }, [loadReviews]);

  return (
    <SupportPageShell>
      <div className="flex flex-col gap-6">
        <div className="flex flex-col justify-between gap-4 md:flex-row md:items-end">
          <div>
            <div className="flex items-center gap-2 text-sm font-medium text-orange-300"><ClipboardCheck size={16} /> Support quality</div>
            <h1 className="mt-2 text-3xl font-semibold text-white">QA review queue</h1>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-gray-400">Review completed conversations consistently, record coaching context, and keep quality decisions auditable.</p>
          </div>
          <button type="button" onClick={loadReviews} disabled={loading} className="inline-flex items-center justify-center gap-2 rounded-xl border border-gray-700 px-4 py-2.5 text-sm font-semibold text-gray-200 hover:border-orange-500 disabled:opacity-50">
            <RefreshCw size={15} className={loading ? 'animate-spin' : ''} /> Refresh
          </button>
        </div>

        <SupportPanel title="Review queue" subtitle="Only resolved and closed conversations appear here. Customer-facing ratings remain separate.">
          <div className="mb-5 grid gap-3 md:grid-cols-[180px_1fr]">
            <select value={status} onChange={(event) => setStatus(event.target.value)} className="rounded-xl border border-gray-700 bg-gray-950 px-3 py-2.5 text-sm text-white focus:border-orange-500 focus:outline-none">
              <option value="pending">Needs review</option>
              <option value="completed">Reviewed</option>
              <option value="all">All completed</option>
            </select>
            <label className="relative block">
              <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-600" />
              <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search customer, agent, or subject" className="w-full rounded-xl border border-gray-700 bg-gray-950 py-2.5 pl-10 pr-3 text-sm text-white focus:border-orange-500 focus:outline-none" />
            </label>
          </div>
          {loading ? (
            <div className="flex min-h-48 items-center justify-center"><RefreshCw className="animate-spin text-orange-400" /></div>
          ) : reviews.length === 0 ? (
            <SupportEmptyState icon={ClipboardCheck} title={status === 'pending' ? 'No conversations need review' : 'No QA reviews found'} body="Completed support conversations will appear here when they are ready for quality review." />
          ) : (
            <div className="space-y-4">{reviews.map((review) => <ReviewCard key={review.conversation_id} review={review} onSaved={loadReviews} />)}</div>
          )}
        </SupportPanel>
      </div>
    </SupportPageShell>
  );
}
