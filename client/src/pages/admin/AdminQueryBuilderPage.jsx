// Admin: Analytics query builder (Phase 3, Item 11 — Tracks A + B).
// Structured, read-only queries over the governed metrics registry.
// Metric picker -> dimension checkboxes -> filter inputs -> period picker ->
// Run -> results table + client-side CSV export.
// The "Ask in plain language" section compiles English utterances via the
// deterministic nlParser (no LLM) into the builder query contract
//   { metric, dimensions, filters, period }
// The parsed interpretation is shown for confirmation BEFORE execution;
// confirming populates the builder and runs the server-validated compiled
// query with the raw utterance attached for the audit ledger.

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

  // Execute a server-validated compiled query directly (used by the NL
  // confirm flow to avoid racing the builder's setState). The raw utterance
  // rides along so the audit ledger records it.
  const executeCompiledQuery = useCallback(
    async (compiled, rawUtterance) => {
      if (running) return;
      setRunning(true);
      setRunError(null);
      try {
        const body = {
          metric: compiled.metric,
          dimensions: compiled.dimensions,
          filters: compiled.filters,
          period: compiled.period,
        };
        if (rawUtterance) body.raw_utterance = rawUtterance;
        const res = await api.post('/admin/analytics/query-builder/run', body);
        setResult(res.data);
      } catch (err) {
        logger.warn('query builder run failed', { metric: compiled.metric, message: err?.message });
        const data = err?.response?.data;
        setRunError(data?.error || data?.message || err?.message || t('queryBuilder.errorTitle'));
        setResult(null);
      } finally {
        setRunning(false);
      }
    },
    [running, t]
  );

  // ── Track B: natural-language input ─────────────────────────────────────
  // Validates a compiled builder query ({ metric, dimensions, filters,
  // period }) against the /meta catalog and populates the builder state.
  // Called by the NL confirm flow below.
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
    },
    [meta, t]
  );

  // The admin types a plain-English question; the deterministic parser
  // compiles it to a builder query (never SQL). The parsed interpretation
  // is shown for confirmation BEFORE anything executes — confirming
  // populates the builder and runs the server-validated compiled query
  // with the raw utterance attached for the audit ledger.
  const [nlUtterance, setNlUtterance] = useState('');
  const [nlParsing, setNlParsing] = useState(false);
  const [nlInterpretation, setNlInterpretation] = useState(null); // { compiled, description }
  const [nlRejection, setNlRejection] = useState(null); // reason string

  const interpretNl = useCallback(async () => {
    const text = nlUtterance.trim();
    if (!text || nlParsing) return;
    setNlParsing(true);
    setNlInterpretation(null);
    setNlRejection(null);
    try {
      const res = await api.post('/admin/analytics/query-builder/nl-parse', { utterance: text });
      if (res.data.rejected) {
        setNlRejection(res.data.reason);
      } else {
        setNlInterpretation(res.data.interpretation);
      }
    } catch (err) {
      logger.warn('nl parse failed', { message: err?.message });
      const data = err?.response?.data;
      setNlRejection(data?.error || data?.message || err?.message || t('queryBuilder.nlParseFailed'));
    } finally {
      setNlParsing(false);
    }
  }, [nlUtterance, nlParsing, t]);

  const confirmNlInterpretation = useCallback(() => {
    if (!nlInterpretation || running) return;
    const { compiled } = nlInterpretation;
    handleNlCompiled(compiled); // populates the builder UI
    executeCompiledQuery(compiled, nlUtterance.trim()); // runs; utterance -> audit ledger
    setNlInterpretation(null);
    setNlUtterance('');
  }, [nlInterpretation, nlUtterance, running, handleNlCompiled, executeCompiledQuery]);

  const cancelNlInterpretation = useCallback(() => {
    setNlInterpretation(null);
    setNlRejection(null);
  }, []);

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

      {/* ── Natural-language input (Track B) ────────────────────────────────
          Deterministic English-only parser. The interpretation is shown for
          confirmation BEFORE anything executes; confirming populates the
          builder above and runs the server-validated compiled query. */}
      <section className="qb-nl-section" data-testid="nl-query-section" aria-label={t('queryBuilder.nlSectionTitle')}>
        <div className="qb-nl-header">
          <MessageSquare size={16} />
          <h2>{t('queryBuilder.nlSectionTitle')}</h2>
        </div>
        <p className="qb-nl-body">{t('queryBuilder.nlSectionBody')}</p>
        <div className="qb-nl-row">
          <input
            className="qb-input qb-nl-input"
            type="text"
            value={nlUtterance}
            onChange={(e) => setNlUtterance(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') interpretNl();
            }}
            placeholder={t('queryBuilder.nlPlaceholder')}
            aria-label={t('queryBuilder.nlSectionTitle')}
            maxLength={500}
            disabled={nlParsing}
          />
          <button
            type="button"
            className="qb-btn qb-btn-secondary"
            onClick={interpretNl}
            disabled={nlParsing || !nlUtterance.trim()}
          >
            {nlParsing ? t('queryBuilder.nlParsing') : t('queryBuilder.nlInterpret')}
          </button>
        </div>
        <p className="qb-nl-note">{t('queryBuilder.nlEnglishOnly')}</p>
        {nlRejection && (
          <div className="qb-error" role="alert">
            <AlertTriangle size={16} />
            <span>
              {t('queryBuilder.nlRejected')}: {nlRejection}
            </span>
            <button type="button" className="qb-btn qb-btn-secondary" onClick={cancelNlInterpretation}>
              {t('queryBuilder.nlDismiss')}
            </button>
          </div>
        )}
        {nlInterpretation && (
          <div className="qb-nl-interpretation" data-testid="nl-interpretation">
            <p className="qb-nl-interpretation-title">{t('queryBuilder.nlInterpretationTitle')}</p>
            <p className="qb-nl-interpretation-desc">{nlInterpretation.description}</p>
            <pre className="qb-nl-interpretation-query">
              {JSON.stringify(nlInterpretation.compiled, null, 2)}
            </pre>
            <div className="qb-nl-actions">
              <button
                type="button"
                className="qb-btn qb-btn-primary"
                onClick={confirmNlInterpretation}
                disabled={running}
              >
                <Play size={14} />
                {t('queryBuilder.nlConfirmRun')}
              </button>
              <button
                type="button"
                className="qb-btn qb-btn-secondary"
                onClick={cancelNlInterpretation}
              >
                {t('queryBuilder.nlDismiss')}
              </button>
            </div>
          </div>
        )}
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
