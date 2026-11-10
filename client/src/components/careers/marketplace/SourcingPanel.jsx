import { useState } from 'react';
import toast from 'react-hot-toast';
import { useTranslation } from 'react-i18next';
import {
  addShortlistMember, createCandidateAlert, createShortlist, deleteCandidateAlert, deleteShortlist, listCandidateAlerts, listShortlistMembers,
  listShortlists, removeShortlistMember, updateCandidateAlert,
} from '../../../api/careers';
import { ActionButton, Check, Empty, Field, Loading, useCareerErrors, useLoad } from '../ui';

/** Add a talent-search result to one of the business's shortlists. */
export function ShortlistAdd({ businessId, userId }) {
  const { t } = useTranslation();
  const errorText = useCareerErrors();
  const lists = useLoad(() => listShortlists(businessId).catch(() => []), [businessId]);
  const [target, setTarget] = useState('');
  if (!(lists.data || []).length) return null;
  return (
    <div className="ox-careers-actions">
      <select aria-label={t('careers.mk.sourcing.shortlist')} value={target} onChange={(e) => setTarget(e.target.value)}>
        <option value="">{t('careers.mk.sourcing.pickShortlist')}</option>
        {lists.data.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
      </select>
      <button type="button" className="ox-careers-btn" disabled={!target} onClick={async () => {
        try { await addShortlistMember(businessId, target, { user_id: userId }); toast.success(t('careers.mk.sourcing.added')); } catch (err) { toast.error(errorText(err)); }
      }} data-track="ui.67012854dd.1"
      >{t('careers.mk.sourcing.add')}</button>
    </div>
  );
}

function Members({ businessId, shortlist }) {
  const { t } = useTranslation();
  const members = useLoad(() => listShortlistMembers(businessId, shortlist.id), [businessId, shortlist.id]);
  if (members.loading && !members.data) return <Loading />;
  if (!(members.data || []).length) return <Empty>{t('careers.mk.sourcing.emptyList')}</Empty>;
  return members.data.map((m) => (
    <div key={m.user_id} className="ox-careers-row ox-careers-app">
      {m.hidden ? <span className="ox-careers-subtle">{t('careers.mk.sourcing.hidden')}</span> : (
        <div>
          <strong>{m.display_name}</strong> {m.available_now ? <span className="ox-careers-chip ok">{t('careers.mk.badges.availableNow')}</span> : null}
          {m.headline ? <p className="ox-careers-subtle">{m.headline}</p> : null}
          {m.note ? <p className="ox-careers-subtle">{m.note}</p> : null}
        </div>
      )}
      <ActionButton onClick={async () => { await removeShortlistMember(businessId, shortlist.id, m.user_id); members.reload(); }}>{t('careers.mk.scheduling.remove')}</ActionButton>
    </div>
  ));
}

/** "New matching candidate" alerts and talent shortlists. */
export default function SourcingPanel({ ctx, openings = [], locations = [] }) {
  const { t } = useTranslation();
  const errorText = useCareerErrors();
  const alerts = useLoad(() => listCandidateAlerts(ctx.businessId), [ctx.businessId]);
  const lists = useLoad(() => listShortlists(ctx.businessId), [ctx.businessId]);
  const [form, setForm] = useState({ name: '', near_location: 'business', radius_km: 25, skills: '', available_now: false, opening_id: '' });
  const [listName, setListName] = useState('');
  const [open, setOpen] = useState(null);
  return (
    <div className="ox-careers-grid">
      <section className="ox-careers-section">
        <h3>{t('careers.mk.sourcing.alertsTitle')}</h3>
        <p className="ox-careers-subtle">{t('careers.mk.sourcing.alertsHint')}</p>
        {(alerts.data || []).map((a) => (
          <div key={a.id} className="ox-careers-row ox-careers-app">
            <div><strong>{a.name}</strong><p className="ox-careers-subtle">{t('careers.filters.withinKm', { km: a.criteria?.radius_km })}{a.criteria?.available_now ? ` · ${t('careers.mk.badges.availableNow')}` : ''}{(a.criteria?.skills || []).length ? ` · ${a.criteria.skills.join(', ')}` : ''}</p></div>
            <div className="ox-careers-actions">
              <ActionButton onClick={async () => { await updateCandidateAlert(ctx.businessId, a.id, { paused: !a.paused }); alerts.reload(); }}>{a.paused ? t('careers.mk.alerts.resume') : t('careers.mk.alerts.pause')}</ActionButton>
              <ActionButton danger onClick={async () => { await deleteCandidateAlert(ctx.businessId, a.id); alerts.reload(); }}>{t('careers.mk.alerts.delete')}</ActionButton>
            </div>
          </div>
        ))}
        <form className="ox-careers-panel" onSubmit={async (e) => {
          e.preventDefault();
          try {
            await createCandidateAlert(ctx.businessId, {
              name: form.name, opening_id: form.opening_id || null,
              criteria: { near_location: form.near_location === 'business' ? 'business' : Number(form.near_location), radius_km: Number(form.radius_km), skills: form.skills.split(',').map((s) => s.trim()).filter(Boolean), available_now: form.available_now },
            });
            setForm((f) => ({ ...f, name: '' })); alerts.reload(); toast.success(t('careers.mk.alerts.created'));
          } catch (err) { toast.error(errorText(err)); }
        }} data-track="ui.67012854dd.2"
        >
          <div className="ox-careers-form-grid">
            <Field label={t('careers.mk.alerts.name')} htmlFor="ca-name"><input id="ca-name" maxLength={80} value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} /></Field>
            <Field label={t('careers.mk.sourcing.near')} htmlFor="ca-near">
              <select id="ca-near" value={form.near_location} onChange={(e) => setForm((f) => ({ ...f, near_location: e.target.value }))}>
                <option value="business">{t('careers.mk.sourcing.businessLocation')}</option>
                {locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
              </select>
            </Field>
            <Field label={t('careers.filters.radius')} htmlFor="ca-radius">
              <select id="ca-radius" value={form.radius_km} onChange={(e) => setForm((f) => ({ ...f, radius_km: e.target.value }))}>
                {[5, 10, 25, 50, 100].map((r) => <option key={r} value={r}>{t('careers.filters.withinKm', { km: r })}</option>)}
              </select>
            </Field>
            <Field label={t('careers.mk.sourcing.skills')} htmlFor="ca-skills" hint={t('careers.mk.sourcing.skillsHint')}><input id="ca-skills" value={form.skills} onChange={(e) => setForm((f) => ({ ...f, skills: e.target.value }))} /></Field>
            <Field label={t('careers.talent.opening')} htmlFor="ca-opening">
              <select id="ca-opening" value={form.opening_id} onChange={(e) => setForm((f) => ({ ...f, opening_id: e.target.value }))}>
                <option value="">{t('careers.common.none')}</option>
                {openings.map((o) => <option key={o.id} value={o.id}>{o.title}</option>)}
              </select>
            </Field>
          </div>
          <Check id="ca-now" label={t('careers.mk.sourcing.onlyAvailable')} checked={form.available_now} onChange={(v) => setForm((f) => ({ ...f, available_now: v }))} />
          <button type="submit" className="ox-careers-btn primary" disabled={!form.name.trim()} data-track="ui.67012854dd.3">{t('careers.mk.alerts.create')}</button>
        </form>
      </section>
      <section className="ox-careers-section">
        <h3>{t('careers.mk.sourcing.shortlistsTitle')}</h3>
        <p className="ox-careers-subtle">{t('careers.mk.sourcing.shortlistsHint')}</p>
        {(lists.data || []).map((s) => (
          <article key={s.id} className="ox-careers-app">
            <div className="ox-careers-row">
              <button type="button" className="ox-careers-link" aria-expanded={open === s.id} onClick={() => setOpen(open === s.id ? null : s.id)} data-track="ui.67012854dd.4">{s.name} ({s.members})</button>
              <ActionButton danger confirm={t('careers.mk.sourcing.deleteConfirm')} onClick={async () => { await deleteShortlist(ctx.businessId, s.id); lists.reload(); }}>{t('careers.mk.resume.delete')}</ActionButton>
            </div>
            {open === s.id ? <Members businessId={ctx.businessId} shortlist={s} /> : null}
          </article>
        ))}
        <form className="ox-careers-actions" onSubmit={async (e) => {
          e.preventDefault();
          try { await createShortlist(ctx.businessId, { name: listName }); setListName(''); lists.reload(); } catch (err) { toast.error(errorText(err)); }
        }} data-track="ui.67012854dd.5"
        >
          <input aria-label={t('careers.mk.sourcing.newShortlist')} placeholder={t('careers.mk.sourcing.newShortlist')} maxLength={80} value={listName} onChange={(e) => setListName(e.target.value)} />
          <button type="submit" className="ox-careers-btn" disabled={!listName.trim()} data-track="ui.67012854dd.6">{t('careers.mk.sourcing.create')}</button>
        </form>
      </section>
    </div>
  );
}
