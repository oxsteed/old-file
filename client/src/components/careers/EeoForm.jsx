import { useTranslation } from 'react-i18next';
import { EEO_OPTIONS } from '../../features/careers/careersModel';

/**
 * Voluntary US self-identification (§9.4). Answers are stored encrypted,
 * apart from the application, and never reach the hiring team.
 */
export default function EeoForm({ value = {}, onChange, idPrefix = 'eeo' }) {
  const { t } = useTranslation();
  return (
    <fieldset className="ox-careers-panel ox-careers-section">
      <legend>{t('careers.eeo.title')}</legend>
      <p className="ox-careers-subtle">{t('careers.eeo.intro')}</p>
      <div className="ox-careers-form-grid">
        {Object.entries(EEO_OPTIONS).map(([dim, options]) => (
          <div key={dim} className="ox-careers-field">
            <label htmlFor={`${idPrefix}-${dim}`}>{t(`careers.eeo.${dim}`)}</label>
            <select id={`${idPrefix}-${dim}`} value={value[dim] || ''} onChange={(e) => onChange({ ...value, [dim]: e.target.value })}>
              <option value="">{t('careers.eeo.skip')}</option>
              {options.map((o) => <option key={o} value={o}>{t(`careers.eeo.options.${dim}.${o}`)}</option>)}
            </select>
          </div>
        ))}
      </div>
    </fieldset>
  );
}
