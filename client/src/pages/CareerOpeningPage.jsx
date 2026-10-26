import { useEffect, useMemo, useState } from 'react';
import { Link, useLocation, useParams, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import PageMeta from '../components/PageMeta';
import PageShell from '../components/PageShell';
import { useAuth } from '../context/AuthContext';
import {
  applyToCareerOpening, confirmGuestApplication, getCareerFacts, getPublicCareerOpening, startGuestApplication,
} from '../api/careers';
import { Check, ErrorNotice, Field, Loading, LoadError, Notice, YesNo, useCareerErrors, useLoad } from '../components/careers/ui';
import EeoForm from '../components/careers/EeoForm';
import {
  applicationPayload, fieldErrorsFrom, formatDate, formatPayRange, localizedOpening,
} from '../features/careers/careersModel';
import '../styles/CareerSystem.css';

const EMPTY_APPLY = {
  authorized_to_work: null, needs_sponsorship: null, preferred_location_ids: [], languages: '', cover_letter: '',
  resume_url: '', accommodation_requested: false, share_fact_types: null, eeo: {},
};
const EMPTY_GUEST = { first_name: '', last_name: '', email: '', phone: '', city: '', age_attested: false };

function GuestConfirm({ openingId }) {
  const { t } = useTranslation();
  const errorText = useCareerErrors();
  const [params] = useSearchParams();
  const token = params.get('token') || '';
  const [state, setState] = useState({ status: 'working', error: null });
  useEffect(() => {
    let active = true;
    if (!token) { setState({ status: 'error', error: null }); return undefined; }
    confirmGuestApplication(openingId, token)
      .then(() => active && setState({ status: 'done', error: null }))
      .catch((error) => active && setState({ status: 'error', error }));
    return () => { active = false; };
  }, [openingId, token]);
  if (state.status === 'working') return <Loading />;
  if (state.status === 'done') return <Notice tone="success">{t('careers.guest.confirmed')}</Notice>;
  return <Notice tone="error">{state.error ? errorText(state.error) : t('careers.guest.missingToken')}</Notice>;
}

function ApplyPanel({ opening, user }) {
  const { t } = useTranslation();
  const [form, setForm] = useState(EMPTY_APPLY);
  const [guest, setGuest] = useState(EMPTY_GUEST);
  const [errors, setErrors] = useState({});
  const [result, setResult] = useState(null);
  const [failure, setFailure] = useState(null);
  const [sending, setSending] = useState(false);
  const facts = useLoad(() => (user ? getCareerFacts() : Promise.resolve({ facts: [] })), [user?.id]);
  const shareable = (facts.data?.facts || []).filter((f) => !f.hidden);
  const set = (k) => (v) => setForm((prev) => ({ ...prev, [k]: v }));
  const country = opening.country_code || t('careers.thisCountry');

  if (!opening.is_accepting && opening.is_accepting !== undefined) return <Notice>{t('careers.apply.closed')}</Notice>;
  if (!user && !opening.allow_guest_applications) {
    return (
      <div className="ox-careers-panel">
        <p>{t('careers.apply.signInToApply')}</p>
        <div className="ox-careers-actions">
          <Link className="ox-careers-btn primary" to={`/login?next=${encodeURIComponent(`/careers/${opening.id}`)}`}>{t('careers.apply.signIn')}</Link>
        </div>
      </div>
    );
  }
  if (result) {
    return <Notice tone="success">{result === 'guest' ? t('careers.guest.checkEmail') : t('careers.apply.submitted')}</Notice>;
  }

  const submit = async (e) => {
    e.preventDefault();
    setErrors({});
    setFailure(null);
    const local = {};
    if (form.authorized_to_work === null) local.authorized_to_work = t('careers.apply.answerRequired');
    if (form.needs_sponsorship === null) local.needs_sponsorship = t('careers.apply.answerRequired');
    if (!user) {
      if (!guest.first_name.trim()) local.first_name = t('careers.apply.required');
      if (!guest.last_name.trim()) local.last_name = t('careers.apply.required');
      if (!guest.email.trim()) local.email = t('careers.apply.required');
      if (!guest.age_attested) local.age_attested = t('careers.guest.ageRequired');
    }
    if (Object.keys(local).length) { setErrors(local); return; }
    setSending(true);
    try {
      const body = applicationPayload(form, opening);
      if (user) {
        await applyToCareerOpening(opening.id, body);
        setResult('account');
      } else {
        delete body.eeo;
        delete body.share_fact_types;
        await startGuestApplication(opening.id, { ...body, ...guest, locale: document.documentElement.lang || 'en' });
        setResult('guest');
      }
    } catch (err) {
      setErrors(fieldErrorsFrom(err));
      setFailure(err);
    } finally {
      setSending(false);
    }
  };

  return (
    <form className="ox-careers-panel" onSubmit={submit} noValidate>
      <h2>{t('careers.apply.title')}</h2>
      {!user ? (
        <>
          <Notice>{t('careers.guest.intro')}</Notice>
          <div className="ox-careers-form-grid">
            {['first_name', 'last_name', 'email', 'phone', 'city'].map((k) => (
              <Field key={k} label={t(`careers.fields.${k}`)} htmlFor={`guest-${k}`} error={errors[k]}>
                <input id={`guest-${k}`} type={k === 'email' ? 'email' : 'text'} autoComplete={k === 'email' ? 'email' : 'on'} value={guest[k]} onChange={(e) => setGuest((g) => ({ ...g, [k]: e.target.value }))} />
              </Field>
            ))}
          </div>
          <Check id="guest-age" label={t('careers.guest.ageAttest')} checked={guest.age_attested} onChange={(v) => setGuest((g) => ({ ...g, age_attested: v }))} />
          {errors.age_attested ? <p className="ox-careers-error">{errors.age_attested}</p> : null}
        </>
      ) : null}
      <YesNo name="authorized_to_work" label={t('careers.apply.authorized', { country })} value={form.authorized_to_work} onChange={set('authorized_to_work')} error={errors.authorized_to_work} />
      <YesNo name="needs_sponsorship" label={t('careers.apply.sponsorship')} value={form.needs_sponsorship} onChange={set('needs_sponsorship')} error={errors.needs_sponsorship} />
      {opening.locations?.length ? (
        <fieldset className="ox-careers-section">
          <legend>{t('careers.apply.preferredStores')}</legend>
          {opening.locations.map((l) => (
            <Check
              key={l.id}
              id={`store-${l.id}`}
              label={[l.name, l.city].filter(Boolean).join(' · ')}
              checked={form.preferred_location_ids.includes(Number(l.id))}
              onChange={(on) => set('preferred_location_ids')(on ? [...form.preferred_location_ids, Number(l.id)] : form.preferred_location_ids.filter((x) => x !== Number(l.id)))}
            />
          ))}
          {errors.preferred_location_ids ? <p className="ox-careers-error">{errors.preferred_location_ids}</p> : null}
        </fieldset>
      ) : null}
      <div className="ox-careers-form-grid">
        <Field label={t('careers.fields.languages')} htmlFor="apply-languages" hint={t('careers.apply.languagesHint')}>
          <input id="apply-languages" value={form.languages} onChange={(e) => set('languages')(e.target.value)} />
        </Field>
        <Field label={t('careers.fields.resumeUrl')} htmlFor="apply-resume" error={errors.resume_url}>
          <input id="apply-resume" type="url" value={form.resume_url} onChange={(e) => set('resume_url')(e.target.value)} placeholder="https://" />
        </Field>
      </div>
      <Field label={t('careers.fields.coverLetter')} htmlFor="apply-cover">
        <textarea id="apply-cover" rows={4} maxLength={5000} value={form.cover_letter} onChange={(e) => set('cover_letter')(e.target.value)} />
      </Field>
      {user && shareable.length ? (
        <fieldset className="ox-careers-section">
          <legend>{t('careers.apply.shareFacts')}</legend>
          <p className="ox-careers-subtle">{t('careers.apply.shareFactsHint')}</p>
          {shareable.map((f) => {
            const chosen = form.share_fact_types || shareable.map((x) => x.fact_type);
            return (
              <Check
                key={`${f.fact_type}-${f.id || ''}`}
                id={`share-${f.fact_type}-${f.id || ''}`}
                label={t(`careers.facts.${f.fact_type}`)}
                checked={chosen.includes(f.fact_type)}
                onChange={(on) => set('share_fact_types')(on ? [...new Set([...chosen, f.fact_type])] : chosen.filter((x) => x !== f.fact_type))}
              />
            );
          })}
        </fieldset>
      ) : null}
      <Check id="apply-accommodation" label={t('careers.apply.accommodation')} checked={form.accommodation_requested} onChange={set('accommodation_requested')} />
      {user && opening.country_code === 'US' ? <EeoForm value={form.eeo} onChange={set('eeo')} /> : null}
      {opening.ai_ranking_enabled ? <Notice>{t('careers.apply.aiNotice')}</Notice> : null}
      <p className="ox-careers-subtle">{t('careers.apply.privacy')}</p>
      <ErrorNotice error={failure} fallbackKey="careers.apply.error" />
      <div className="ox-careers-actions">
        <button type="submit" className="ox-careers-btn primary" disabled={sending}>{sending ? t('careers.apply.sending') : t('careers.apply.submit')}</button>
      </div>
    </form>
  );
}

export default function CareerOpeningPage() {
  const { t, i18n } = useTranslation();
  const { id } = useParams();
  const { pathname } = useLocation();
  const { user } = useAuth();
  const confirming = pathname.endsWith('/confirm');
  const { data: raw, loading, error, reload } = useLoad(() => getPublicCareerOpening(id), [id]);
  const opening = useMemo(() => localizedOpening(raw, i18n.language), [raw, i18n.language]);

  return (
    <PageShell>
      <PageMeta title={opening ? `${opening.title} · ${opening.employer_name}` : t('careers.metaTitle')} description={t('careers.metaDesc')} />
      <div className="ox-careers">
        <Link className="ox-careers-btn" to="/careers">{t('careers.back')}</Link>
        {confirming ? <GuestConfirm openingId={id} /> : null}
        {loading ? <Loading /> : null}
        {!loading && error ? (error?.response?.status === 404 ? <Notice>{t('careers.opening.notFound')}</Notice> : <LoadError error={error} onRetry={reload} />) : null}
        {opening ? (
          <>
            <p className="ox-careers-kicker">{opening.employer_name}{opening.employer_verified ? ` · ${t('careers.verifiedEmployer')}` : ''}</p>
            <h1>{opening.title}</h1>
            <div className="ox-careers-meta">
              <span className="ox-careers-chip ok">{formatPayRange(opening, i18n.language)} {t(`careers.period.${opening.compensation_period}`)}</span>
              <span className="ox-careers-chip">{t(`careers.workplace.${opening.workplace_type}`)}</span>
              {opening.path_stage ? <span className="ox-careers-chip">{t(`careers.path.${opening.path_stage}`)}</span> : null}
              <span className="ox-careers-chip">{[opening.city, opening.region, opening.country_code].filter(Boolean).join(', ') || t('careers.remoteWorldwide')}</span>
              {opening.sponsorship_available ? <span className="ox-careers-chip">{t('careers.authorization.visa_sponsorship')}</span> : null}
              {opening.employer_model === 'oxsteed_eor' ? <span className="ox-careers-chip">{t('careers.eorBadge')}</span> : null}
              {opening.applications_close_at ? <span className="ox-careers-chip warn">{t('careers.closesOn', { date: formatDate(opening.applications_close_at, i18n.language) })}</span> : null}
            </div>
            {opening.is_translated ? <p className="ox-careers-subtle">{t('careers.machineTranslated')}</p> : null}
            {opening.employer_model === 'oxsteed_eor' ? <Notice>{t('careers.eorExplainer')}</Notice> : null}
            {opening.schedule_summary ? (
              <section className="ox-careers-section"><h3>{t('careers.fields.schedule')}</h3><p className="ox-careers-prose">{opening.schedule_summary}</p></section>
            ) : null}
            <section className="ox-careers-section">
              <h3>{t('careers.fields.description')}</h3>
              <p className="ox-careers-prose">{opening.description || t('careers.opening.noDescription')}</p>
            </section>
            {opening.requirements ? (
              <section className="ox-careers-section"><h3>{t('careers.fields.requirements')}</h3><p className="ox-careers-prose">{opening.requirements}</p></section>
            ) : null}
            {opening.benefits_summary || opening.benefits ? (
              <section className="ox-careers-section"><h3>{t('careers.fields.benefits')}</h3><p className="ox-careers-prose">{opening.benefits_summary || opening.benefits}</p></section>
            ) : null}
            {opening.background_check_required ? <Notice>{t('careers.opening.backgroundCheck')}</Notice> : null}
            <p className="ox-careers-subtle">{t('careers.opening.minAge', { age: opening.min_age || 18 })}</p>
            {!confirming ? <ApplyPanel opening={opening} user={user} /> : null}
          </>
        ) : null}
      </div>
    </PageShell>
  );
}
