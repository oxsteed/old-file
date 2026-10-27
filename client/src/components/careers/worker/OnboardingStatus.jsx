import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { getMyOnboarding, setOnboardingPin } from '../../../api/careers';
import { Field, Loading, LoadError, Notice, useCareerErrors, useLoad } from '../ui';

/** The worker's view of their onboarding run, with the POS PIN step. */
export default function OnboardingStatus({ runId }) {
  const { t } = useTranslation();
  const errorText = useCareerErrors();
  const { data: run, loading, error, reload, setData } = useLoad(() => getMyOnboarding(runId), [runId]);
  const [pin, setPin] = useState('');
  const [pinError, setPinError] = useState(null);
  const [saving, setSaving] = useState(false);
  if (loading && !run) return <Loading />;
  if (error) return <LoadError error={error} onRetry={reload} />;
  if (!run) return null;
  const pinStep = (run.steps || []).find((s) => s.step === 'pin');
  const needsPin = pinStep && pinStep.status === 'needs_action';
  return (
    <div className="ox-careers-section">
      <h3>{t('careers.onboarding.title')}</h3>
      <p className="ox-careers-subtle">{t(`careers.onboarding.run.${run.status}`)}</p>
      <ul className="ox-careers-steps">
        {(run.steps || []).map((s) => (
          <li key={s.step}>
            <span>{t(`careers.onboarding.steps.${s.step}`)}</span>
            <span className={`ox-careers-chip ${s.status === 'done' ? 'ok' : s.status === 'failed' ? 'bad' : s.status === 'needs_action' ? 'warn' : ''}`}>{t(`careers.onboarding.status.${s.status}`)}</span>
          </li>
        ))}
      </ul>
      {needsPin ? (
        <form
          className="ox-careers-section"
          onSubmit={async (e) => {
            e.preventDefault();
            setPinError(null);
            if (!/^\d{4,6}$/.test(pin)) { setPinError(t('careers.onboarding.pinFormat')); return; }
            setSaving(true);
            try { setData(await setOnboardingPin(runId, pin)); setPin(''); } catch (err) { setPinError(errorText(err)); } finally { setSaving(false); }
          }} data-track="ui.671ca93b97.1"
        >
          <Field label={t('careers.onboarding.pinLabel')} htmlFor={`pin-${runId}`} hint={t('careers.onboarding.pinHint')} error={pinError}>
            <input id={`pin-${runId}`} inputMode="numeric" autoComplete="off" maxLength={6} value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))} />
          </Field>
          <button type="submit" className="ox-careers-btn primary" disabled={saving} data-track="ui.671ca93b97.2">{t('careers.onboarding.setPin')}</button>
        </form>
      ) : null}
      {run.first_shift?.date ? <Notice>{t('careers.onboarding.firstShift', { date: run.first_shift.date, start: run.first_shift.start, end: run.first_shift.end })}</Notice> : null}
    </div>
  );
}
