import { Link } from 'react-router-dom';

const CUSTOMER_STEPS = [
  {
    step: '1',
    title: 'Create a Free Account',
    desc: 'Sign up in under 2 minutes. No credit card required. Just your name, email, and a password.',
  },
  {
    step: '2',
    title: 'Post a Job',
    desc: 'Describe what you need — handyman work, cleaning, yard work, moving help, and more. Set your budget and timeline.',
  },
  {
    step: '3',
    title: 'Receive Bids',
    desc: 'Qualified local helpers see your job and send competitive bids. Compare profiles, ratings, and pricing side by side.',
  },
  {
    step: '4',
    title: 'Hire with Confidence',
    desc: 'Choose the best fit, communicate through our secure messaging, and get the job done. Leave a review when complete.',
  },
];

const HELPER_STEPS = [
  {
    step: '1',
    title: 'Apply to Become a Helper',
    desc: 'Complete our 5-step registration including identity verification, background check consent, and service area setup.',
  },
  {
    step: '2',
    title: 'Choose Your Services & Plan',
    desc: 'Select the categories you specialize in. Pick a free or premium plan to control how many jobs you can bid on.',
  },
  {
    step: '3',
    title: 'Browse & Bid on Jobs',
    desc: 'See real jobs posted by customers in your area. Submit competitive bids and showcase your experience.',
  },
  {
    step: '4',
    title: 'Get Hired & Get Paid',
    desc: 'Win jobs, complete the work, and build your reputation with reviews. Grow your local business on your schedule.',
  },
];

const FAQS = [
  {
    q: 'Is OxSteed free to use?',
    a: 'Yes! Posting jobs as a customer is completely free. Helpers can sign up for free and bid on a limited number of jobs per month, or upgrade to a paid plan for unlimited access.',
  },
  {
    q: 'How does OxSteed verify helpers?',
    a: 'Every helper completes identity verification and consents to a background check during registration. We also collect tax information (W-9) for compliance. Customer reviews further build each helper\'s reputation over time.',
  },
  {
    q: 'What types of jobs can I post?',
    a: 'Handyman, plumbing, electrical, cleaning, moving, painting, landscaping, yard work, tool rental, general labor, and more. If it\'s a local service task, you can post it on OxSteed.',
  },
  {
    q: 'How do I communicate with a helper or customer?',
    a: 'Once a bid is accepted, both parties can message each other securely through OxSteed\'s built-in messaging system — no need to share personal phone numbers.',
  },
  {
    q: 'What if something goes wrong?',
    a: 'OxSteed has a dispute resolution center. If there\'s an issue with a job, either party can open a dispute and our team will help mediate a fair resolution.',
  },
];

