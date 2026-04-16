/**
 * Thin re-export kept for backward compatibility with any component
 * that imports useTranslate directly.
 *
 * Prefer using useTranslation() from 'react-i18next' in new code:
 *   const { t } = useTranslation();
 *   <h1>{t('Browse Jobs')}</h1>
 */
export { useTranslation as useTranslate } from 'react-i18next';

export default function useT() {
  const { t } = require('react-i18next').useTranslation();
  return t;
}
