// Floor device setup checklist for live restaurants (F8 / B8).
import React, { useCallback, useEffect, useState } from 'react';

const STORAGE_KEY = (restaurantId) => `ox.food.onboarding.devices.${restaurantId}`;

const DEVICE_STEPS = [
  {
    id: 'kiosk',
    title: 'Install Local Food Directory Kiosk (TestFlight)',
    detail: 'Guest self-ordering at the counter. Sign in once and select your restaurant.',
  },
  {
    id: 'kitchen',
    title: 'Install Local Food Directory Kitchen (TestFlight)',
    detail: 'Staff sign-in — tickets appear in New. Tap to advance Preparing → Ready.',
  },
  {
    id: 'queue',
    title: 'Open Queue display on dining-room tablet',
    detail: 'In the Kiosk app, switch to the Queue tab (or use oxsteed.com/restaurants/queue/<ID>).',
  },
  {
    id: 'test',
    title: 'Run one test order end-to-end',
    detail: 'Place an order on Kiosk, advance it on Kitchen, confirm the number on the queue board.',
  },
];

function loadChecks(restaurantId) {
  try {
    const raw = localStorage.getItem(STORAGE_KEY(restaurantId));
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function saveChecks(restaurantId, checks) {
  localStorage.setItem(STORAGE_KEY(restaurantId), JSON.stringify(checks));
}

export default function DeviceSetupChecklist({ restaurant, t, onComplete }) {
  const [checks, setChecks] = useState({});
  const [complete, setComplete] = useState(false);

  useEffect(() => {
    if (!restaurant?.id) return;
    const saved = loadChecks(restaurant.id);
    setChecks(saved);
    setComplete(Boolean(saved.__complete));
  }, [restaurant?.id]);

  const toggle = useCallback((id) => {
    setChecks((prev) => {
      const next = { ...prev, [id]: !prev[id] };
      saveChecks(restaurant.id, next);
      return next;
    });
  }, [restaurant?.id]);

  const markComplete = useCallback(() => {
    const next = { ...checks, __complete: true };
    saveChecks(restaurant.id, next);
    setChecks(next);
    setComplete(true);
    onComplete?.();
  }, [checks, restaurant?.id, onComplete]);

  if (!restaurant || restaurant.status !== 'active' || complete) return null;

  const allChecked = DEVICE_STEPS.every((step) => checks[step.id]);

  return (
    <section className="fd-section fd-setup-wizard fd-device-setup">
      <h2>{t('food.merchant.deviceSetupTitle', 'Floor device setup')}</h2>
      <p className="fd-card-meta">
        {t('food.merchant.deviceSetupSubtitle', 'Connect in-store tablets so guests can order and kitchen sees tickets. Restaurant ID: {{id}}', {
          id: restaurant.id,
        })}
      </p>
      <ol className="fd-setup-steps">
        {DEVICE_STEPS.map((step) => (
          <li key={step.id} className={checks[step.id] ? 'fd-setup-step fd-complete' : 'fd-setup-step'}>
            <label className="fd-device-check">
              <input
                type="checkbox"
                checked={Boolean(checks[step.id])}
                onChange={() => toggle(step.id)}
              />
              <span>
                <strong>{step.title}</strong>
                <span className="fd-card-meta">{step.detail}</span>
              </span>
            </label>
          </li>
        ))}
      </ol>
      <button
        type="button"
        className="fd-btn fd-btn-primary"
        disabled={!allChecked}
        onClick={markComplete}
      >
        {t('food.merchant.deviceSetupDone', 'Mark floor setup complete')}
      </button>
    </section>
  );
}

export function isDeviceSetupComplete(restaurantId) {
  const saved = loadChecks(restaurantId);
  return Boolean(saved.__complete);
}
