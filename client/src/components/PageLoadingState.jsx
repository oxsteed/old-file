import { useTranslation } from 'react-i18next';
import OxsteedAnimatedLogo from './OxsteedAnimatedLogo';
import './PageLoadingState.css';

export default function PageLoadingState() {
  const { t } = useTranslation('common');
  return (
    <div className="ox-loading-state" role="status" aria-live="polite">
      <OxsteedAnimatedLogo variant="pulse" size={72} />
      <p>{t('actions.loading')}</p>
    </div>
  );
}
