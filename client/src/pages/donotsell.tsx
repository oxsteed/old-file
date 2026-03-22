export default function DoNotSell() {
  return (
    <div className="min-h-screen bg-gray-950 text-gray-300">
      <div className="max-w-4xl mx-auto px-4 py-12 text-sm leading-relaxed">
        <h1 className="text-3xl font-bold text-white mb-2">
          Do Not Sell or Share My Personal Information
        </h1>
        <p className="text-gray-500 text-xs mb-10">
          Required under the California Consumer Privacy Act (CCPA) and
          the California Privacy Rights Act (CPRA)
        </p>

        <section className="mb-8">
          <h2 className="text-lg font-bold text-orange-400 mb-3">
            OxSteed Does Not Sell Your Data
          </h2>
          <p className="mb-3">
            OxSteed LLC does not sell, rent, trade, or otherwise disclose
            your personal information to third parties for monetary or
            other valuable consideration. We do not share your personal
            information with third parties for cross-context behavioral
            advertising.
          </p>
          <p className="mb-3">
            Because we do not sell or share personal information as
            defined by the CCPA/CPRA, there is no action required on
            your part. However, if California law changes or if our
            practices change, this page will be updated accordingly.
          </p>
        </section>

        <section className="mb-8">
          <h2 className="text-lg font-bold text-orange-400 mb-3">
            Your California Privacy Rights
          </h2>
          <p className="mb-3">
            As a California resident, you have the following rights under
            the CCPA/CPRA:
          </p>
          <ul className="list-disc ml-5 space-y-2 mb-3">
            <li><strong>Right to know:</strong> You may request that we disclose the categories and specific pieces of personal information we have collected about you.</li>
            <li><strong>Right to delete:</strong> You may request deletion of your personal information, subject to certain exceptions.</li>
            <li><strong>Right to correct:</strong> You may request correction of inaccurate personal information.</li>
            <li><strong>Right to opt out of sale/sharing:</strong> We do not sell or share your personal information, so no opt-out is necessary.</li>
            <li><strong>Right to limit use of sensitive personal information:</strong> We use sensitive personal information (e.g., SSN for W-9) only for the purposes for which it was collected.</li>
            <li><strong>Right to non-discrimination:</strong> We will not discriminate against you for exercising any of these rights.</li>
          </ul>
        </section>

        <section className="mb-8">
          <h2 className="text-lg font-bold text-orange-400 mb-3">
            How to Exercise Your Rights
          </h2>
          <p className="mb-3">
            To submit a verifiable consumer request, email us at:{' '}
            <a href="mailto:legal@oxsteed.com" className="text-orange-500 underline">legal@oxsteed.com</a>
            {' '}with the subject line "California Privacy Rights Request."
          </p>
          <p className="mb-3">
            We will verify your identity before processing any request.
            You may also designate an authorized agent to make a request
            on your behalf by providing written authorization.
          </p>
          <p className="mb-3">
            We will respond to verified requests within 45 days, with
            the possibility of a 45-day extension if necessary (with
            notice to you).
          </p>
        </section>

        <section className="mb-8">
          <h2 className="text-lg font-bold text-orange-400 mb-3">
            Categories of Personal Information
          </h2>
          <p className="mb-3">
            In the preceding 12 months, OxSteed has collected the
            following categories of personal information:
          </p>
          <ul className="list-disc ml-5 space-y-2 mb-3">
            <li>Identifiers (name, email, phone number, IP address)</li>
            <li>Personal information under Cal. Civ. Code 1798.80 (name, address, phone number)</li>
            <li>Commercial information (transaction history, subscription status)</li>
            <li>Internet/electronic activity (usage data, pages viewed)</li>
            <li>Geolocation data (approximate location from IP and zip code)</li>
            <li>Professional information (skills, service categories, licenses)</li>
            <li>Sensitive personal information (SSN/EIN for W-9, background check consent)</li>
          </ul>
          <p className="mb-3">
            <strong>None of these categories have been sold or shared
            with third parties for advertising purposes.</strong>
          </p>
        </section>

        <p className="text-gray-500 text-xs mt-8 border-t border-gray-700 pt-4 mb-8">
          OxSteed LLC — Springfield, Ohio —{' '}
          <a href="mailto:legal@oxsteed.com" className="text-orange-500 underline">
            legal@oxsteed.com
          </a>
        </p>
      </div>
    </div>
  );
}
