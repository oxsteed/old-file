import LegalPageLayout from '../components/LegalPageLayout';

export default function DoNotSell() {
  return (
    <LegalPageLayout title="Do Not Sell or Share My Personal Information" effectiveDate="2026-03-22">
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
          Your Rights Under CCPA/CPRA
        </h2>
        <p className="mb-3">
          California residents have the right to:
        </p>
        <ul className="list-disc ml-5 space-y-2 mb-3">
          <li>Know what personal information is collected and how it is used;</li>
          <li>Request deletion of personal information;</li>
          <li>Opt out of the sale or sharing of personal information (not applicable since we do not sell or share);</li>
          <li>Non-discrimination for exercising your privacy rights.</li>
        </ul>
      </section>

      <section className="mb-8">
        <h2 className="text-lg font-bold text-orange-400 mb-3">
          Other State Privacy Laws
        </h2>
        <p className="mb-3">
          OxSteed also respects privacy rights under the Virginia Consumer
          Data Protection Act (VCDPA), Colorado Privacy Act (CPA), Connecticut
          Data Privacy Act (CTDPA), and other applicable state privacy laws.
          If you are a resident of any of these states, you may exercise
          your rights by contacting us at the address below.
        </p>
      </section>

      <section className="mb-8">
        <h2 className="text-lg font-bold text-orange-400 mb-3">
          How to Contact Us
        </h2>
        <p className="mb-3">
          If you have questions about this page or wish to exercise any
          privacy rights, please contact us at:
        </p>
        <p className="mb-3">
          <strong>Email:</strong> privacy@oxsteed.com<br />
          <strong>Mail:</strong> OxSteed LLC, Springfield, OH 45503
        </p>
      </section>
    </LegalPageLayout>
  );
}
