import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import PageMeta from '../components/PageMeta';
import PageShell from '../components/PageShell';
import CountrySelect from '../components/CountrySelect';
import { getSalaryInsights } from '../api/careers';
import { Empty, Field, Loading, Notice, useCareerErrors } from '../components/careers/ui';
import '../styles/CareerSystem.css';

const KEYS = ['p10', 'p25', 'median', 'p75', 'p90'];

/** Salary insights: percentiles from posted pay and moderated worker reports. */
export default function CareerSalariesPage() {
  const { t, i18n } = useTranslation();
  const errorText = useCareerErrors();
  const [params, setParams] = useSearchParams();
  const [form, setForm] = useState({ title: params.get('title') || '', country: params.get('country') || '', region: params.get('region') || '', currency: params.get('currency') || 'USD' });
  const [state, setState] = useState({ loading: false, data: null, error: null });
  const money = (v, cur) => new Intl.NumberFormat(i18n.language, { style: 'currency', currency: cur, maximumFractionDigits: v < 100 ? 2 : 0 }).format(v);

  const run = async (e) => {
    e?.preventDefault();
    if (form.title.trim().length < 2) return;
    setParams(Object.fromEntries(Object.entries(form).filter(([, v]) => v)), { replace: true });
    setState({ loading: true, data: null, error: null });
    try { setState({ loading: false, data: await getSalaryInsights({ ...form, country: form.country || undefined, region: form.region || undefined }), error: null }); } catch (err) { setState({ loading: false, data: null, error: err }); }
  };
  const d = state.data;
  return (
    <PageShell>
      <PageMeta title={t('careers.mk.salaries.metaTitle')} description={t('careers.mk.salaries.metaDesc')} />
      <div className="ox-careers">
        <Link className="ox-careers-btn" to="/careers">{t('careers.back')}</Link>
        <h1>{t('careers.mk.salaries.title')}</h1>
        <p className="ox-careers-lead">{t('careers.mk.salaries.lead')}</p>
        <form className="ox-careers-panel" role="search" onSubmit={run} data-track="ui.596a1c2005.1">
          <div className="ox-careers-form-grid">
            <Field label={t('careers.mk.salaries.jobTitle')} htmlFor="sal-title"><input id="sal-title" maxLength={120} value={form.title} onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))} /></Field>
            <Field label={t('careers.mk.salaries.country')} htmlFor="sal-country"><CountrySelect id="sal-country" value={form.country} onChange={(v) => setForm((f) => ({ ...f, country: v }))} /></Field>
            <Field label={t('careers.mk.salaries.region')} htmlFor="sal-region"><input id="sal-region" maxLength={80} value={form.region} onChange={(e) => setForm((f) => ({ ...f, region: e.target.value }))} /></Field>
            <Field label={t('careers.mk.salaries.currency')} htmlFor="sal-cur"><input id="sal-cur" maxLength={3} dir="ltr" value={form.currency} onChange={(e) => setForm((f) => ({ ...f, currency: e.target.value.toUpperCase() }))} /></Field>
          </div>
          <button type="submit" className="ox-careers-btn primary" disabled={form.title.trim().length < 2} data-track="ui.596a1c2005.2">{t('careers.mk.salaries.show')}</button>
        </form>
        {state.loading ? <Loading /> : null}
        {state.error ? <Notice tone="error">{errorText(state.error)}</Notice> : null}
        {d && !d.available ? <Empty>{t('careers.mk.salaries.notEnough', { count: d.sample })}</Empty> : null}
        {d?.available ? (
          <section className="ox-careers-section">
            <h2>{t('careers.mk.salaries.resultTitle', { title: d.title })}</h2>
            <table className="ox-careers-table">
              <thead><tr><th scope="col">{t('careers.mk.salaries.percentile')}</th><th scope="col">{t('careers.period.hourly')}</th><th scope="col">{t('careers.period.yearly')}</th></tr></thead>
              <tbody>
                {KEYS.map((k) => (
                  <tr key={k}><th scope="row">{t(`careers.mk.salaries.p.${k}`)}</th><td>{money(d.percentiles[k].hourly, d.currency_code)}</td><td>{money(d.percentiles[k].yearly, d.currency_code)}</td></tr>
                ))}
              </tbody>
            </table>
            <p className="ox-careers-subtle">{t('careers.mk.salaries.basis', { count: d.sample, postings: d.from_postings, reports: d.from_reports })}</p>
          </section>
        ) : null}
        <Notice>{t('careers.mk.salaries.method')}</Notice>
      </div>
    </PageShell>
  );
}
