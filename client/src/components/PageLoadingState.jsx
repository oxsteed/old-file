import { useTranslation } from 'react-i18next';
import './PageLoadingState.css';

export default function PageLoadingState() {
  const { t } = useTranslation('common');
  return (
    <div className="ox-loading-state" role="status" aria-live="polite">
      <span className="ox-loading-state__spinner" aria-hidden="true" />
      <p>{t('actions.loading')}</p>
    </div>
  );
}
