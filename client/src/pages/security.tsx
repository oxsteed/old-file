import LegalPageLayout from '../components/LegalPageLayout';

export default function SecurityPolicy() {
  return (
    <LegalPageLayout title="Security Policy" effectiveDate="2026-03-22">
      <section className="mb-8">
        <h2 className="text-lg font-bold text-orange-400 mb-3">
          1. Our Commitment to Security
        </h2>
        <p className="mb-3">
          OxSteed LLC takes the security of your personal information
          seriously. We implement commercially reasonable administrative,
          technical, and physical safeguards to protect your data against
          unauthorized access, alteration, disclosure, or destruction.
        </p>
      </section>

      <section className="mb-8">
        <h2 className="text-lg font-bold text-orange-400 mb-3">
          2. Technical Security Measures
        </h2>
        <ul className="list-disc ml-5 space-y-2 mb-3">
          <li><strong>Encryption in transit:</strong> All data transmitted between your browser and OxSteed's servers is encrypted using TLS 1.2+ (HTTPS).</li>
          <li><strong>Password security:</strong> Passwords are hashed using bcrypt with per-user salts. OxSteed staff cannot view your password.</li>
          <li><strong>Authentication:</strong> JWT-based authentication with secure, HTTP-only cookies. Tokens expire and are refreshed automatically.</li>
          <li><strong>Rate limiting:</strong> Authentication endpoints are rate-limited to prevent brute-force attacks.</li>
          <li><strong>Role-based access control:</strong> Users can only access data and features appropriate to their role (Customer, Helper, Admin).</li>
          <li><strong>Input validation:</strong> All user inputs are validated and sanitized server-side to prevent injection attacks.</li>
          <li><strong>Security headers:</strong> Helmet.js is used to set secure HTTP headers including CSP, HSTS, X-Frame-Options, and X-Content-Type-Options.</li>
        </ul>
      </section>

      <section className="mb-8">
        <h2 className="text-lg font-bold text-orange-400 mb-3">
          3. Third-Party Security
        </h2>
        <ul className="list-disc ml-5 space-y-2 mb-3">
          <li><strong>Stripe:</strong> All payment processing is handled by Stripe, Inc., which is PCI DSS Level 1 certified. OxSteed never stores credit card numbers.</li>
          <li><strong>Checkr:</strong> Background check data is processed and stored by Checkr, Inc. under its own security and FCRA compliance policies.</li>
          <li><strong>Render:</strong> Our servers are hosted on Render's infrastructure with automatic TLS, DDoS protection, and isolated environments.</li>
          <li><strong>Resend:</strong> Transactional emails are delivered through Resend with TLS encryption.</li>
        </ul>
      </section>

      <section className="mb-8">
        <h2 className="text-lg font-bold text-orange-400 mb-3">
          4. Responsible Disclosure
        </h2>
        <p className="mb-3">
          If you discover a security vulnerability on OxSteed, we ask that you
          disclose it responsibly. Please report security issues to:
        </p>
        <p className="mb-3">
          <a href="mailto:security@oxsteed.com" className="text-orange-400 underline">security@oxsteed.com</a>
        </p>
        <p className="mb-3">Please include:</p>
        <ul className="list-disc ml-5 space-y-2 mb-3">
          <li>A description of the vulnerability and its potential impact;</li>
          <li>Steps to reproduce the issue;</li>
          <li>Any relevant screenshots or proof-of-concept code;</li>
          <li>Your contact information for follow-up.</li>
        </ul>
        <p className="mb-3">
          We will acknowledge your report within 48 hours and work to resolve
          verified vulnerabilities as quickly as possible. We will not take
          legal action against researchers who follow responsible disclosure
          practices.
        </p>
        <p className="mb-3">
          <strong>Do not</strong> access other users' accounts or data, perform
          denial-of-service attacks, or exploit vulnerabilities beyond what is
          necessary to demonstrate the issue.
        </p>
      </section>

      <section className="mb-8">
        <h2 className="text-lg font-bold text-orange-400 mb-3">
          5. Your Security Responsibilities
        </h2>
        <ul className="list-disc ml-5 space-y-2 mb-3">
          <li>Use a strong, unique password for your OxSteed account;</li>
          <li>Do not share your login credentials with anyone;</li>
          <li>Log out of your account when using shared or public devices;</li>
          <li>Notify us immediately at <a href="mailto:security@oxsteed.com" className="text-orange-400 underline">security@oxsteed.com</a> if you suspect unauthorized access to your account;</li>
          <li>Keep your browser and operating system up to date.</li>
        </ul>
      </section>

      <section className="mb-8">
        <h2 className="text-lg font-bold text-orange-400 mb-3">
          6. Incident Response
        </h2>
        <p className="mb-3">
          In the event of a security incident that compromises personal data,
          OxSteed will:
        </p>
        <ul className="list-disc ml-5 space-y-2 mb-3">
          <li>Investigate and contain the incident immediately;</li>
          <li>Notify affected users by email within 72 hours of discovery;</li>
          <li>Notify applicable state attorneys general as required by law;</li>
          <li>Provide details about what data was affected and steps users should take;</li>
          <li>Implement measures to prevent recurrence.</li>
        </ul>
      </section>

      <section className="mb-8">
        <h2 className="text-lg font-bold text-orange-400 mb-3">
          7. DMCA Designated Agent
        </h2>
        <p className="mb-3">
          OxSteed's designated agent for DMCA takedown notices:
        </p>
        <p className="mb-3">
          OxSteed LLC<br />
          Attn: DMCA Agent<br />
          Springfield, Ohio<br />
          <a href="mailto:legal@oxsteed.com" className="text-orange-400 underline">legal@oxsteed.com</a>
        </p>
      </section>
    </LegalPageLayout>
  );
}
