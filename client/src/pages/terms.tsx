export default function TermsOfService() {
  return (
    <div className="min-h-screen bg-gray-950 text-gray-300">
      <div className="max-w-4xl mx-auto px-4 py-12 text-sm leading-relaxed">
        <h1 className="text-3xl font-bold text-white mb-2">
          Terms of Service
        </h1>
        <p className="text-gray-500 text-xs mb-10">
          Last updated: March 22, 2026 - Effective immediately upon account creation
        </p>

        <section className="mb-8">
          <h2 className="text-lg font-bold text-orange-400 mb-3">
            1. What OxSteed Is - And Is Not
          </h2>
          <p className="mb-3">
            OxSteed LLC ("OxSteed," "we," "us," or "our") operates an online
            introduction platform that connects individuals seeking local
            assistance ("Customers") with independent individuals who offer
            their skills and labor ("Helpers"). OxSteed is a neutral
            third-party platform - a broker and directory service - not an
            employer, staffing agency, or general contractor.
          </p>
          <p className="mb-3">
            OxSteed does not employ Helpers, does not control how Helpers
            perform their work, does not set the prices Helpers charge, and
            does not dispatch Helpers to any job. All agreements for services
            are made directly between Customers and Helpers.
          </p>
          <p className="mb-3">
            OxSteed is a platform, not a party to any service agreement
            between a Customer and a Helper. By using OxSteed, you
            acknowledge and agree that OxSteed has no control over,
            and bears no responsibility for, the quality, safety, legality,
            or outcome of any service performed.
          </p>
          <p className="text-xs bg-yellow-900/30 border border-yellow-700/50 rounded-lg p-3 text-yellow-400">
            <strong>Important:</strong> OxSteed operates under the
            Communications Decency Act, 47 U.S.C. § 230. OxSteed is not
            the publisher or speaker of any content created by its users
            and is immune from liability for such content to the extent
            provided by federal law.
          </p>
        </section>

        <section className="mb-8">
          <h2 className="text-lg font-bold text-orange-400 mb-3">
            2. Eligibility
          </h2>
          <p className="mb-3">
            You must be at least 18 years old and a legal resident of the
            United States to create an account or use OxSteed. By creating
            an account, you represent and warrant that:
          </p>
          <ul className="list-disc ml-5 space-y-2 mb-3">
            <li>You are at least 18 years of age;</li>
            <li>You are a legal resident of the United States;</li>
            <li>You have the legal capacity to enter into a binding agreement;</li>
            <li>You are not prohibited by law from using the platform;</li>
            <li>All information you provide during registration is accurate, current, and complete;</li>
            <li>You will maintain the accuracy of your account information.</li>
          </ul>
          <p className="mb-3">
            OxSteed reserves the right to request proof of age or identity at
            any time. Accounts created by anyone under 18 will be immediately
            terminated.
          </p>
          <p className="text-xs bg-yellow-900/30 border border-yellow-700/50 rounded-lg p-3 text-yellow-400">
            <strong>Important:</strong> OxSteed is currently available only
            within the United States. Users outside the U.S. are not
            permitted to create accounts or use the platform.
          </p>
        </section>

        <section className="mb-8">
          <h2 className="text-lg font-bold text-orange-400 mb-3">
            3. Platform Tiers and Services
          </h2>
          <p className="mb-3">
            OxSteed operates three distinct service tiers. Each tier has
            different features, fees, and legal implications.
          </p>
          <div className="space-y-4">
            <div className="border border-gray-700 rounded-xl p-4">
              <h3 className="font-bold text-white mb-1">Tier 1 - Free Directory Listing</h3>
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
            <div className="border border-gray-700 rounded-xl p-4">
              <h3 className="font-bold text-white mb-1">Tier 2 - Verified Subscription (Pro, $29/month)</h3>
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
                protection.
              </p>
            </div>
            <div className="border border-gray-700 rounded-xl p-4">
              <h3 className="font-bold text-white mb-1">Tier 3 - Protected Payment (Broker, $79/month)</h3>
              <p className="mb-2">
                Tier 3 is an optional, voluntary payment protection service
                that both the Customer and the Helper must affirmatively
                elect. When elected, OxSteed facilitates payment through
                Stripe Connect, holds funds in escrow until job completion
                is confirmed, and provides a structured dispute resolution
                process.
              </p>
              <p className="mb-2"><strong>Platform fees for Tier 3 transactions:</strong></p>
              <ul className="list-disc ml-5 space-y-1 mb-2">
                <li>Platform service fee: 10% of the agreed job value, minimum $5.00</li>
                <li>Payment protection fee: 2% of the agreed job value (covers Stripe processing and escrow administration)</li>
                <li>Broker mediation fee (if applicable): 5% of job value, applied only when a Tier 3 Broker Helper mediates the transaction</li>
                <li>Total maximum platform take: up to 17% of agreed job value for brokered Tier 3 transactions</li>
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

        <section className="mb-8">
          <h2 className="text-lg font-bold text-orange-400 mb-3">
            4. User Roles and Definitions
          </h2>
          <ul className="space-y-3">
            <li><strong>Customer:</strong> Any individual or entity that creates an OxSteed account for the purpose of posting job listings or contacting Helpers to arrange services.</li>
            <li><strong>Helper (Tier 1 - Free):</strong> An independent individual who creates a free OxSteed profile to advertise their skills and availability. Helpers are not employees, agents, or contractors of OxSteed.</li>
            <li><strong>Helper (Tier 2 - Pro Subscriber):</strong> A Helper who maintains an active Pro subscription, has completed optional identity and background verification, and may submit bids on posted jobs.</li>
            <li><strong>Helper (Tier 3 - Broker):</strong> A Helper with an active Broker subscription who has connected a Stripe Express account, enabling protected payment transactions.</li>
            <li><strong>Independent Contractor Status:</strong> All Helpers, regardless of tier, are independent contractors. OxSteed does not set their work hours, require minimum availability, control their methods or tools, provide equipment, mandate specific rates, or guarantee any volume of work.</li>
          </ul>
        </section>

        <section className="mb-8">
          <h2 className="text-lg font-bold text-orange-400 mb-3">
            5. Fees and Payment Terms
          </h2>
          <p className="mb-3">
            <strong>Subscription Fees.</strong> Tier 2 (Pro) and Tier 3
            (Broker) subscriptions are billed monthly. Subscription fees
            are non-refundable except as required by applicable law.
            You may cancel at any time through your account dashboard.
          </p>
          <p className="mb-3">
            <strong>Transaction Fees (Tier 3 only).</strong> When both
            parties elect Tier 3 payment protection, OxSteed deducts its
            platform service fee (10% of job value, minimum $5.00) plus a
            2% payment protection fee before releasing the remaining
            balance to the Helper. No fees are charged for Tier 1 connections.
          </p>
          <p className="mb-3">
            <strong>Tax Compliance.</strong> Helpers earning $600 or more
            through the platform in a calendar year are required to provide
            a completed IRS Form W-9. OxSteed will issue IRS Form 1099-NEC
            to qualifying Helpers as required by law.
          </p>
          <p className="mb-3">
            <strong>Refunds (Tier 3 escrow).</strong> Disputed funds held
            in escrow will be released according to the dispute
            resolution process described in Section 12.
          </p>
        </section>

        <section className="mb-8">
          <h2 className="text-lg font-bold text-orange-400 mb-3">
            Background Checks, Verification, and FCRA Compliance </h2>
          <h2 className="mb-3">6.1 Optional Background Screening</h2>
          <p className="mb-3">
            Tier 2 and Tier 3 Helpers may elect to complete a background check through <strong>Checkr, Inc.</strong>, OxSteed's third-party consumer reporting agency. Background checks are entirely voluntary. Completion of a background check does not guarantee employment, job awards, or continued platform access.
          </p>
          <h2 className="mb-3">6.2 Fair Credit Reporting Act (FCRA) Disclosure</h2>
          <p className="mb-3">
            OxSteed complies with the Fair Credit Reporting Act, 15 U.S.C. § 1681 et seq. ("FCRA"). Before initiating a background check, OxSteed will provide you with:
          </p>
          <ul>
            <li>A <strong>standalone written FCRA disclosure</strong> informing you that a consumer report may be obtained for platform access purposes; and</li>
            <li>A request for your <strong>written authorization</strong> to obtain the report.</li>
          </ul>
          <p className="mb-3">
            You must affirmatively consent before any background check is initiated. Your consent is separate from acceptance of these Terms.
          </p>
          <h2>6.3 Adverse Action Procedure</h2>
          <p className="mb-3">
            If OxSteed takes an adverse action based in whole or in part on information in a consumer report — for example, denying or revoking your verified badge — OxSteed will:
          </p>
          <ol>
            <li>Provide you with a <strong>pre-adverse action notice</strong> and a copy of the consumer report and a summary of your FCRA rights before the action is finalized;</li>
            <li>Allow you a reasonable period (typically 5 business days) to dispute any inaccuracies directly with Checkr;</li>
            <li>Provide a final <strong>adverse action notice</strong> if the decision is upheld, including contact information for Checkr and information on your right to obtain a free copy of the report.</li>
          </ol>
          <h2>6.4 Accuracy Disclaimer</h2>
          <p className="mb-3">
            Background check results are provided solely by <strong>Checkr, Inc.</strong>, which is subject to its own Terms of Service and Privacy Policy. <strong>OxSteed makes no representation or warranty that any background check result is complete, accurate, or current.</strong> OxSteed is not responsible for errors or omissions in Checkr's reports. Customers are solely responsible for conducting their own independent due diligence before engaging any Helper, regardless of badge status.
          </p>
          <h2>6.5 Badge Expiration and Renewal</h2>
          <p className="mb-3">
            Background check badges expire 12 months after the date of the underlying report and must be renewed to maintain verified status. OxSteed will notify you at least 30 days before your badge expires.
          </p>
          <h2>6.6 Verified Badge Limitations</h2>
          <p className="mb-3">
            The verified badge indicates only that a background check was completed at a specific point in time through Checkr. It does not:
          </p>
          <ul>
            <li>Constitute OxSteed's endorsement of any Helper's skills, quality of work, or character;</li>
            <li>Guarantee that a Helper holds any required professional license or insurance;</li>
            <li>Reflect criminal activity, license changes, or other events occurring after the check date;</li>
            <li>Create any warranty or guarantee by OxSteed regarding the Helper's fitness for any particular job.</li>
          </ul>
          <p className="mb-3">
            <strong>Do not rely solely on the verified badge when hiring a Helper.</strong> Always independently verify licenses, insurance, and references for any regulated trade or high-value job.
          </p></section>

        <section className="mb-8">
          <h2 className="text-lg font-bold text-orange-400 mb-3">
            7. Independent Contractor Status
          </h2>
          <p className="mb-3">
            Nothing in these Terms creates an employment relationship,
            partnership, joint venture, agency, franchise, or
            employer-employee relationship between OxSteed and any Helper.
          </p>
          <p className="mb-3">Helpers expressly acknowledge that:</p>
          <ul className="list-disc ml-5 space-y-2 mb-3">
            <li>They are operating an independent business</li>
            <li>They are solely responsible for all federal, state, and local taxes on income earned through the platform</li>
            <li>They must carry any insurance required by law for their services</li>
            <li>They are solely responsible for obtaining any licenses or permits required by law</li>
            <li>OxSteed does not provide workers' compensation, unemployment insurance, health benefits, or any other employment benefits</li>
            <li>They may work for any other platform, client, or employer at any time without restriction</li>
          </ul>
        </section>

        <section className="mb-8">
          <h2 className="text-lg font-bold text-orange-400 mb-3">
            8. Intellectual Property and DMCA
          </h2>
          <p className="mb-3">
            <strong>OxSteed Content.</strong> All content, design, logos,
            trademarks, code, and materials on the OxSteed platform
            ("OxSteed Content") are owned by or licensed to OxSteed LLC
            and are protected by U.S. and international copyright,
            trademark, and other intellectual property laws. You may not
            copy, reproduce, distribute, modify, create derivative works
            of, publicly display, or otherwise exploit any OxSteed Content
            without prior written consent from OxSteed.
          </p>
          <p className="mb-3">
            <strong>User Content License.</strong> By posting content on
            OxSteed (including but not limited to profile information,
            photos, reviews, job descriptions, and messages), you grant
            OxSteed a non-exclusive, worldwide, royalty-free, transferable,
            sublicensable license to use, display, reproduce, and distribute
            your content solely in connection with operating and promoting
            the platform. You retain ownership of your content. This license
            terminates when you delete your content or your account, except
            for content that has been shared with other users or that OxSteed
            is required to retain for legal or compliance purposes.
          </p>
          <p className="mb-3">
            <strong>DMCA Notice and Takedown.</strong> OxSteed respects
            intellectual property rights and complies with the Digital
            Millennium Copyright Act ("DMCA"), 17 U.S.C. § 512. If you
            believe that content on OxSteed infringes your copyright, you
            may submit a DMCA takedown notice to our designated agent:
          </p>
          <div className="bg-gray-800/50 border border-gray-700 rounded-lg p-4 mb-3">
            <p className="mb-1"><strong className="text-white">DMCA Designated Agent:</strong></p>
            <p>OxSteed LLC</p>
            <p>Attn: DMCA Agent</p>
            <p>Springfield, Ohio</p>
            <p>Email: <a href="mailto:legal@oxsteed.com" className="text-orange-500 underline">legal@oxsteed.com</a></p>
          </div>
          <p className="mb-3">
            Your DMCA notice must include: (1) identification of the
            copyrighted work; (2) identification of the infringing material
            and its location on the platform; (3) your contact information;
            (4) a statement of good faith belief that the use is not
            authorized; (5) a statement under penalty of perjury that the
            information is accurate and you are the copyright owner or
            authorized agent; and (6) your physical or electronic signature.
          </p>
          <p className="mb-3">
            <strong>Counter-Notice.</strong> If you believe your content was
            removed in error, you may submit a counter-notice containing:
            (1) identification of the removed material; (2) a statement
            under penalty of perjury that the removal was a mistake;
            (3) your name, address, and phone number; (4) consent to
            jurisdiction of the federal court in your district; and
            (5) your physical or electronic signature.
          </p>
          <p className="text-xs bg-red-900/30 border border-red-700/50 rounded-lg p-3 text-red-400">
            <strong>Warning:</strong> Submitting a false DMCA notice or
            counter-notice may result in legal liability under 17 U.S.C. § 512(f),
            including damages and attorney's fees.
          </p>
        </section>

        <section className="mb-8">
          <h2 className="text-lg font-bold text-orange-400 mb-3">
            9. Termination and Suspension
          </h2>
          <p className="mb-3">
            <strong>By OxSteed.</strong> OxSteed may suspend or terminate
            your account at any time, with or without cause, and with or
            without notice. Grounds for termination include, but are not
            limited to: violation of these Terms, fraudulent or illegal
            activity, non-payment of fees, receiving multiple complaints
            from other users, or any conduct that OxSteed determines is
            harmful to the platform, other users, or third parties.
          </p>
          <p className="mb-3">
            <strong>By You.</strong> You may deactivate your account at
            any time through your account settings. Deactivation does not
            release you from any obligations incurred prior to deactivation,
            including pending Tier 3 escrow transactions or outstanding fees.
          </p>
          <p className="mb-3">
            <strong>Effect of Termination.</strong> Upon termination:
          </p>
          <ul className="list-disc ml-5 space-y-2 mb-3">
            <li>Your right to access and use OxSteed ceases immediately;</li>
            <li>Any pending Tier 3 escrow funds will be handled according to the dispute resolution process in Section 12;</li>
            <li>OxSteed may retain your data as required by law or for legitimate business purposes (e.g., tax records, dispute evidence);</li>
            <li>Provisions that by their nature should survive termination will survive, including Sections 7, 8, 10, 12, and 15.</li>
          </ul>
          <p className="mb-3">
            <strong>Appeal.</strong> If your account is suspended or
            terminated, you may appeal by contacting{' '}
            <a href="mailto:legal@oxsteed.com" className="text-orange-500 underline">
              legal@oxsteed.com
            </a>{' '}
            within 30 days. OxSteed will review your appeal and respond
            within 10 business days. OxSteed's decision on appeal is final.
          </p>
        </section>

        <section className="mb-8">
          <h2 className="text-lg font-bold text-orange-400 mb-3">
            10. Liability Limitations and Insurance
          </h2>
          <p className="mb-3">
            <strong>No Insurance Provided.</strong> OxSteed does not
            provide any insurance coverage for any Helper, Customer, or third party.
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
            SPECIAL, CONSEQUENTIAL, PUNITIVE, OR EXEMPLARY DAMAGES.
          </p>
          <p className="mb-3">
            <strong>Property Damage.</strong> OxSteed is not liable for
            any property damage caused by a Helper during the performance
            of services.
          </p>
          <p className="mb-3">
            <strong>Personal Injury.</strong> OxSteed is not liable for any
            personal injury, death, or bodily harm arising from services
            arranged through the platform.
          </p>
          <p className="text-xs bg-red-900/30 border border-red-700/50 rounded-lg p-3 text-red-400">
            <strong>Ohio-Specific Notice:</strong> Ohio Revised Code
            § 4113.15 et seq. governs wage payment disputes between
            independent contractors and engaging parties. OxSteed is
            not an "employer" as defined under Ohio law.
          </p>
        </section>

        <section className="mb-8">
          <h2 className="text-lg font-bold text-orange-400 mb-3">
            11. Prohibited Conduct
          </h2>
          <p className="mb-2">The following are strictly prohibited on OxSteed:</p>
          <ul className="list-disc ml-5 space-y-2">
            <li><strong>Off-platform solicitation after Tier 3 election:</strong> Once both parties have elected Tier 3 payment protection for a specific job, attempting to redirect payment outside the platform is a material breach.</li>
            <li><strong>False identity or credentials:</strong> Creating a profile with false identity information or fabricated credentials.</li>
            <li><strong>Unlicensed regulated work:</strong> Advertising or performing work that requires a state or local license without holding the required license.</li>
            <li><strong>Harassment or discrimination:</strong> Any conduct that harasses, discriminates against, or threatens another user.</li>
            <li><strong>Manipulation of reviews:</strong> Submitting false, incentivized, or coerced reviews.</li>
            <li><strong>Unauthorized data collection:</strong> Scraping, harvesting, or collecting user data from the platform by any automated means.</li>
          </ul>
        </section>

        <section className="mb-8">
          <h2 className="text-lg font-bold text-orange-400 mb-3">
            12. Dispute Resolution
          </h2>
          <p className="mb-3">
            <strong>Tier 1 and Tier 2 Disputes.</strong> OxSteed has no
            role in disputes arising from Tier 1 or Tier 2 connections
            where no platform payment was made.
          </p>
          <p className="mb-3">
            <strong>Tier 3 Escrow Disputes.</strong> Where funds are held
            in Tier 3 escrow, either party may file a dispute within
            72 hours of the job's scheduled completion date.
          </p>
          <ol className="list-decimal ml-5 space-y-1 mb-3">
            <li>Acknowledge the dispute within 24 hours</li>
            <li>Request documentation from both parties within 48 hours</li>
            <li>Issue a resolution decision within 5 business days</li>
            <li>Release or refund escrowed funds per the decision</li>
          </ol>
          <p className="mb-3">
            <strong>Binding Arbitration.</strong> Any dispute not resolved
            through the escrow dispute process shall be resolved by binding
            individual arbitration under the rules of the AAA in Clark
            County, Ohio. You waive your right to a jury trial
            and to participate in a class action.
          </p>
          <p className="mb-3">
            <strong>Governing Law.</strong> These Terms are governed by
            the laws of the State of Ohio.
          </p>
        </section>

        <section className="mb-8">
          <h2 className="text-lg font-bold text-orange-400 mb-3">
            13. Privacy and Address Masking
          </h2>
          <ul className="list-disc ml-5 space-y-2 mb-3">
            <li><strong>Address masking:</strong> When a Customer posts a job, their full address is never shown publicly.</li>
            <li><strong>Address reveal:</strong> A Helper receives the Customer's full address only after accepting the job and within 12 hours of start time.</li>
            <li><strong>Data minimization:</strong> OxSteed collects only the data necessary to operate the platform.</li>
            <li><strong>Data retention:</strong> Account data is retained for 3 years after account closure for tax compliance purposes.</li>
          </ul>
        </section>

        <section className="mb-8">
          <h2 className="text-lg font-bold text-orange-400 mb-3">
            14. Consent and Acceptance
          </h2>
          <p className="mb-3">
            By creating an OxSteed account, you confirm that you have read,
            understood, and agree to be bound by these Terms of Service.
            Your click of "Create Account" or "Continue" constitutes a
            legally binding electronic signature under the E-SIGN Act,
            15 U.S.C. § 7001 et seq.
          </p>
          <p className="mb-3">
            If you do not agree to these Terms, do not create an account
            or use the OxSteed platform.
          </p>
        </section>

        <section className="mb-8">
          <h2 className="text-lg font-bold text-orange-400 mb-3">
            15. Modifications to These Terms
          </h2>
          <p className="mb-3">
            OxSteed may update these Terms at any time. We will notify
            users of material changes by email at least 14 days before
            the changes take effect.
          </p>
          <p>
            For questions about these Terms, contact us at:{' '}
            <a href="mailto:legal@oxsteed.com" className="text-orange-500 underline">
              legal@oxsteed.com
            </a>
          </p>
        </section>

        <p className="text-xs text-gray-500 mt-12 border-t border-gray-700 pt-4">
          OxSteed LLC - Springfield, Ohio -{' '}
          <a href="mailto:legal@oxsteed.com" className="hover:text-gray-400">
            legal@oxsteed.com
          </a>
        </p>
      </div>
    </div>
  );
}
