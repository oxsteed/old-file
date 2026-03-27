import React, { useState, useEffect } from 'react';
import { useNavigate, Link, useSearchParams } from 'react-router-dom';
import Step1AccountSetup from '../components/helperRegister/Step1AccountSetup';
import Step2EmailVerification from '../components/helperRegister/Step2EmailVerification';
import Step3TheFork from '../components/helperRegister/Step3TheFork';
import Step4ProfileLocation from '../components/helperRegister/Step4ProfileLocation';
import Step5ChoosePlan from '../components/helperRegister/Step5ChoosePlan';
import Step6TaxInfo from '../components/helperRegister/Step6TaxInfo';
import Step7ReviewComplete from '../components/helperRegister/Step7ReviewComplete';

const STEPS = [
  { label: 'Account', icon: '1' },
  { label: 'Verify', icon: '2' },
  { label: 'Profile', icon: '3' },
  { label: 'Plan', icon: '4' },
  { label: 'Tax', icon: '5' },
  { label: 'Review', icon: '6' },
];

export default function HelperRegister() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [step, setStep] = useState(1);
  const [registrationToken, setRegistrationToken] = useState('');
  const [selectedTier, setSelectedTier] = useState('');
  const [formData, setFormData] = useState<{
    firstName: string;
    lastName: string;
    email: string;
    phone: string;
    zip: string;
    city: string;
    state: string;
    bio: string;
    skills: string[];
    photoUrl: string;
    taxType: string;
    taxId: string;
    legalName: string;
    mailingAddress: { street: string; city: string; state: string; zip: string };
  }>({
    firstName: '', lastName: '', email: '',
    phone: '', zip: '', city: '', state: '',
    bio: '', skills: [], photoUrl: '',
    taxType: '', taxId: '', legalName: '',
    mailingAddress: { street: '', city: '', state: '', zip: '' },
  });

  // Handle Stripe return
  useEffect(() => {
    const sessionId = searchParams.get('session_id');
    const stepParam = searchParams.get('step');
    if (sessionId && stepParam) {
      setStep(Number(stepParam));
    }
  }, [searchParams]);

  const isFree = selectedTier === 'free';

  // Steps visible: Account(1), Verify(2), [Fork is not shown in progress], Profile(4), Plan(5), Tax(6, Pro only), Review(7)
  const getVisibleSteps = (): number[] => {
    if (isFree) return [1, 2, 4, 5, 7];
    return [1, 2, 4, 5, 6, 7];
  };

  const visibleSteps = getVisibleSteps();
  const currentIndex = visibleSteps.indexOf(step);

  const updateFormData = (data: Partial<typeof formData>) => {
    setFormData(prev => ({ ...prev, ...data }));
  };

  const renderStep = () => {
    switch (step) {
      case 1:
        return (
          <Step1AccountSetup
            onSuccess={(token: string, data: { firstName: string; lastName: string; email: string }) => {
              setRegistrationToken(token);
              updateFormData(data);
              setStep(2);
            }}
          />
        );
      case 2:
        return (
          <Step2EmailVerification
            token={registrationToken}
            email={formData.email}
            firstName={formData.firstName}
            onSuccess={() => setStep(3)}
          />
        );
      case 3:
        return (
          <Step3TheFork
            onContinue={() => setStep(4)}
            onFinishLater={() => navigate('/helper/dashboard')}
          />
        );
      case 4:
        return (
          <Step4ProfileLocation
            token={registrationToken}
            onSuccess={(data) => {
              updateFormData(data);
              setStep(5);
            }}
          />
        );
      case 5:
        return (
          <Step5ChoosePlan
            token={registrationToken}
            onSuccess={(tier: string) => {
              setSelectedTier(tier);
              if (tier === 'free') {
                setStep(7);
              } else {
                setStep(6);
              }
            }}
          />
        );
      case 6:
        return (
          <Step6TaxInfo
            token={registrationToken}
            onSuccess={(data) => {
              updateFormData(data);
              setStep(7);
            }}
          />
        );
      case 7:
        return (
          <Step7ReviewComplete
            token={registrationToken}
            formData={formData}
            selectedTier={selectedTier}
            onEdit={(targetStep: number) => setStep(targetStep)}
            onSuccess={() => {
              navigate('/helper/dashboard', { state: { message: 'Welcome to OxSteed!' } });
            }}
          />
        );
      default:
        return null;
    }
  };

  // Don't show progress bar on Fork step (3)
  const showProgressBar = step !== 3;

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
            Start Earning in Your Neighborhood
          </h1>
          <p className="text-orange-400 font-semibold text-lg">
            Set your own rates. Get found by neighbors. Earn on your schedule.
          </p>
          <p className="text-gray-400 text-sm mt-2">
            Takes about 5 minutes &middot; Free to join &middot; Upgrade to Pro anytime
          </p>
        </section>

        {/* Progress bar */}
        {showProgressBar && currentIndex >= 0 && (
          <>
            <div className="flex items-center gap-1 mb-1" role="progressbar" aria-valuenow={currentIndex + 1} aria-valuemin={1} aria-valuemax={visibleSteps.length}>
              {visibleSteps.map((s, i) => {
                const stepMeta = STEPS[s <= 2 ? s - 1 : s - 2]; // Adjust for fork step gap
                return (
                  <React.Fragment key={s}>
                    <div className="flex flex-col items-center">
                      <div
                        className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold ${
                          i < currentIndex
                            ? 'bg-green-500 text-white'
                            : s === step
                            ? 'bg-orange-500 text-white'
                            : 'bg-gray-700 text-gray-400'
                        }`}
                        aria-label={`Step ${i + 1}: ${stepMeta?.label || ''}`}
                      >
                        {i < currentIndex ? '\u2713' : String(i + 1)}
                      </div>
                      <span className={`text-xs mt-1 ${
                        s === step ? 'text-orange-400 font-medium' : 'text-gray-500'
                      }`}>{stepMeta?.label || ''}</span>
                    </div>
                    {i < visibleSteps.length - 1 && (
                      <div
                        className={`flex-1 h-0.5 mb-5 ${
                          i < currentIndex ? 'bg-green-500' : 'bg-gray-700'
                        }`}
                      />
                    )}
                  </React.Fragment>
                );
              })}
            </div>
            <p className="text-sm text-gray-400 mb-8">
              Step {currentIndex + 1} of {visibleSteps.length}
            </p>
          </>
        )}

        {/* Content */}
        <div>{renderStep()}</div>

        {/* Social Proof */}
        {step <= 3 && (
          <section className="mt-12 text-center border-t border-gray-800 pt-8">
            <blockquote className="text-gray-300 italic text-sm max-w-md mx-auto">
              &ldquo;I signed up on a Monday and had my first job by Wednesday. OxSteed made it easy to start earning in my neighborhood.&rdquo;
            </blockquote>
            <p className="text-gray-500 text-xs mt-2">&mdash; Marcus T., Springfield Helper</p>
            <p className="text-gray-500 text-xs mt-4">Join 150+ helpers already earning on OxSteed</p>
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
              <li><Link to="/cookiepolicy" className="hover:text-white transition">Cookie Policy</Link></li>
              <li><Link to="/donotsell" className="hover:text-white transition">Do Not Sell My Info</Link></li>
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
          &copy; {new Date().getFullYear()} OxSteed. All rights reserved.
        </div>
      </footer>
    </div>
  );
}
