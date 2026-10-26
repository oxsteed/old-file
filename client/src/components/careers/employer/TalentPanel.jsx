import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import toast from 'react-hot-toast';
import { listTalentYouKnow, searchTalent, sendCareerInvitation } from '../../../api/careers';
import { INVITATION_REASONS, factValueText, formatDate } from '../../../features/careers/careersModel';
import { Check, Empty, ErrorNotice, Field, Loading, LoadError, Notice, useLoad } from '../ui';

function InviteForm({ ctx, person, source, openings, onDone }) {
  const { t } = useTranslation();
  const [f, setF] = useState({ opening_id: openings[0]?.id || '', reason_code: source === "talent_you_know" ? 'worked_with_us' : 'skills_match', message: '', certified: false });
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  return (
    <div className="ox-careers-app">
      <div className="ox-careers-form-grid">
        <Field label={t('careers.talent.opening')} htmlFor={`inv-op-${person.user_id}`}>
          <select id={`inv-op-${person.user_id}`} value={f.opening_id} onChange={(e) => setF({ ...f, opening_id: e.target.value })}>
            {openings.map((o) => <option key={o.id} value={o.id}>{o.title}</option>)}
          </select>
        </Field>
        <Field label={t('careers.talent.reason')} htmlFor={`inv-reason-${person.user_id}`}>
          <select id={`inv-reason-${person.user_id}`} value={f.reason_code} onChange={(e) => setF({ ...f, reason_code: e.target.value })}>
            {INVITATION_REASONS.map((r) => <option key={r} value={r}>{t(`careers.invitations.reason.${r}`)}</option>)}
          </select>
        </Field>
      </div>
      <Field label={t('careers.talent.message')} htmlFor={`inv-msg-${person.user_id}`}>
        <textarea id={`inv-msg-${person.user_id}`} rows={2} maxLength={500} value={f.message} onChange={(e) => setF({ ...f, message: e.target.value })} />
      </Field>
      <Check id={`inv-cert-${person.user_id}`} label={t('careers.talent.certify')} checked={f.certified} onChange={(v) => setF({ ...f, certified: v })} />
      <ErrorNotice error={error} />
      <div className="ox-careers-actions">
        <button
          type="button"
          className="ox-careers-btn primary"
          disabled={!f.opening_id || !f.certified || busy}
          onClick={async () => {
            setError(null);
            setBusy(true);
            try {
              const r = await sendCareerInvitation(ctx.businessId, {
                user_id: person.user_id, opening_id: Number(f.opening_id), reason_code: f.reason_code, message: f.message || null,
                source, permissible_purpose_certified: true,
              });
              toast.success(t('careers.talent.sent', { left: r.usage?.remainingToday ?? '' }));
              onDone(r.usage);
            } catch (err) { setError(err); } finally { setBusy(false); }
          }}
        >
          {t('careers.talent.send')}
        </button>
        <button type="button" className="ox-careers-btn" onClick={() => onDone(null)}>{t('careers.common.cancel')}</button>
      </div>
    </div>
  );
}

function PersonCard({ ctx, person, source, openings, onUsage }) {
  const { t, i18n } = useTranslation();
  const [inviting, setInviting] = useState(false);
  return (
    <article className="ox-careers-app">
      <div className="ox-careers-row">
        <strong>{person.display_name || t('careers.talent.member')}</strong>
        {person.distance_km != null ? <span className="ox-careers-chip">{t('careers.talent.distance', { km: person.distance_km })}</span> : null}
      </div>
      {person.headline ? <p>{person.headline}</p> : null}
      {person.history ? (
        <p className="ox-careers-subtle">
          {t('careers.talent.history', { jobs: person.history.jobs_for_business || 0, shifts: person.history.shifts_for_business || 0 })}
          {person.history.former_staff ? ` · ${t('careers.talent.formerStaff')}` : ''}
          {person.last_worked_at ? ` · ${t('careers.talent.lastWorked', { date: formatDate(person.last_worked_at, i18n.language) })}` : ''}
        </p>
      ) : null}
      <div className="ox-careers-facts">
        {(person.facts || []).map((f, i) => <span key={`${f.fact_type}-${i}`} className="ox-careers-chip">{t(`careers.facts.${f.fact_type}`)} {factValueText(f, i18n.language)}</span>)}
        {(person.skill_codes || []).slice(0, 6).map((s) => <span key={s} className="ox-careers-chip">{s}</span>)}
      </div>
      {inviting ? (
        <InviteForm ctx={ctx} person={person} source={source} openings={openings} onDone={(usage) => { setInviting(false); if (usage) onUsage(usage); }} />
      ) : (
        <button type="button" className="ox-careers-btn" disabled={!openings.length} onClick={() => setInviting(true)}>{t('careers.talent.invite')}</button>
      )}
    </article>
  );
}

