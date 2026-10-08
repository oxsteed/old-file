import LegalPageLayout from '../components/LegalPageLayout';
import { useTranslation } from 'react-i18next';

const tableStyles = {
  table: { width: '100%', borderCollapse: 'collapse' as const, marginBottom: 24 },
  th: { textAlign: 'left' as const, padding: '10px 12px', borderBottom: '1px solid #333', color: '#f97316', fontSize: 13 },
  td: { padding: '10px 12px', borderBottom: '1px solid #222', color: '#ccc', fontSize: 13 },
};

export default function CookiePolicyPage({ embedded = false }: { embedded?: boolean }) {
  const { t } = useTranslation();

  return (
    <LegalPageLayout
      title={t('cookiePolicyPage.title')}
      description={t('cookiePolicyPage.section1Text')}
      effectiveDate="2026-03-23"
      embedded={embedded}
    >
      <section className="mb-8">
        <h2 className="text-lg font-bold text-orange-400 mb-3">
          {t('cookiePolicyPage.section1Title')}
        </h2>
        <p className="mb-3">
          {t('cookiePolicyPage.section1Text')}
        </p>
      </section>

      <section className="mb-8">
        <h2 className="text-lg font-bold text-orange-400 mb-3">
          {t('cookiePolicyPage.section2Title')}
        </h2>
        <p className="mb-3">
          {t('cookiePolicyPage.section2Text')}
        </p>
      </section>

      <section className="mb-8">
        <h2 className="text-lg font-bold text-orange-400 mb-3">
          {t('cookiePolicyPage.section3Title')}
        </h2>
        <table style={tableStyles.table}>
          <thead>
            <tr>
              <th style={tableStyles.th}>{t('cookiePolicyPage.tableCategory')}</th>
              <th style={tableStyles.th}>{t('cookiePolicyPage.tablePurpose')}</th>
              <th style={tableStyles.th}>{t('cookiePolicyPage.tableDuration')}</th>
              <th style={tableStyles.th}>{t('cookiePolicyPage.tableRequired')}</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td style={tableStyles.td}><strong>{t('cookiePolicyPage.tableEssentialCategory')}</strong></td>
              <td style={tableStyles.td}>{t('cookiePolicyPage.tableEssentialPurpose')}</td>
              <td style={tableStyles.td}>{t('cookiePolicyPage.tableEssentialDuration')}</td>
              <td style={tableStyles.td}>{t('cookiePolicyPage.tableYes')}</td>
            </tr>
            <tr>
              <td style={tableStyles.td}><strong>{t('cookiePolicyPage.tableAnalyticsCategory')}</strong></td>
              <td style={tableStyles.td}>{t('cookiePolicyPage.tableAnalyticsPurpose')}</td>
              <td style={tableStyles.td}>{t('cookiePolicyPage.tableAnalyticsDuration')}</td>
              <td style={tableStyles.td}>{t('cookiePolicyPage.tableNo')}</td>
            </tr>
            <tr>
              <td style={tableStyles.td}><strong>{t('cookiePolicyPage.tableMarketingCategory')}</strong></td>
              <td style={tableStyles.td}>{t('cookiePolicyPage.tableMarketingPurpose')}</td>
              <td style={tableStyles.td}>{t('cookiePolicyPage.tableMarketingDuration')}</td>
              <td style={tableStyles.td}>{t('cookiePolicyPage.tableNo')}</td>
            </tr>
            <tr>
              <td style={tableStyles.td}><strong>{t('cookiePolicyPage.tableFunctionalCategory')}</strong></td>
              <td style={tableStyles.td}>{t('cookiePolicyPage.tableFunctionalPurpose')}</td>
              <td style={tableStyles.td}>{t('cookiePolicyPage.tableFunctionalDuration')}</td>
              <td style={tableStyles.td}>{t('cookiePolicyPage.tableNo')}</td>
            </tr>
          </tbody>
        </table>
      </section>

      <section className="mb-8">
        <h2 className="text-lg font-bold text-orange-400 mb-3">
          {t('cookiePolicyPage.section4Title')}
        </h2>
        <p className="mb-3">
          {t('cookiePolicyPage.section4Text')}
        </p>
        <ul className="list-disc ml-5 space-y-2 mb-3">
          <li>{t('cookiePolicyPage.section4Choice1')}</li>
          <li>{t('cookiePolicyPage.section4Choice2')}</li>
          <li>{t('cookiePolicyPage.section4Choice3')}</li>
        </ul>
        <p className="mb-3">
          {t('cookiePolicyPage.section4Footer')}
        </p>
      </section>

      <section className="mb-8">
        <h2 className="text-lg font-bold text-orange-400 mb-3">
          {t('cookiePolicyPage.section5Title')}
        </h2>
        <p className="mb-3">
          {t('cookiePolicyPage.section5Text')}
        </p>
      </section>

      <section className="mb-8">
        <h2 className="text-lg font-bold text-orange-400 mb-3">
          {t('cookiePolicyPage.section6Title')}
        </h2>
        <p className="mb-3">
          {t('cookiePolicyPage.section6Text')}
        </p>
        <ul className="list-disc ml-5 space-y-2 mb-3">
          <li>{t('cookiePolicyPage.section6ThirdParty1')}</li>
          <li>{t('cookiePolicyPage.section6ThirdParty2')}</li>
        </ul>
      </section>

      <section className="mb-8">
        <h2 className="text-lg font-bold text-orange-400 mb-3">
          {t('cookiePolicyPage.section7Title')}
        </h2>
        <p className="mb-3">
          {t('cookiePolicyPage.section7Text')}
        </p>
      </section>

      <section className="mb-8">
        <h2 className="text-lg font-bold text-orange-400 mb-3">
          {t('cookiePolicyPage.section8Title')}
        </h2>
        <p className="mb-3">
          {t('cookiePolicyPage.section8Text')}
          <a href="/do-not-sell" className="text-orange-400 underline">
            {t('cookiePolicyPage.section8Link')}
          </a>
          {t('cookiePolicyPage.section8Suffix')}
        </p>
      </section>

      <section className="mb-8">
        <h2 className="text-lg font-bold text-orange-400 mb-3">
          {t('cookiePolicyPage.section9Title')}
        </h2>
        <p className="mb-3">
          {t('cookiePolicyPage.section9Text')}
        </p>
      </section>

      <section className="mb-8">
        <h2 className="text-lg font-bold text-orange-400 mb-3">
          {t('cookiePolicyPage.section10Title')}
        </h2>
        <p className="mb-3">
          {t('cookiePolicyPage.section10Text')}
          <a href="mailto:privacy@oxsteed.com" className="text-orange-400 underline">
            privacy@oxsteed.com
          </a>
          {t('cookiePolicyPage.section10Suffix')}
        </p>
      </section>
    </LegalPageLayout>
  );
}
