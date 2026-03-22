import { Link } from 'react-router-dom';
import { ArrowRight, Shield, MapPin, Wrench, Users, Star, ChevronRight } from 'lucide-react';

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
          <div className="flex items-center gap-4">
            <Link to="/login" className="text-sm text-gray-400 hover:text-white transition">Sign in</Link>
            <Link
              to="/register/helper"
              className="text-sm px-4 py-2 bg-orange-500 hover:bg-orange-600 text-white rounded-lg font-medium transition"
            >
              Become a Helper
            </Link>
          </div>
        </div>
      </nav>

      {/* Hero */}
      <section className="max-w-6xl mx-auto px-6 py-20 text-center">
        <h1 className="text-4xl md:text-6xl font-bold leading-tight">
          Local help,{' '}
          <span className="text-orange-500">handled for you.</span>
        </h1>
        <p className="mt-4 text-lg text-gray-400 max-w-2xl mx-auto">
          OxSteed connects you with vetted local helpers for handyman work, tool rentals,
          moving, and more. Tell us what you need — we handle the rest.
        </p>
        <div className="mt-8 flex flex-col sm:flex-row gap-4 justify-center">
          <Link
            to="/register/customer"
            className="inline-flex items-center justify-center gap-2 px-8 py-4 bg-orange-500 hover:bg-orange-600 text-white font-semibold rounded-xl shadow-lg shadow-orange-500/25 transition text-lg"
          >
            Get Help Now
            <ArrowRight size={20} />
          </Link>
          <Link
            to="/register/helper"
            className="inline-flex items-center justify-center gap-2 px-8 py-4 border border-gray-700 hover:border-gray-500 text-white font-semibold rounded-xl transition text-lg"
          >
            Earn as a Helper
            <ChevronRight size={20} />
          </Link>
        </div>
      </section>

      {/* How It Works */}
      <section className="bg-gray-900/50 py-16">
        <div className="max-w-6xl mx-auto px-6">
          <h2 className="text-2xl font-bold text-center mb-12">How OxSteed Works</h2>
          <div className="grid md:grid-cols-3 gap-8">
            {[
              { step: '1', title: 'Tell us what you need', desc: 'Describe the job, pick a category, and set your budget.' },
              { step: '2', title: 'We match you', desc: 'OxSteed connects you with a vetted, local helper who fits the job.' },
              { step: '3', title: 'Job done, pay securely', desc: 'Your helper completes the work. Pay through OxSteed or directly — your choice.' },
            ].map((item) => (
              <div key={item.step} className="text-center">
                <div className="w-12 h-12 rounded-full bg-orange-500 text-white text-xl font-bold flex items-center justify-center mx-auto">
                  {item.step}
                </div>
                <h3 className="mt-4 text-lg font-semibold">{item.title}</h3>
                <p className="mt-2 text-gray-400 text-sm">{item.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Categories */}
      <section className="py-16">
        <div className="max-w-6xl mx-auto px-6">
          <h2 className="text-2xl font-bold text-center mb-12">Popular Services</h2>
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

      {/* Trust Section */}
      <section className="bg-gray-900/50 py-16">
        <div className="max-w-6xl mx-auto px-6">
          <h2 className="text-2xl font-bold text-center mb-12">Why OxSteed</h2>
          <div className="grid md:grid-cols-3 gap-8">
            <div className="flex items-start gap-4">
              <div className="w-10 h-10 rounded-xl bg-orange-500/10 flex items-center justify-center flex-shrink-0">
                <Shield className="w-5 h-5 text-orange-500" />
              </div>
              <div>
                <h3 className="font-semibold">Verified Helpers</h3>
                <p className="text-sm text-gray-400 mt-1">Paid-tier helpers are background-checked and identity-verified.</p>
              </div>
            </div>
            <div className="flex items-start gap-4">
              <div className="w-10 h-10 rounded-xl bg-orange-500/10 flex items-center justify-center flex-shrink-0">
                <Shield className="w-5 h-5 text-orange-500" />
              </div>
              <div>
                <h3 className="font-semibold">Optional Escrow</h3>
                <p className="text-sm text-gray-400 mt-1">Choose secure payment protection on any job — or pay directly.</p>
              </div>
            </div>
            <div className="flex items-start gap-4">
              <div className="w-10 h-10 rounded-xl bg-orange-500/10 flex items-center justify-center flex-shrink-0">
                <MapPin className="w-5 h-5 text-orange-500" />
              </div>
              <div>
                <h3 className="font-semibold">Springfield Local</h3>
                <p className="text-sm text-gray-400 mt-1">Built for Springfield, OH. Helpers in your neighborhood.</p>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Helper CTA */}
      <section className="py-16">
        <div className="max-w-4xl mx-auto px-6 text-center">
          <h2 className="text-3xl font-bold">Ready to earn on your own terms?</h2>
          <p className="mt-4 text-gray-400 text-lg">
            List your services for free or upgrade to a verified profile.
            OxSteed sends you jobs — you do great work.
          </p>
          <Link
            to="/register/helper"
            className="mt-8 inline-flex items-center gap-2 px-8 py-4 bg-orange-500 hover:bg-orange-600 text-white font-semibold rounded-xl shadow-lg shadow-orange-500/25 transition text-lg"
          >
            Become a Helper
            <ArrowRight size={20} />
          </Link>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-gray-800 py-8">
        <div className="max-w-6xl mx-auto px-6 flex flex-col md:flex-row items-center justify-between gap-4">
          <p className="text-sm text-gray-500">&copy; 2026 OxSteed LLC &middot; Springfield, OH</p>
          <div className="flex gap-6 text-sm text-gray-500">
            <Link to="/login" className="hover:text-white transition">Sign In</Link>
            <Link to="/register/customer" className="hover:text-white transition">Find Help</Link>
            <Link to="/register/helper" className="hover:text-white transition">Become a Helper</Link>
          </div>
        </div>
      </footer>
    </div>
  );
}
