// client/src/pages/HelperRegister.tsx
// 2-step registration: Account → Didit (required) → Helper Dashboard
// Identical structure to CustomerRegister. Onboarding finishes from dashboard.

import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { StepBar, AccountForm, DiditPanel } from '../components/registration';

type Step = 1 | 2;

export default function HelperRegister() {
  const navigate = useNavigate();
  const [step, setStep] = useState<Step>(1);

  return (
    <div className="min-h-screen bg-gray-950 text-white">
      {/* Navbar */}
      <nav className="border-b border-gray-800">
        <div className="max-w-6xl mx-auto px-4 py-3 flex items-center justify-between">
          <Link to="/" className="text-2xl font-bold text-orange-500">OxSteed</Link>
          <div className="flex items-center gap-4">
            <Link to="/how-it-works" className="text-sm text-gray-400 hover:text-white transition">How It Works</Link>
            <Link to="/login" className="text-sm text-gray-400 hover:text-white transition">Sign In</Link>
          </div>
        </div>
      </nav>

      <div className="flex flex-col items-center px-4 py-8 md:py-12">
        <div className="w-full max-w-[480px] flex flex-col gap-8">

          <section className="text-center">
            <h1 className="text-3xl font-bold text-white mb-2">Start Earning in Your Neighborhood</h1>
            <p className="text-orange-400 font-semibold text-lg">Set your own rates. Get found by neighbors.</p>
            <p className="text-gray-400 text-sm mt-2">Free for 90 days · No credit card required</p>
          </section>

          <div className="bg-gray-900 border border-gray-800 rounded-xl shadow-lg shadow-black/30 overflow-hidden">
            <StepBar current={step} />

            {step === 1 && (
              <div className="animate-fadeIn">
                <AccountForm
                  role="helper"
                  onSuccess={() => {
                    setStep(2);
                    window.scrollTo({ top: 0, behavior: 'smooth' });
                  }}
                />
              </div>
            )}

            {step === 2 && (
              <div className="animate-fadeIn">
                <DiditPanel
                  onVerified={() => navigate('/helper-dashboard', { replace: true })}
                  onBack={() => setStep(1)}
                />
              </div>
            )}

            <div className="text-center px-6 pb-5 text-xs text-gray-400">
              Already have an account?{' '}
              <Link to="/login" className="text-orange-500 font-medium hover:underline">Sign in</Link>
            </div>
          </div>

          <div className="text-center">
            <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-violet-900/20 border border-violet-700/40">
              <span className="w-2 h-2 rounded-full bg-violet-400 animate-pulse" />
              <span className="text-xs text-violet-300 font-medium">
                90-day Pro trial included — all features unlocked, no card needed
              </span>
            </div>
          </div>

          <footer className="text-center text-xs text-gray-600">
            © {new Date().getFullYear()} OxSteed · Springfield, OH
          </footer>
        </div>
      </div>
    </div>
  );
}
