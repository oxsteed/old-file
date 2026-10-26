import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import toast from 'react-hot-toast';
import CountrySelect from '../../CountrySelect';
import {
  createCareerDispute, deleteCareerResume, getCareerProfile, getCareerResumeUrl, previewCareerProfile,
  updateCareerProfile, uploadCareerResume,
} from '../../../api/careers';
import {
  availabilityToForm, factValueText, fieldErrorsFrom, formToAvailability, PAY_PERIODS, VISIBILITY_LEVELS, WEEKDAYS,
} from '../../../features/careers/careersModel';
import { ActionButton, Check, ErrorNotice, Field, Loading, LoadError, Notice, useCareerErrors, useLoad } from '../ui';

const DESIRED = ['shift', 'part_time', 'full_time', 'seasonal', 'temporary'];
const joinList = (v) => (Array.isArray(v) ? v.join(', ') : '');
const splitList = (v) => String(v || '').split(',').map((s) => s.trim()).filter(Boolean);

function toForm(p) {
  return {
    headline: p.headline || '', summary: p.summary || '', desired_roles: joinList(p.desired_roles), skill_codes: joinList(p.skill_codes),
    desired_employment: p.desired_employment || [], availability: availabilityToForm(p.availability || []),
    travel_radius_km: p.travel_radius_km ?? '', postal_code: p.postal_code || '', country_code: p.postal_country || '',
    min_pay: p.min_pay_cents != null ? Number(p.min_pay_cents) / 100 : '', min_pay_period: p.min_pay_period || 'hourly',
    languages: joinList(p.languages), open_to_work: Boolean(p.open_to_work), email_invitations: p.email_invitations !== false,
    visibility: p.share_visibility || p.visibility || 'private', hidden_fact_types: p.hidden_fact_types || [],
    career_offers_opt_in: Boolean(p.career_offers_opt_in),
  };
}

function toPayload(f) {
  return {
    headline: f.headline, summary: f.summary, desired_roles: splitList(f.desired_roles), skill_codes: splitList(f.skill_codes),
    desired_employment: f.desired_employment, availability: formToAvailability(f.availability),
    travel_radius_km: f.travel_radius_km === '' ? null : Number(f.travel_radius_km),
    postal_code: f.postal_code || null, country_code: f.country_code || null,
    min_pay: f.min_pay === '' ? null : Number(f.min_pay), min_pay_period: f.min_pay_period,
    languages: splitList(f.languages), open_to_work: f.open_to_work, email_invitations: f.email_invitations,
    visibility: f.visibility, hidden_fact_types: f.hidden_fact_types, career_offers_opt_in: f.career_offers_opt_in,
  };
}

function DisputeForm({ fact, onDone }) {
  const { t } = useTranslation();
  const [reason, setReason] = useState('');
  const [hide, setHide] = useState(true);
  const [error, setError] = useState(null);
  return (
    <div className="ox-careers-app">
      <Field label={t('careers.profile.disputeReason')} htmlFor={`dispute-${fact.id}`}>
        <textarea id={`dispute-${fact.id}`} rows={3} maxLength={1000} value={reason} onChange={(e) => setReason(e.target.value)} />
      </Field>
      <Check id={`dispute-hide-${fact.id}`} label={t('careers.profile.disputeHide')} checked={hide} onChange={setHide} />
      <ErrorNotice error={error} />
      <div className="ox-careers-actions">
        <ActionButton
          primary
          disabled={!reason.trim()}
          onClick={async () => {
            setError(null);
            try {
              await createCareerDispute({ fact_type: fact.fact_type, fact_id: fact.id, reason, hide_while_reviewing: hide });
              toast.success(t('careers.profile.disputeSent'));
              onDone();
            } catch (err) { setError(err); }
          }}
        >
          {t('careers.profile.disputeSubmit')}
        </ActionButton>
        <button type="button" className="ox-careers-btn" onClick={onDone}>{t('careers.common.cancel')}</button>
      </div>
    </div>
  );
}

