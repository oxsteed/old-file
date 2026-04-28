import LegalPageLayout from '../components/LegalPageLayout';

export default function AboutPage() {
  return (
    <LegalPageLayout title="About OxSteed" effectiveDate="2026-03-24">
      <section className="mb-8">
        <h2 className="text-lg font-bold text-orange-400 mb-3">Who We Are</h2>
        <p className="mb-3">
          OxSteed LLC is an online marketplace that connects customers with local
          service providers for handyman work, home services, and tool rentals.
          We are incorporated in the State of Ohio.
        </p>
        <p className="mb-3">
          Our platform serves as an introduction board where helpers list their
          skills and customers post jobs. OxSteed does not employ, dispatch, or
          supervise any helper. All service agreements are between the customer
          and the helper directly.
        </p>
      </section>

      <section className="mb-8">
        <h2 className="text-lg font-bold text-orange-400 mb-3">Our Mission</h2>
        <p className="mb-3">
          We believe everyone should have easy, affordable access to trustworthy
          local help. OxSteed's mission is to empower independent service
          providers to run their own businesses while giving customers a
          transparent, secure way to find and pay for the help they need.
        </p>
      </section>

      <section className="mb-8">
        <h2 className="text-lg font-bold text-orange-400 mb-3">How It Works</h2>
        <ul className="list-disc ml-5 space-y-2 mb-3">
          <li><strong>Tier 1 — Free Directory:</strong> Helpers list services for free. Customers browse and coordinate directly.</li>
          <li><strong>Tier 2 — Pro Subscription:</strong> Helpers subscribe for priority placement, a verified badge, and bid alerts.</li>
          <li><strong>Tier 3 — Payment Protection:</strong> When both parties opt in, OxSteed holds funds in escrow via Stripe until the job is confirmed complete.</li>
        </ul>
      </section>

      <section className="mb-8">
        <h2 className="text-lg font-bold text-orange-400 mb-3">Contact Us</h2>
        <p className="mb-3">
          Have questions, feedback, or partnership inquiries? We'd love to hear from you.
        </p>
        <ul className="list-disc ml-5 space-y-2">
          <li>Email: <a href="mailto:support@oxsteed.com" className="text-orange-400 underline hover:text-orange-300">support@oxsteed.com</a></li>
          <li>Website: <a href="https://oxsteed.com" className="text-orange-400 underline hover:text-orange-300">oxsteed.com</a></li>
        </ul>
      </section>

      <section className="mb-8">
        <h2 className="text-lg font-bold text-orange-400 mb-3">Legal</h2>
        <p>
          OxSteed LLC · Registered in Ohio · All rights reserved.<br />
          Use of this platform is subject to our{' '}
          <a href="/terms" className="text-orange-400 underline hover:text-orange-300">Terms of Service</a>{' '}
          and{' '}
          <a href="/privacy" className="text-orange-400 underline hover:text-orange-300">Privacy Policy</a>.
        </p>
      </section>
    </LegalPageLayout>
  );
}
