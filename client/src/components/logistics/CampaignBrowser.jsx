import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { listCampaigns, listLanes } from '../../api/logistics';
import CampaignPreview from './CampaignPreview';
import './CampaignBrowser.css';

/**
 * CampaignBrowser - shared campaign search/filter/results component.
 *
 * Used by the logistics browsing hub (/logistics) and the full campaigns
 * page (/logistics/campaigns). Filter state (search, lane, status, open,
 * page) lives in the URL search params, so it survives navigation between
 * the two pages and is shareable/bookmarkable. Scroll position is saved on
 * unmount and restored on mount.
 *
 * Public visibility: GET /logistics/campaigns is an unauthenticated,
 * public-safe endpoint; guests only ever receive published fields and the
 * server excludes drafts/private campaigns (publicSafe mode). No auth is
 * required or attached here.
 *
 * Search: the campaigns list endpoint has no server-side search parameter,
 * so when a query is present the component fetches a page buffer (up to 200
 * rows, the server cap) and filters client-side across title, description,
 * product, and lane text. Lane/status filters always run server-side.
 */
const PAGE_LIMIT = 20;
const SEARCH_BUFFER_LIMIT = 200;
const FILTER_STATUSES = [
  'open',
  'pledging',
  'deposit_phase',
  'locked',
  'placed',
  'in_transit',
  'completed',
];

const STATUS_PILL_CLASS = {
  open: 'lx-cb-pill-open',
  pledging: 'lx-cb-pill-pledging',
  deposit_phase: 'lx-cb-pill-deposit',
  locked: 'lx-cb-pill-locked',
  placed: 'lx-cb-pill-placed',
  in_transit: 'lx-cb-pill-transit',
  completed: 'lx-cb-pill-completed',
  cancelled: 'lx-cb-pill-cancelled',
};

