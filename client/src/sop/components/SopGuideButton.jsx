/**
 * SopGuideButton.jsx - contextual "Step-by-step guide" button for task pages.
 *
 * Looks up guidesForRoute() for the current path:
 * - exactly one guide: opens the modal with that guide,
 * - several guides: opens the modal with a task-selection list,
 * - none: renders nothing (pages stay untouched until guides ship).
 */

import { useCallback, useEffect, useMemo, useState, useId } from 'react';
import { useTranslation } from 'react-i18next';
import { useLocation } from 'react-router-dom';
import { guidesForRoute } from '../guideRegistry.js';
import SopGuideModal from './SopGuideModal.jsx';
import '../sop.css';

function GuideIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
      <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
      <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" />
    </svg>
  );
}

export default function SopGuideButton({ className = '', user = null }) {
  const { t } = useTranslation();
  const { pathname } = useLocation();
  const dialogId = useId();
  const [open, setOpen] = useState(false);

  const guides = useMemo(() => guidesForRoute(pathname,user), [pathname,user?.default_mode,user?.role]);

  const close = useCallback(() => setOpen(false), []);
  useEffect(() => setOpen(false), [pathname,user?.id,user?.default_mode]);

  if (guides.length === 0) return null;

  return (
    <>
      <button
        type="button"
        className={`sop-guide-button ${className}`.trim()}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={open ? dialogId : undefined}
        onClick={() => setOpen(true)}
      >
        <GuideIcon />
        {t('sop.guideButton')}
      </button>
      {open && <SopGuideModal id={dialogId} guides={guides} onClose={close} />}
    </>
  );
}
