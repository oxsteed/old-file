import { useState } from 'react';
import { Link, useParams, useNavigate } from 'react-router-dom';
import api from '../api/axios';
import { useTranslation } from 'react-i18next';
import toast from 'react-hot-toast';
import { Eye, EyeOff, Lock } from 'lucide-react';
import Footer from '../components/Footer';

export default function ResetPasswordPage() {
  const { token } = useParams();
  const navigate = useNavigate();
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);
  const { t } = useTranslation();

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (password.length < 8) {
      toast.error(t('resetPassword.errorMinLength'));
      return;
    }
    if (password !== confirmPassword) {
      toast.error(t('resetPassword.errorMismatch'));
      return;
    }
    setLoading(true);
    try {
      await api.post('/auth/reset-password', { token, password });
      setSuccess(true);
      toast.success(t('resetPassword.successToast'));
      setTimeout(() => navigate('/login'), 3000);
    } catch (err) {
      toast.error(err.response?.data?.error || t('errors.resetLinkInvalid'));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-[var(--color-bg)] text-[var(--color-text)] flex flex-col">
      <main className="flex-1 flex items-center justify-center px-4">
      <div className="w-full max-w-md space-y-6">
        <div className="text-center">
          <Link to="/" className="text-3xl font-bold text-orange-500">OxSteed</Link>
          <h2 className="mt-6 text-2xl font-bold text-[var(--color-text)]">
            {success ? t('resetPassword.successTitle') : t('resetPassword.title')}
          </h2>
          <p className="mt-2 text-[var(--color-text-muted)] text-sm">
            {success
              ? t('resetPassword.successSubtitle')
              : t('resetPassword.subtitle')}
          </p>
        </div>

        {!success && (
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label htmlFor="password" className="block text-sm font-medium text-[var(--color-text-muted)] mb-1.5">
                {t('resetPassword.newPassword')}
              </label>
              <div className="relative">
                <input
                  id="password"
                  type={showPassword ? 'text' : 'password'}
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full px-4 py-3 bg-[var(--color-surface)] border border-[var(--color-border-strong)] rounded-xl text-[var(--color-text)] placeholder-[var(--color-text-faint)] focus:outline-none focus:ring-2 focus:ring-orange-500 focus:border-transparent transition pr-12"
                  placeholder={t('resetPassword.passwordPlaceholder')}
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-[var(--color-text-faint)] hover:text-[var(--color-text-muted)] transition"
                >
                  {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                </button>
              </div>
            </div>
            <div>
              <label htmlFor="confirmPassword" className="block text-sm font-medium text-[var(--color-text-muted)] mb-1.5">
                {t('resetPassword.confirmPassword')}
              </label>
              <input
                id="confirmPassword"
                type="password"
                required
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                className="w-full px-4 py-3 bg-[var(--color-surface)] border border-[var(--color-border-strong)] rounded-xl text-[var(--color-text)] placeholder-[var(--color-text-faint)] focus:outline-none focus:ring-2 focus:ring-orange-500 focus:border-transparent transition"
                placeholder={t('resetPassword.confirmPlaceholder')}
              />
            </div>
            <button
              type="submit"
              disabled={loading}
              className="w-full flex items-center justify-center gap-2 py-3 px-4 bg-orange-500 hover:bg-orange-600 text-white font-semibold rounded-xl shadow-lg shadow-orange-500/25 disabled:opacity-50 transition"
            >
              {loading ? t('resetPassword.resetting') : (<><Lock size={18} /> {t('resetPassword.resetButton')}</>)}
            </button>
          </form>
        )}

        {success && (
          <div className="text-center">
            <div className="w-16 h-16 mx-auto bg-green-500/10 rounded-full flex items-center justify-center mb-4">
              <Lock className="w-8 h-8 text-green-500" />
            </div>
            <Link to="/login" className="text-orange-500 hover:text-orange-400 text-sm font-medium transition">
              {t('resetPassword.goToSignIn')}
            </Link>
          </div>
        )}
      </div>
      </main>
      <Footer />
    </div>
  );
}
