import { useTranslation } from 'react-i18next';
import heartMonitorStill from '../assets/oxsteed-heart-monitor-still.png';
import './PageLoadingState.css';

// Cost audit 2026-11-13 item 13: the 254KB heart-monitor GIF used to ride
// the startup chunk graph (statically imported here, and this component is
// the Suspense fallback for every route). It is replaced with a CSS spinner
// so no 254KB download happens on the first slow route transition. The
// prefers-reduced-motion still is kept: reduced-motion users see the static
// image instead of the spinner.
export default function PageLoadingState() {
  const { t } = useTranslation('common');
  return (
    <div className="ox-loading-state" role="status" aria-live="polite">
      <span className="ox-loading-state__spinner" aria-hidden="true" />
      <img className="ox-loading-state__still" src={heartMonitorStill} alt="" width={72} height={72} />
      <p>{t('actions.loading')}</p>
    </div>
  );
}
