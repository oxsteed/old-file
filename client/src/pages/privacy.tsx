import { Link } from 'react-router-dom';
import { Home, Shield } from 'lucide-react';

export default function PrivacyPolicy() {
  return (
    <div className="min-h-screen bg-gray-950 text-gray-300 flex flex-col">
      {/* Header */}
      <nav className="sticky top-0 z-50 bg-gray-950/80 backdrop-blur-md border-b border-gray-800">
        <div className="max-w-6xl mx-auto px-4 py-4 flex items-center justify-between">
          <Link to="/" className="flex items-center gap-2 group">
            <Home className="w-5 h-5 text-orange-500 group-hover:text-orange-400 transition-colors" />
            <span className="text-xl font-bold text-white group-hover:text-orange-400 transition-colors">OxSteed</span>
          </Link>
          <div className="flex items-center gap-6">
            <Link to="/" className="text-sm text-gray-400 hover:text-white transition-colors">Home</Link>
            <Link to="/jobs" className="text-sm text-gray-400 hover:text-white transition-colors">Browse Jobs</Link>
            <Link to="/login" className="text-sm bg-orange-600 hover:bg-orange-500 text-white px-4 py-2 rounded-lg transition-colors font-medium">Sign In</Link>
          </div>
        </div>
      </nav>

      {/* Hero Banner */}
      <div className="bg-gradient-to-r from-orange-600/20 via-orange-500/10 to-transparent border-b border-gray-800">
        <div className="max-w-4xl mx-auto px-4 py-10 flex items-center gap-4">
          <div className="bg-orange-500/20 p-3 rounded-xl">
            <Shield className="w-8 h-8 text-orange-400" />
          </div>
          <div>
            <h1 className="text-3xl font-bold text-white">Privacy Policy</h1>
            <p className="text-gray-400 text-sm mt-1">Last updated: March 22, 2026 — Effective immediately upon account creation</p>
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1">
        <div className="max-w-4xl mx-auto px-4 py-12 text-sm leading-relaxed">

        <section className="mb-8">
          <h2 className="text-lg font-bold text-orange-400 mb-3">
            1. Introduction
          </h2>
          <p className="mb-3">
            OxSteed LLC ("OxSteed," "we," "us," or "our") operates the
            OxSteed platform at oxsteed.com. This Privacy Policy explains
            what personal information we collect, how we use it, how we
            share it, and your rights regarding your data.
          </p>
          <p className="mb-3">
            By creating an account or using OxSteed, you consent to the
            collection and use of your information as described in this
            Privacy Policy. If you do not agree, do not use the platform.
          </p>
        </section>

        <section className="mb-8">
          <h2 className="text-lg font-bold text-orange-400 mb-3">
            2. Information We Collect
          </h2>
          <h3 className="text-md font-semibold text-orange-300 mb-2">
            2.1 Information You Provide
          </h3>
          <ul className="list-disc ml-5 space-y-2 mb-3">
            <li><strong>Account registration:</strong> Name, email address, phone number, password, role (Customer or Helper), and location (city, state, zip code).</li>
            <li><strong>Profile information:</strong> Profile photo, bio, skills, service categories, hourly rates, and availability.</li>
            <li><strong>Payment information:</strong> Stripe processes all payments. OxSteed does not store credit card numbers. We store Stripe customer IDs and connected account IDs.</li>
            <li><strong>Background check data:</strong> If you elect a background check, Checkr, Inc. collects and processes your personal data under its own privacy policy. OxSteed receives only pass/fail status and badge eligibility.</li>
            <li><strong>Communications:</strong> Messages sent through the platform, support requests, and feedback.</li>
            <li><strong>Job and bid data:</strong> Job descriptions, bid amounts, completion status, and reviews.</li>
            <li><strong>Tax information:</strong> IRS Form W-9 data (name, address, SSN/EIN) for Helpers earning $600+ annually through Tier 3.</li>
          </ul>
                    <h3 className="text-md font-semibold text-orange-300 mb-2">
            2.2 Information Collected Automatically
          </h3>
          <ul className="list-disc ml-5 space-y-2 mb-3">
            <li><strong>Device and browser data:</strong> IP address, browser type, operating system, device identifiers, and screen resolution.</li>
            <li><strong>Usage data:</strong> Pages viewed, features used, search queries, click patterns, and session duration.</li>
            <li><strong>Location data:</strong> Approximate location derived from IP address and zip code provided during registration.</li>
            <li><strong>Cookies and tracking:</strong> We use essential cookies for authentication and session management. See Section 8 for details.</li>
          </ul>
          <h3 className="text-md font-semibold text-orange-300 mb-2">
            2.3 Information from Third Parties
          </h3>
          <ul className="list-disc ml-5 space-y-2 mb-3">
            <li><strong>Stripe:</strong> Payment status, transaction IDs, and connected account status.</li>
            <li><strong>Checkr:</strong> Background check completion status and badge eligibility (not the underlying report details).</li>
          </ul>
        </section>

                <section className="mb-8">
          <h2 className="text-lg font-bold text-orange-400 mb-3">
            3. How We Use Your Information
          </h2>
          <p className="mb-3">
            We use the information we collect for the following purposes:
          </p>
          <ul className="list-disc ml-5 space-y-2 mb-3">
            <li>To create, maintain, and secure your account;</li>
            <li>To connect Customers with Helpers and facilitate service transactions;</li>
            <li>To process payments through Stripe (Tier 3 escrow);</li>
            <li>To facilitate background checks through Checkr;</li>
            <li>To send transactional emails (job alerts, payment confirmations, account notifications);</li>
            <li>To comply with tax reporting obligations (IRS Form 1099-NEC);</li>
            <li>To enforce our Terms of Service and prevent fraud;</li>
            <li>To improve and develop the platform;</li>
            <li>To respond to legal requests and prevent harm;</li>
            <li>To send service-related communications (you may not opt out of these while your account is active).</li>
          </ul>
          <p className="mb-3">
            <strong>We do not sell your personal information.</strong> We do
            not use your data for targeted advertising. We do not share
            your data with data brokers.
          </p>
        </section>

        <section className="mb-8">
          <h2 className="text-lg font-bold text-orange-400 mb-3">
            4. How We Share Your Information
          </h2>
          <p className="mb-3">
            We share your personal information only in the following
            circumstances:
          </p>
          <ul className="list-disc ml-5 space-y-2 mb-3">
            <li><strong>With other users:</strong> Your profile information (name, photo, skills, reviews, badge status) is visible to other users. Your full address is shared only with Helpers who have accepted a job, and only within 12 hours of the job start time.</li>
            <li><strong>With Stripe, Inc.:</strong> Payment and identity data necessary to process transactions and manage connected accounts.</li>
            <li><strong>With Checkr, Inc.:</strong> Personal data necessary to conduct background checks (only with your separate, affirmative consent under FCRA).</li>
            <li><strong>With Resend:</strong> Email address and name for transactional email delivery.</li>
            <li><strong>With law enforcement:</strong> When required by law, subpoena, court order, or to protect the rights, property, or safety of OxSteed, its users, or the public.</li>
            <li><strong>In a business transfer:</strong> If OxSteed is acquired, merged, or sells assets, user data may be transferred to the successor entity. We will notify you by email before your data is subject to a different privacy policy.</li>
          </ul>
        </section>

                <section className="mb-8">
          <h2 className="text-lg font-bold text-orange-400 mb-3">
            5. Address Privacy and Data Masking
          </h2>
          <p className="mb-3">
            When a Customer posts a job, their full street address is never
            displayed publicly. A Helper receives the Customer's full
            address only after:
          </p>
          <ul className="list-disc ml-5 space-y-2 mb-3">
            <li>The Helper has been accepted for the job; AND</li>
            <li>The job is scheduled to begin within 12 hours.</li>
          </ul>
          <p className="mb-3">
            All address reveals are logged with timestamps, user IDs, and
            IP addresses for security and audit purposes.
          </p>
        </section>

        <section className="mb-8">
          <h2 className="text-lg font-bold text-orange-400 mb-3">
            6. Data Retention
          </h2>
          <ul className="list-disc ml-5 space-y-2 mb-3">
            <li><strong>Active accounts:</strong> Data is retained for as long as your account is active.</li>
            <li><strong>Closed accounts:</strong> Account data is retained for 3 years after account closure for tax compliance, legal obligations, and dispute resolution purposes.</li>
            <li><strong>Tax records (W-9, 1099-NEC):</strong> Retained for 7 years as required by IRS regulations.</li>
            <li><strong>Escrow transaction records:</strong> Retained for 5 years after the transaction date.</li>
            <li><strong>Audit logs:</strong> Security and access logs are retained for 2 years.</li>
            <li><strong>Background check status:</strong> Badge expiration is 12 months. Underlying check data is held by Checkr under its own retention policy.</li>
          </ul>
        </section>

        <section className="mb-8">
          <h2 className="text-lg font-bold text-orange-400 mb-3">
            7. Your Rights
          </h2>
          <p className="mb-3">
            Depending on your state of residence, you may have the following
            rights regarding your personal information:
          </p>
          <ul className="list-disc ml-5 space-y-2 mb-3">
            <li><strong>Right to know:</strong> Request a copy of the personal information we hold about you.</li>
            <li><strong>Right to delete:</strong> Request deletion of your personal information, subject to legal retention obligations.</li>
            <li><strong>Right to correct:</strong> Request correction of inaccurate personal information.</li>
            <li><strong>Right to opt out of sale:</strong> We do not sell personal information. No action is needed.</li>
            <li><strong>Right to non-discrimination:</strong> We will not discriminate against you for exercising your privacy rights.</li>
          </ul>
          <p className="mb-3">
            To exercise any of these rights, email{' '}
            <a href="mailto:legal@oxsteed.com" className="text-orange-500 underline">legal@oxsteed.com</a>
            {' '}with the subject line "Privacy Rights Request." We will
            respond within 30 days. We may need to verify your identity
            before processing your request.
          </p>
          <p className="text-xs bg-yellow-900/30 border border-yellow-700/50 rounded-lg p-3 text-yellow-400">
            <strong>California residents (CCPA/CPRA):</strong> You have
            additional rights under the California Consumer Privacy Act
            and the California Privacy Rights Act. See our{' '}
            <a href="/#/do-not-sell" className="text-orange-500 underline">Do Not Sell or Share My Personal Information</a>
            {' '}page for details.
          </p>
        </section>

                <section className="mb-8">
          <h2 className="text-lg font-bold text-orange-400 mb-3">
            8. Cookies and Tracking Technologies
          </h2>
          <p className="mb-3">
            OxSteed uses the following categories of cookies:
          </p>
          <ul className="list-disc ml-5 space-y-2 mb-3">
            <li><strong>Essential cookies:</strong> Required for authentication, session management, and security. These cannot be disabled.</li>
            <li><strong>Functional cookies:</strong> Remember your preferences (e.g., dark mode, location). You may disable these in your browser settings.</li>
          </ul>
          <p className="mb-3">
            OxSteed does <strong>not</strong> use advertising cookies,
            retargeting pixels, or third-party tracking scripts. We do not
            participate in ad networks or sell data to advertisers.
          </p>
        </section>

        <section className="mb-8">
          <h2 className="text-lg font-bold text-orange-400 mb-3">
            9. Data Security and Breach Notification
          </h2>
          <p className="mb-3">
            OxSteed implements commercially reasonable security measures to
            protect your personal information, including:
          </p>
          <ul className="list-disc ml-5 space-y-2 mb-3">
            <li>Encryption in transit (TLS/HTTPS) and at rest for sensitive data;</li>
            <li>Bcrypt password hashing with salting;</li>
            <li>JWT-based authentication with secure, HTTP-only cookies;</li>
            <li>Rate limiting on authentication endpoints;</li>
            <li>Role-based access controls;</li>
            <li>Audit logging of security-sensitive actions.</li>
          </ul>
          <p className="mb-3">
            <strong>Breach notification:</strong> In the event of a data
            breach that compromises your personal information, OxSteed will
            notify affected users by email within 72 hours of discovering
            the breach and will notify applicable state attorneys general
            as required by law.
          </p>
        </section>

        <section className="mb-8">
          <h2 className="text-lg font-bold text-orange-400 mb-3">
            10. Account Deletion
          </h2>
          <p className="mb-3">
            You may request deletion of your account at any time through
            your account settings or by emailing{' '}
            <a href="mailto:legal@oxsteed.com" className="text-orange-500 underline">legal@oxsteed.com</a>.
          </p>
          <p className="mb-3">
            Upon deletion:
          </p>
          <ul className="list-disc ml-5 space-y-2 mb-3">
            <li>Your profile, messages, and personal data will be permanently removed within 30 days;</li>
            <li>Reviews you have left for others will be anonymized but not deleted;</li>
            <li>Tax records (W-9, 1099-NEC) will be retained for the legally required period;</li>
            <li>Escrow transaction records will be retained for audit purposes;</li>
            <li>Active Tier 3 escrow transactions must be completed or resolved before deletion can proceed.</li>
          </ul>
        </section>

        <section className="mb-8">
          <h2 className="text-lg font-bold text-orange-400 mb-3">
            11. Children's Privacy
          </h2>
          <p className="mb-3">
            OxSteed is not intended for use by anyone under the age of 18.
            We do not knowingly collect personal information from children
            under 18. If we discover that we have collected personal
            information from a child under 18, we will delete it
            immediately. If you believe a child under 18 has provided us
            personal information, contact us at{' '}
            <a href="mailto:legal@oxsteed.com" className="text-orange-500 underline">legal@oxsteed.com</a>.
          </p>
        </section>

        <section className="mb-8">
          <h2 className="text-lg font-bold text-orange-400 mb-3">
            12. Changes to This Privacy Policy
          </h2>
          <p className="mb-3">
            OxSteed may update this Privacy Policy at any time. We will
            notify users of material changes by email at least 14 days
            before the changes take effect. The "Last updated" date at the
            top of this page reflects the most recent revision.
          </p>
        </section>

        <section className="mb-8">
          <h2 className="text-lg font-bold text-orange-400 mb-3">
            13. Contact Us
          </h2>
          <p className="mb-3">
            For questions about this Privacy Policy or to exercise your
            privacy rights, contact us at:
          </p>
          <p className="mb-3">
            OxSteed LLC<br />
            Springfield, Ohio<br />
            <a href="mailto:legal@oxsteed.com" className="text-orange-500 underline">legal@oxsteed.com</a>
          </p>
        </section>

                </div>
      </div>

      {/* Footer */}
      <footer className="border-t border-gray-800 bg-gray-950">
        <div className="max-w-6xl mx-auto px-4 py-8">
          <div className="flex flex-col md:flex-row items-center justify-between gap-4">
            <div className="flex items-center gap-2">
              <Home className="w-4 h-4 text-orange-500" />
              <span className="text-sm font-semibold text-white">OxSteed</span>
            </div>
            <div className="flex flex-wrap items-center gap-4 text-xs text-gray-500">
              <Link to="/terms" className="hover:text-orange-400 transition-colors">Terms of Service</Link>
              <Link to="/privacy" className="hover:text-orange-400 transition-colors">Privacy Policy</Link>
              <Link to="/security" className="hover:text-orange-400 transition-colors">Security</Link>
              <Link to="/cookiepolicy" className="hover:text-orange-400 transition-colors">Cookie Policy</Link>
              <Link to="/donotsell" className="hover:text-orange-400 transition-colors">Do Not Sell My Info</Link>
            </div>
          </div>
          <div className="mt-4 pt-4 border-t border-gray-800 flex flex-col md:flex-row items-center justify-between gap-2 text-xs text-gray-600">
            <p>&copy; {new Date().getFullYear()} OxSteed LLC</p>
            <p>For questions, contact <a href="mailto:legal@oxsteed.com" className="text-orange-500 hover:text-orange-400 underline">legal@oxsteed.com</a></p>
          </div>
        </div>
      </footer>
    </div>
  );
}
