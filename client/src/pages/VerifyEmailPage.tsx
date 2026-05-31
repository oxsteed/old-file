// client/src/pages/VerifyEmailPage.tsx
// Email verification gate for authenticated users without verified email.
// Shown when a logged-in user has email_verified=false.

import { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../hooks/useAuth';
import api from '../api/axios';
import toast from 'react-hot-toast';
import { Mail, CheckCircle } from 'lucide-react';
import Footer from '../components/Footer';

export default function VerifyEmailPage() {
  const navigate = useNavigate();
  const { user, refreshUser } = useAuth();
  const { t } = useTranslation();

  const [step, setStep] = useState<'request' | 'verify'>('request');
  const [otp, setOtp] = useState('');
  const [loading, setLoading] = useState(false);
  const [otpSent, setOtpSent] = useState(false);

  const handleRequestOTP = async () => {
    if (!user?.email) {
      toast.error(t('errors.emailNotFound'));
      return;
    }

    setLoading(true);
    try {
      await api.post('/auth/otp/request', {
        email: user.email,
        type: 'email_verification'
      });
      setOtpSent(true);
      setStep('verify');
      toast.success(t('auth.otpSent'));
    } catch (err) {
      toast.error(err.response?.data?.error || t('errors.otpRequestFailed'));
    } finally {
      setLoading(false);
    }
  };

  const handleVerifyOTP = async () => {
    if (!otp.trim()) {
      toast.error(t('errors.enterOtp'));
      return;
    }

    setLoading(true);
    try {
      await api.post('/auth/otp/verify', {
        email: user?.email,
        otp: otp.trim(),
        type: 'email_verification'
      });

      // Refresh user to get updated email_verified status
      await refreshUser();
      toast.success(t('auth.emailVerified'));
      navigate('/dashboard', { replace: true });
    } catch (err) {
      toast.error(err.response?.data?.error || t('errors.invalidOtp'));
    } finally {
      setLoading(false);
    }
  };

  // Navigate to dashboard if already verified
  if (user?.email_verified) {
    navigate('/dashboard', { replace: true });
    return null;
  }

  return (
    <div className="min-h-screen bg-gray-950 text-white flex flex-col">
      <nav className="border-b border-gray-800">
        <div className="max-w-6xl mx-auto px-4 py-3 flex items-center justify-between">
          <Link to="/" className="text-2xl font-bold text-orange-500">OxSteed</Link>
        </div>
      </nav>

      <div className="flex-1 flex flex-col items-center px-4 py-8 md:py-12">
        <div className="w-full max-w-[480px]">
          <div className="bg-gray-900 border border-gray-800 rounded-xl shadow-lg shadow-black/30 overflow-hidden">
            <div className="p-8">
              {/* Header */}
              <div className="flex items-center justify-center mb-6">
                <Mail className="w-12 h-12 text-orange-500" />
              </div>
              <h1 className="text-2xl font-bold text-center mb-2">
                {t('verifyEmail.title')}
              </h1>
              <p className="text-gray-400 text-center text-sm mb-6">
                {t('verifyEmail.description')}
              </p>

              {step === 'request' ? (
                <div className="space-y-4">
                  <p className="text-sm text-gray-300 bg-gray-800/50 p-3 rounded">
                    {t('verifyEmail.sentTo', { email: user?.email })}
                  </p>

                  <button
                    onClick={handleRequestOTP}
                    disabled={loading}
                    className="w-full px-4 py-3 bg-orange-500 text-white font-medium rounded-lg hover:bg-orange-600 disabled:opacity-50 transition-colors"
                  >
                    {loading ? (
                      <span className="flex items-center justify-center gap-2">
                        <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white" />
                        {t('common.loading')}
                      </span>
                    ) : (
                      t('verifyEmail.sendOtp')
                    )}
                  </button>

                  <p className="text-xs text-gray-500 text-center">
                    {t('verifyEmail.didntReceive')}{' '}
                    <button
                      onClick={handleRequestOTP}
                      disabled={loading}
                      className="text-orange-400 hover:text-orange-300 disabled:opacity-50"
                    >
                      {t('common.tryAgain')}
                    </button>
                  </p>
                </div>
              ) : (
                <div className="space-y-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-300 mb-2">
                      {t('auth.otpCode')}
                    </label>
                    <input
                      type="text"
                      value={otp}
                      onChange={(e) => setOtp(e.target.value.toUpperCase())}
                      placeholder={t('verifyEmail.otpPlaceholder')}
                      maxLength={6}
                      className="w-full px-4 py-3 bg-gray-800 border border-gray-700 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:border-orange-500 transition"
                      disabled={loading}
                    />
                  </div>

                  <button
                    onClick={handleVerifyOTP}
                    disabled={loading || !otp.trim()}
                    className="w-full px-4 py-3 bg-orange-500 text-white font-medium rounded-lg hover:bg-orange-600 disabled:opacity-50 transition-colors flex items-center justify-center gap-2"
                  >
                    {loading ? (
                      <>
                        <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white" />
                        {t('common.verifying')}
                      </>
                    ) : (
                      <>
                        <CheckCircle className="w-4 h-4" />
                        {t('verifyEmail.verify')}
                      </>
                    )}
                  </button>

                  <button
                    onClick={() => {
                      setStep('request');
                      setOtp('');
                    }}
                    disabled={loading}
                    className="w-full text-sm text-gray-400 hover:text-gray-300 disabled:opacity-50"
                  >
                    {t('common.back')}
                  </button>
                </div>
              )}
            </div>
          </div>

          <p className="text-xs text-gray-500 text-center mt-6">
            {t('verifyEmail.help')}{' '}
            <Link to="/support/escalation" className="text-orange-400 hover:text-orange-300">
              {t('common.contactSupport')}
            </Link>
          </p>
        </div>
      </div>

      <Footer />
    </div>
  );
}
