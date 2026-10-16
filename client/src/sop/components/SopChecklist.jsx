/**
 * SopChecklist.jsx - device-only reading-progress checklist for a guide.
 *
 * Progress is stored in localStorage only, scoped by account (or guest),
 * guide id, and guide revision, so a revised guide starts fresh:
 *   sop-checklist:{accountIdOrGuest}:{guideId}:{revision}
 *
 * Checking a step records reading progress on this device only. It does not
 * verify, pay, book, or submit anything.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../../context/AuthContext';
import '../sop.css';

const DISCLAIMER =
  'Checking a step records your reading progress on this device only. It does not verify, pay, book, or submit anything.';

function checklistKey(accountIdOrGuest, guideId, revision) {
  return `sop-checklist:${accountIdOrGuest}:${guideId}:${revision}`;
}

function readStored(key) {
  try {
    const raw = window.localStorage.getItem(key);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.filter((id) => typeof id === 'string') : [];
  } catch {
    return [];
  }
}

function writeStored(key, checkedIds) {
  try {
    window.localStorage.setItem(key, JSON.stringify(checkedIds));
  } catch {
    // Storage unavailable (private mode, quota): progress simply does not persist.
  }
}

export default function SopChecklist({ guide }) {
  const { t } = useTranslation();
  const { user } = useAuth();

  const accountIdOrGuest = user?.id ? String(user.id) : 'guest';
  const key = useMemo(
    () => checklistKey(accountIdOrGuest, guide.id, guide.revision),
    [accountIdOrGuest, guide.id, guide.revision],
  );

  const [checkedIds, setCheckedIds] = useState(() => readStored(key));

  // Re-read when the scoping key changes (account switch or guide revision).
  useEffect(() => {
    setCheckedIds(readStored(key));
  }, [key]);

  const toggle = useCallback(
    (stepId) => {
      setCheckedIds((previous) => {
        const next = previous.includes(stepId)
          ? previous.filter((id) => id !== stepId)
          : [...previous, stepId];
        writeStored(key, next);
        return next;
      });
    },
    [key],
  );

  const reset = useCallback(() => {
    setCheckedIds([]);
    writeStored(key, []);
  }, [key]);

  const steps = guide.steps || [];
  const done = steps.filter((step) => checkedIds.includes(step.id)).length;

  return (
    <section className="sop-checklist" aria-labelledby={`sop-checklist-${guide.id}`}>
      <div className="sop-checklist-head">
        <h2 id={`sop-checklist-${guide.id}`}>{t('sop.checklist.title')}</h2>
        <span className="sop-checklist-progress">
          {t('sop.checklist.progress', { done, total: steps.length })}
        </span>
      </div>
      <ul className="sop-checklist-list">
        {steps.map((step, index) => {
          const checked = checkedIds.includes(step.id);
          return (
            <li key={step.id}>
              <label className={`sop-checklist-item${checked ? ' is-done' : ''}`}>
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={() => toggle(step.id)}
                  aria-label={`${t('sop.guide.stepNumber', { n: index + 1 })}: ${step.title}. ${
                    checked ? t('sop.checklist.markNotDone') : t('sop.checklist.markDone')
                  }`}
                />
                <span className="sop-checklist-label">
                  <strong>{index + 1}.</strong> {step.title}
                </span>
              </label>
            </li>
          );
        })}
      </ul>
      <button type="button" className="sop-btn sop-btn-ghost" onClick={reset}>
        {t('sop.checklist.reset')}
      </button>
      <p className="sop-checklist-disclaimer">{DISCLAIMER}</p>
    </section>
  );
}