export default function HowItWorks() {
  return (
    <div className="min-h-screen bg-gray-950 text-white">
      {/* Navbar */}
      <nav className="border-b border-gray-800" role="navigation" aria-label="Main navigation">
        <div className="max-w-6xl mx-auto px-4 py-3 flex items-center justify-between">
          <Link to="/" className="text-2xl font-bold text-orange-500">OxSteed</Link>
          <div className="flex items-center gap-4">
            <Link to="/register/customer" className="text-sm text-gray-400 hover:text-white transition">Post a Job</Link>
            <Link to="/register/helper" className="text-sm text-gray-400 hover:text-white transition">Become a Helper</Link>
            <Link to="/login" className="text-sm bg-orange-500 hover:bg-orange-600 text-white px-4 py-1.5 rounded-full transition">Sign In</Link>
          </div>
        </div>
      </nav>

      {/* Hero */}
      <section className="text-center py-16 px-4 border-b border-gray-800">
        <h1 className="text-4xl md:text-5xl font-bold text-white mb-4">
          How OxSteed Works
        </h1>
        <p className="text-gray-400 text-lg max-w-2xl mx-auto mb-8">
          OxSteed connects customers with trusted local helpers. Whether you need work done or want to earn money in your community — we make it simple, safe, and fast.
        </p>
        <div className="flex flex-wrap justify-center gap-4">
          <Link
            to="/register/customer"
            className="bg-orange-500 hover:bg-orange-600 text-white font-semibold px-6 py-3 rounded-full transition"
          >
            Post a Job — It's Free
          </Link>
          <Link
            to="/register/helper"
            className="border border-gray-600 hover:border-orange-400 text-gray-300 hover:text-white font-semibold px-6 py-3 rounded-full transition"
          >
            Become a Helper
          </Link>
        </div>
      </section>

      {/* For Customers */}
      <section className="max-w-5xl mx-auto px-4 py-16">
        <div className="text-center mb-10">
          <span className="text-xs font-bold uppercase tracking-widest text-orange-500 mb-2 block">For Customers</span>
          <h2 className="text-3xl font-bold text-white">Get Help in 4 Easy Steps</h2>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {CUSTOMER_STEPS.map((item) => (
            <div key={item.step} className="bg-gray-900 border border-gray-800 rounded-xl p-6 flex gap-4">
              <div className="w-10 h-10 rounded-full bg-orange-500 text-white font-bold text-lg flex items-center justify-center flex-shrink-0">
                {item.step}
              </div>
              <div>
                <h3 className="text-white font-semibold text-lg mb-1">{item.title}</h3>
                <p className="text-gray-400 text-sm leading-relaxed">{item.desc}</p>
              </div>
            </div>
          ))}
        </div>
        <div className="text-center mt-8">
          <Link
            to="/register/customer"
            className="inline-block bg-orange-500 hover:bg-orange-600 text-white font-semibold px-8 py-3 rounded-full transition"
          >
            Create Your Free Account
          </Link>
        </div>
      </section>

      {/* Divider */}
      <div className="border-t border-gray-800" />

      {/* For Helpers */}
      <section className="max-w-5xl mx-auto px-4 py-16">
        <div className="text-center mb-10">
          <span className="text-xs font-bold uppercase tracking-widest text-orange-500 mb-2 block">For Helpers</span>
          <h2 className="text-3xl font-bold text-white">Start Earning in Your Neighborhood</h2>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {HELPER_STEPS.map((item) => (
            <div key={item.step} className="bg-gray-900 border border-gray-800 rounded-xl p-6 flex gap-4">
              <div className="w-10 h-10 rounded-full bg-orange-500 text-white font-bold text-lg flex items-center justify-center flex-shrink-0">
                {item.step}
              </div>
              <div>
                <h3 className="text-white font-semibold text-lg mb-1">{item.title}</h3>
                <p className="text-gray-400 text-sm leading-relaxed">{item.desc}</p>
              </div>
            </div>
          ))}
        </div>
        <div className="text-center mt-8">
          <Link
            to="/register/helper"
            className="inline-block border border-orange-500 hover:bg-orange-500 text-orange-400 hover:text-white font-semibold px-8 py-3 rounded-full transition"
          >
            Apply to Become a Helper
          </Link>
        </div>
      </section>

      {/* Trust Bar */}
      <section className="bg-gray-900 border-y border-gray-800 py-12 px-4">
        <div className="max-w-4xl mx-auto grid grid-cols-1 md:grid-cols-3 gap-8 text-center">
          <div>
            <p className="text-3xl font-bold text-orange-500 mb-1">500+</p>
            <p className="text-gray-400 text-sm">Customers have posted jobs</p>
          </div>
          <div>
            <p className="text-3xl font-bold text-orange-500 mb-1">Verified</p>
            <p className="text-gray-400 text-sm">Helpers with identity checks</p>
          </div>
          <div>
            <p className="text-3xl font-bold text-orange-500 mb-1">Local</p>
            <p className="text-gray-400 text-sm">Helpers in your neighborhood</p>
          </div>
        </div>
      </section>

      {/* FAQ */}
      <section className="max-w-3xl mx-auto px-4 py-16">
        <div className="text-center mb-10">
          <h2 className="text-3xl font-bold text-white">Frequently Asked Questions</h2>
        </div>
        <div className="space-y-4">
          {FAQS.map((faq, i) => (
            <div key={i} className="bg-gray-900 border border-gray-800 rounded-xl p-6">
              <h3 className="text-white font-semibold mb-2">{faq.q}</h3>
              <p className="text-gray-400 text-sm leading-relaxed">{faq.a}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Bottom CTA */}
      <section className="text-center py-16 px-4 bg-gray-900 border-t border-gray-800">
        <h2 className="text-3xl font-bold text-white mb-3">Ready to Get Started?</h2>
        <p className="text-gray-400 mb-8 max-w-md mx-auto">Join your local OxSteed community today. It only takes a couple of minutes.</p>
        <div className="flex flex-wrap justify-center gap-4">
          <Link
            to="/register/customer"
            className="bg-orange-500 hover:bg-orange-600 text-white font-semibold px-8 py-3 rounded-full transition"
          >
            Post a Job Free
          </Link>
          <Link
            to="/register/helper"
            className="border border-gray-600 hover:border-orange-400 text-gray-300 hover:text-white font-semibold px-8 py-3 rounded-full transition"
          >
            Become a Helper
          </Link>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-gray-800 mt-0">
        <div className="max-w-6xl mx-auto px-4 py-8 grid grid-cols-1 md:grid-cols-3 gap-8 text-sm text-gray-400">
          <div>
            <h3 className="text-white font-semibold mb-3">OxSteed</h3>
            <p>Your local home-services marketplace. Connecting neighbors with trusted helpers.</p>
          </div>
          <div>
            <h3 className="text-white font-semibold mb-3">Legal</h3>
            <ul className="space-y-1">
              <li><Link to="/terms" className="hover:text-white transition">Terms of Service</Link></li>
              <li><Link to="/privacy" className="hover:text-white transition">Privacy Policy</Link></li>
              <li><Link to="/security" className="hover:text-white transition">Security Policy</Link></li>
              <li><Link to="/accessibility" className="hover:text-white transition">Accessibility</Link></li>
              <li><Link to="/cookie-policy" className="hover:text-white transition">Cookie Policy</Link></li>
              <li><Link to="/do-not-sell" className="hover:text-white transition">Do Not Sell My Info</Link></li>
            </ul>
          </div>
          <div>
            <h3 className="text-white font-semibold mb-3">Company</h3>
            <ul className="space-y-1">
              <li><Link to="/about" className="hover:text-white transition">About</Link></li>
              <li><Link to="/how-it-works" className="hover:text-white transition">How It Works</Link></li>
              <li><a href="mailto:support@oxsteed.com" className="hover:text-white transition">Contact</a></li>
            </ul>
          </div>
        </div>
        <div className="max-w-6xl mx-auto px-4 pb-6 text-center text-xs text-gray-600">
          {`\u00A9 ${new Date().getFullYear()} OxSteed. All rights reserved.`}
        </div>
      </footer>
    </div>
  );
}
