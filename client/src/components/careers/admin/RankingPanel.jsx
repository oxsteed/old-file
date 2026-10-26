import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import toast from 'react-hot-toast';
import {
  adminListFairnessReports, adminListRankingMarkets, adminReviewFairnessReport, adminReviewRankingBlock, adminRunFairness, adminSaveRankingMarket,
} from '../../../api/careers';
import { fieldErrorsFrom, formatDate } from '../../../features/careers/careersModel';
import { ActionButton, Check, Empty, ErrorNotice, Field, Loading, LoadError, Notice, useLoad } from '../ui';

const EMPTY = { market: '', bias_audit_ref: '', bias_audit_passed_at: '', bias_audit_expires_at: '', bias_audit_summary_url: '', ai_act_signed_off_at: '', dpia_covers_ranking_at: '', enabled: false };
const day = (v) => (v ? String(v).slice(0, 10) : '');

/** Lowest impact ratio across steps and EEO dimensions (city proxy shown apart). */
export function lowestRatios(metrics) {
  let eeo = null;
  let proxy = null;
  for (const step of Object.values(metrics?.steps || {})) {
    for (const [dim, r] of Object.entries(step)) {
      if (r?.minRatio == null) continue;
      if (dim === 'city_proxy') proxy = proxy == null ? r.minRatio : Math.min(proxy, r.minRatio);
      else eeo = eeo == null ? r.minRatio : Math.min(eeo, r.minRatio);
    }
  }
  return { eeo, proxy };
}

function MarketForm({ initial, onSaved }) {
  const { t } = useTranslation();
  const [f, setF] = useState(initial);
  const [errors, setErrors] = useState({});
  const [error, setError] = useState(null);
  const field = (k, type = 'date') => (
    <Field label={t(`careers.admin.market.${k}`)} htmlFor={`mk-${k}`} error={errors[k]}>
      <input id={`mk-${k}`} type={type} value={f[k] || ''} onChange={(e) => setF({ ...f, [k]: e.target.value })} />
    </Field>
  );
  return (
    <div className="ox-careers-panel">
      <div className="ox-careers-form-grid">
        <Field label={t('careers.admin.market.market')} htmlFor="mk-market" hint={t('careers.admin.market.marketHint')} error={errors.market}>
          <input id="mk-market" value={f.market} disabled={Boolean(initial.market)} onChange={(e) => setF({ ...f, market: e.target.value.toUpperCase() })} />
        </Field>
        {field('bias_audit_ref', 'text')}
        {field('bias_audit_passed_at')}
        {field('bias_audit_expires_at')}
        {field('bias_audit_summary_url', 'url')}
        {field('ai_act_signed_off_at')}
        {field('dpia_covers_ranking_at')}
      </div>
      <Check id="mk-enabled" label={t('careers.admin.market.enabled')} checked={f.enabled} onChange={(v) => setF({ ...f, enabled: v })} />
      <ErrorNotice error={error} />
      <ActionButton
        primary
        disabled={!f.market}
        onClick={async () => {
          setError(null);
          setErrors({});
          try {
            const { market, ...rest } = f;
            await adminSaveRankingMarket(market, rest);
            toast.success(t('careers.admin.saved'));
            onSaved();
          } catch (err) { setErrors(fieldErrorsFrom(err)); setError(err); }
        }}
      >
        {t('careers.admin.saveMarket')}
      </ActionButton>
    </div>
  );
}

