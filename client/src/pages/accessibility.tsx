import LegalPageLayout from '../components/LegalPageLayout';

export default function AccessibilityPage() {
  return (
    <LegalPageLayout title="Accessibility Statement" effectiveDate="2026-03-23">
      <section className="mb-8">
        <h2 className="text-lg font-bold text-orange-400 mb-3">
          Our Commitment
        </h2>
        <p className="mb-3">
          OxSteed is committed to ensuring digital accessibility for people with
          disabilities. We continually work to improve the user experience for
          everyone and apply the relevant accessibility standards.
        </p>
      </section>

      <section className="mb-8">
        <h2 className="text-lg font-bold text-orange-400 mb-3">
          Conformance Status
        </h2>
        <p className="mb-3">
          We aim to conform to the Web Content Accessibility Guidelines (WCAG)
          2.1 at Level AA. These guidelines explain how to make web content more
          accessible to people with a wide array of disabilities.
        </p>
      </section>

      <section className="mb-8">
        <h2 className="text-lg font-bold text-orange-400 mb-3">
          Measures Taken
        </h2>
        <ul className="list-disc ml-5 space-y-2 mb-3">
          <li>Semantic HTML markup throughout the application;</li>
          <li>Sufficient color contrast ratios for text and interactive elements;</li>
          <li>Keyboard navigable interface;</li>
          <li>ARIA labels and roles where appropriate;</li>
          <li>Responsive design that works across screen sizes and zoom levels.</li>
        </ul>
      </section>

      <section className="mb-8">
        <h2 className="text-lg font-bold text-orange-400 mb-3">
          Feedback & Contact
        </h2>
        <p className="mb-3">
          If you experience any accessibility issues or barriers while using
          OxSteed, please contact us. We take accessibility feedback seriously
          and will work to address any concerns promptly.
        </p>
        <p className="mb-3">
          Email:{' '}
          <a
            href="mailto:support@oxsteed.com"
            className="text-orange-400 underline"
          >
            support@oxsteed.com
          </a>
        </p>
        <p className="mb-3">
          We aim to respond to accessibility feedback within 2 business days.
        </p>
      </section>
    </LegalPageLayout>
  );
}
