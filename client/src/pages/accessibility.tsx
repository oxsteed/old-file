import LegalPageLayout from '../components/LegalPageLayout';
import { useTranslation } from 'react-i18next';

export default function AccessibilityPage() {
  const { t } = useTranslation();

  const measures = [
    t('accessibilityPage.measures.one'),
    t('accessibilityPage.measures.two'),
    t('accessibilityPage.measures.three'),
    t('accessibilityPage.measures.four'),
    t('accessibilityPage.measures.five'),
  ];

  return (
    <LegalPageLayout
      title={t('accessibilityPage.title')}
      description={t('accessibilityPage.overview')}
      effectiveDate="2026-03-23"
    >
      <section className="mb-8">
        <h2 className="text-lg font-bold text-orange-400 mb-3">
          {t('accessibilityPage.sections.commitment')}
        </h2>
        <p className="mb-3">
          {t('accessibilityPage.overview')}
        </p>
      </section>

      <section className="mb-8">
        <h2 className="text-lg font-bold text-orange-400 mb-3">
          {t('accessibilityPage.sections.conformance')}
        </h2>
        <p className="mb-3">
          {t('accessibilityPage.conformance')}
        </p>
      </section>

      <section className="mb-8">
        <h2 className="text-lg font-bold text-orange-400 mb-3">
          {t('accessibilityPage.sections.measures')}
        </h2>
        <ul className="list-disc ml-5 space-y-2 mb-3">
          {measures.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      </section>

      <section className="mb-8">
        <h2 className="text-lg font-bold text-orange-400 mb-3">
          {t('accessibilityPage.sections.feedback')}
        </h2>
        <p className="mb-3">
          {t('accessibilityPage.feedback')}
        </p>
        <p className="mb-3">
          {t('accessibilityPage.emailLabel')}
          <a
            href="mailto:support@oxsteed.com"
            className="text-orange-400 underline"
          >
            support@oxsteed.com
          </a>
        </p>
        <p className="mb-3">
          {t('accessibilityPage.responseTime')}
        </p>
      </section>
    </LegalPageLayout>
  );
}
