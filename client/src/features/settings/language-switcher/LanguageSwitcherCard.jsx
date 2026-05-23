import React from 'react';
import { useTranslation } from 'react-i18next';
import LanguageSelector from '../../../components/LanguageSelector';

export default function LanguageSwitcherCard() {
  const { t } = useTranslation(['translator']);

  return (
    <section className="translator-card">
      <div className="translator-card-header">
        <h2>{t('translator:languageCard.title')}</h2>
      </div>
      <p className="translator-muted">{t('translator:languageCard.body')}</p>
      <div className="translator-language-selector-row">
        <LanguageSelector />
      </div>
    </section>
  );
}
