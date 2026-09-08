import LegalPageLayout from '../components/LegalPageLayout';
import { useTranslation } from 'react-i18next';

export default function SecurityPolicy() {
  const { t } = useTranslation();

  return (
    <LegalPageLayout
      title={t('securityPolicyPage.title')}
      description={t('securityPolicyPage.section1Text')}
      effectiveDate="2026-03-22"
    >
      <section className="mb-8">
        <h2 className="text-lg font-bold text-orange-400 mb-3">
          {t('securityPolicyPage.section1Title')}
        </h2>
        <p className="mb-3">
          {t('securityPolicyPage.section1Text')}
        </p>
      </section>

      <section className="mb-8">
        <h2 className="text-lg font-bold text-orange-400 mb-3">
          {t('securityPolicyPage.section2Title')}
        </h2>
        <ul className="list-disc ml-5 space-y-2 mb-3">
          <li>{t('securityPolicyPage.section2List1')}</li>
          <li>{t('securityPolicyPage.section2List2')}</li>
          <li>{t('securityPolicyPage.section2List3')}</li>
          <li>{t('securityPolicyPage.section2List4')}</li>
          <li>{t('securityPolicyPage.section2List5')}</li>
          <li>{t('securityPolicyPage.section2List6')}</li>
          <li>{t('securityPolicyPage.section2List7')}</li>
          <li>{t('securityPolicyPage.section2List8')}</li>
        </ul>
      </section>

      <section className="mb-8">
        <h2 className="text-lg font-bold text-orange-400 mb-3">
          {t('securityPolicyPage.section3Title')}
        </h2>
        <ul className="list-disc ml-5 space-y-2 mb-3">
          <li>{t('securityPolicyPage.section3List1')}</li>
          <li>{t('securityPolicyPage.section3List2')}</li>
          <li>{t('securityPolicyPage.section3List3')}</li>
          <li>{t('securityPolicyPage.section3List4')}</li>
        </ul>
      </section>

      <section className="mb-8">
        <h2 className="text-lg font-bold text-orange-400 mb-3">
          {t('securityPolicyPage.section4Title')}
        </h2>
        <p className="mb-3">
          {t('securityPolicyPage.section4Text')}
        </p>
        <p className="mb-3">
          <a href="mailto:security@oxsteed.com" className="text-orange-400 underline">
            security@oxsteed.com
          </a>
        </p>
        <p className="mb-3">{t('securityPolicyPage.section4Include')}</p>
        <ul className="list-disc ml-5 space-y-2 mb-3">
          <li>{t('securityPolicyPage.section4Include1')}</li>
          <li>{t('securityPolicyPage.section4Include2')}</li>
          <li>{t('securityPolicyPage.section4Include3')}</li>
          <li>{t('securityPolicyPage.section4Include4')}</li>
        </ul>
        <p className="mb-3">
          {t('securityPolicyPage.section4Response')}
        </p>
        <p className="mb-3">
          {t('securityPolicyPage.section4DoNot')}
        </p>
      </section>

      <section className="mb-8">
        <h2 className="text-lg font-bold text-orange-400 mb-3">
          {t('securityPolicyPage.section5Title')}
        </h2>
        <ul className="list-disc ml-5 space-y-2 mb-3">
          <li>{t('securityPolicyPage.section5List1')}</li>
          <li>{t('securityPolicyPage.section5List2')}</li>
          <li>{t('securityPolicyPage.section5List3')}</li>
          <li>{t('securityPolicyPage.section5List4')}</li>
          <li>{t('securityPolicyPage.section5List5')}</li>
          <li>{t('securityPolicyPage.section5List6')}</li>
        </ul>
      </section>

      <section className="mb-8">
        <h2 className="text-lg font-bold text-orange-400 mb-3">
          {t('securityPolicyPage.section6Title')}
        </h2>
        <p className="mb-3">
          {t('securityPolicyPage.section6Text')}
        </p>
        <ul className="list-disc ml-5 space-y-2 mb-3">
          <li>{t('securityPolicyPage.section6List1')}</li>
          <li>{t('securityPolicyPage.section6List2')}</li>
          <li>{t('securityPolicyPage.section6List3')}</li>
          <li>{t('securityPolicyPage.section6List4')}</li>
          <li>{t('securityPolicyPage.section6List5')}</li>
        </ul>
      </section>

      <section className="mb-8">
        <h2 className="text-lg font-bold text-orange-400 mb-3">
          {t('securityPolicyPage.section7Title')}
        </h2>
        <p className="mb-3">
          {t('securityPolicyPage.section7Text')}
        </p>
        <p className="mb-3">
          OxSteed LLC<br />
          {t('securityPolicyPage.section7Attention')}<br />
          Springfield, Ohio<br />
          <a href="mailto:legal@oxsteed.com" className="text-orange-400 underline">legal@oxsteed.com</a>
        </p>
      </section>
    </LegalPageLayout>
  );
}
