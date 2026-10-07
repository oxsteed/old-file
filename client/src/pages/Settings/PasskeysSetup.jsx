import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { ArrowLeft, KeyRound } from 'lucide-react';
import Navbar from '../../components/Navbar';
import Footer from '../../components/Footer';
import PasskeysSection from './PasskeysSection';

export default function PasskeysSetup() {
  const { t } = useTranslation();

  return (
    <div className="flex min-h-screen flex-col bg-[var(--color-bg)] text-content">
      <Navbar />
      <main className="flex-1 px-4 py-10">
        <div className="mx-auto max-w-lg">
          <Link
            to="/settings"
            className="mb-8 inline-flex items-center gap-2 text-sm text-muted transition hover:text-content"
          >
            <ArrowLeft size={16} /> {t('twoFactor.backToSettings')}
          </Link>

          <div className="rounded-2xl border border-border bg-surface p-8">
            <div className="mb-6 flex items-center gap-3">
              <KeyRound className="text-primary" size={28} />
              <div>
                <h1 className="text-2xl font-bold text-content">{t('twoFactor.passkeysPageTitle')}</h1>
                <p className="text-sm text-muted">{t('twoFactor.passkeysPageSubtitle')}</p>
              </div>
            </div>
            <PasskeysSection className="space-y-3" />
          </div>
        </div>
      </main>
      <Footer />
    </div>
  );
}
