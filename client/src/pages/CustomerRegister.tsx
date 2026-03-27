// src/pages/CustomerRegister.tsx
import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import Step1BasicInfo from '../components/register/Step1BasicInfo';
import Step2Terms from '../components/register/Step2Terms';
import Step3EmailVerification from '../components/register/Step3EmailVerification';

const STEPS = [
  { label: 'Account', icon: '1' },
  { label: 'Terms', icon: '2' },
  { label: 'Verify', icon: '3' },
];

type Step = 1 | 2 | 3;

export default function CustomerRegister() {
  const [step, setStep] = useState<Step>(1);
  const [registrationToken, setRegistrationToken] = useState<string | null>(null);
  const [formData, setFormData] = useState({ firstName: '', lastName: '', email: '' });

  const currentIndex = step - 1;

  return (
    <div className="min-h-screen bg-gray-950 text-white">
      {/* Navbar */}
      <nav className="border-b border-gray-800" role="navigation" aria-label="Main navigation">
        <div className="max-w-6xl mx-auto px-4 py-3 flex items-center justify-between">
          <Link to="/" className="text-2xl font-bold text-orange-500">OxSteed</Link>
          <div className="flex items-center gap-4">
            <Link to="/how-it-works" className="text-sm text-gray-400 hover:text-white transition">How It Works</Link>
            <Link to="/login" className="text-sm text-gray-400 hover:text-white transition">Sign In</Link>
          </div>
        </div>
      </nav>

      <div className="max-w-2xl mx-auto px-4 py-8">
        {/* Hero */}
        <section className="text-center mb-8 px-4">
          <h1 className="text-3xl font-bold text-white mb-2">
            Find Trusted Local Help
          </h1>
          <p className="text-orange-400 font-semibold text-lg">
            Post a job, compare bids, and hire with confidence.
          </p>
          <p className="text-gray-400 text-sm mt-2">
            Takes about 2 minutes · Free to post · No upfront fees
          </p>
        </section>

        {/* Progress bar */}
        <>
          <div className="flex items-center gap-1 mb-1" role="progressbar" aria-valuenow={step} aria-valuemin={1} aria-valuemax={3}>
            {STEPS.map((s, i) => (
              <React.Fragment key={i}>
                <div className="flex flex-col items-center">
                  <div
                    className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold ${
                      i < currentIndex
                        ? 'bg-green-500 text-white'
                        : i === currentIndex
                        ? 'bg-orange-500 text-white'
                        : 'bg-gray-700 text-gray-400'
                    }`}
                    aria-label={`Step ${i + 1}: ${s.label}`}
                  >
                    {i < currentIndex ? '\u2713' : String(i + 1)}
                  </div>
                  <span className={`text-xs mt-1 ${
                    i === currentIndex ? 'text-orange-400 font-medium' : 'text-gray-500'
                  }`}>{s.label}</span>
                </div>
                {i < STEPS.length - 1 && (
                  <div
                    className={`flex-1 h-0.5 mb-5 ${
                      i < currentIndex ? 'bg-green-500' : 'bg-gray-700'
                    }`}
                  />
                )}
              </React.Fragment>
            ))}
          </div>
          <p className="text-sm text-gray-400 mb-8">
            Step {step} of {STEPS.length}
          </p>
        </>

        {/* Content */}
        <div>
          {step === 1 && (
            <Step1BasicInfo
              onSuccess={(token, data) => {
                setRegistrationToken(token);
                setFormData(data);
                setStep(2);
              }}
            />
          )}
          {step === 2 && registrationToken && (
            <Step2Terms
              registrationToken={registrationToken}
              firstName={formData.firstName}
              lastName={formData.lastName}
              onSuccess={() => setStep(3)}
            />
          )}
          {step === 3 && registrationToken && (
            <Step3EmailVerification
              registrationToken={registrationToken}
            />
          )}
        </div>

        {/* Social Proof */}
        {step <= 2 && (
          <section className="mt-12 text-center border-t border-gray-800 pt-8">
            <blockquote className="text-gray-300 italic text-sm max-w-md mx-auto">
              "I posted a job and had 3 bids within an hour. Hired the same day. So easy!"
            </blockquote>
            <p className="text-gray-500 text-xs mt-2">— Sarah M., Louisville Customer</p>
            <p className="text-gray-500 text-xs mt-4">Join 500+ customers already posting jobs on OxSteed</p>
          </section>
        )}
      </div>

      {/* Footer */}
      <footer className="border-t border-gray-800 mt-16">
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
            <h3 className="text-white font-semibold mb-3">Contact</h3>
            <ul className="space-y-1">
              <li>Email: <a href="mailto:support@oxsteed.com" className="hover:text-white transition">support@oxsteed.com</a></li>
              <li><Link to="/how-it-works" className="hover:text-white transition">How It Works</Link></li>
              <li><Link to="/about" className="hover:text-white transition">About</Link></li>
            </ul>
          </div>
        </div>
        <div className="max-w-6xl mx-auto px-4 pb-6 text-center text-xs text-gray-600">
          © {new Date().getFullYear()} OxSteed. All rights reserved.
        </div>
      </footer>
    </div>
  );
}
