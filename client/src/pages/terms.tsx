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

      {/* ── 1. WHAT OXSTEED IS ──────────────────────────────── */}
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
          OxSteed is a platform, not a party to any service agreement
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

      {/* ── 2. PLATFORM TIERS ───────────────────────────────── */}
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
              Helpers who subscribe to Tier 2 gain access to: priority
              placement in search results, a verified profile badge,
              optional background check certification, bid submission on
              posted jobs, and push notification alerts for matching jobs.
            </p>
            <p>
              Tier 2 subscriptions are billed monthly via Stripe.
              Subscriptions renew automatically until cancelled. No money
              from customer-to-helper transactions passes through OxSteed
              at this tier unless the parties elect Tier 3 payment
              protection. OxSteed's fee for Tier 2 is the monthly
              subscription fee only.
            </p>
          </div>

          <div className="border border-gray-200 rounded-xl p-4">
            <h3 className="font-bold text-gray-800 mb-1">
              Tier 3 — Protected Payment (Broker, $79/month)
            </h3>
            <p className="mb-2">
              Tier 3 is an optional, voluntary payment protection service
              that both the Customer and the Helper must affirmatively
              elect. When elected, OxSteed facilitates payment through
              Stripe Connect, holds funds in escrow until job completion
              is confirmed, and provides a structured dispute resolution
              process.
            </p>
            <p className="mb-2">
              <strong>Platform fees for Tier 3 transactions:</strong>
            </p>
            <ul className="list-disc ml-5 space-y-1 mb-2">
              >
                Platform service fee: 10% of the agreed job value,
                minimum $5.00
              </li>
              >
                Payment protection fee: 2% of the agreed job value
                (covers Stripe processing and escrow administration)
              </li>
              >
                Broker mediation fee (if applicable): 5% of job value,
                applied only when a Tier 3 Broker Helper mediates the
                transaction
              </li>
              >
                Total maximum platform take: up to 17% of agreed
                job value for brokered Tier 3 transactions
              </li>
            </ul>
            <p>
              Tier 3 does not make OxSteed a party to the service
              agreement. OxSteed acts solely as a payment intermediary
              and neutral escrow agent. Stripe, Inc. processes all
              payments as a licensed money transmitter.
            </p>
          </div>
        </div>
      </section>

      {/* ── 3. ROLE DEFINITIONS ─────────────────────────────── */}
      <section className="mb-8">
        <h2 className="text-lg font-bold text-gray-900 mb-3">
          3. User Roles and Definitions
        </h2>
        <ul className="space-y-3">
          >
            <strong>Customer:</strong> Any individual or entity that
            creates an OxSteed account for the purpose of posting job
            listings or contacting Helpers to arrange services.
          </li>
          >
            <strong>Helper (Tier 1 — Free):</strong> An independent
            individual who creates a free OxSteed profile to advertise
            their skills and availability. Helpers are not employees,
            agents, or contractors of OxSteed. Helpers set their own
            rates, hours, and service areas entirely at their own
            discretion.
          </li>
          >
            <strong>Helper (Tier 2 — Pro Subscriber):</strong> A Helper
            who maintains an active Pro subscription, has completed
            optional identity and background verification, and may
            submit bids on posted jobs. Tier 2 Helpers remain
            independent contractors with no employment relationship
            with OxSteed.
          </li>
          >
            <strong>Helper (Tier 3 — Broker):</strong> A Helper with an
            active Broker subscription who has connected a Stripe Express
            account, enabling protected payment transactions. Brokers may
            also mediate introductions between Customers and other
            Helpers. Broker Helpers are independent contractors with no
            employment relationship with OxSteed.
          </li>
          >
            <strong>Independent Contractor Status:</strong> All Helpers,
            regardless of tier, are independent contractors. OxSteed
            does not: set their work hours, require minimum availability,
            control their methods or tools, provide equipment, mandate
            specific rates, or guarantee any volume of work. Helpers are
            solely responsible for their own taxes, insurance, licensing,
            and compliance with applicable law.
          </li>
        </ul>
      </section>

      {/* ── 4. FEES AND PAYMENTS ────────────────────────────── */}
      <section className="mb-8">
        <h2 className="text-lg font-bold text-gray-900 mb-3">
          4. Fees and Payment Terms
        </h2>
        <p className="mb-3">
          <strong>Subscription Fees.</strong> Tier 2 (Pro) and Tier 3
          (Broker) subscriptions are billed monthly. Subscription fees
          are non-refundable except as required by applicable law.
          Subscriptions renew automatically. You may cancel at any time
          through your account dashboard; cancellation takes effect at
          the end of the current billing period.
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

      {/* ── 5. BACKGROUND CHECKS ────────────────────────────── */}
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
        <p className="mb-3">
          Background check results are governed by the Fair Credit
          Reporting Act (FCRA). Helpers who dispute a background check
          result must contact Checkr directly. OxSteed cannot modify,
          interpret, or override Checkr's results.
        </p>
        <p className="mb-3">
          Background check badges expire after 12 months and must be
          renewed. OxSteed will notify Helpers 30 days before expiry.
        </p>
      </section>

      {/* ── 6. INDEPENDENT CONTRACTOR / WORKER CLASSIFICATION ── */}
      <section className="mb-8">
        <h2 className="text-lg font-bold text-gray-900 mb-3">
          6. Independent Contractor Status
        </h2>
        <p className="mb-3">
          Nothing in these Terms creates an employment relationship,
          partnership, joint venture, agency, franchise, or
          employer-employee relationship between OxSteed and any Helper.
        </p>
        <p className="mb-3">
          Helpers expressly acknowledge that:
        </p>
        <ul className="list-disc ml-5 space-y-2 mb-3">
          >They are operating an independent business</li>
          >
            They are solely responsible for all federal, state, and local
            taxes on income earned through the platform
          </li>
          >
            They must carry any insurance required by law for their
            services, including general liability insurance
          </li>
          >
            They are solely responsible for obtaining any licenses or
            permits required by Ohio law or applicable local ordinances
            to perform their services
          </li>
          >
            OxSteed does not provide workers' compensation, unemployment
            insurance, health benefits, or any other employment benefits
          </li>
          >
            They may work for any other platform, client, or employer
            at any time without restriction
          </li>
        </ul>
        <p>
          Helpers who believe they are being misclassified should
          immediately cease using the platform and contact OxSteed at
          legal@oxsteed.com.
        </p>
      </section>

      {/* ── 7. LIABILITY AND INSURANCE ──────────────────────── */}
      <section className="mb-8">
        <h2 className="text-lg font-bold text-gray-900 mb-3">
          7. Liability Limitations and Insurance
        </h2>
        <p className="mb-3">
          <strong>No Insurance Provided.</strong> OxSteed does not
          provide, and is not responsible for, any insurance coverage for
          any Helper, Customer, or third party. This includes but is not
          limited to: general liability insurance, professional liability
          insurance, workers' compensation, automobile insurance, and
          property damage coverage.
        </p>
        <p className="mb-3">
          <strong>Limitation of Liability.</strong> TO THE MAXIMUM
          EXTENT PERMITTED BY APPLICABLE LAW, OXSTEED'S TOTAL LIABILITY
          FOR ANY CLAIM ARISING FROM OR RELATING TO THESE TERMS OR THE
          PLATFORM SHALL NOT EXCEED THE GREATER OF: (A) $100 USD, OR
          (B) THE TOTAL FEES PAID BY YOU TO OXSTEED IN THE 12 MONTHS
          PRECEDING THE CLAIM.
        </p>
        <p className="mb-3">
          OXSTEED SHALL NOT BE LIABLE FOR ANY INDIRECT, INCIDENTAL,
          SPECIAL, CONSEQUENTIAL, PUNITIVE, OR EXEMPLARY DAMAGES,
          INCLUDING LOSS OF PROFITS, DATA, GOODWILL, OR OTHER INTANGIBLE
          LOSSES, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGES.
        </p>
        <p className="mb-3">
          <strong>Property Damage.</strong> OxSteed is not liable for
          any property damage caused by a Helper during the performance
          of services. Customers agree that any property damage claims
          must be directed to the Helper personally or to the Helper's
          insurance carrier.
        </p>
        <p className="mb-3">
          <strong
                      >Personal Injury.</strong> OxSteed is not liable for any
          personal injury, death, or bodily harm arising from services
          arranged through the platform. Customers and Helpers
          assume all risk of injury associated with any services
          performed or received.
        </p>
        <p className="text-xs bg-red-50 border border-red-200
                       rounded-lg p-3 text-red-800">
          <strong>Ohio-Specific Notice:</strong> Ohio Revised Code
          § 4113.15 et seq. governs wage payment disputes between
          independent contractors and engaging parties. OxSteed is
          not an "employer" as defined under Ohio law and has no
          wage payment obligations to any Helper.
        </p>
      </section>

      {/* ── 8. PROHIBITED CONDUCT ───────────────────────────── */}
      <section className="mb-8">
        <h2 className="text-lg font-bold text-gray-900 mb-3">
          8. Prohibited Conduct
        </h2>
        <p className="mb-2">
          The following are strictly prohibited on OxSteed:
        </p>
        <ul className="list-disc ml-5 space-y-2">
          >
            <strong>Off-platform solicitation after Tier 3 election:</strong>{' '}
            Once both parties have elected Tier 3 payment protection for
            a specific job, attempting to redirect payment outside the
            platform for that job is a material breach of these Terms
            and may result in immediate account termination.
          </li>
          >
            <strong>False identity or credentials:</strong> Creating a
            profile with false identity information, fabricated
            credentials, or fake reviews.
          </li>
          >
            <strong>Unlicensed regulated work:</strong> Advertising or
            performing work that requires a state or local license
            (electrical, plumbing, HVAC, structural) without holding
            the required license.
          </li>
          >
            <strong>Harassment or discrimination:</strong> Any conduct
            that harasses, discriminates against, or threatens another
            user on the basis of any protected characteristic.
          </li>
          >
            <strong>Manipulation of reviews:</strong> Submitting false,
            incentivized, or coerced reviews.
          </li>
          >
            <strong>Circumventing background check requirements:</strong>{' '}
            Misrepresenting background check status or assisting
            another person in doing so.
          </li>
          >
            <strong>Unauthorized data collection:</strong> Scraping,
            harvesting, or collecting user data from the platform
            by any automated means.
          </li>
        </ul>
        <p className="mt-3">
          OxSteed reserves the right to suspend or permanently terminate
          any account found in violation of these prohibitions, without
          notice and without refund of any subscription fees.
        </p>
      </section>

      {/* ── 9. DISPUTE RESOLUTION ───────────────────────────── */}
      <section className="mb-8">
        <h2 className="text-lg font-bold text-gray-900 mb-3">
          9. Dispute Resolution
        </h2>
        <p className="mb-3">
          <strong>Tier 1 and Tier 2 Disputes.</strong> OxSteed has no
          role in, and no obligation to resolve, disputes arising from
          Tier 1 or Tier 2 connections where no platform payment was
          made. These disputes are entirely between the Customer and
          the Helper and must be resolved between the parties directly,
          through applicable small claims court, or through any other
          lawful means.
        </p>
        <p className="mb-3">
          <strong>Tier 3 Escrow Disputes.</strong> Where funds are held
          in Tier 3 escrow, either party may file a dispute within
          72 hours of the job's scheduled completion date. OxSteed will:
        </p>
        <ol className="list-decimal ml-5 space-y-1 mb-3">
          >Acknowledge the dispute within 24 hours</li>
          >Request documentation from both parties within 48 hours</li>
          >Issue a resolution decision within 5 business days</li>
          >Release or refund escrowed funds per the decision</li>
        </ol>
        <p className="mb-3">
          OxSteed's dispute resolution decisions are final with respect
          to the release of escrowed funds. OxSteed is not a court or
          arbitration body and its decisions do not preclude either
          party from pursuing legal remedies independently.
        </p>
        <p className="mb-3">
          <strong>Binding Arbitration.</strong> Any dispute, claim, or
          controversy arising from or relating to these Terms or the
          OxSteed platform that is not resolved through the escrow
          dispute process shall be resolved by binding individual
          arbitration under the rules of the American Arbitration
          Association (AAA), Commercial Arbitration Rules, in Clark
          County, Ohio. <strong>You waive your right to a jury trial
          and to participate in a class action.</strong>
        </p>
        <p className="mb-3">
          <strong>Small Claims Exception.</strong> Either party may
          bring an individual claim in small claims court in Clark
          County, Ohio, if the claim qualifies under that court's
          jurisdictional limits.
        </p>
        <p className="mb-3">
          <strong>Governing Law.</strong> These Terms are governed by
          the laws of the State of Ohio, without regard to its conflict
          of law principles.
        </p>
      </section>

      {/* ── 10. PRIVACY AND DATA ────────────────────────────── */}
      <section className="mb-8">
        <h2 className="text-lg font-bold text-gray-900 mb-3">
          10. Privacy and Address Masking
        </h2>
        <p className="mb-3">
          OxSteed takes the privacy of its users seriously. The
          following protections are built into the platform by default:
        </p>
        <ul className="list-disc ml-5 space-y-2 mb-3">
          >
            <strong>Address masking:</strong> When a Customer posts a
            job, their full address is never shown publicly. Helpers
            browsing jobs see only the Customer's last name and an
            approximate location within a 2-mile radius.
          </li>
          >
            <strong>Address reveal:</strong> A Helper receives the
            Customer's full name and address only after: (a) the Helper
            has accepted the job and confirmed their attendance, and
            (b) the scheduled job start time is within 12 hours.
          </li>
          >
            <strong>Data minimization:</strong> OxSteed collects only
            the data necessary to operate the platform. We do not sell
            user data to third parties for advertising purposes.
          </li>
          >
            <strong>Data retention:</strong> Account data is retained
            for 3 years after account closure for tax compliance
            purposes, then permanently deleted.
          </li>
        </ul>
        <p>
          For full details, see our{' '}
          <a href="/privacy"
             className="text-orange-500 underline">
            Privacy Policy
          </a>.
        </p>
      </section>

      {/* ── 11. CLICKWRAP CONSENT ───────────────────────────── */}
      <section className="mb-8">
        <h2 className="text-lg font-bold text-gray-900 mb-3">
          11. Consent and Acceptance
        </h2>
        <p className="mb-3">
          By creating an OxSteed account, you confirm that you have read,
          understood, and agree to be bound by these Terms of Service,
          our Privacy Policy, and any additional agreements applicable
          to your chosen tier. Your click of "Create Account" or
          "Continue" constitutes a legally binding electronic signature
          under the Electronic Signatures in Global and National Commerce
          Act (E-SIGN Act), 15 U.S.C. § 7001 et seq.
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

      {/* ── 12. MODIFICATIONS ───────────────────────────────── */}
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
