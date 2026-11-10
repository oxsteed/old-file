import { useState } from 'react';
import { Link } from 'react-router-dom';
import toast from 'react-hot-toast';
import { useTranslation } from 'react-i18next';
import { createCareerAlert, deleteCareerAlert, listCareerAlerts, listCareerFollows, unfollowCareerEmployer, updateCareerAlert } from '../../../api/careers';
import { ActionButton, Empty, Field, Loading, LoadError, useCareerErrors, useLoad } from '../ui';
import { ALERT_CHANNELS, ALERT_FREQUENCIES } from '../../../features/careers/marketplaceModel';

/** Job alerts (saved searches) and the employers the worker follows. */
export default function AlertsTab() {
  const { t } = useTranslation();
  const errorText = useCareerErrors();
  const alerts = useLoad(() => listCareerAlerts(), []);
  const follows = useLoad(() => listCareerFollows(), []);
  const [form, setForm] = useState({ name: '', q: '', near: '', frequency: 'daily', channels: ['in_app', 'email'] });
  const submit = async (e) => {
    e.preventDefault();
    try {
      const criteria = {};
      if (form.q.trim()) criteria.q = form.q.trim();
      if (form.near.trim()) criteria.near = form.near.trim();
      await createCareerAlert({ name: form.name.trim() || form.q.trim(), criteria, frequency: form.frequency, channels: form.channels });
      setForm((f) => ({ ...f, name: '', q: '', near: '' }));
      toast.success(t('careers.mk.alerts.created'));
      alerts.reload();
    } catch (err) { toast.error(errorText(err)); }
  };
  return (
    <div className="ox-careers-grid">
      <section className="ox-careers-section">
        <h2>{t('careers.mk.alerts.title')}</h2>
        <p className="ox-careers-subtle">{t('careers.mk.alerts.hint')} <Link to="/careers">{t('careers.mk.alerts.fromSearch')}</Link></p>
        {alerts.loading && !alerts.data ? <Loading /> : null}
        <LoadError error={alerts.error} onRetry={alerts.reload} />
        {alerts.data && !alerts.data.length ? <Empty>{t('careers.mk.alerts.none')}</Empty> : null}
        {(alerts.data || []).map((a) => (
          <article key={a.id} className="ox-careers-panel">
            <div className="ox-careers-row">
              <div>
                <strong>{a.name}</strong>
                <p className="ox-careers-subtle">{Object.entries(a.criteria || {}).map(([k, v]) => `${t(`careers.mk.alerts.criteria.${k}`)}: ${v}`).join(' · ')}</p>
              </div>
              <span className="ox-careers-chip">{t(`careers.mk.alerts.frequency.${a.frequency}`)}</span>
            </div>
            <div className="ox-careers-actions">
              <ActionButton onClick={async () => { await updateCareerAlert(a.id, { paused: !a.paused }); alerts.reload(); }}>{a.paused ? t('careers.mk.alerts.resume') : t('careers.mk.alerts.pause')}</ActionButton>
              <Link className="ox-careers-btn" to={`/careers?${new URLSearchParams(a.criteria || {}).toString()}`}>{t('careers.mk.alerts.seeJobs')}</Link>
              <ActionButton danger onClick={async () => { await deleteCareerAlert(a.id); alerts.reload(); }}>{t('careers.mk.alerts.delete')}</ActionButton>
            </div>
          </article>
        ))}
        <form className="ox-careers-panel" onSubmit={submit} data-track="ui.4cfaf93be4.1">
          <h3>{t('careers.mk.alerts.new')}</h3>
          <div className="ox-careers-form-grid">
            <Field label={t('careers.mk.alerts.name')} htmlFor="alert-name"><input id="alert-name" maxLength={80} value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} /></Field>
            <Field label={t('careers.searchPlaceholder')} htmlFor="alert-q"><input id="alert-q" maxLength={120} value={form.q} onChange={(e) => setForm((f) => ({ ...f, q: e.target.value }))} /></Field>
            <Field label={t('careers.filters.near')} htmlFor="alert-near"><input id="alert-near" maxLength={20} value={form.near} onChange={(e) => setForm((f) => ({ ...f, near: e.target.value }))} /></Field>
            <Field label={t('careers.mk.alerts.howOften')} htmlFor="alert-freq">
              <select id="alert-freq" value={form.frequency} onChange={(e) => setForm((f) => ({ ...f, frequency: e.target.value }))}>
                {ALERT_FREQUENCIES.map((x) => <option key={x} value={x}>{t(`careers.mk.alerts.frequency.${x}`)}</option>)}
              </select>
            </Field>
          </div>
          <fieldset className="ox-careers-yesno">
            <legend>{t('careers.mk.alerts.channels')}</legend>
            {ALERT_CHANNELS.map((c) => (
              <label key={c} className="ox-careers-check">
                <input type="checkbox" disabled={c === 'in_app'} checked={form.channels.includes(c)} onChange={(e) => setForm((f) => ({ ...f, channels: e.target.checked ? [...f.channels, c] : f.channels.filter((x) => x !== c) }))} data-track="ui.4cfaf93be4.2" />
                <span>{t(`careers.mk.alerts.channel.${c}`)}</span>
              </label>
            ))}
          </fieldset>
          <button type="submit" className="ox-careers-btn primary" disabled={!form.q.trim() && !form.near.trim()} data-track="ui.4cfaf93be4.3">{t('careers.mk.alerts.create')}</button>
        </form>
      </section>
      <section className="ox-careers-section">
        <h2>{t('careers.mk.follows.title')}</h2>
        {follows.data && !follows.data.length ? <Empty>{t('careers.mk.follows.none')}</Empty> : null}
        {(follows.data || []).map((f) => (
          <div key={f.business_id || 'platform'} className="ox-careers-row ox-careers-app">
            <Link to={`/careers/employers/${encodeURIComponent(f.employer_slug)}`}>{f.employer_name}</Link>
            <ActionButton onClick={async () => { await unfollowCareerEmployer(f.is_platform ? { employer: 'platform' } : { business_id: f.business_id }); follows.reload(); }}>{t('careers.mk.actions.unfollow')}</ActionButton>
          </div>
        ))}
      </section>
    </div>
  );
}
