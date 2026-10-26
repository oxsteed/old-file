import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import toast from 'react-hot-toast';
import {
  adminListEorMarkets, adminListPayRules, adminListRetentionRules, adminRevokeEorMarket, adminSaveEorMarket, adminSavePayRule, adminSaveRetentionRule,
} from '../../../api/careers';
import { fieldErrorsFrom, formatDate } from '../../../features/careers/careersModel';
import { ActionButton, Check, Empty, ErrorNotice, Field, Loading, LoadError, Notice, useLoad } from '../ui';

function useSaver(onSaved) {
  const { t } = useTranslation();
  const [errors, setErrors] = useState({});
  const [error, setError] = useState(null);
  const run = async (fn) => {
    setErrors({});
    setError(null);
    try { await fn(); toast.success(t('careers.admin.saved')); onSaved(); } catch (err) { setErrors(fieldErrorsFrom(err)); setError(err); }
  };
  return { errors, error, run };
}

export function EorPanel() {
  const { t, i18n } = useTranslation();
  const list = useLoad(() => adminListEorMarkets(), []);
  const [f, setF] = useState({ country: '', region: '', licence_ref: '' });
  const saver = useSaver(() => { setF({ country: '', region: '', licence_ref: '' }); list.reload(); });
  return (
    <div className="ox-careers-grid">
      <Notice>{t('careers.admin.eorIntro')}</Notice>
      {list.data && !list.data.provider_configured ? <Notice tone="warn">{t('careers.admin.eorUnconfigured')}</Notice> : null}
      {list.loading && !list.data ? <Loading /> : null}
      <LoadError error={list.error} onRetry={list.reload} />
      {(list.data?.markets || []).length ? (
        <table className="ox-careers-table">
          <thead><tr><th>{t('careers.fields.country')}</th><th>{t('careers.fields.region')}</th><th>{t('careers.admin.licence')}</th><th>{t('careers.admin.approvedAt')}</th><th /></tr></thead>
          <tbody>
            {list.data.markets.map((m) => (
              <tr key={`${m.country}-${m.region}`}>
                <td>{m.country}</td><td>{m.region || '—'}</td><td>{m.licence_ref}</td>
                <td>{m.revoked_at ? t('careers.admin.revokedOn', { date: formatDate(m.revoked_at, i18n.language) }) : formatDate(m.approved_at, i18n.language)}</td>
                <td>{!m.revoked_at ? <ActionButton danger onClick={async () => { await adminRevokeEorMarket(m.country, m.region); list.reload(); }}>{t('careers.scopes.revoke')}</ActionButton> : null}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : <Empty>{t('careers.admin.noEorMarkets')}</Empty>}
      <div className="ox-careers-panel ox-careers-form-grid">
        <Field label={t('careers.fields.country')} htmlFor="eor-country" error={saver.errors.country}><input id="eor-country" maxLength={2} value={f.country} onChange={(e) => setF({ ...f, country: e.target.value.toUpperCase() })} /></Field>
        <Field label={t('careers.fields.region')} htmlFor="eor-region" error={saver.errors.region}><input id="eor-region" maxLength={6} value={f.region} onChange={(e) => setF({ ...f, region: e.target.value.toUpperCase() })} /></Field>
        <Field label={t('careers.admin.licence')} htmlFor="eor-licence" error={saver.errors.licence_ref}><input id="eor-licence" value={f.licence_ref} onChange={(e) => setF({ ...f, licence_ref: e.target.value })} /></Field>
        <div><ActionButton primary onClick={() => saver.run(() => adminSaveEorMarket(f))}>{t('careers.admin.approveMarket')}</ActionButton></div>
      </div>
      <ErrorNotice error={saver.error} />
    </div>
  );
}

export function RetentionPanel() {
  const { t, i18n } = useTranslation();
  const list = useLoad(() => adminListRetentionRules(), []);
  const blank = { country: '', region: '', applies_to: 'application', keep_months: 12, legal_source: '', legal_reviewed: false };
  const [f, setF] = useState(blank);
  const saver = useSaver(() => { setF(blank); list.reload(); });
  return (
    <div className="ox-careers-grid">
      <Notice>{t('careers.admin.retentionIntro')}</Notice>
      {list.loading && !list.data ? <Loading /> : null}
      <LoadError error={list.error} onRetry={list.reload} />
      {(list.data?.rules || []).length ? (
        <table className="ox-careers-table">
          <thead><tr><th>{t('careers.fields.country')}</th><th>{t('careers.fields.region')}</th><th>{t('careers.admin.appliesTo')}</th><th>{t('careers.admin.months')}</th><th>{t('careers.admin.legalSource')}</th><th>{t('careers.admin.legalReviewed')}</th></tr></thead>
          <tbody>
            {list.data.rules.map((r) => (
              <tr key={r.id}>
                <td>{r.country}</td><td>{r.region || '—'}</td><td>{t(`careers.admin.applies.${r.applies_to}`)}</td><td>{r.keep_months}</td><td>{r.legal_source}</td>
                <td>{r.reviewed_at ? formatDate(r.reviewed_at, i18n.language) : <span className="ox-careers-chip warn">{t('careers.admin.needsReview')}</span>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : <Empty>{t('careers.admin.noRules')}</Empty>}
      <div className="ox-careers-panel">
        <div className="ox-careers-form-grid">
          <Field label={t('careers.fields.country')} htmlFor="ret-country" error={saver.errors.country}><input id="ret-country" maxLength={2} value={f.country} onChange={(e) => setF({ ...f, country: e.target.value.toUpperCase() })} /></Field>
          <Field label={t('careers.fields.region')} htmlFor="ret-region"><input id="ret-region" maxLength={3} value={f.region} onChange={(e) => setF({ ...f, region: e.target.value.toUpperCase() })} /></Field>
          <Field label={t('careers.admin.appliesTo')} htmlFor="ret-applies" error={saver.errors.applies_to}>
            <select id="ret-applies" value={f.applies_to} onChange={(e) => setF({ ...f, applies_to: e.target.value })}>
              {['application', 'eeo', 'ai_run', 'background_check'].map((a) => <option key={a} value={a}>{t(`careers.admin.applies.${a}`)}</option>)}
            </select>
          </Field>
          <Field label={t('careers.admin.months')} htmlFor="ret-months" error={saver.errors.keep_months}><input id="ret-months" type="number" min={1} max={120} value={f.keep_months} onChange={(e) => setF({ ...f, keep_months: Number(e.target.value) })} /></Field>
        </div>
        <Field label={t('careers.admin.legalSource')} htmlFor="ret-source" error={saver.errors.legal_source}><input id="ret-source" value={f.legal_source} onChange={(e) => setF({ ...f, legal_source: e.target.value })} /></Field>
        <Check id="ret-reviewed" label={t('careers.admin.counselReviewed')} checked={f.legal_reviewed} onChange={(v) => setF({ ...f, legal_reviewed: v })} />
        <ActionButton primary onClick={() => saver.run(() => adminSaveRetentionRule({ ...f, region: f.region || null }))}>{t('careers.admin.saveRule')}</ActionButton>
        <ErrorNotice error={saver.error} />
      </div>
    </div>
  );
}

const FLAGS = ['pay_range_required', 'benefits_required', 'close_date_required', 'pay_history_banned', 'gender_neutral_titles', 'internal_promotion_notice'];

export function PayRulesPanel() {
  const { t, i18n } = useTranslation();
  const list = useLoad(() => adminListPayRules(), []);
  const blank = { code: '', legal_ref: '', min_employees: '', in_force_from: '', legal_reviewed: false, ...Object.fromEntries(FLAGS.map((k) => [k, ['pay_range_required', 'pay_history_banned'].includes(k)])) };
  const [f, setF] = useState(blank);
  const saver = useSaver(() => { setF(blank); list.reload(); });
  return (
    <div className="ox-careers-grid">
      <Notice>{t('careers.admin.payRulesIntro')}</Notice>
      {list.loading && !list.data ? <Loading /> : null}
      <LoadError error={list.error} onRetry={list.reload} />
      {(list.data?.rules || []).length ? (
        <table className="ox-careers-table">
          <thead><tr><th>{t('careers.admin.code')}</th>{FLAGS.map((k) => <th key={k}>{t(`careers.admin.flags.${k}`)}</th>)}<th>{t('careers.admin.legalReviewed')}</th><th /></tr></thead>
          <tbody>
            {list.data.rules.map((r) => (
              <tr key={r.code}>
                <td>{r.code}</td>
                {FLAGS.map((k) => <td key={k}>{r[k] ? '✓' : ''}</td>)}
                <td>{r.reviewed_at ? formatDate(r.reviewed_at, i18n.language) : <span className="ox-careers-chip warn">{t('careers.admin.needsReview')}</span>}</td>
                <td><button type="button" className="ox-careers-btn" onClick={() => setF({ ...blank, ...r, min_employees: r.min_employees ?? '', in_force_from: r.in_force_from ? String(r.in_force_from).slice(0, 10) : '', legal_reviewed: false })}>{t('careers.employer.edit')}</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : <Empty>{t('careers.admin.noRules')}</Empty>}
      <div className="ox-careers-panel">
        <div className="ox-careers-form-grid">
          <Field label={t('careers.admin.code')} htmlFor="pr-code" hint={t('careers.admin.codeHint')} error={saver.errors.code}><input id="pr-code" value={f.code} onChange={(e) => setF({ ...f, code: e.target.value.toUpperCase() })} /></Field>
          <Field label={t('careers.admin.minEmployees')} htmlFor="pr-min" error={saver.errors.min_employees}><input id="pr-min" type="number" min={1} value={f.min_employees} onChange={(e) => setF({ ...f, min_employees: e.target.value })} /></Field>
          <Field label={t('careers.admin.inForce')} htmlFor="pr-force" error={saver.errors.in_force_from}><input id="pr-force" type="date" value={f.in_force_from} onChange={(e) => setF({ ...f, in_force_from: e.target.value })} /></Field>
        </div>
        <Field label={t('careers.admin.legalSource')} htmlFor="pr-ref" error={saver.errors.legal_ref}><input id="pr-ref" value={f.legal_ref} onChange={(e) => setF({ ...f, legal_ref: e.target.value })} /></Field>
        {FLAGS.map((k) => <Check key={k} id={`pr-${k}`} label={t(`careers.admin.flags.${k}`)} checked={f[k]} onChange={(v) => setF({ ...f, [k]: v })} />)}
        <Check id="pr-reviewed" label={t('careers.admin.counselReviewed')} checked={f.legal_reviewed} onChange={(v) => setF({ ...f, legal_reviewed: v })} />
        <ActionButton
          primary
          disabled={!f.code}
          onClick={() => saver.run(() => {
            const { code, ...rest } = f;
            return adminSavePayRule(code, { ...Object.fromEntries(FLAGS.map((k) => [k, rest[k]])), legal_ref: rest.legal_ref, min_employees: rest.min_employees || null, in_force_from: rest.in_force_from || null, legal_reviewed: rest.legal_reviewed });
          })}
        >
          {t('careers.admin.saveRule')}
        </ActionButton>
        <ErrorNotice error={saver.error} />
      </div>
    </div>
  );
}