export default function RankingPanel() {
  const { t, i18n } = useTranslation();
  const markets = useLoad(() => adminListRankingMarkets(), []);
  const reports = useLoad(() => adminListFairnessReports(), []);
  const [editing, setEditing] = useState(null);
  const [blockNotes, setBlockNotes] = useState({});
  const [run, setRun] = useState({ kind: 'monthly_ranking', period_start: '', period_end: '' });
  const d = markets.data || {};
  return (
    <div className="ox-careers-grid">
      <Notice>{t('careers.admin.rankingIntro')}</Notice>
      {d.globally_enabled === false ? <Notice tone="warn">{t('careers.admin.rankingGlobalOff')}</Notice> : null}
      {markets.loading && !markets.data ? <Loading /> : null}
      <LoadError error={markets.error} onRetry={markets.reload} />
      <section className="ox-careers-panel">
        <div className="ox-careers-row">
          <h2>{t('careers.admin.marketsTitle')}</h2>
          <button type="button" className="ox-careers-btn" onClick={() => setEditing({ ...EMPTY })}>{t('careers.admin.addMarket')}</button>
        </div>
        {(d.markets || []).length ? (
          <table className="ox-careers-table">
            <thead><tr><th>{t('careers.admin.market.market')}</th><th>{t('careers.admin.market.bias_audit_expires_at')}</th><th>{t('careers.admin.market.ai_act_signed_off_at')}</th><th>{t('careers.admin.market.dpia_covers_ranking_at')}</th><th>{t('careers.admin.market.enabled')}</th><th /></tr></thead>
            <tbody>
              {d.markets.map((m) => (
                <tr key={m.market}>
                  <td>{m.market}{m.is_eu ? ' (EU)' : ''}</td>
                  <td>{formatDate(m.bias_audit_expires_at, i18n.language)}</td>
                  <td>{formatDate(m.ai_act_signed_off_at, i18n.language)}</td>
                  <td>{formatDate(m.dpia_covers_ranking_at, i18n.language)}</td>
                  <td>{m.enabled ? t('careers.common.yes') : t('careers.common.no')}</td>
                  <td>
                    <button type="button" className="ox-careers-btn" onClick={() => setEditing({ ...EMPTY, ...m, bias_audit_passed_at: day(m.bias_audit_passed_at), bias_audit_expires_at: day(m.bias_audit_expires_at), ai_act_signed_off_at: day(m.ai_act_signed_off_at), dpia_covers_ranking_at: day(m.dpia_covers_ranking_at), bias_audit_ref: m.bias_audit_ref || '', bias_audit_summary_url: m.bias_audit_summary_url || '' })}>
                      {t('careers.employer.edit')}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : <Empty>{t('careers.admin.noMarkets')}</Empty>}
        {editing ? <MarketForm key={editing.market || 'new'} initial={editing} onSaved={() => { setEditing(null); markets.reload(); }} /> : null}
      </section>

      <section className="ox-careers-panel">
        <h2>{t('careers.admin.blocksTitle')}</h2>
        <p className="ox-careers-subtle">{t('careers.admin.blocksIntro')}</p>
        {(d.blocks || []).length ? d.blocks.map((b) => (
          <div key={b.id} className="ox-careers-app">
            <div className="ox-careers-row">
              <span>{b.scope_type}: {b.scope_ref} · {t('careers.admin.ratio', { ratio: Number(b.impact_ratio).toFixed(2) })}</span>
              <span className={`ox-careers-chip ${b.reviewed_at ? 'ok' : 'bad'}`}>{b.reviewed_at ? t('careers.admin.reviewed') : t('careers.admin.blocked')}</span>
            </div>
            {!b.reviewed_at ? (
              <div className="ox-careers-row">
                <input aria-label={t('careers.admin.note')} placeholder={t('careers.admin.reviewNote')} value={blockNotes[b.id] || ''} onChange={(e) => setBlockNotes({ ...blockNotes, [b.id]: e.target.value })} />
                <ActionButton disabled={!blockNotes[b.id]} onClick={async () => { await adminReviewRankingBlock(b.id, blockNotes[b.id]); markets.reload(); }}>{t('careers.admin.markReviewed')}</ActionButton>
              </div>
            ) : null}
          </div>
        )) : <Empty>{t('careers.admin.noBlocks')}</Empty>}
      </section>

      <section className="ox-careers-panel">
        <h2>{t('careers.admin.fairnessTitle')}</h2>
        <div className="ox-careers-filters">
          <select aria-label={t('careers.admin.kind')} value={run.kind} onChange={(e) => setRun({ ...run, kind: e.target.value })}>
            <option value="monthly_ranking">{t('careers.admin.kinds.monthly_ranking')}</option>
            <option value="quarterly">{t('careers.admin.kinds.quarterly')}</option>
          </select>
          <input aria-label={t('careers.paid.starts')} type="date" value={run.period_start} onChange={(e) => setRun({ ...run, period_start: e.target.value })} />
          <input aria-label={t('careers.paid.ends')} type="date" value={run.period_end} onChange={(e) => setRun({ ...run, period_end: e.target.value })} />
          <ActionButton onClick={async () => { await adminRunFairness({ kind: run.kind, period_start: run.period_start || undefined, period_end: run.period_end || undefined }); reports.reload(); markets.reload(); toast.success(t('careers.admin.ran')); }}>
            {t('careers.admin.runNow')}
          </ActionButton>
        </div>
        {reports.loading && !reports.data ? <Loading /> : null}
        <LoadError error={reports.error} onRetry={reports.reload} />
        {(reports.data?.reports || []).length ? (
          <table className="ox-careers-table">
            <thead><tr><th>{t('careers.admin.kind')}</th><th>{t('careers.admin.scope')}</th><th>{t('careers.admin.period')}</th><th>{t('careers.admin.lowestRatio')}</th><th>{t('careers.admin.proxyRatio')}</th><th /></tr></thead>
            <tbody>
              {reports.data.reports.map((r) => {
                const low = lowestRatios(r.metrics);
                return (
                  <tr key={r.id}>
                    <td>{t(`careers.admin.kinds.${r.kind}`)}</td>
                    <td>{r.scope_type}: {r.scope_ref}</td>
                    <td>{formatDate(r.period_start, i18n.language)} – {formatDate(r.period_end, i18n.language)}</td>
                    <td className={low.eeo != null && low.eeo < 0.8 ? 'ox-careers-error' : ''}>{low.eeo == null ? '—' : low.eeo.toFixed(2)}</td>
                    <td>{low.proxy == null ? '—' : low.proxy.toFixed(2)}</td>
                    <td>{r.reviewed_at ? t('careers.admin.reviewed') : <ActionButton onClick={async () => { await adminReviewFairnessReport(r.id); reports.reload(); }}>{t('careers.admin.markReviewed')}</ActionButton>}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        ) : <Empty>{t('careers.admin.noReports')}</Empty>}
      </section>
    </div>
  );
}
