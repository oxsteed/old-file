import { useEffect } from 'react';
import { useBlocker } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import LogisticsModal from './LogisticsModal';

/**
 * UnsavedChangesGuard - confirms before the user leaves a dirty form.
 *
 * Uses react-router's useBlocker for in-app navigation and the native
 * beforeunload event for tab close / refresh. The confirmation renders in
 * the accessible LogisticsModal (Escape dismisses, focus is contained and
 * returned), and all copy is localized.
 *
 * Props:
 *  - when: boolean — true while the form has unsaved changes
 */
export default function UnsavedChangesGuard({ when }) {
  const { t } = useTranslation();
  const blocker = useBlocker(when);

  // Native guard for full-page unloads (refresh, tab close).
  useEffect(() => {
    if (!when) return undefined;
    const onBeforeUnload = (event) => {
      event.preventDefault();
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [when]);

  const blocked = blocker.state === 'blocked';

  return (
    <LogisticsModal
      open={blocked}
      onClose={() => blocker.reset()}
      title={t('logistics.forms.unsavedChanges.title', 'Discard unsaved changes?')}
      size="sm"
    >
      <p className="lx-t-muted lx-t-small" style={{ margin: '0 0 1.25rem', lineHeight: 1.6 }}>
        {t(
          'logistics.forms.unsavedChanges.body',
          'You have unsaved changes. Leaving now will discard what you entered.'
        )}
      </p>
      <div className="lx-btn-row">
        <button
          type="button"
          className="lx-btn-secondary"
          onClick={() => blocker.reset()}
          autoFocus
        >
          {t('logistics.forms.unsavedChanges.stay', 'Keep editing')}
        </button>
        <button
          type="button"
          className="lx-btn-primary"
          onClick={() => blocker.proceed()}
        >
          {t('logistics.forms.unsavedChanges.discard', 'Discard changes')}
        </button>
      </div>
    </LogisticsModal>
  );
}
