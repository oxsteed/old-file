import { useTranslation } from 'react-i18next';

// Shared pager for the Track D admin surfaces: every list shows its total
// and a previous/next pager, and steps back when the last page empties.
export default function RsdPager({ offset, limit, total, onPage }) {
  const { t } = useTranslation();
  const from = total === 0 ? 0 : offset + 1;
  const to = Math.min(offset + limit, total);
  const canPrev = offset > 0;
  const canNext = offset + limit < total;
  if (total === 0) return null;
  return (
    <div className="mt-4 flex flex-wrap items-center gap-3">
      <span className="text-sm text-gray-400">{t('adminRsd.showing', { from, to, total })}</span>
      <button
        type="button"
        disabled={!canPrev}
        onClick={() => onPage(Math.max(0, offset - limit))}
        className="rounded-lg bg-slate-800 px-3 py-1.5 text-sm font-semibold text-gray-200 disabled:opacity-40"
      >
        {t('common.previous')}
      </button>
      <button
        type="button"
        disabled={!canNext}
        onClick={() => onPage(offset + limit)}
        className="rounded-lg bg-slate-800 px-3 py-1.5 text-sm font-semibold text-gray-200 disabled:opacity-40"
      >
        {t('common.next')}
      </button>
    </div>
  );
}

export function serverErrorMessage(err, fallback) {
  const serverError = err?.response?.data?.error;
  if (typeof serverError === 'string' && serverError) return serverError;
  if (serverError?.message) return serverError.message;
  return err?.message || fallback;
}
