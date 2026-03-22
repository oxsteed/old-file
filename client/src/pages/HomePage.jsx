import { Link } from 'react-router-dom';
import { ArrowRight, Shield, MapPin, Wrench, Users, Star, ChevronRight, Lock } from 'lucide-react';

const CATEGORIES = [
  { name: 'Handyman', icon: Wrench, desc: 'Repairs, assembly, installations' },
  { name: 'Tool Rental', icon: Wrench, desc: 'Borrow tools from locals' },
  { name: 'Moving Help', icon: Users, desc: 'Loading, unloading, hauling' },
  { name: 'Yard Work', icon: Wrench, desc: 'Mowing, trimming, cleanup' },
  { name: 'Cleaning', icon: Star, desc: 'Home & office cleaning' },
  { name: 'General Labor', icon: Users, desc: 'Any task you need done' },
];

export default function HomePage() {
  return (
    <div className="min-h-screen bg-gray-950 text-white">
      {/* Navbar */}
      <nav className="border-b border-gray-800">
        <div className="max-w-6xl mx-auto px-6 py-4 flex items-center justify-between">
          <Link to="/" className="text-2xl font-bold text-orange-500">OxSteed</Link>
              <div className="flex items-center gap-3">
                <Link to="/login" className="text-sm text-gray-400 hover:text-white transition">Sign in</Link>
                <Link
                  to="/register/customer"
                  className="text-sm px-3 py-1.5 border border-orange-500 text-orange-500 hover:bg-orange-500 hover:text-white rounded-lg font-medium transition"
                >
                  Find Help
                </Link>
                <Link
                  to="/register/helper"
                  className="text-sm px-3 py-1.5 bg-orange-500 hover:bg-orange-600 text-white rounded-lg font-medium transition"
                >
                  List Your Skills
                </Link>
              </div>
      </nav>

      {/* Hero */}
      <section className="max-w-6xl mx-auto px-6 py-20 text-center">
        <h1 className="text-4xl md:text-6xl font-bold leading-tight">
          Your local{' '}
          <span className="text-orange-500">services board.</span>
        </h1>
        <p className="mt-4 text-lg text-gray-400 max-w-2xl mx-auto">
          OxSteed is a community directory where neighbors post jobs and local helpers list their skills.
          Browse listings, connect directly, or opt into payment protection — you decide how you work together.
        </p>
        <div className="mt-8 flex flex-col sm:flex-row gap-4 justify-center">
          <Link
                          to="/jobs"
            className="inline-flex items-center justify-center gap-2 px-8 py-4 bg-orange-500 hover:bg-orange-600 text-white font-semibold rounded-xl shadow-lg shadow-orange-500/25 transition text-lg"
          >
            Browse Listings
            <ArrowRight size={20} />
          </Link>
          <Link
            to="/register/helper"
            className="inline-flex items-center justify-center gap-2 px-8 py-4 border border-gray-700 hover:border-gray-500 text-white font-semibold rounded-xl transition text-lg"
          >
            List Your Skills
            <ChevronRight size={20} />
          </Link>
        </div>
      </section>

      {/* How It Works — Three Tiers */}
      <section className="bg-gray-900/50 py-16">
        <div className="max-w-6xl mx-auto px-6">
          <h2 className="text-2xl font-bold text-center mb-4">How OxSteed Works</h2>
          <p className="text-center text-gray-400 text-sm mb-12 max-w-xl mx-auto">
            Three tiers. You choose how involved OxSteed is.
          </p>
          <div className="grid md:grid-cols-3 gap-8">
            <div className="text-center">
              <div className="w-12 h-12 rounded-full bg-orange-500 text-white text-xl font-bold flex items-center justify-center mx-auto">
                1
              </div>
              <h3 className="mt-4 text-lg font-semibold">Browse the Board</h3>
              <p className="mt-1 text-xs text-orange-400 font-medium uppercase tracking-wide">Tier 1 — Free Directory</p>
              <p className="mt-2 text-gray-400 text-sm">
                Helpers post free listings. Customers browse and post jobs. Connect directly and arrange everything between yourselves. No money passes through OxSteed.
              </p>
            </div>
            <div className="text-center">
              <div className="w-12 h-12 rounded-full bg-orange-500 text-white text-xl font-bold flex items-center justify-center mx-auto">
                2
              </div>
              <h3 className="mt-4 text-lg font-semibold">Go Pro</h3>
              <p className="mt-1 text-xs text-orange-400 font-medium uppercase tracking-wide">Tier 2 — Helper Subscription</p>
              <p className="mt-2 text-gray-400 text-sm">
                Helpers subscribe for priority placement, a verified badge, optional background check certification, and bid alerts. Payments still happen directly between you and the customer.
              </p>
            </div>
            <div className="text-center">
              <div className="w-12 h-12 rounded-full bg-orange-500 text-white text-xl font-bold flex items-center justify-center mx-auto">
                3
              </div>
              <h3 className="mt-4 text-lg font-semibold">Add Payment Protection</h3>
              <p className="mt-1 text-xs text-orange-400 font-medium uppercase tracking-wide">Tier 3 — Mutual Opt-In Only</p>
              <p className="mt-2 text-gray-400 text-sm">
                When both the customer and helper agree, OxSteed can hold funds in escrow via Stripe until the job is confirmed complete. Includes dispute resolution. Only activated when both sides opt in.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* Categories */}
      <section className="py-16">
        <div className="max-w-6xl mx-auto px-6">
          <h2 className="text-2xl font-bold text-center mb-12">Popular Listings</h2>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
            {CATEGORIES.map((cat) => (
              <div
                key={cat.name}
                className="p-6 bg-gray-900 border border-gray-800 rounded-xl hover:border-orange-500/50 transition cursor-pointer"
              >
                <cat.icon className="w-8 h-8 text-orange-500 mb-3" />
                <h3 className="font-semibold">{cat.name}</h3>
                <p className="text-sm text-gray-400 mt-1">{cat.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Why OxSteed */}
      <section className="bg-gray-900/50 py-16">
        <div className="max-w-6xl mx-auto px-6">
          <h2 className="text-2xl font-bold text-center mb-12">Why OxSteed</h2>
          <div className="grid md:grid-cols-3 gap-8">
            <div className="flex items-start gap-4">
              <div className="w-10 h-10 rounded-xl bg-orange-500/10 flex items-center justify-center flex-shrink-0">
                <Shield className="w-5 h-5 text-orange-500" />
              </div>
              <div>
                <h3 className="font-semibold">Verified Profiles Available</h3>
                <p className="text-sm text-gray-400 mt-1">Helpers can opt into background screening through Checkr. Look for the verified badge. OxSteed does not endorse or guarantee any helper.</p>
              </div>
            </div>
            <div className="flex items-start gap-4">
              <div className="w-10 h-10 rounded-xl bg-orange-500/10 flex items-center justify-center flex-shrink-0">
                <Lock className="w-5 h-5 text-orange-500" />
              </div>
              <div>
                <h3 className="font-semibold">OxSteed Pay — Mutual Opt-In</h3>
                <p className="text-sm text-gray-400 mt-1">Both the customer and helper must agree to activate escrow protection. Funds are held via Stripe Connect until the job is confirmed complete. Never automatic.</p>
              </div>
            </div>
            <div className="flex items-start gap-4">
              <div className="w-10 h-10 rounded-xl bg-orange-500/10 flex items-center justify-center flex-shrink-0">
                <MapPin className="w-5 h-5 text-orange-500" />
              </div>
              <div>
                <h3 className="font-semibold">Available Nationwide</h3>
                <p className="text-sm text-gray-400 mt-1">A local listing board for communities across the US. Your address stays private until a helper confirms and the job is within 12 hours of starting.</p>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Helper CTA */}
      <section className="py-16">
        <div className="max-w-4xl mx-auto px-6 text-center">
          <h2 className="text-3xl font-bold">Post your skills. Run your own business.</h2>
          <p className="mt-4 text-gray-400 text-lg">
            List your services for free on your local help board, or subscribe to Pro for priority visibility and a verified badge.
            You set your own rates, hours, and service area. OxSteed is the board — you're the business owner.
          </p>
          <Link
            to="/register/helper"
            className="mt-8 inline-flex items-center gap-2 px-8 py-4 bg-orange-500 hover:bg-orange-600 text-white font-semibold rounded-xl shadow-lg shadow-orange-500/25 transition text-lg"
          >
            List Your Skills
            <ArrowRight size={20} />
          </Link>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-gray-800 py-8">
        <div className="max-w-6xl mx-auto px-6 flex flex-col gap-4">
          <div className="flex flex-col md:flex-row items-center justify-between gap-4">
            <p className="text-sm text-gray-500">&copy; 2026 OxSteed LLC</p>
            <div className="flex flex-wrap gap-4 text-sm text-gray-500">
              <Link to="/login" className="hover:text-white transition">Sign In</Link>
              <Link to="/register/customer" className="hover:text-white transition">Find Help</Link>
              <Link to="/register/helper" className="hover:text-white transition">List Your Skills</Link>
            </div>
          </div>
          <div className="flex flex-wrap justify-center gap-4 text-xs text-gray-500">
            <Link to="/terms" className="hover:text-white transition">Terms of Service</Link>
            <Link to="/privacy" className="hover:text-white transition">Privacy Policy</Link>
            <Link to="/security" className="hover:text-white transition">Security</Link>
            <Link to="/cookie-policy" className="hover:text-white transition">Cookie Policy</Link>
            <Link to="/do-not-sell" className="hover:text-white transition">Do Not Sell My Info</Link>
          </div>
          <p className="text-xs text-gray-600 text-center max-w-4xl mx-auto">
            OxSteed LLC operates an online introduction platform and optional payment services. OxSteed is not a party to any service agreement between users unless both parties have affirmatively opted into Tier 3 Payment Protection for a specific job. All helpers are independent individuals or businesses — not employees, agents, or contractors of OxSteed. OxSteed does not control how helpers perform work, does not set prices, and does not dispatch helpers. Users are solely responsible for evaluating and selecting other users. OxSteed does not provide insurance of any kind.
          </p>
        </div>
      </footer>
    </div>
  );
}
