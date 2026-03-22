import LegalPageLayout from '../components/LegalPageLayout';

const tableStyles = {
  table: { width: '100%', borderCollapse: 'collapse' as const, marginBottom: 24 },
  th: { textAlign: 'left' as const, padding: '10px 12px', borderBottom: '1px solid #333', color: '#f97316', fontSize: 13 },
  td: { padding: '10px 12px', borderBottom: '1px solid #222', color: '#ccc', fontSize: 13 },
};

export default function CookiePolicyPage() {
  return (
    <LegalPageLayout title="Cookie Policy" effectiveDate="2025-06-01">
      <section className="mb-8">
        <h2 className="text-lg font-bold text-orange-400 mb-3">
          1. What Are Cookies?
        </h2>
        <p className="mb-3">
          Cookies are small text files stored on your device when you visit a website. They help
          us remember your preferences, understand how you use our platform, and improve your experience.
        </p>
      </section>

      <section className="mb-8">
        <h2 className="text-lg font-bold text-orange-400 mb-3">
          2. How OxSteed Uses Cookies
        </h2>
        <p className="mb-3">
          OxSteed uses cookies and similar technologies (localStorage, sessionStorage) to operate
          the platform, analyze usage, and deliver relevant content.
        </p>
      </section>

      <section className="mb-8">
        <h2 className="text-lg font-bold text-orange-400 mb-3">
          3. Types of Cookies We Use
        </h2>
        <table style={tableStyles.table}>
          <thead>
            <tr>
              <th style={tableStyles.th}>Category</th>
              <th style={tableStyles.th}>Purpose</th>
              <th style={tableStyles.th}>Duration</th>
              <th style={tableStyles.th}>Required</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td style={tableStyles.td}><strong>Essential</strong></td>
              <td style={tableStyles.td}>Authentication, security tokens, CSRF protection, session management</td>
              <td style={tableStyles.td}>Session / 30 days</td>
              <td style={tableStyles.td}>Yes</td>
            </tr>
            <tr>
              <td style={tableStyles.td}><strong>Analytics</strong></td>
              <td style={tableStyles.td}>Page views, feature usage, performance metrics (Google Analytics)</td>
              <td style={tableStyles.td}>Up to 2 years</td>
              <td style={tableStyles.td}>No</td>
            </tr>
            <tr>
              <td style={tableStyles.td}><strong>Marketing</strong></td>
              <td style={tableStyles.td}>Ad targeting, campaign tracking, conversion pixels</td>
              <td style={tableStyles.td}>Up to 1 year</td>
              <td style={tableStyles.td}>No</td>
            </tr>
            <tr>
              <td style={tableStyles.td}><strong>Functional</strong></td>
              <td style={tableStyles.td}>Saved preferences, chat widgets, language settings</td>
              <td style={tableStyles.td}>Up to 1 year</td>
              <td style={tableStyles.td}>No</td>
            </tr>
          </tbody>
        </table>
      </section>

      <section className="mb-8">
        <h2 className="text-lg font-bold text-orange-400 mb-3">
          4. Your Choices
        </h2>
        <p className="mb-3">
          When you first visit OxSteed, a cookie banner will ask for your consent. You can:
        </p>
        <ul className="list-disc ml-5 space-y-2 mb-3">
          <li><strong>Accept All</strong> — Enable all cookie categories</li>
          <li><strong>Reject All</strong> — Only essential cookies will be used</li>
          <li><strong>Customize</strong> — Choose which categories to enable</li>
        </ul>
        <p className="mb-3">
          You can change your preferences at any time by clicking "Cookie Settings" in the footer.
        </p>
      </section>

      <section className="mb-8">
        <h2 className="text-lg font-bold text-orange-400 mb-3">
          5. Browser Controls
        </h2>
        <p className="mb-3">
          Most browsers allow you to block or delete cookies through their settings.
          Note that blocking essential cookies may prevent OxSteed from functioning properly.
        </p>
      </section>

      <section className="mb-8">
        <h2 className="text-lg font-bold text-orange-400 mb-3">
          6. Third-Party Cookies
        </h2>
        <p className="mb-3">
          Some cookies are set by third-party services that appear on our pages.
          We do not control these cookies. Key third parties include:
        </p>
        <ul className="list-disc ml-5 space-y-2 mb-3">
          <li>Google Analytics (analytics)</li>
          <li>Stripe (payment processing — essential)</li>
        </ul>
      </section>

      <section className="mb-8">
        <h2 className="text-lg font-bold text-orange-400 mb-3">
          7. Do Not Track
        </h2>
        <p className="mb-3">
          OxSteed honors Do Not Track (DNT) browser signals. When detected,
          we disable non-essential cookies automatically.
        </p>
      </section>

      <section className="mb-8">
        <h2 className="text-lg font-bold text-orange-400 mb-3">
          8. California Residents (CCPA)
        </h2>
        <p className="mb-3">
          Under the CCPA, you have the right to opt out of the sale of your personal
          information. Marketing cookies may constitute a "sale" under CCPA. Visit our{' '}
          <a href="/do-not-sell" className="text-orange-400 underline">Do Not Sell My Personal Information</a>{' '}
          page to exercise this right.
        </p>
      </section>

      <section className="mb-8">
        <h2 className="text-lg font-bold text-orange-400 mb-3">
          9. Updates to This Policy
        </h2>
        <p className="mb-3">
          We may update this Cookie Policy periodically. Changes will be posted on this page
          with a revised effective date. Continued use of OxSteed after changes constitutes acceptance.
        </p>
      </section>

      <section className="mb-8">
        <h2 className="text-lg font-bold text-orange-400 mb-3">
          10. Contact Us
        </h2>
        <p className="mb-3">
          Questions about our cookie practices? Contact us at{' '}
          <a href="mailto:privacy@oxsteed.com" className="text-orange-400 underline">privacy@oxsteed.com</a>.
        </p>
      </section>
    </LegalPageLayout>
  );
}