export default function ProfileTab({ previewBusinesses = [] }) {
  const { t, i18n } = useTranslation();
  const errorText = useCareerErrors();
  const { data, loading, error, reload, setData } = useLoad(() => getCareerProfile(), []);
  const [form, setForm] = useState(null);
  const [errors, setErrors] = useState({});
  const [saveError, setSaveError] = useState(null);
  const [saving, setSaving] = useState(false);
  const [suggestions, setSuggestions] = useState(null);
  const [disputing, setDisputing] = useState(null);
  const [preview, setPreview] = useState(null);
  const [previewFor, setPreviewFor] = useState('');
  const fileRef = useRef(null);

  useEffect(() => { if (data?.profile) setForm(toForm(data.profile)); }, [data]);
  if (loading && !data) return <Loading />;
  if (error) return <LoadError error={error} onRetry={reload} />;
  if (!form) return null;
  const set = (k) => (v) => setForm((f) => ({ ...f, [k]: v }));
  const facts = data.facts || [];
  const disputedIds = new Set((data.disputes || []).filter((d) => d.status === 'open').map((d) => Number(d.fact_id)));

  const save = async (e) => {
    e?.preventDefault();
    setErrors({});
    setSaveError(null);
    setSaving(true);
    try {
      const r = await updateCareerProfile({ ...toPayload(form), profile_locale: i18n.language?.slice(0, 2) });
      setData({ profile: r.profile, facts: r.facts, disputes: r.disputes, mutes: r.mutes });
      setSuggestions(r.skill_suggestions);
      toast.success(t('careers.profile.saved'));
    } catch (err) {
      setErrors(fieldErrorsFrom(err));
      setSaveError(err);
    } finally {
      setSaving(false);
    }
  };

  return (
    <form className="ox-careers-grid" onSubmit={save} noValidate>
      <section className="ox-careers-panel">
        <h2>{t('careers.profile.visibilityTitle')}</h2>
        <p className="ox-careers-subtle">{t('careers.profile.visibilityIntro')}</p>
        {VISIBILITY_LEVELS.map((v) => (
          <label key={v} className="ox-careers-check" htmlFor={`vis-${v}`}>
            <input id={`vis-${v}`} type="radio" name="visibility" checked={form.visibility === v} onChange={() => set('visibility')(v)} />
            <span><strong>{t(`careers.visibility.${v}.label`)}</strong> — {t(`careers.visibility.${v}.help`)}</span>
          </label>
        ))}
        <Check id="career-offers" label={t('careers.profile.careerOffers')} checked={form.career_offers_opt_in} onChange={set('career_offers_opt_in')} />
        <p className="ox-careers-hint">{t('careers.profile.careerOffersHint')}</p>
        <Check id="open-to-work" label={t('careers.profile.openToWork')} checked={form.open_to_work} onChange={set('open_to_work')} />
        <Check id="email-invitations" label={t('careers.profile.emailInvitations')} checked={form.email_invitations} onChange={set('email_invitations')} />
      </section>

      <section className="ox-careers-panel">
        <h2>{t('careers.profile.aboutTitle')}</h2>
        <Field label={t('careers.profile.headline')} htmlFor="p-headline" error={errors.headline}>
          <input id="p-headline" maxLength={120} value={form.headline} onChange={(e) => set('headline')(e.target.value)} />
        </Field>
        <Field label={t('careers.profile.summary')} htmlFor="p-summary" error={errors.summary}>
          <textarea id="p-summary" rows={4} maxLength={1500} value={form.summary} onChange={(e) => set('summary')(e.target.value)} />
        </Field>
        <div className="ox-careers-form-grid">
          <Field label={t('careers.profile.desiredRoles')} htmlFor="p-roles" hint={t('careers.profile.commaHint')}>
            <input id="p-roles" value={form.desired_roles} onChange={(e) => set('desired_roles')(e.target.value)} />
          </Field>
          <Field label={t('careers.profile.skills')} htmlFor="p-skills" hint={t('careers.profile.commaHint')}>
            <input id="p-skills" value={form.skill_codes} onChange={(e) => set('skill_codes')(e.target.value)} />
          </Field>
          <Field label={t('careers.fields.languages')} htmlFor="p-langs" hint={t('careers.profile.commaHint')} error={errors.languages}>
            <input id="p-langs" value={form.languages} onChange={(e) => set('languages')(e.target.value)} />
          </Field>
        </div>
        {suggestions?.length ? (
          <Notice>
            {t('careers.profile.suggestions')}{' '}
            {suggestions.map((s) => {
              const code = typeof s === 'string' ? s : s.code;
              return (
                <button key={code} type="button" className="ox-careers-btn" onClick={() => set('skill_codes')([...new Set([...splitList(form.skill_codes), code])].join(', '))}>
                  + {code}
                </button>
              );
            })}
          </Notice>
        ) : null}
      </section>

      <section className="ox-careers-panel">
        <h2>{t('careers.profile.workTitle')}</h2>
        <fieldset className="ox-careers-section">
          <legend>{t('careers.profile.desiredEmployment')}</legend>
          {DESIRED.map((d) => (
            <Check key={d} id={`want-${d}`} label={t(`careers.path.${d}`)} checked={form.desired_employment.includes(d)} onChange={(on) => set('desired_employment')(on ? [...form.desired_employment, d] : form.desired_employment.filter((x) => x !== d))} />
          ))}
        </fieldset>
        <fieldset className="ox-careers-section">
          <legend>{t('careers.profile.availability')}</legend>
          {WEEKDAYS.map((d) => (
            <div key={d} className="ox-careers-row">
              <Check id={`day-${d}`} label={t(`careers.weekday.${d}`)} checked={form.availability[d].on} onChange={(on) => set('availability')({ ...form.availability, [d]: { ...form.availability[d], on } })} />
              {form.availability[d].on ? (
                <span className="ox-careers-row">
                  <input aria-label={t('careers.profile.from')} type="time" value={form.availability[d].start} onChange={(e) => set('availability')({ ...form.availability, [d]: { ...form.availability[d], start: e.target.value } })} />
                  <input aria-label={t('careers.profile.to')} type="time" value={form.availability[d].end} onChange={(e) => set('availability')({ ...form.availability, [d]: { ...form.availability[d], end: e.target.value } })} />
                </span>
              ) : null}
            </div>
          ))}
          {errors.availability ? <p className="ox-careers-error">{errors.availability}</p> : null}
        </fieldset>
        <div className="ox-careers-form-grid">
          <Field label={t('careers.fields.country')} htmlFor="p-country" error={errors.country_code}>
            <CountrySelect id="p-country" value={form.country_code} onChange={set("country_code")} />
          </Field>
          <Field label={t('careers.profile.postal')} htmlFor="p-postal" hint={t('careers.profile.postalHint')} error={errors.postal_code}>
            <input id="p-postal" value={form.postal_code} onChange={(e) => set('postal_code')(e.target.value)} />
          </Field>
          <Field label={t('careers.profile.radius')} htmlFor="p-radius" error={errors.travel_radius_km}>
            <input id="p-radius" type="number" min={1} max={500} value={form.travel_radius_km} onChange={(e) => set('travel_radius_km')(e.target.value)} />
          </Field>
          <Field label={t('careers.profile.minPay')} htmlFor="p-minpay" error={errors.min_pay}>
            <input id="p-minpay" type="number" min={0} step="0.01" value={form.min_pay} onChange={(e) => set('min_pay')(e.target.value)} />
          </Field>
          <Field label={t('careers.fields.payPeriod')} htmlFor="p-minpay-period">
            <select id="p-minpay-period" value={form.min_pay_period} onChange={(e) => set('min_pay_period')(e.target.value)}>
              {PAY_PERIODS.map((p) => <option key={p} value={p}>{t(`careers.period.${p}`)}</option>)}
            </select>
          </Field>
        </div>
      </section>

      <section className="ox-careers-panel">
        <h2>{t('careers.profile.factsTitle')}</h2>
        <p className="ox-careers-subtle">{t('careers.profile.factsIntro')}</p>
        {!facts.length ? <p className="ox-careers-empty">{t('careers.profile.noFacts')}</p> : (
          <table className="ox-careers-table">
            <thead><tr><th>{t('careers.profile.fact')}</th><th>{t('careers.profile.value')}</th><th>{t('careers.profile.shown')}</th><th /></tr></thead>
            <tbody>
              {facts.map((f) => (
                <tr key={f.id}>
                  <td>{t(`careers.facts.${f.fact_type}`)}</td>
                  <td>{factValueText(f, i18n.language)}</td>
                  <td>
                    <input
                      type="checkbox"
                      aria-label={t('careers.profile.showFact', { fact: t(`careers.facts.${f.fact_type}`) })}
                      checked={!form.hidden_fact_types.includes(f.fact_type)}
                      onChange={(e) => set('hidden_fact_types')(e.target.checked ? form.hidden_fact_types.filter((x) => x !== f.fact_type) : [...new Set([...form.hidden_fact_types, f.fact_type])])}
                    />
                  </td>
                  <td>
                    {disputedIds.has(Number(f.id)) ? <span className="ox-careers-chip warn">{t('careers.profile.underReview')}</span> : (
                      <button type="button" className="ox-careers-btn" onClick={() => setDisputing(f)}>{t('careers.profile.dispute')}</button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {disputing ? <DisputeForm fact={disputing} onDone={() => { setDisputing(null); reload(); }} /> : null}
      </section>

      <section className="ox-careers-panel">
        <h2>{t('careers.profile.resumeTitle')}</h2>
        <p className="ox-careers-subtle">{t('careers.profile.resumeIntro')}</p>
        <input ref={fileRef} type="file" accept=".pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document" hidden onChange={async (e) => {
          const file = e.target.files?.[0];
          e.target.value = '';
          if (!file) return;
          if (file.size > 5 * 1024 * 1024) { toast.error(t('careers.profile.resumeTooBig')); return; }
          try { await uploadCareerResume(file); toast.success(t('careers.profile.resumeUploaded')); reload(); } catch (err) { toast.error(errorText(err)); }
        }}
        />
        <div className="ox-careers-actions">
          <button type="button" className="ox-careers-btn" onClick={() => fileRef.current?.click()}>{data.profile.has_resume ? t('careers.profile.resumeReplace') : t('careers.profile.resumeUpload')}</button>
          {data.profile.has_resume ? (
            <>
              <ActionButton onClick={async () => { const r = await getCareerResumeUrl(); if (r.url) window.open(r.url, '_blank', 'noopener'); }}>{t('careers.profile.resumeDownload')}</ActionButton>
              <ActionButton danger confirm={t('careers.profile.resumeDeleteConfirm')} onClick={async () => { await deleteCareerResume(); reload(); }}>{t('careers.profile.resumeDelete')}</ActionButton>
            </>
          ) : null}
        </div>
      </section>

      {previewBusinesses.length ? (
        <section className="ox-careers-panel">
          <h2>{t('careers.profile.previewTitle')}</h2>
          <div className="ox-careers-row">
            <select aria-label={t('careers.profile.previewAs')} value={previewFor} onChange={(e) => setPreviewFor(e.target.value)}>
              <option value="">{t('careers.profile.previewAs')}</option>
              {previewBusinesses.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
            </select>
            <ActionButton disabled={!previewFor} onClick={async () => setPreview(await previewCareerProfile(`business:${previewFor}`))}>{t('careers.profile.preview')}</ActionButton>
          </div>
          {preview ? (
            <div className="ox-careers-app">
              <p>{t('careers.profile.previewVisibility', { level: t(`careers.visibility.${preview.visibility}.label`) })}{preview.muted ? ` · ${t('careers.profile.previewMuted')}` : ''}</p>
              <div className="ox-careers-facts">
                {preview.facts.map((f, i) => <span key={`${f.fact_type}-${i}`} className="ox-careers-chip">{t(`careers.facts.${f.fact_type}`)} {factValueText(f, i18n.language)}</span>)}
              </div>
              {preview.employer_only_facts?.length ? <p className="ox-careers-subtle">{t('careers.profile.previewEmployerOnly')}</p> : null}
            </div>
          ) : null}
        </section>
      ) : null}

      <ErrorNotice error={saveError} />
      <div className="ox-careers-actions">
        <button type="submit" className="ox-careers-btn primary" disabled={saving}>{saving ? t('careers.common.saving') : t('careers.profile.save')}</button>
      </div>
    </form>
  );
}
