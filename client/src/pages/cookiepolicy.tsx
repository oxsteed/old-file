import { useNavigate } from 'react-router-dom';

const s = {
  page: { minHeight: '100vh', background: '#0b0e18', color: '#e0e0e0', padding: '60px 20px' } as React.CSSProperties,
  container: { maxWidth: 800, margin: '0 auto' } as React.CSSProperties,
  h1: { color: '#f97316', fontSize: 28, marginBottom: 8 } as React.CSSProperties,
  date: { color: '#888', fontSize: 13, marginBottom: 32 } as React.CSSProperties,
  h2: { color: '#f97316', fontSize: 20, marginTop: 32, marginBottom: 12 } as React.CSSProperties,
  p: { color: '#ccc', fontSize: 14, lineHeight: 1.7, marginBottom: 16 } as React.CSSProperties,
  table: { width: '100%', borderCollapse: 'collapse' as const, marginBottom: 24 },
  th: { textAlign: 'left' as const, padding: '10px 12px', borderBottom: '1px solid #333', color: '#f97316', fontSize: 13 },
  td: { padding: '10px 12px', borderBottom: '1px solid #222', color: '#ccc', fontSize: 13 },
  link: { color: '#f97316', textDecoration: 'underline', cursor: 'pointer' },
  back: { color: '#f97316', cursor: 'pointer', background: 'none', border: 'none', fontSize: 14, marginTop: 40, display: 'block' } as React.CSSProperties,
};

export default function CookiePolicyPage() {
  const navigate = useNavigate();
  return (
    <div style={s.page}>
      <div style={s.container}>
        <h1 style={s.h1}>Cookie Policy</h1>
        <p style={s.date}>Effective Date: June 1, 2025</p>

        <h2 style={s.h2}>1. What Are Cookies?</h2>
        <p style={s.p}>
          Cookies are small text files stored on your device when you visit a website. They help
          us remember your preferences, understand how you use our platform, and improve your experience.
        </p>

        <h2 style={s.h2}>2. How OxSteed Uses Cookies</h2>
        <p style={s.p}>
          OxSteed uses cookies and similar technologies (localStorage, sessionStorage) to operate
          the platform, analyze usage, and deliver relevant content.
        </p>

        <h2 style={s.h2}>3. Types of Cookies We Use</h2>
        <table style={s.table}>
          <thead>
            <tr>
              <th style={s.th}>Category</th>
              <th style={s.th}>Purpose</th>
              <th style={s.th}>Duration</th>
              <th style={s.th}>Required</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td style={s.td}><strong>Essential</strong></td>
              <td style={s.td}>Authentication, security tokens, CSRF protection, session management</td>
              <td style={s.td}>Session / 30 days</td>
              <td style={s.td}>Yes</td>
            </tr>
            <tr>
              <td style={s.td}><strong>Analytics</strong></td>
              <td style={s.td}>Page views, feature usage, performance metrics (Google Analytics)</td>
              <td style={s.td}>Up to 2 years</td>
              <td style={s.td}>No</td>
            </tr>
            <tr>
              <td style={s.td}><strong>Marketing</strong></td>
              <td style={s.td}>Ad targeting, campaign tracking, conversion pixels</td>
              <td style={s.td}>Up to 1 year</td>
              <td style={s.td}>No</td>
            </tr>
            <tr>
              <td style={s.td}><strong>Functional</strong></td>
              <td style={s.td}>Saved preferences, chat widgets, language settings</td>
              <td style={s.td}>Up to 1 year</td>
              <td style={s.td}>No</td>
            </tr>
          </tbody>
        </table>

        <h2 style={s.h2}>4. Your Choices</h2>
        <p style={s.p}>
          When you first visit OxSteed, a cookie banner will ask for your consent. You can:
        </p>
        <ul style={{ ...s.p, paddingLeft: 20 }}>
          <li><strong>Accept All</strong> — Enable all cookie categories</li>
          <li><strong>Reject All</strong> — Only essential cookies will be used</li>
          <li><strong>Customize</strong> — Choose which categories to enable</li>
        </ul>
        <p style={s.p}>
          You can change your preferences at any time by clicking "Cookie Settings" in the footer.
        </p>

        <h2 style={s.h2}>5. Browser Controls</h2>
        <p style={s.p}>
          Most browsers allow you to block or delete cookies through their settings. Note that
          blocking essential cookies may prevent OxSteed from functioning properly.
        </p>

        <h2 style={s.h2}>6. Third-Party Cookies</h2>
        <p style={s.p}>
          Some cookies are set by third-party services that appear on our pages. We do not control
          these cookies. Key third parties include:
        </p>
        <ul style={{ ...s.p, paddingLeft: 20 }}>
          <li>Google Analytics (analytics)</li>
          <li>Stripe (payment processing — essential)</li>
        </ul>

        <h2 style={s.h2}>7. Do Not Track</h2>
        <p style={s.p}>
          OxSteed honors Do Not Track (DNT) browser signals. When detected, we disable
          non-essential cookies automatically.
        </p>

        <h2 style={s.h2}>8. California Residents (CCPA)</h2>
        <p style={s.p}>
          Under the CCPA, you have the right to opt out of the sale of your personal information.
          Marketing cookies may constitute a "sale" under CCPA. Visit our{' '}
          <a href="/do-not-sell" style={s.link}>Do Not Sell My Personal Information</a> page to exercise this right.
        </p>

        <h2 style={s.h2}>9. Updates to This Policy</h2>
        <p style={s.p}>
          We may update this Cookie Policy periodically. Changes will be posted on this page with
          a revised effective date. Continued use of OxSteed after changes constitutes acceptance.
        </p>

        <h2 style={s.h2}>10. Contact Us</h2>
        <p style={s.p}>
          Questions about our cookie practices? Contact us at{' '}
          <a href="mailto:privacy@oxsteed.com" style={s.link}>privacy@oxsteed.com</a>.
        </p>

        <button onClick={() => navigate(-1)} style={s.back}>&larr; Go Back</button>
      </div>
    </div>
  );
}
