import { useTranslation } from 'react-i18next';
import heartMonitor from '../assets/oxsteed-heart-monitor.gif';
import heartMonitorStill from '../assets/oxsteed-heart-monitor-still.png';
import './PageLoadingState.css';

export default function PageLoadingState() {
  const { t } = useTranslation('common');
  return (
    <div className="ox-loading-state" role="status" aria-live="polite">
      <picture>
        <source media="(prefers-reduced-motion: reduce)" srcSet={heartMonitorStill} />
        <img src={heartMonitor} alt="" width={72} height={72} />
      </picture>
      <p>{t('actions.loading')}</p>
    </div>
  );
}
