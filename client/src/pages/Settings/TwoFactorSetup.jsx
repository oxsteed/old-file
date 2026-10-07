import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { twoFactorAPI } from '../../api/twoFactor';
import toast from 'react-hot-toast';
import { Shield, ShieldCheck, ShieldOff, ArrowLeft, Copy, RefreshCw } from 'lucide-react';
import Navbar from '../../components/Navbar';
import Footer from '../../components/Footer';
import PasskeysSection from './PasskeysSection';

export default function TwoFactorSetup({ adminSetup = false }) {
  const { t } = useTranslation();
  const [status, setStatus] = useState(null);
  const [loading, setLoading] = useState(true);
  const [setupData, setSetupData] = useState(null);
  const [verifyCode, setVerifyCode] = useState('');
  const [disableCode, setDisableCode] = useState('');
  const [backupCodes, setBackupCodes] = useState(null);
  const [step, setStep] = useState('status');

  useEffect(() => { fetchStatus(); }, [adminSetup]);

  const fetchStatus = async () => {
    try {
      const { data } = await twoFactorAPI.getStatus();
      setStatus(data);
      setStep(data.enabled ? 'enabled' : 'status');
    } catch (err) {
      toast.error(t('twoFactor.failedLoad'));
    } finally {
      setLoading(false);
    }
  };

  const handleSetup = async () => {
    try {
      const { data } = await twoFactorAPI.setup();
      setSetupData(data);
      setBackupCodes(data.backupCodes);
      setStep('setup');
    } catch (err) {
      toast.error(err.response?.data?.error || t('twoFactor.setupFailed'));
    }
  };

  const handleVerify = async (e) => {
    e.preventDefault();
    try {
      const { data } = await twoFactorAPI.verifySetup(verifyCode);
      setBackupCodes(data.backupCodes);
      setStatus({ enabled: true });
      toast.success(t('twoFactor.enableSuccess'));
      setStep('backupCodes');
    } catch (err) {
      toast.error(err.response?.data?.error || t('twoFactor.invalidCode'));
    }
  };

  const handleDisable = async (e) => {
    e.preventDefault();
    try {
      await twoFactorAPI.disable(disableCode);
      toast.success(t('twoFactor.disableSuccess'));
      setStatus({ enabled: false });
      setStep('status');
      setDisableCode('');
    } catch (err) {
      toast.error(err.response?.data?.error || t('twoFactor.invalidCode'));
    }
  };

  const handleRegenBackup = async (e) => {
    e.preventDefault();
    try {
      const { data } = await twoFactorAPI.regenerateBackupCodes(disableCode);
      setBackupCodes(data.backupCodes);
      setStep('backupCodes');
      toast.success(t('twoFactor.newBackupGenerated'));
    } catch (err) {
      toast.error(err.response?.data?.error || t('twoFactor.failedRegen'));
    }
  };

  const copyBackupCodes = () => {
    if (backupCodes) {
      navigator.clipboard.writeText(backupCodes.join('\n'));
      toast.success(t('twoFactor.backupCopied'));
    }
  };

  if (loading) return (
    <div className="flex min-h-screen flex-col bg-[var(--color-bg)]">
      <Navbar />
      <div className="flex flex-1 items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
      </div>
      <Footer />
    </div>
  );

  return (
    <div className="flex min-h-screen flex-col bg-[var(--color-bg)] text-content">
      <Navbar />
      <main className="flex-1 px-4 py-10">
      <div className="mx-auto max-w-lg">
        <Link to="/settings" className="mb-8 inline-flex items-center gap-2 text-sm text-muted transition hover:text-content">
          <ArrowLeft size={16} /> {t('twoFactor.backToSettings')}
        </Link>

        <div className="rounded-2xl border border-border bg-surface p-8">
          <div className="mb-6 flex items-center gap-3">
            <Shield className="text-primary" size={28} />
            <div>
              <h1 className="text-2xl font-bold text-content">{t('twoFactor.title')}</h1>
              <p className="text-sm text-muted">{t('twoFactor.subtitle')}</p>
            </div>
          </div>

          {step === 'status' && (
            <div className="space-y-6">
              <div className="flex items-center gap-3 rounded-xl bg-surface-2/50 p-4">
                <ShieldOff className="text-muted" size={24} />
                <div>
                  <p className="font-medium text-content">{t('twoFactor.notEnabled')}</p>
                  <p className="text-sm text-muted">{t('twoFactor.notEnabledSub')}</p>
                </div>
              </div>
              <button onClick={handleSetup} className="w-full rounded-xl bg-action px-4 py-3 font-semibold text-on-action transition hover:bg-action-hover">
                {t('twoFactor.enableBtn')}
              </button>
            </div>
          )}

          {step === 'setup' && setupData && (
            <div className="space-y-6">
              <div className="text-center">
                <p className="mb-4 text-muted">{t('twoFactor.scanQr')}</p>
                <div className="inline-block rounded-xl bg-white p-4">
                  <img src={setupData.qrCode} alt="2FA QR Code" className="h-48 w-48" />
                </div>
              </div>
              <div className="rounded-xl bg-surface-2/50 p-4">
                <p className="mb-1 text-xs text-muted">{t('twoFactor.manualKey')}</p>
                <p className="break-all font-mono text-sm text-primary">{setupData.secret}</p>
              </div>
              {backupCodes && (
                <div className="rounded-xl border p-4" style={{ borderColor: 'color-mix(in srgb, var(--color-warning) 35%, transparent)', background: 'var(--color-warning-bg)' }}>
                  <p className="mb-2 text-sm font-semibold" style={{ color: 'var(--color-warning)' }}>{t('twoFactor.saveBackupCodes')}</p>
                  <p className="mb-3 text-xs text-muted">{t('twoFactor.backupCodesSub')}</p>
                  <div className="mb-3 grid grid-cols-2 gap-2">
                    {backupCodes.map((code, i) => (
                      <code key={i} className="rounded bg-surface-2 px-3 py-1.5 text-center font-mono text-sm text-content">{code}</code>
                    ))}
                  </div>
                  <button onClick={copyBackupCodes} className="flex items-center gap-2 text-sm text-primary hover:opacity-90">
                    <Copy size={14} /> {t('twoFactor.copyAllCodes')}
                  </button>
                </div>
              )}
              <form onSubmit={handleVerify} className="space-y-4">
                <div>
                  <label className="mb-1.5 block text-sm text-muted">{t('twoFactor.codeLabel')}</label>
                  <input
                    type="text"
                    value={verifyCode}
                    onChange={(e) => setVerifyCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                    className="w-full rounded-xl border border-border bg-surface-2 px-4 py-3 text-center font-mono text-2xl tracking-widest text-content focus:outline-none focus:ring-2 focus:ring-primary"
                    placeholder="000000"
                    maxLength={6}
                    autoFocus
                  />
                </div>
                <button type="submit" disabled={verifyCode.length !== 6} className="w-full rounded-xl bg-action py-3 font-semibold text-on-action transition hover:bg-action-hover disabled:opacity-50">
                  {t('twoFactor.verifyEnableBtn')}
                </button>
              </form>
            </div>
          )}

          {step === 'enabled' && (
            <div className="space-y-6">
              {adminSetup && (
                <Link to="/admin/dashboard" className="block rounded-xl bg-action px-4 py-3 text-center font-semibold text-on-action">
                  {t('nav.dashboard')}
                </Link>
              )}
              <div className="flex items-center gap-3 rounded-xl border p-4" style={{ borderColor: 'color-mix(in srgb, var(--color-success) 35%, transparent)', background: 'var(--color-success-bg)' }}>
                <ShieldCheck style={{ color: 'var(--color-success)' }} size={24} />
                <div>
                  <p className="font-medium text-content">{t('twoFactor.isEnabled')}</p>
                  <p className="text-sm text-muted">{t('twoFactor.isEnabledSub')}</p>
                </div>
              </div>
              <div className="space-y-3">
                <h3 className="font-medium text-content">{t('twoFactor.manage')}</h3>
                <form onSubmit={handleDisable} className="space-y-3">
                  <input
                    type="text"
                    value={disableCode}
                    onChange={(e) => setDisableCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                    className="w-full rounded-xl border border-border bg-surface-2 px-4 py-3 text-center font-mono text-content focus:outline-none focus:ring-2 focus:ring-primary"
                    placeholder={t('twoFactor.manageCodePh')}
                    maxLength={6}
                  />
                  <div className="flex gap-3">
                    <button type="submit" disabled={disableCode.length !== 6} className="flex-1 rounded-xl py-2.5 text-sm font-medium text-on-solid transition disabled:opacity-50" style={{ background: 'var(--color-error)' }}>
                      {t('twoFactor.disableBtn')}
                    </button>
                    <button type="button" onClick={handleRegenBackup} disabled={disableCode.length !== 6} className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-surface-3 py-2.5 text-sm font-medium text-content transition hover:opacity-90 disabled:opacity-50">
                      <RefreshCw size={14} /> {t('twoFactor.newBackupCodesBtn')}
                    </button>
                  </div>
                </form>
              </div>
            </div>
          )}

          {step === 'backupCodes' && backupCodes && (
            <div className="space-y-6">
              <div className="rounded-xl border p-4" style={{ borderColor: 'color-mix(in srgb, var(--color-warning) 35%, transparent)', background: 'var(--color-warning-bg)' }}>
                <p className="mb-2 text-sm font-semibold" style={{ color: 'var(--color-warning)' }}>{t('twoFactor.newBackupTitle')}</p>
                <p className="mb-3 text-xs text-muted">{t('twoFactor.newBackupSub')}</p>
                <div className="mb-3 grid grid-cols-2 gap-2">
                  {backupCodes.map((code, i) => (
                    <code key={i} className="rounded bg-surface-2 px-3 py-1.5 text-center font-mono text-sm text-content">{code}</code>
                  ))}
                </div>
                <button onClick={copyBackupCodes} className="flex items-center gap-2 text-sm text-primary hover:opacity-90">
                  <Copy size={14} /> {t('twoFactor.copyAllCodes')}
                </button>
              </div>
              <button onClick={() => setStep('enabled')} className="w-full rounded-xl bg-surface-3 py-3 font-medium text-content transition hover:opacity-90">
                {t('twoFactor.doneBtn')}
              </button>
            </div>
          )}

          <PasskeysSection adminSetup={adminSetup} className="mt-6 space-y-3 border-t border-border pt-5" />
        </div>
      </div>
      </main>
      <Footer />
    </div>
  );
}