export default function TalentPanel({ ctx, openings, locations }) {
  const { t } = useTranslation();
  const open = openings.filter((o) => o.status === 'open');
  const known = useLoad(() => listTalentYouKnow(ctx.businessId), [ctx.businessId]);
  const [usage, setUsage] = useState(null);
  const [q, setQ] = useState({ near_location: locations[0]?.id || '', radius_km: 25, skill: '' });
  const [search, setSearch] = useState({ data: null, error: null, loading: false, page: 0 });
  const u = usage || search.data?.usage || known.data?.usage;

  const runSearch = async (page = 0) => {
    setSearch((s) => ({ ...s, loading: true, error: null }));
    try {
      const data = await searchTalent(ctx.businessId, { ...q, page });
      setSearch({ data, error: null, loading: false, page });
    } catch (error) {
      setSearch((s) => ({ ...s, error, loading: false }));
    }
  };

  return (
    <div className="ox-careers-grid">
      <Notice>{t('careers.talent.rules')}</Notice>
      {u ? <p className="ox-careers-subtle">{t('careers.talent.usage', { left: u.remainingToday })}</p> : null}
      {!open.length ? <Notice tone="warn">{t('careers.talent.needOpening')}</Notice> : null}
      <section className="ox-careers-panel">
        <h2>{t('careers.talent.knownTitle')}</h2>
        <p className="ox-careers-subtle">{t('careers.talent.knownIntro')}</p>
        {known.loading && !known.data ? <Loading /> : null}
        <LoadError error={known.error} onRetry={known.reload} />
        {known.data && !known.data.people?.length ? <Empty>{t('careers.talent.noKnown')}</Empty> : null}
        <div className="ox-careers-grid">
          {(known.data?.people || []).map((p) => <PersonCard key={p.user_id} ctx={ctx} person={p} source="talent_you_know" openings={open} onUsage={setUsage} />)}
        </div>
      </section>
      <section className="ox-careers-panel">
        <h2>{t('careers.talent.searchTitle')}</h2>
        <p className="ox-careers-subtle">{t('careers.talent.searchIntro')}</p>
        <form className="ox-careers-filters" onSubmit={(e) => { e.preventDefault(); runSearch(0); }}>
          <select aria-label={t('careers.talent.nearStore')} value={q.near_location} onChange={(e) => setQ({ ...q, near_location: e.target.value })}>
            {locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
          </select>
          <select aria-label={t('careers.filters.radius')} value={q.radius_km} onChange={(e) => setQ({ ...q, radius_km: Number(e.target.value) })}>
            {[5, 10, 25, 50].map((r) => <option key={r} value={r}>{t('careers.filters.withinKm', { km: r })}</option>)}
          </select>
          <input aria-label={t('careers.talent.skill')} placeholder={t('careers.talent.skill')} value={q.skill} onChange={(e) => setQ({ ...q, skill: e.target.value })} />
          <button type="submit" className="ox-careers-btn primary" disabled={!q.near_location || search.loading}>{t('careers.filters.search')}</button>
        </form>
        {!locations.length ? <p className="ox-careers-subtle">{t('careers.employer.noStores')}</p> : null}
        <ErrorNotice error={search.error} />
        {search.loading ? <Loading /> : null}
        {search.data && !search.data.results?.length ? <Empty>{t('careers.talent.noResults')}</Empty> : null}
        <div className="ox-careers-grid">
          {(search.data?.results || []).map((p) => <PersonCard key={p.user_id} ctx={ctx} person={p} source="talent_search" openings={open} onUsage={setUsage} />)}
        </div>
        {search.data?.hasMore ? <button type="button" className="ox-careers-btn" onClick={() => runSearch(search.page + 1)}>{t('careers.loadMore')}</button> : null}
      </section>
    </div>
  );
}
