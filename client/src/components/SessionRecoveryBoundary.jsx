import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../context/AuthContext';
import PageShell from './PageShell';
import './PageLoadingState.css';

export default function SessionRecoveryBoundary({ children }) {
  const { user, sessionRecovering, refreshUser } = useAuth();
  const [retrying, setRetrying] = useState(false);
  const { t } = useTranslation('common');
  if (user || !sessionRecovering) return children;
  const retry = async () => {
    setRetrying(true);
    try { await refreshUser(); } catch { /* Keep the recovery action available. */ }
    finally { setRetrying(false); }
  };
  // No stored profile is treated as authenticated while verification is
  // unavailable. Keep the current destination so recovery restores its draft.
  return <PageShell><section className="ox-loading-state" aria-labelledby="session-recovery-title">
    <h1 id="session-recovery-title">{t('sessionRecovery.title')}</h1>
    <p role="status">{t('sessionRecovery.description')}</p>
    <button type="button" className="ox-loading-state__retry" disabled={retrying} onClick={retry} data-track-private>
      {retrying ? t('actions.loading') : t('sessionRecovery.retry')}
    </button>
  </section></PageShell>;
}
