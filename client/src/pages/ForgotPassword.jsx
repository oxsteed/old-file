import { useState } from 'react';
import { Link } from 'react-router-dom';
import api from '../api/axios';
import { useTranslation } from 'react-i18next';
import toast from 'react-hot-toast';
import { ArrowLeft, Mail } from 'lucide-react';
import Footer from '../components/Footer';

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);
  const { t } = useTranslation();

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    try {
      await api.post('/auth/forgot-password', { email });
      setSent(true);
      toast.success(t('forgotPassword.successToast'));
    } catch (err) {
      toast.error(err.response?.data?.error || t('forgotPassword.errorGeneric'));
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
          <h2 className="mt-6 text-2xl font-bold text-[var(--color-text)]">{t('forgotPassword.title')}</h2>
          <p className="mt-2 text-[var(--color-text-muted)] text-sm">
            {sent
              ? t('forgotPassword.sentSubtitle')
              : t('forgotPassword.subtitle')}
          </p>
        </div>

        {!sent ? (
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label htmlFor="email" className="block text-sm font-medium text-[var(--color-text-muted)] mb-1.5">
                {t('auth.email')}
              </label>
              <input
                id="email"
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full px-4 py-3 bg-[var(--color-surface)] border border-[var(--color-border-strong)] rounded-xl text-[var(--color-text)] placeholder-[var(--color-text-faint)] focus:outline-none focus:ring-2 focus:ring-orange-500 focus:border-transparent transition"
                placeholder="you@example.com"
                autoComplete="email"
              />
            </div>
            <button
              type="submit"
              disabled={loading}
              className="w-full flex items-center justify-center gap-2 py-3 px-4 bg-orange-500 hover:bg-orange-600 text-white font-semibold rounded-xl shadow-lg shadow-orange-500/25 disabled:opacity-50 transition"
            >
              {loading ? t('forgotPassword.sending') : (<><Mail size={18} /> {t('forgotPassword.sendButton')}</>)}
            </button>
          </form>
        ) : (
          <div className="text-center space-y-4">
            <div className="w-16 h-16 mx-auto bg-orange-500/10 rounded-full flex items-center justify-center">
              <Mail className="w-8 h-8 text-orange-500" />
            </div>
            <p className="text-[var(--color-text-muted)] text-sm">{t('forgotPassword.checkSpam')}</p>
            <button
              onClick={() => setSent(false)}
              className="text-orange-500 hover:text-orange-400 text-sm font-medium transition"
            >
              {t('forgotPassword.tryAgain')}
            </button>
          </div>
        )}

        <div className="text-center">
          <Link to="/login" className="inline-flex items-center gap-1 text-sm text-[var(--color-text-muted)] hover:text-[var(--color-text)] transition">
            <ArrowLeft size={16} /> {t('forgotPassword.backToSignIn')}
          </Link>
        </div>
      </div>
      </main>
      <Footer />
    </div>
  );
}
