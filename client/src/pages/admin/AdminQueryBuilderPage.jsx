// Admin: Analytics query builder (Phase 3, Item 11 — Track A).
// Structured, read-only queries over the governed metrics registry.
// Metric picker -> dimension checkboxes -> filter inputs -> period picker ->
// Run -> results table + client-side CSV export.
//
// TRACK B INTEGRATION POINT: the "Ask in plain language" section below is a
// clearly-marked placeholder. Track B wires the NL input there: it compiles
// an utterance into the builder query contract
//   { metric, dimensions, filters, period }
// and calls handleNlCompiled(compiled) — already stubbed below — which
// validates the shape, populates the builder state, and runs it. The NL
// input posts raw_utterance alongside the compiled query so the audit
// ledger (analytics_query_audit) records both.

import { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { Play, Download, RotateCcw, MessageSquare, AlertTriangle } from 'lucide-react';
import api from '../../api/axios';
import logger from '../../utils/logger';
import './AdminQueryBuilderPage.css';

const PERIOD_LABELS = {
  '1d': '1D',
  '7d': '7D',
  '30d': '30D',
  '90d': '90D',
  '1y': '1Y',
};

// Column keys that hold integer cents -> render as dollars.
function isCentsColumn(key) {
  return key.endsWith('_cents');
}

function isPctColumn(key) {
  return key.endsWith('_pct');
}

function formatCell(key, value) {
  if (value === null || value === undefined) return '—';
  if (key === 'bucket' && typeof value === 'string') {
    const d = new Date(value);
    if (!Number.isNaN(d.getTime())) return d.toLocaleString();
    return value;
  }
  if (isCentsColumn(key) && typeof value === 'number') {
    return `$${(value / 100).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  }
  if (isPctColumn(key) && typeof value === 'number') {
    return `${value.toFixed(1)}%`;
  }
  if (key === 'repeat_order_rate' && typeof value === 'number') {
    return `${(value * 100).toFixed(2)}%`;
  }
  if ((key === 'nps_index' || key === 'avg_nps' || key === 'compliance_pct') && typeof value === 'number') {
    return value.toFixed(1);
  }
  if (typeof value === 'boolean') return value ? '✓' : '✗';
  return String(value);
}

function prettifyColumn(key) {
  return key
    .split('_')
    .map((w) => (w ? w[0].toUpperCase() + w.slice(1) : w))
    .join(' ');
}

function toCsv(rows, columns) {
  const escape = (v) => {
    const s = v === null || v === undefined ? '' : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = [columns.map(escape).join(',')];
  for (const row of rows) {
    lines.push(columns.map((c) => escape(row[c])).join(','));
  }
  return lines.join('\n');
}

export default function AdminQueryBuilderPage() {
  const { t } = useTranslation();
  const [meta, setMeta] = useState(null);
  const [metaError, setMetaError] = useState(null);
  const [metaLoading, setMetaLoading] = useState(true);

  const [metric, setMetric] = useState('');
  const [dimensions, setDimensions] = useState([]);
  const [filters, setFilters] = useState({});
  const [period, setPeriod] = useState('30d');

  const [running, setRunning] = useState(false);
  const [result, setResult] = useState(null);
  const [runError, setRunError] = useState(null);

  const loadMeta = useCallback(async () => {
    setMetaLoading(true);
    setMetaError(null);
    try {
      const res = await api.get('/admin/analytics/query-builder/meta');
      setMeta(res.data);
    } catch (err) {
      logger.warn('query builder meta failed', { message: err?.message });
      setMetaError(err?.response?.data?.error || err?.message || t('queryBuilder.loadFailed'));
    } finally {
      setMetaLoading(false);
    }
  }, [t]);

  useEffect(() => {
    loadMeta();
  }, [loadMeta]);

  const activeMetric = meta?.metrics?.find((m) => m.name === metric) || null;

  const selectMetric = (name) => {
    setMetric(name);
    setDimensions([]);
    setFilters({});
    setResult(null);
    setRunError(null);
  };

  const toggleDimension = (name) => {
    setDimensions((prev) =>
      prev.includes(name) ? prev.filter((d) => d !== name) : [...prev, name]
    );
  };

  const setFilter = (name, value) => {
    setFilters((prev) => {
      const next = { ...prev };
      if (value === '' || value === null || value === undefined) {
        delete next[name];
      } else {
        next[name] = value;
      }
      return next;
    });
  };

  const runQuery = useCallback(async () => {
    if (!metric || running) return;
    setRunning(true);
    setRunError(null);
    try {
      const res = await api.post('/admin/analytics/query-builder/run', {
        metric,
        dimensions,
        filters,
        period,
      });
      setResult(res.data);
    } catch (err) {
      logger.warn('query builder run failed', { metric, message: err?.message });
      const data = err?.response?.data;
      setRunError(data?.error || data?.message || err?.message || t('queryBuilder.errorTitle'));
      setResult(null);
    } finally {
      setRunning(false);
    }
  }, [metric, dimensions, filters, period, running, t]);

  // ── Track B hook ──────────────────────────────────────────────────────────
  // Track B: call this with the compiled builder query
  // ({ metric, dimensions, filters, period }) produced from the NL
  // utterance. It validates the shape, populates the builder, and runs it.
  // The NL input should ALSO pass the raw utterance through so the audit
  // ledger records it (POST body: { ..., raw_utterance } is not needed —
  // Track B calls executeBuilderQuery server-side with opts.rawUtterance;
  // from this UI the compiled query runs through the normal /run endpoint).
  const handleNlCompiled = useCallback(
    (compiled) => {
      if (!compiled || typeof compiled !== 'object' || typeof compiled.metric !== 'string') {
        setRunError(t('queryBuilder.errorTitle'));
        return;
      }
      const def = meta?.metrics?.find((m) => m.name === compiled.metric);
      if (!def) {
        setRunError(t('queryBuilder.errorTitle'));
        return;
      }
      setMetric(compiled.metric);
      setDimensions(
        Array.isArray(compiled.dimensions)
          ? compiled.dimensions.filter((d) => def.dimensions.includes(d))
          : []
      );
      const cleanFilters = {};
      if (compiled.filters && typeof compiled.filters === 'object') {
        for (const key of def.filters) {
          if (compiled.filters[key] !== undefined && compiled.filters[key] !== '') {
            cleanFilters[key] = compiled.filters[key];
          }
        }
      }
      setFilters(cleanFilters);
      setPeriod(def.periods.includes(compiled.period) ? compiled.period : '30d');
      setResult(null);
      setRunError(null);
      // Track B: trigger runQuery() here once the NL input is live.
    },
    [meta, t]
  );
  void handleNlCompiled;

  const exportCsv = () => {
    if (!result?.rows?.length) return;
    const csv = toCsv(result.rows, result.columns);
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
    a.href = url;
    a.download = `query-builder-${metric}-${stamp}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const renderFilterInput = (filterName) => {
    const value = filters[filterName] ?? '';
    if (filterName === 'role') {
      return (
        <select
          className="qb-input"
          value={value}
          onChange={(e) => setFilter(filterName, e.target.value)}
          aria-label={t('queryBuilder.filterRole')}
        >
          <option value="">{t('queryBuilder.filterRole')}</option>
          <option value="customer">customer</option>
          <option value="helper">helper</option>
          <option value="platform">platform</option>
        </select>
      );
    }
    const labelKey =
      filterName === 'customerId'
        ? 'queryBuilder.filterCustomerId'
        : filterName === 'businessId'
          ? 'queryBuilder.filterBusinessId'
          : 'queryBuilder.filterRestaurantId';
    return (
      <input
        className="qb-input"
        type={filterName === 'customerId' ? 'text' : 'number'}
        min={filterName === 'customerId' ? undefined : 1}
        placeholder={t(labelKey)}
        aria-label={t(labelKey)}
        value={value}
        onChange={(e) => setFilter(filterName, e.target.value)}
      />
    );
  };

  return (
    <div className="qb-page">
      <h1 className="qb-title">{t('queryBuilder.title')}</h1>
      <p className="qb-subtitle">{t('queryBuilder.subtitle')}</p>

      {/* ── Track B: natural-language input lives here ────────────────────
          This section is a clearly-marked placeholder. Track B replaces the
          disabled input with a live NL box that compiles utterances into
          the builder contract and calls handleNlCompiled(). */}
      <section className="qb-nl-section" data-testid="nl-query-section" aria-label={t('queryBuilder.nlSectionTitle')}>
        <div className="qb-nl-header">
          <MessageSquare size={16} />
          <h2>{t('queryBuilder.nlSectionTitle')}</h2>
        </div>
        <p className="qb-nl-body">{t('queryBuilder.nlSectionBody')}</p>
        <input
          className="qb-input qb-nl-input"
          type="text"
          disabled
          placeholder={t('queryBuilder.nlPlaceholder')}
          aria-label={t('queryBuilder.nlSectionTitle')}
        />
        <p className="qb-nl-note">{t('queryBuilder.nlDisabledNote')}</p>
      </section>

      <section className="qb-builder">
        {metaLoading && <p className="qb-loading">{t('queryBuilder.running')}</p>}
        {metaError && (
          <div className="qb-error">
            <AlertTriangle size={16} />
            <span>{metaError}</span>
            <button type="button" className="qb-btn qb-btn-secondary" onClick={loadMeta}>
              {t('queryBuilder.retry')}
            </button>
          </div>
        )}
        {meta && (
          <>
            <div className="qb-field">
              <label htmlFor="qb-metric">{t('queryBuilder.metricLabel')}</label>
              <select
                id="qb-metric"
                className="qb-input"
                value={metric}
                onChange={(e) => selectMetric(e.target.value)}
              >
                <option value="">{t('queryBuilder.metricPlaceholder')}</option>
                {meta.metrics.map((m) => (
                  <option key={m.name} value={m.name}>
                    {t(`queryBuilder.metricNames.${m.name}`)}
                  </option>
                ))}
              </select>
            </div>

            {activeMetric ? (
              <>
                <div className="qb-field">
                  <span className="qb-label">{t('queryBuilder.dimensionsLabel')}</span>
                  {activeMetric.dimensions.length === 0 ? (
                    <p className="qb-hint">{t('queryBuilder.noDimensions')}</p>
                  ) : (
                    <div className="qb-checks">
                      {activeMetric.dimensions.map((d) => (
                        <label key={d} className="qb-check">
                          <input
                            type="checkbox"
                            checked={dimensions.includes(d)}
                            onChange={() => toggleDimension(d)}
                          />
                          {t(`queryBuilder.dimension${d[0].toUpperCase()}${d.slice(1)}`)}
                        </label>
                      ))}
                    </div>
                  )}
                </div>

                <div className="qb-field">
                  <span className="qb-label">{t('queryBuilder.filtersLabel')}</span>
                  {activeMetric.filters.length === 0 ? (
                    <p className="qb-hint">{t('queryBuilder.noFilters')}</p>
                  ) : (
                    <div className="qb-filters">
                      {activeMetric.filters.map((f) => (
                        <div key={f}>{renderFilterInput(f)}</div>
                      ))}
                    </div>
                  )}
                </div>

                <div className="qb-field">
                  <label htmlFor="qb-period">{t('queryBuilder.periodLabel')}</label>
                  <select
                    id="qb-period"
                    className="qb-input qb-period"
                    value={period}
                    onChange={(e) => setPeriod(e.target.value)}
                  >
                    {activeMetric.periods.map((p) => (
                      <option key={p} value={p}>
                        {PERIOD_LABELS[p] || p}
                      </option>
                    ))}
                  </select>
                  {!activeMetric.periodSensitive && (
                    <p className="qb-hint">{t('queryBuilder.periodInsensitiveNote')}</p>
                  )}
                </div>

                <button
                  type="button"
                  className="qb-btn qb-btn-primary"
                  onClick={runQuery}
                  disabled={running}
                >
                  <Play size={15} />
                  {running ? t('queryBuilder.running') : t('queryBuilder.run')}
                </button>
              </>
            ) : (
              <p className="qb-hint">{t('queryBuilder.chooseMetricFirst')}</p>
            )}
          </>
        )}
      </section>

      {runError && (
        <div className="qb-error" role="alert">
          <AlertTriangle size={16} />
          <span>
            <strong>{t('queryBuilder.errorTitle')}: </strong>
            {runError}
          </span>
        </div>
      )}

      {result && (
        <section className="qb-results">
          <div className="qb-results-head">
            <h2>{t('queryBuilder.resultsTitle')}</h2>
            <div className="qb-results-meta">
              <span>{t('queryBuilder.rowCount', { count: result.rowCount })}</span>
              <span>{t('queryBuilder.duration', { ms: result.durationMs })}</span>
              {result.truncated && (
                <span className="qb-truncated">
                  {t('queryBuilder.truncatedNotice', { cap: meta?.rowCap || 10000 })}
                </span>
              )}
            </div>
            <div className="qb-results-actions">
              <button
                type="button"
                className="qb-btn qb-btn-secondary"
                onClick={exportCsv}
                disabled={!result.rows?.length}
              >
                <Download size={15} />
                {t('queryBuilder.exportCsv')}
              </button>
              <button
                type="button"
                className="qb-btn qb-btn-secondary"
                onClick={() => {
                  setResult(null);
                  setRunError(null);
                }}
              >
                <RotateCcw size={15} />
                {t('queryBuilder.clear')}
              </button>
            </div>
          </div>
          {result.rows?.length ? (
            <div className="qb-table-wrap">
              <table className="qb-table">
                <thead>
                  <tr>
                    {result.columns.map((c) => (
                      <th key={c}>{prettifyColumn(c)}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {result.rows.map((row, i) => (
                    <tr key={i}>
                      {result.columns.map((c) => (
                        <td key={c}>{formatCell(c, row[c])}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="qb-hint">{t('queryBuilder.noResults')}</p>
          )}
        </section>
      )}
    </div>
  );
}
