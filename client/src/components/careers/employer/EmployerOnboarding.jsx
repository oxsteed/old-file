import { useTranslation } from 'react-i18next';
import { completeOnboardingStep, getEmployerOnboarding, retryOnboardingStep } from '../../../api/careers';
import { ActionButton, Loading, LoadError, useLoad } from '../ui';

// Manual steps the manager can mark done; failed steps can be retried.
const MANUAL = new Set(['documents', 'payroll_handoff']);

export default function EmployerOnboarding({ runId }) {
  const { t } = useTranslation();
  const { data: run, loading, error, reload, setData } = useLoad(() => getEmployerOnboarding(runId), [runId]);
  if (loading && !run) return <Loading />;
  if (error) return <LoadError error={error} onRetry={reload} />;
  if (!run) return null;
  return (
    <div className="ox-careers-section">
      <h3>{t('careers.onboarding.title')}</h3>
      <p className="ox-careers-subtle">{t(`careers.onboarding.run.${run.status}`)}</p>
      <ul className="ox-careers-steps">
        {(run.steps || []).map((s) => (
          <li key={s.step}>
            <span>{t(`careers.onboarding.steps.${s.step}`)}</span>
            <span className="ox-careers-row">
              <span className={`ox-careers-chip ${s.status === 'done' ? 'ok' : s.status === 'failed' ? 'bad' : s.status === 'needs_action' ? 'warn' : ''}`}>{t(`careers.onboarding.status.${s.status}`)}</span>
              {s.status === 'failed' ? <ActionButton onClick={async () => setData(await retryOnboardingStep(runId, s.step))}>{t('careers.onboarding.retry')}</ActionButton> : null}
              {MANUAL.has(s.step) && ['pending', 'needs_action'].includes(s.status) ? (
                <ActionButton onClick={async () => setData(await completeOnboardingStep(runId, s.step))}>{t('careers.onboarding.markDone')}</ActionButton>
              ) : null}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
