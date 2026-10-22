import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { AlertTriangle, ChevronRight, RefreshCw } from 'lucide-react';

const URGENCY_RANK = { urgent: 0, high: 1, normal: 2, low: 3 };
const URGENCIES = ['urgent', 'high', 'normal', 'low'];

// Categories that represent a decision the owner must make (sorted ahead of
// passive informational items within the same urgency band).
const DECISION_CATEGORIES = new Set([
  'refunds_disputes',
  'payments_settlements',
  'agreements_warranties',
  'leads_quotes',
  'invoices_billing',
]);

export const ATTENTION_CATEGORIES = [
  'orders_fulfillment',
  'pickup_delivery',
  'bookings_scheduling',
  'service_jobs',
  'leads_quotes',
  'messages',
  'agreements_warranties',
  'invoices_billing',
  'refunds_disputes',
  'payments_settlements',
  'restaurant_credit',
  'inventory_offerings',
  'team_access',
  'devices_integrations',
  'setup_verification',
  'customer_followup',
];

function isOverdue(item, now) {
  if (!item?.deadlineAt) return false;
  const deadline = new Date(item.deadlineAt).getTime();
  return Number.isFinite(deadline) && deadline < now;
}

// Sort contract: overdue first, then urgency rank, then items that need a
// decision, then everything else; setup tasks sort last; oldest first.
export function sortAttentionItems(items) {
  const now = Date.now();
  return [...(items || [])].sort((a, b) => {
    const aOver = isOverdue(a, now);
    const bOver = isOverdue(b, now);
    if (aOver !== bOver) return aOver ? -1 : 1;
    const urgencyDiff = (URGENCY_RANK[a.urgency] ?? 9) - (URGENCY_RANK[b.urgency] ?? 9);
    if (urgencyDiff !== 0) return urgencyDiff;
    const decisionDiff = (DECISION_CATEGORIES.has(b.category) ? 1 : 0)
      - (DECISION_CATEGORIES.has(a.category) ? 1 : 0);
    if (decisionDiff !== 0) return decisionDiff;
    const setupDiff = (a.category === 'setup_verification' ? 1 : 0)
      - (b.category === 'setup_verification' ? 1 : 0);
    if (setupDiff !== 0) return setupDiff;
    return (b.ageDays ?? 0) - (a.ageDays ?? 0);
  });
}

export function getBusinessId(biz) {
  return biz?.business_id ?? biz?.id;
}

export function getBusinessName(biz) {
  return biz?.business_name ?? biz?.name ?? '';
}

function formatMoney(amountCents, currencyCode) {
  if (amountCents == null) return null;
  try {
    return new Intl.NumberFormat(undefined, {
      style: 'currency',
      currency: currencyCode || 'USD',
    }).format(amountCents / 100);
  } catch {
    return `${(amountCents / 100).toFixed(2)} ${currencyCode || ''}`.trim();
  }
}

function AttentionRow({ item, onSelect }) {
  const { t, i18n } = useTranslation('attention');

  // Backend reason keys arrive namespaced ("attention.reasons.unreadMessages");
  // the attention catalog holds the suffix. Unknown reasons fall back to a
  // generic label rather than rendering a raw key.
  const reasonSuffix = String(item.reason || '').replace(/^attention\./, '');
  const reasonText = i18n.exists(reasonSuffix, { ns: 'attention' })
    ? t(reasonSuffix, item.reasonParams || {})
    : t('reasons.other');

  const categoryLabel = item.category
    ? t(`categories.${item.category}`, { defaultValue: item.category })
    : null;
  const urgencyLabel = item.urgency
    ? t(`urgency.${item.urgency}`, { defaultValue: item.urgency })
    : null;

  let ageLabel = null;
  if (item.deadlineAt) {
    const deadline = new Date(item.deadlineAt).getTime();
    if (Number.isFinite(deadline)) {
      if (deadline < Date.now()) {
        ageLabel = t('age.overdue');
      } else {
        const days = Math.max(1, Math.ceil((deadline - Date.now()) / 86400000));
        ageLabel = t('age.dueIn', { days });
      }
    }
  } else if (item.ageDays != null && item.ageDays > 0) {
    ageLabel = t('age.daysAgo', { days: item.ageDays });
  }

  const amount = formatMoney(item.amountCents, item.currencyCode);
  const count = Number(item.reasonParams?.count);
  const context = [item.businessName, item.restaurantName].filter(Boolean).join(' · ');

  return (
    <li>
      <button
        type="button"
        className="attention-row"
        onClick={() => onSelect(item)}
        aria-label={`${reasonText}${context ? ` — ${context}` : ''}`} data-track="ui.d267ab4eff.1"
      >
        <span className={`attention-urgency attention-urgency--${item.urgency || 'normal'}`}>
          <span className="attention-urgency__dot" aria-hidden="true" />
          {urgencyLabel}
        </span>
        <span className="attention-row__main">
          <span className="attention-row__reason">
            {reasonText}
            {Number.isFinite(count) && count > 1 && (
              <span className="attention-count-badge" style={{ marginInlineStart: '0.5rem' }} aria-label={String(count)}>
                {count}
              </span>
            )}
          </span>
          <span className="attention-row__context">
            {context}
            {categoryLabel && ` · ${categoryLabel}`}
          </span>
        </span>
        <span className="attention-row__meta attention-row__meta--keep">
          {ageLabel && <span>{ageLabel}</span>}
          {amount && <span>{amount}</span>}
          {item.creditRail && (
            <span className="attention-chip">{t(`creditRail.${item.creditRail}`, { defaultValue: item.creditRail })}</span>
          )}
        </span>
        <ChevronRight size={18} className="attention-chevron" aria-hidden="true" />
      </button>
    </li>
  );
}

