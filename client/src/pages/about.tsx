import LegalPageLayout from '../components/LegalPageLayout';
import { useTranslation } from 'react-i18next';

export default function AboutPage() {
  const { t } = useTranslation();

  const howItWorksItems = [
    t('aboutPage.howItWorks.items.tier1'),
    t('aboutPage.howItWorks.items.tier2'),
    t('aboutPage.howItWorks.items.tier3'),
  ];

  return (
    <LegalPageLayout title={t('aboutPage.title')} effectiveDate="2026-03-24">
      <section className="mb-8">
        <h2 className="text-lg font-bold text-orange-400 mb-3">{t('aboutPage.sections.whoWeAre')}</h2>
        <p className="mb-3">
          {t('aboutPage.whoWeAre')}
        </p>
        <p className="mb-3">{t('aboutPage.whoWeAreSecondary')}</p>
      </section>

      <section className="mb-8">
        <h2 className="text-lg font-bold text-orange-400 mb-3">{t('aboutPage.sections.mission')}</h2>
        <p className="mb-3">{t('aboutPage.mission')}</p>
      </section>

      <section className="mb-8">
        <h2 className="text-lg font-bold text-orange-400 mb-3">{t('aboutPage.sections.howItWorks')}</h2>
        <ul className="list-disc ml-5 space-y-2 mb-3">
          {howItWorksItems.map((item) => (
            <li key={item}>
              <strong>{t('aboutPage.howItWorks.title')}:</strong>
              {' '}
              {item}
            </li>
          ))}
        </ul>
      </section>

      <section className="mb-8">
        <h2 className="text-lg font-bold text-orange-400 mb-3">{t('aboutPage.sections.contact')}</h2>
        <p className="mb-3">{t('aboutPage.contact')}</p>
        <ul className="list-disc ml-5 space-y-2">
          <li>
            {t('aboutPage.contactEmail')}
            <a href="mailto:support@oxsteed.com" className="text-orange-400 underline hover:text-orange-300">support@oxsteed.com</a>
          </li>
          <li>
            {t('aboutPage.contactWebsite')}
            <a href="https://oxsteed.com" className="text-orange-400 underline hover:text-orange-300">oxsteed.com</a>
          </li>
        </ul>
      </section>

      <section className="mb-8">
        <h2 className="text-lg font-bold text-orange-400 mb-3">{t('aboutPage.sections.legal')}</h2>
        <p>
          {t('aboutPage.legalPrefix')}
          <a href="/terms" className="text-orange-400 underline hover:text-orange-300">{t('footer.terms')}</a>{' '}
          {t('aboutPage.legalAnd')}
          <a href="/privacy" className="text-orange-400 underline hover:text-orange-300">{t('footer.privacy')}</a>.
        </p>
      </section>
    </LegalPageLayout>
  );
}