function matchesQuery(campaign, needle) {
  const haystack = [
    campaign.title,
    campaign.description,
    campaign.product_title,
    campaign.product_category,
    campaign.lane_name,
    campaign.origin_country,
    campaign.destination_country,
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
  return haystack.includes(needle);
}

function progressPct(campaign) {
  const pct = Number(campaign.moq_pct);
  if (Number.isFinite(pct)) return Math.max(0, Math.min(100, pct));
  const target = Number(campaign.target_moq);
  const current = Number(campaign.current_committed_qty);
  if (target > 0 && Number.isFinite(current)) {
    return Math.max(0, Math.min(100, Math.round((current / target) * 100)));
  }
  return 0;
}

export default function CampaignBrowser() {
  const { t } = useTranslation();
  const [params, setParams] = useSearchParams();

  const q = params.get('q') || '';
  const status = params.get('status') || '';
  const laneId = params.get('lane_id') || '';
  const openOnly = params.get('open') === 'true';
  const page = Math.max(parseInt(params.get('page') || '1', 10) || 1, 1);

  const [searchInput, setSearchInput] = useState(q);
  const [lanes, setLanes] = useState([]);
  const [campaigns, setCampaigns] = useState([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [retryNonce, setRetryNonce] = useState(0);
  const [previewId, setPreviewId] = useState(null);

  const debounceRef = useRef(null);
  const resultsTopRef = useRef(null);
  const filterKey = useMemo(
    () => `${q}|${status}|${laneId}|${openOnly}|${page}`,
    [q, status, laneId, openOnly, page],
  );
  const filterChangeRun = useRef(true);

  // Keep the input in sync when the URL changes from outside (e.g. back button).
  useEffect(() => {
    setSearchInput(q);
  }, [q]);

  const setFilter = (patch) => {
    setParams((prev) => {
      const next = new URLSearchParams(prev);
      Object.entries(patch).forEach(([key, value]) => {
        if (value === '' || value == null || value === false) next.delete(key);
        else next.set(key, String(value));
      });
      next.delete('page'); // any filter change restarts at page 1
      return next;
    });
  };

  const setPage = (nextPage) => {
    setParams((prev) => {
      const next = new URLSearchParams(prev);
      if (nextPage <= 1) next.delete('page');
      else next.set('page', String(nextPage));
      return next;
    });
  };

  const onSearchChange = (e) => {
    const value = e.target.value;
    setSearchInput(value);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => setFilter({ q: value.trim() }), 350);
  };

  useEffect(() => () => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
  }, []);

  // ── Data ────────────────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false;
    listLanes()
      .then((r) => {
        if (!cancelled) setLanes(r.data || []);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  const searching = q.length > 0;

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    listCampaigns({
      status: status || undefined,
      lane_id: laneId || undefined,
      open: openOnly ? 'true' : undefined,
      limit: searching ? SEARCH_BUFFER_LIMIT : PAGE_LIMIT,
      offset: searching ? 0 : (page - 1) * PAGE_LIMIT,
    })
      .then((r) => {
        if (cancelled) return;
        // The list endpoint returns `orders` (legacy shape); the extended API
        // also includes `data` when pagination params are passed. Accept both.
        let orders = Array.isArray(r.orders) ? r.orders : Array.isArray(r.data) ? r.data : [];
        let totalCount = Number(r.total) || 0;
        if (searching) {
          const needle = q.toLowerCase();
          orders = orders.filter((c) => matchesQuery(c, needle));
          totalCount = orders.length;
          const start = (page - 1) * PAGE_LIMIT;
          orders = orders.slice(start, start + PAGE_LIMIT);
        }
        setCampaigns(orders);
        setTotal(totalCount);
      })
      .catch((e) => {
        if (!cancelled) setError(e?.message || 'error');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [q, status, laneId, openOnly, page, searching, retryNonce]);

  // ── Scroll: restore saved position on mount, top on filter/page change ──
  useEffect(() => {
    const key = `lx-browser-scroll:${window.location.pathname}:${window.location.search}`;
    let saved = null;
    try {
      saved = sessionStorage.getItem(key);
    } catch {
      saved = null;
    }
    if (saved != null) {
      window.scrollTo(0, parseInt(saved, 10) || 0);
      try {
        sessionStorage.removeItem(key);
      } catch {
        /* ignore */
      }
    }
    return () => {
      try {
        sessionStorage.setItem(key, String(window.scrollY));
      } catch {
        /* ignore */
      }
    };
  }, []);

  useEffect(() => {
    if (filterChangeRun.current) {
      filterChangeRun.current = false;
      return;
    }
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }, [filterKey]);

  const totalPages = Math.max(1, Math.ceil(total / PAGE_LIMIT));
  const hasActiveFilters = searching || status !== '' || laneId !== '' || openOnly;
  const noFiltersAtAll = !hasActiveFilters;

  const retry = () => {
    setError(null);
    setRetryNonce((n) => n + 1); // force the fetch effect to re-run
  };

  return (
    <section className="lx-cb" aria-label={t('logistics.campaigns.title', 'Pooled Campaigns')}>
      {/* ── Search + filters ── */}
      <div className="lx-cb-controls" role="search">
        <div className="lx-cb-search">
          <label className="lx-cb-visually-hidden" htmlFor="lx-cb-search">
            {t('logistics.hub.searchLabel')}
          </label>
          <input
            id="lx-cb-search"
            type="search"
            className="lx-cb-input"
            value={searchInput}
            onChange={onSearchChange}
            placeholder={t('logistics.hub.searchPlaceholder')}
            autoComplete="off"
          />
        </div>
        <label className="lx-cb-field">
          <span className="lx-cb-visually-hidden">{t('logistics.hub.laneLabel')}</span>
          <select
            className="lx-cb-select"
            value={laneId}
            onChange={(e) => setFilter({ lane_id: e.target.value })}
            aria-label={t('logistics.hub.laneLabel')}
          >
            <option value="">{t('logistics.campaigns.allLanes', 'All lanes')}</option>
            {lanes.map((lane) => (
              <option key={lane.id} value={lane.id}>
                {lane.name}
              </option>
            ))}
          </select>
        </label>
        <label className="lx-cb-field">
          <span className="lx-cb-visually-hidden">{t('logistics.hub.statusLabel')}</span>
          <select
            className="lx-cb-select"
            value={status}
            onChange={(e) => setFilter({ status: e.target.value })}
            aria-label={t('logistics.hub.statusLabel')}
          >
            <option value="">{t('logistics.campaigns.allStatuses', 'All statuses')}</option>
            {FILTER_STATUSES.map((s) => (
              <option key={s} value={s}>
                {t(`logistics.status.${s}`, { defaultValue: s.replace(/_/g, ' ') })}
              </option>
            ))}
          </select>
        </label>
        <label className="lx-cb-check">
          <input
            type="checkbox"
            checked={openOnly}
            onChange={(e) => setFilter({ open: e.target.checked })} data-track="ui.cae85ba4cb.1"
          />
          <span>{t('logistics.campaigns.openOnly', 'Open only')}</span>
        </label>
      </div>

      {/* ── Results ── */}
      <div ref={resultsTopRef} className="lx-cb-results">
        {!loading && !error && (
          <p className="lx-cb-count" role="status">
            {t('logistics.hub.resultsCount', { count: total })}
          </p>
        )}

        {loading && (
          <div className="lx-cb-loading" role="status" aria-live="polite">
            <span className="lx-cb-spinner" aria-hidden="true" />
            {t('logistics.hub.loading')}
          </div>
        )}

        {error && !loading && (
          <div className="lx-cb-error" role="alert">
            <p>{t('logistics.hub.error')}</p>
            <button type="button" className="lx-cb-btn-secondary" onClick={retry} data-track="ui.cae85ba4cb.2">
              {t('logistics.hub.retry')}
            </button>
          </div>
        )}

        {!loading && !error && campaigns.length === 0 && (
          <div className="lx-cb-empty">
            <h2 className="lx-cb-empty-title">
              {noFiltersAtAll ? t('logistics.hub.noCampaignsTitle') : t('logistics.hub.emptyTitle')}
            </h2>
            <p className="lx-cb-empty-body">
              {noFiltersAtAll ? t('logistics.hub.noCampaignsBody') : t('logistics.hub.emptyBody')}
            </p>
            <div className="lx-cb-empty-actions">
              {hasActiveFilters && (
                <button
                  type="button"
                  className="lx-cb-btn-secondary"
                  onClick={() => setFilter({ q: '', status: '', lane_id: '', open: false })} data-track="ui.cae85ba4cb.3"
                >
                  {t('logistics.hub.clearFilters')}
                </button>
              )}
              <Link to="/logistics/campaigns/new" className="lx-cb-btn-primary">
                {t('logistics.hub.organizeCta')}
              </Link>
              <Link to="/logistics/business-procurement" className="lx-cb-btn-ghost">
                {t('logistics.hub.procurementCta')}
              </Link>
            </div>
          </div>
        )}

        {!loading && !error && campaigns.length > 0 && (
          <div className="lx-cb-grid">
            {campaigns.map((c) => {
              const pct = progressPct(c);
              return (
                <article key={c.id} className="lx-cb-card" aria-labelledby={`lx-cb-title-${c.id}`}>
                  <span className="lx-cb-card-lane">
                    {c.origin_country} → {c.destination_country}
                    {c.lane_name && <span className="lx-cb-card-lane-name"> · {c.lane_name}</span>}
                  </span>
                  <Link to={`/logistics/campaigns/${c.id}`} className="lx-cb-card-title-link">
                    <span className="lx-cb-card-title" id={`lx-cb-title-${c.id}`}>{c.title}</span>
                  </Link>
                  {c.product_title && (
                    <span className="lx-cb-card-product">
                      {c.product_category ? `${c.product_category} · ` : ''}
                      {c.product_title}
                    </span>
                  )}
                  <span className="lx-cb-progress" aria-hidden="true">
                    <span className="lx-cb-progress-bar" style={{ width: `${pct}%` }} />
                  </span>
                  <span className="lx-cb-card-meta">
                    <span className="lx-cb-card-qty">
                      {c.current_committed_qty || 0} / {c.target_moq}{' '}
                      {t('logistics.campaigns.units', 'units')} ({pct}%)
                    </span>
                    <span
                      className={`lx-cb-pill ${STATUS_PILL_CLASS[c.status] || 'lx-cb-pill-default'}`}
                    >
                      {t(`logistics.status.${c.status}`, { defaultValue: (c.status || '').replace(/_/g, ' ') })}
                    </span>
                  </span>
                  <span className="lx-cb-card-foot">
                    {c.unit_landed_cost_usd && (
                      <span className="lx-cb-card-price">
                        ${parseFloat(c.unit_landed_cost_usd).toFixed(2)}{' '}
                        {t('logistics.campaigns.perUnit', '/unit landed')}
                      </span>
                    )}
                    {c.participant_count > 0 && (
                      <span className="lx-cb-card-participants">
                        {c.participant_count} {t('logistics.campaigns.participants', 'participants')}
                      </span>
                    )}
                    {c.close_date && (
                      <span className="lx-cb-card-close">
                        {t('logistics.campaigns.closes', 'Closes')}{' '}
                        {new Date(c.close_date).toLocaleDateString()}
                      </span>
                    )}
                    <button
                      type="button"
                      className="lx-cb-btn-ghost"
                      onClick={() => setPreviewId(c.id)} data-track="ui.cae85ba4cb.4"
                    >
                      {t('logistics.tables.preview')}
                    </button>
                  </span>
                </article>
              );
            })}
          </div>
        )}

        {/* ── Pagination ── */}
        {!loading && !error && totalPages > 1 && (
          <nav className="lx-cb-pagination" aria-label={t('logistics.hub.pageOf', { page, pages: totalPages })}>
            <button
              type="button"
              className="lx-cb-btn-secondary"
              disabled={page <= 1}
              onClick={() => setPage(page - 1)} data-track="ui.cae85ba4cb.5"
            >
              ← {t('logistics.hub.prevPage')}
            </button>
            <span className="lx-cb-page-indicator" role="status">
              {t('logistics.hub.pageOf', { page, pages: totalPages })}
            </span>
            <button
              type="button"
              className="lx-cb-btn-secondary"
              disabled={page >= totalPages}
              onClick={() => setPage(page + 1)} data-track="ui.cae85ba4cb.6"
            >
              {t('logistics.hub.nextPage')} →
            </button>
          </nav>
        )}
      </div>

      <CampaignPreview
        key={previewId} id={previewId}
        open={previewId !== null}
        onClose={() => setPreviewId(null)}
      />
    </section>
  );
}
