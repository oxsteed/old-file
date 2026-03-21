export default function TermsOfService() {
  return (
    <div className="max-w-4xl mx-auto px-4 py-12 text-gray-700 text-sm
                    leading-relaxed">
      <h1 className="text-3xl font-bold text-gray-900 mb-2">
        Terms of Service
      </h1>
      <p className="text-gray-400 text-xs mb-10">
        Last updated: March 20, 2026 · Effective immediately upon account creation
      </p>

      {/* — 1. WHAT OXSTEED IS ————————————————————— */}
      <section className="mb-8">
        <h2 className="text-lg font-bold text-gray-900 mb-3">
          1. What OxSteed Is — And Is Not
        </h2>
        <p className="mb-3">
          OxSteed LLC ("OxSteed," "we," "us," or "our") operates an online
          introduction platform that connects individuals seeking local
          assistance ("Customers") with independent individuals who offer
          their skills and labor ("Helpers"). OxSteed is a neutral
          third-party platform — a broker and directory service — not an
          employer, staffing agency, or general contractor.
        </p>
        <p className="mb-3">
          OxSteed does not employ Helpers, does not control how Helpers
          perform their work, does not set the prices Helpers charge, and
          does not dispatch Helpers to any job. All agreements for services
          are made directly between Customers and Helpers. OxSteed's role
          is limited to facilitating introductions and, at the parties'
          election, providing optional payment infrastructure.
        </p>
        <p className="mb-3">
          OxSteed is not a party to any agreement or transaction
          between a Customer and a Helper. By using OxSteed, you
          acknowledge and agree that OxSteed has no control over,
          and bears no responsibility for, the quality, safety, legality,
          or outcome of any service performed.
        </p>
        <p className="text-xs bg-yellow-50 border border-yellow-200
                      rounded-lg p-3 text-yellow-800">
          <strong>Important:</strong> OxSteed operates under the
          Communications Decency Act, 47 U.S.C. § 230. OxSteed is not
          the publisher or speaker of any content created by its users
          and is immune from liability for such content to the extent
          provided by federal law.
        </p>
      </section>

      {/* — 2. PLATFORM TIERS ————————————————————— */}
      <section className="mb-8">
        <h2 className="text-lg font-bold text-gray-900 mb-3">
          2. Platform Tiers and Services
        </h2>
        <p className="mb-3">
          OxSteed operates three distinct service tiers. Each tier has
          different features, fees, and legal implications. By selecting a
          tier, you agree to the terms specific to that tier.
        </p>

        <div className="space-y-4">
          <div className="border border-gray-200 rounded-xl p-4">
            <h3 className="font-bold text-gray-800 mb-1">
              Tier 1 — Free Directory Listing
            </h3>
            <p>
              Helpers may create a free profile. Customers may browse
              profiles and post job listings. OxSteed facilitates
              introductions only. <strong>No money passes through
              OxSteed.</strong> Customers and Helpers transact entirely
              outside the platform. OxSteed holds zero liability for
              any transaction, outcome, injury, or dispute arising from
              Tier 1 connections.
            </p>
          </div>

          <div className="border border-gray-200 rounded-xl p-4">
            <h3 className="font-bold text-gray-800 mb-1">
              Tier 2 — Verified Subscription (Pro, $29/month)
            </h3>
            <p className="mb-2">
              Helpers who subscribe to Tier 2 receive a verified badge,
              priority placement in search results, and access to
              optional background check verification. Tier 2 Helpers
              may optionally use OxSteed's Tier 3 payment processing
              for individual jobs.
            </p>
            <p>
              Subscription fees are billed monthly through Stripe and
              are non-refundable. You may cancel at any time; access
              continues through the end of the billing period.
            </p>
          </div>

          <div className="border border-gray-200 rounded-xl p-4">
            <h3 className="font-bold text-gray-800 mb-1">
              Tier 3 — Protected Transaction (Broker, $79/month)
            </h3>
            <p className="mb-2">
              Tier 3 provides full escrow-based payment protection.
              Customers pay through OxSteed. Funds are held in escrow
              until the Customer confirms job completion. OxSteed
              deducts its platform fees before releasing the remaining
              balance to the Helper's Stripe Express account.
            </p>
            <p>
              Tier 3 Helpers must maintain a Stripe Express connected
              account in good standing. OxSteed reserves the right to
              withhold funds if Stripe flags an account for review.
            </p>
          </div>
        </div>
      </section>

      {/* — 3. USER ACCOUNTS ————————————————————— */}
      <section className="mb-8">
        <h2 className="text-lg font-bold text-gray-900 mb-3">
          3. User Accounts and Eligibility
        </h2>
        <p className="mb-3">
          You must be at least 18 years old and legally able to enter
          binding contracts in your jurisdiction. By creating an account,
          you represent that all information provided is accurate and
          complete.
        </p>
        <p className="mb-3">
          You are responsible for maintaining the confidentiality of your
          login credentials and for all activity that occurs under your
          account. Notify OxSteed immediately if you suspect unauthorized
          access.
        </p>
        <p className="mb-3">
          OxSteed reserves the right to suspend or terminate any account
          at its sole discretion, including but not limited to accounts
          that violate these Terms, engage in fraudulent activity, or
          receive repeated negative reviews.
        </p>
      </section>

      {/* — 4. FEES AND PAYMENTS ——————————————————— */}
      <section className="mb-8">
        <h2 className="text-lg font-bold text-gray-900 mb-3">
          4. Fees, Payments, and Taxes
        </h2>
        <p className="mb-3">
          <strong>Subscription Fees.</strong> Tier 2 ($29/month) and
          Tier 3 ($79/month) subscriptions are billed monthly via Stripe.
          All subscription fees are non-refundable. Cancellation takes
          effect at the end of the current billing period.
        </p>
        <p className="mb-3">
          <strong>Transaction Fees (Tier 3 only).</strong> When both
          parties elect Tier 3 payment protection, OxSteed deducts its
          platform service fee (10% of job value, minimum $5.00) plus a
          2% payment protection fee before releasing the remaining
          balance to the Helper's Stripe Express account. All fees are
          disclosed to both parties prior to transaction confirmation.
          No fees are charged for Tier 1 connections.
        </p>
        <p className="mb-3">
          <strong>Tax Compliance.</strong> Helpers earning $600 or more
          through the platform in a calendar year are required to provide
          a completed IRS Form W-9. OxSteed will issue IRS Form 1099-NEC
          to qualifying Helpers and file copies with the IRS as required
          by law. Failure to provide W-9 information may result in
          suspension of payment releases.
        </p>
        <p className="mb-3">
          <strong>Refunds (Tier 3 escrow).</strong> Disputed funds held
          in escrow will be released according to OxSteed's dispute
          resolution process described in Section 9. Platform service
          fees are non-refundable once a job has been marked complete
          by both parties.
        </p>
      </section>

      {/* — 5. BACKGROUND CHECKS ——————————————————— */}
      <section className="mb-8">
        <h2 className="text-lg font-bold text-gray-900 mb-3">
          5. Background Checks and Verification
        </h2>
        <p className="mb-3">
          Tier 2 and Tier 3 Helpers may elect to complete a background
          check through OxSteed's third-party provider, Checkr, Inc.
          Helpers who pass background screening receive a "Background
          Checked" badge visible on their profile.
        </p>
        <p className="mb-3">
          <strong>OxSteed makes no representation or warranty</strong>
          that any background check result is complete, accurate, or
          current. Background checks are a voluntary value-add service
          and do not constitute OxSteed's endorsement of any Helper.
          Customers are solely responsible for conducting their own due
          diligence before engaging any Helper.
        </p>
      </section>

      {/* — 6. REVIEWS AND RATINGS —————————————————— */}
      <section className="mb-8">
        <h2 className="text-lg font-bold text-gray-900 mb-3">
          6. Reviews and Ratings
        </h2>
        <p className="mb-3">
          Users may leave reviews and ratings after completed jobs.
          Reviews must be honest, factual, and based on genuine
          experiences. OxSteed does not edit or censor reviews but
          reserves the right to remove reviews that contain hate speech,
          threats, personally identifiable information, or are clearly
          fraudulent.
        </p>
        <p className="mb-3">
          By submitting a review, you grant OxSteed a non-exclusive,
          royalty-free license to display, reproduce, and distribute
          your review on the platform.
        </p>
      </section>

      {/* — 7. INTELLECTUAL PROPERTY ————————————————— */}
      <section className="mb-8">
        <h2 className="text-lg font-bold text-gray-900 mb-3">
          7. Intellectual Property
        </h2>
        <p className="mb-3">
          All content, designs, logos, and software comprising the
          OxSteed platform are the intellectual property of OxSteed LLC.
          Users retain ownership of content they upload (photos,
          descriptions, reviews) but grant OxSteed a worldwide,
          non-exclusive license to use, display, and distribute such
          content in connection with operating the platform.
        </p>
        <p className="mb-3">
          You may not copy, modify, distribute, or reverse-engineer
          any part of the OxSteed platform without prior written
          consent from OxSteed LLC.
        </p>
      </section>

      {/* — 8. PROHIBITED CONDUCT —————————————————— */}
      <section className="mb-8">
        <h2 className="text-lg font-bold text-gray-900 mb-3">
          8. Prohibited Conduct
        </h2>
        <p className="mb-3">You agree not to:</p>
        <ul className="list-disc pl-6 space-y-2 mb-3">
          <li>Use the platform for any unlawful purpose</li>
          <li>Impersonate another person or entity</li>
          <li>Submit false or misleading information</li>
          <li>Harass, threaten, or abuse other users</li>
          <li>Circumvent OxSteed's fee structure by taking Tier 3
              transactions off-platform</li>
          <li>Attempt to reverse-engineer, scrape, or interfere with
              the platform's functionality</li>
          <li>Create multiple accounts to manipulate reviews or
              search rankings</li>
          <li>Post content that is defamatory, obscene, or infringes
              on intellectual property rights</li>
        </ul>
        <p className="mb-3">
          Violation of these rules may result in immediate account
          suspension or termination, forfeiture of escrowed funds,
          and reporting to law enforcement where applicable.
        </p>
      </section>

      {/* — 9. DISPUTE RESOLUTION —————————————————— */}
      <section className="mb-8">
        <h2 className="text-lg font-bold text-gray-900 mb-3">
          9. Dispute Resolution
        </h2>
        <p className="mb-3">
          <strong>Tier 1 disputes.</strong> OxSteed has no involvement
          in Tier 1 transactions and provides no dispute resolution
          services for Tier 1 connections. All Tier 1 disputes are
          between the Customer and Helper.
        </p>
        <p className="mb-3">
          <strong>Tier 3 disputes.</strong> If a Customer is dissatisfied
          with a completed job, they may file a dispute within 48 hours
          of job completion. OxSteed will review the dispute and may
          request additional evidence from both parties. OxSteed's
          decision on escrow fund release is final.
        </p>
        <p className="mb-3">
          <strong>Binding Arbitration.</strong> Any dispute arising from
          these Terms or your use of OxSteed that cannot be resolved
          through OxSteed's internal process shall be resolved through
          binding arbitration administered by the American Arbitration
          Association in Clark County, Ohio. You waive your right to
          participate in class action lawsuits.
        </p>
        <p className="mb-3">
          <strong>Governing Law.</strong> These Terms are governed by the
          laws of the State of Ohio, without regard to conflict of law
          principles.
        </p>
      </section>

      {/* — 10. LIMITATION OF LIABILITY ——————————————— */}
      <section className="mb-8">
        <h2 className="text-lg font-bold text-gray-900 mb-3">
          10. Limitation of Liability
        </h2>
        <p className="mb-3">
          TO THE MAXIMUM EXTENT PERMITTED BY LAW, OXSTEED LLC, ITS
          OFFICERS, DIRECTORS, EMPLOYEES, AND AGENTS SHALL NOT BE
          LIABLE FOR ANY INDIRECT, INCIDENTAL, SPECIAL, CONSEQUENTIAL,
          OR PUNITIVE DAMAGES ARISING FROM YOUR USE OF THE PLATFORM.
        </p>
        <p className="mb-3">
          OxSteed's total liability for any claim arising from these
          Terms or the platform shall not exceed the greater of (a) the
          fees you paid to OxSteed in the 12 months preceding the claim,
          or (b) $100.
        </p>
        <p className="mb-3">
          OxSteed is not liable for any injury, property damage, death,
          or loss arising from services performed by Helpers. OxSteed
          is not liable for the actions, omissions, or conduct of any
          user, whether online or offline.
        </p>
      </section>

      {/* — 11. ACCEPTANCE —————————————————————— */}
      <section className="mb-8">
        <h2 className="text-lg font-bold text-gray-900 mb-3">
          11. Acceptance of Terms
        </h2>
        <p className="mb-3">
          By creating an account, clicking "I Agree," or using OxSteed
          in any capacity, you acknowledge that you have read, understood,
          and agree to be bound by these Terms of Service and our Privacy
          Policy.
        </p>
        <p className="mb-3">
          If you do not agree to these Terms, do not create an account
          or use the OxSteed platform.
        </p>
        <p>
          OxSteed records the timestamp, IP address, and account
          identifier associated with your acceptance. These records are
          maintained for legal compliance purposes.
        </p>
      </section>

      {/* — 12. MODIFICATIONS ————————————————————— */}
      <section className="mb-8">
        <h2 className="text-lg font-bold text-gray-900 mb-3">
          12. Modifications to These Terms
        </h2>
        <p className="mb-3">
          OxSteed may update these Terms at any time. We will notify
          users of material changes by email and by displaying a notice
          in the platform at least 14 days before the changes take
          effect. Your continued use of the platform after the effective
          date constitutes acceptance of the updated Terms.
        </p>
        <p>
          For questions about these Terms, contact us at:{' '}
          <a href="mailto:legal@oxsteed.com"
             className="text-orange-500 underline">
            legal@oxsteed.com
          </a>
        </p>
      </section>

      {/* Footer timestamp */}
      <p className="text-xs text-gray-300 mt-12 border-t pt-4">
        OxSteed LLC · Springfield, Ohio ·{' '}
        <a href="mailto:legal@oxsteed.com"
           className="hover:text-gray-400">
          legal@oxsteed.com
        </a>
      </p>
    </div>
  );
}
