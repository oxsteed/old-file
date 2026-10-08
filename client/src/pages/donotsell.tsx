import LegalPageLayout from '../components/LegalPageLayout';
import { useTranslation } from 'react-i18next';

export default function DoNotSell({ embedded = false }: { embedded?: boolean }) {
  const { t } = useTranslation();

  return (
    <LegalPageLayout
      title={t('doNotSellPage.title')}
      description={t('doNotSellPage.doesNotSellText1')}
      effectiveDate="2026-03-22"
      embedded={embedded}
    >
      <section className="mb-8">
        <h2 className="text-lg font-bold text-orange-400 mb-3">
          {t('doNotSellPage.doesNotSellYourDataTitle')}
        </h2>
        <p className="mb-3">
          {t('doNotSellPage.doesNotSellText1')}
        </p>
        <p className="mb-3">
          {t('doNotSellPage.doesNotSellText2')}
        </p>
      </section>

      <section className="mb-8">
        <h2 className="text-lg font-bold text-orange-400 mb-3">
          {t('doNotSellPage.rightsTitle')}
        </h2>
        <p className="mb-3">
          {t('doNotSellPage.rightsIntro')}
        </p>
        <ul className="list-disc ml-5 space-y-2 mb-3">
          <li>{t('doNotSellPage.rightsItem1')}</li>
          <li>{t('doNotSellPage.rightsItem2')}</li>
          <li>{t('doNotSellPage.rightsItem3')}</li>
          <li>{t('doNotSellPage.rightsItem4')}</li>
        </ul>
      </section>

      <section className="mb-8">
        <h2 className="text-lg font-bold text-orange-400 mb-3">
          {t('doNotSellPage.otherStateLawsTitle')}
        </h2>
        <p className="mb-3">
          {t('doNotSellPage.otherStateLawsText')}
        </p>
      </section>

      <section className="mb-8">
        <h2 className="text-lg font-bold text-orange-400 mb-3">
          {t('doNotSellPage.contactTitle')}
        </h2>
        <p className="mb-3">
          {t('doNotSellPage.contactIntro')}
        </p>
        <p className="mb-3">
          <strong>{t('doNotSellPage.contactEmailLabel')}</strong> privacy@oxsteed.com<br />
          <strong>{t('doNotSellPage.contactMailLabel')}</strong> OxSteed LLC, Springfield, OH 45503
        </p>
      </section>
    </LegalPageLayout>
  );
}