export default function AttentionList({
  items,
  totals,
  freshness,
  partialFailures,
  businesses,
  filters,
  onFilterChange,
  page,
  totalPages,
  onPageChange,
  onSelectTask,
  status,
  error,
  onRetry,
}) {
  const { t } = useTranslation('attention');
  const sorted = useMemo(() => sortAttentionItems(items), [items]);

  const staleSources = useMemo(() => {
    if (!Array.isArray(freshness)) return [];
    return freshness.filter((entry) => entry && (entry.stale === true || entry.isStale === true));
  }, [freshness]);
  const hasPartialFailures = Array.isArray(partialFailures) && partialFailures.length > 0;

  const setFilter = (key, value) => onFilterChange({ ...filters, [key]: value, page: 1 });

  if (status === 'loading') {
    return (
      <div className="attention-state" role="status" aria-live="polite">
        <div className="attention-spinner" aria-hidden="true" />
        <p className="attention-state__text">{t('list.loading')}</p>
      </div>
    );
  }

  // A failed load never renders the reassuring empty state: if some sources
  // failed, the totals may be incomplete, so surface retry instead of "all clear".
  if (status === 'error' || (status === 'ready' && hasPartialFailures && sorted.length === 0)) {
    return (
      <div className="attention-state" role="alert">
        <AlertTriangle size={32} className="text-amber-500" aria-hidden="true" />
        <p className="attention-state__title">{t('list.partialFailure')}</p>
        {error && <p className="attention-state__text">{String(error)}</p>}
        <button type="button" className="attention-btn attention-btn--primary" onClick={onRetry} data-track="ui.d267ab4eff.2">
          <RefreshCw size={16} aria-hidden="true" /> {t('list.retry')}
        </button>
      </div>
    );
  }

  return (
    <div>
      {hasPartialFailures && (
        <div className="attention-banner attention-banner--warning" role="alert">
          <AlertTriangle size={16} aria-hidden="true" />
          <span>{t('list.partialFailure')}</span>
        </div>
      )}
      {staleSources.length > 0 && (
        <div className="attention-banner attention-banner--info" role="status">
          <AlertTriangle size={16} aria-hidden="true" />
          <span>{t('list.staleSource')}</span>
        </div>
      )}

      <div className="attention-filters" role="group" aria-label={t('list.title')}>
        <label className="attention-filter">
          <span className="attention-filter__label">{t('list.filters.business')}</span>
          <select
            className="attention-select"
            value={filters.businessId || ''}
            onChange={(event) => setFilter('businessId', event.target.value || '')}
          >
            <option value="">{t('list.filters.all')}</option>
            {(businesses || []).map((biz) => (
              <option key={String(getBusinessId(biz))} value={String(getBusinessId(biz))}>
                {getBusinessName(biz)}
              </option>
            ))}
          </select>
        </label>
        <label className="attention-filter">
          <span className="attention-filter__label">{t('list.filters.category')}</span>
          <select
            className="attention-select"
            value={filters.category || ''}
            onChange={(event) => setFilter('category', event.target.value || '')}
          >
            <option value="">{t('list.filters.all')}</option>
            {ATTENTION_CATEGORIES.map((category) => (
              <option key={category} value={category}>
                {t(`categories.${category}`)}
              </option>
            ))}
          </select>
        </label>
        <label className="attention-filter">
          <span className="attention-filter__label">{t('list.filters.urgency')}</span>
          <select
            className="attention-select"
            value={filters.urgency || ''}
            onChange={(event) => setFilter('urgency', event.target.value || '')}
          >
            <option value="">{t('list.filters.all')}</option>
            {URGENCIES.map((urgency) => (
              <option key={urgency} value={urgency}>
                {t(`urgency.${urgency}`)}
              </option>
            ))}
          </select>
        </label>
        <span className="attention-sort-note">{t('list.sort.urgentFirst')}</span>
      </div>

      {totals && (
        <p className="attention-state__text" style={{ marginBottom: '0.75rem' }} aria-live="polite">
          {t('list.affectedBusinesses', { count: totals.affectedBusinesses ?? 0 })}
        </p>
      )}

      {sorted.length === 0 ? (
        <div className="attention-state">
          <p className="attention-state__text">{t('list.empty')}</p>
        </div>
      ) : (
        <>
          <ul className="attention-list">
            {sorted.map((item) => (
              <AttentionRow key={item.id} item={item} onSelect={onSelectTask} />
            ))}
          </ul>
          {totalPages > 1 && (
            <nav className="attention-modal__footer" style={{ borderTop: 'none', paddingInline: 0 }} aria-label={t('list.title')}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.75rem' }}>
                <button
                  type="button"
                  className="attention-btn"
                  disabled={page <= 1}
                  onClick={() => onPageChange(page - 1)} data-track="ui.d267ab4eff.3"
                >
                  {t('list.pagination.previous')}
                </button>
                <span className="attention-state__text" aria-current="page">
                  {page} / {totalPages}
                </span>
                <button
                  type="button"
                  className="attention-btn"
                  disabled={page >= totalPages}
                  onClick={() => onPageChange(page + 1)} data-track="ui.d267ab4eff.4"
                >
                  {t('list.pagination.next')}
                </button>
              </div>
            </nav>
          )}
        </>
      )}
    </div>
  );
}
