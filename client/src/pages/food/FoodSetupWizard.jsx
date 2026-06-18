// Guided setup wizard for draft restaurants (B8).
import React, { useCallback, useEffect, useState } from 'react';
import { getFoodSetupProgress } from '../../api/food';

const STEP_HINTS = {
  profile: 'Add a description and cuisine tags in Settings.',
  location: 'Add your address and coordinates, or create a location below.',
  hours: 'Set operating hours in Settings so customers know when you are open.',
  menu: 'Add at least one menu item on the Menu tab.',
  publish: 'Press Go live when the checklist is complete.',
  devices: 'Install Kiosk and Kitchen apps, then run a test order.',
};

export default function SetupWizard({ restaurant, t, onGoTab, onStartGuide }) {
  const [progress, setProgress] = useState(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(() => {
    if (!restaurant?.id || restaurant.status === 'active') {
      setProgress(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    getFoodSetupProgress(restaurant.id)
      .then(setProgress)
      .catch(() => setProgress(null))
      .finally(() => setLoading(false));
  }, [restaurant?.id, restaurant?.status]);

  useEffect(() => { load(); }, [load]);

  if (!restaurant || restaurant.status === 'active' || loading || !progress) return null;

  const completed = progress.steps.filter((s) => s.complete).length;

  return (
    <section className="fd-section fd-setup-wizard">
      <h2>{t('food.merchant.setupWizardTitle', 'Setup checklist')}</h2>
      <p className="fd-card-meta">
        {t('food.merchant.setupWizardSubtitle', '{{done}} of {{total}} steps complete', {
          done: completed,
          total: progress.steps.filter((s) => s.id !== 'publish').length,
        })}
      </p>
      <ol className="fd-setup-steps">
        {progress.steps.filter((s) => s.id !== 'publish').map((step) => (
          <li key={step.id} className={step.complete ? 'fd-setup-step fd-complete' : 'fd-setup-step'}>
            <span>{step.complete ? '✓' : '○'} {step.title}</span>
            {!step.complete && (
              <button
                type="button"
                className="fd-btn fd-btn-sm fd-btn-secondary"
                onClick={() => onGoTab(step.id === 'menu' ? 'menu' : 'settings')}
              >
                {t('food.merchant.setupWizardFix', 'Fix')}
              </button>
            )}
          </li>
        ))}
      </ol>
      {!progress.readyToPublish && progress.nextStepId && (
        <p className="fd-pay-note">{STEP_HINTS[progress.nextStepId]}</p>
      )}
      {progress.readyToPublish && (
        <p className="fd-pay-note">{t('food.merchant.setupWizardReady', 'All setup steps are done — you can go live from Settings.')}</p>
      )}
      {onStartGuide && (
        <button type="button" className="fd-btn fd-btn-primary fd-btn-sm" onClick={onStartGuide}>
          {t('food.merchant.setupWizardContinue', 'Continue setup guide')}
        </button>
      )}
    </section>
  );
}

export function defaultWeekdayHours(open = '11:00', close = '22:00') {
  return {
    weekly: {
      mon: { open, close },
      tue: { open, close },
      wed: { open, close },
      thu: { open, close },
      fri: { open, close },
      sat: { open, close },
      sun: { open, close },
    },
  };
}
