import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import toast from 'react-hot-toast';
import api from '../api/axios';
import { useAuth } from '../hooks/useAuth';

// Review P2-476 / P2-593..595: the helper onboarding checklist. Steps come
// from GET /helper-registration/onboarding/status, which derives them from
// real progress (terms record, profile, Didit identity, background check).
export default function HelperOnboardingChecklist() {
  const { t } = useTranslation();
  const { refreshUser } = useAuth();
  const [status, setStatus] = useState(null);
  const [busy, setBusy] = useState(false);
  const [profile, setProfile] = useState({ phone: '', city: '', state: '', zip_code: '', bio: '' });

  const load = useCallback(async () => {
    try {
      const { data } = await api.get('/helper-registration/onboarding/status');
      setStatus(data);
    } catch {
      setStatus(null);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  if (!status || status.onboarding_completed) return null;
  const steps = status.steps || {};

  const run = async (fn, okKey) => {
    setBusy(true);
    try {
      await fn();
      toast.success(t(okKey));
      await load();
    } catch (err) {
      toast.error(err?.response?.data?.error || t('helperOnboarding.failed'));
    } finally {
      setBusy(false);
    }
  };

  const saveProfile = (e) => {
    e.preventDefault();
    run(() => api.put('/helper-registration/onboarding/profile', profile), 'helperOnboarding.profileSaved');
  };
  const consentBackground = () => run(
    () => api.put('/helper-registration/onboarding/background-check', { background_check_consent: true }),
    'helperOnboarding.backgroundSaved',
  );
  const finalize = () => run(async () => {
    await api.post('/helper-registration/finalize');
    await refreshUser?.();
  }, 'helperOnboarding.finalized');

  const Row = ({ done, label, children }) => (
    <li className="flex flex-col gap-2 border-b border-white/10 py-3">
      <div className="flex items-center gap-2">
        <span aria-hidden="true">{done ? '✓' : '○'}</span>
        <span className="font-medium">{label}</span>
        <span className="ms-auto text-sm opacity-70">{done ? t('helperOnboarding.done') : t('helperOnboarding.todo')}</span>
      </div>
      {!done && children}
    </li>
  );

  const field = (name, labelKey) => (
    <label className="flex flex-col text-sm gap-1">
      {t(labelKey)}
      <input
        className="rounded bg-white/10 px-2 py-1 text-start"
        value={profile[name]}
        onChange={(e) => setProfile((p) => ({ ...p, [name]: e.target.value }))}
        required={name !== 'bio'}
      />
    </label>
  );

  return (
    <section className="my-6 rounded-xl border border-orange-400/40 p-4" aria-labelledby="helper-onboarding-heading" data-testid="helper-onboarding-checklist">
      <h2 id="helper-onboarding-heading" className="text-lg font-semibold">{t('helperOnboarding.title')}</h2>
      <p className="text-sm opacity-80">{t('helperOnboarding.intro')}</p>
      <ul className="mt-2">
        <Row done={steps.email} label={t('helperOnboarding.email')} />
        <Row done={steps.terms} label={t('helperOnboarding.terms')}>
          <p className="text-sm">{t('helperOnboarding.termsHelp')}</p>
        </Row>
        <Row done={steps.profile} label={t('helperOnboarding.profile')}>
          <form onSubmit={saveProfile} className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {field('phone', 'helperOnboarding.phone')}
            {field('city', 'helperOnboarding.city')}
            {field('state', 'helperOnboarding.state')}
            {field('zip_code', 'helperOnboarding.zip')}
            {field('bio', 'helperOnboarding.bio')}
            <button type="submit" disabled={busy} className="rounded bg-orange-500 px-3 py-1 self-end">{t('helperOnboarding.saveProfile')}</button>
          </form>
        </Row>
        <Row done={steps.identityVerified} label={t('helperOnboarding.identity')}>
          <p className="text-sm">{steps.identitySubmitted ? t('helperOnboarding.identityPending') : t('helperOnboarding.identityHelp')}</p>
          {!steps.identitySubmitted && <Link to="/verify-identity" className="underline">{t('helperOnboarding.verifyNow')}</Link>}
        </Row>
        <Row done={steps.background === 'passed'} label={t('helperOnboarding.background')}>
          {steps.background === 'none'
            ? <button type="button" disabled={busy || !steps.identitySubmitted} onClick={consentBackground} className="underline text-start">{t('helperOnboarding.backgroundConsent')}</button>
            : <p className="text-sm">{t('helperOnboarding.backgroundPending')}</p>}
        </Row>
      </ul>
      <button
        type="button"
        onClick={finalize}
        disabled={busy || (status.missing || []).length > 0}
        className="mt-4 rounded bg-orange-500 px-4 py-2 disabled:opacity-50"
      >
        {t('helperOnboarding.finalize')}
      </button>
    </section>
  );
}
