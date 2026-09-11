import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { twoFactorAPI } from '../../api/twoFactor';
import { startRegistration } from '@simplewebauthn/browser';
import toast from 'react-hot-toast';
import { Shield, ShieldCheck, ShieldOff, ArrowLeft, Copy, RefreshCw } from 'lucide-react';
import Navbar from '../../components/Navbar';
import Footer from '../../components/Footer';

export default function TwoFactorSetup({ adminSetup = false }) {
  const { t } = useTranslation();
  const [status, setStatus] = useState(null);
  const [loading, setLoading] = useState(true);
  const [setupData, setSetupData] = useState(null);
  const [verifyCode, setVerifyCode] = useState('');
  const [disableCode, setDisableCode] = useState('');
  const [backupCodes, setBackupCodes] = useState(null);
  const [step, setStep] = useState('status');
  const [passkeys, setPasskeys] = useState([]);
  const [passkeyBusy, setPasskeyBusy] = useState(false);

  useEffect(() => { fetchStatus(); if (adminSetup) fetchPasskeys(); }, [adminSetup]);

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

  const fetchPasskeys = async () => {
    try {
      const { data } = await twoFactorAPI.listPasskeys();
      setPasskeys(Array.isArray(data?.passkeys) ? data.passkeys : []);
    } catch {
      setPasskeys([]);
    }
  };

  const handleRegisterPasskey = async () => {
    if (!window.PublicKeyCredential || passkeyBusy) {
      toast.error('This browser does not support passkeys.');
      return;
    }
    setPasskeyBusy(true);
    try {
      const deviceName = (window.prompt('Name this passkey (for example, MacBook Touch ID):') || '').trim();
      if (!deviceName) return;
      const { data } = await twoFactorAPI.passkeyRegistrationOptions();
      const response = await startRegistration({ optionsJSON: data.options });
      await twoFactorAPI.verifyPasskeyRegistration(response, deviceName);
      await fetchPasskeys();
      toast.success('Passkey registered. TOTP and backup codes remain available.');
    } catch (err) {
      if (err?.name !== 'NotAllowedError') {
        toast.error(err.response?.data?.error || 'Could not register this passkey.');
      }
    } finally {
      setPasskeyBusy(false);
    }
  };

  const handleRevokePasskey = async (passkey) => {
    if (!passkey?.id || passkeyBusy || !window.confirm(`Revoke ${passkey.deviceName || 'this passkey'}?`)) return;
    setPasskeyBusy(true);
    try {
      await twoFactorAPI.revokePasskey(passkey.id);
      await fetchPasskeys();
      toast.success('Passkey revoked.');
    } catch (err) {
      toast.error(err.response?.data?.error || 'Could not revoke this passkey.');
    } finally {
      setPasskeyBusy(false);
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
    <div className="min-h-screen bg-gray-950 flex flex-col">
      <Navbar />
      <div className="flex-1 flex items-center justify-center">
        <div className="animate-spin h-8 w-8 border-2 border-orange-500 border-t-transparent rounded-full" />
      </div>
      <Footer />
    </div>
  );

  return (
    <div className="min-h-screen bg-gray-950 text-white flex flex-col">
      <Navbar />
      <main className="flex-1 py-10 px-4">
      <div className="max-w-lg mx-auto">
        <Link to="/settings" className="inline-flex items-center gap-2 text-gray-400 hover:text-white mb-8 transition text-sm">
          <ArrowLeft size={16} /> {t('twoFactor.backToSettings')}
        </Link>

        <div className="bg-gray-900 border border-gray-800 rounded-2xl p-8">
          <div className="flex items-center gap-3 mb-6">
            <Shield className="text-orange-500" size={28} />
            <div>
              <h1 className="text-2xl font-bold text-white">{t('twoFactor.title')}</h1>
              <p className="text-gray-400 text-sm">{t('twoFactor.subtitle')}</p>
            </div>
          </div>

          {step === 'status' && (
            <div className="space-y-6">
              <div className="flex items-center gap-3 p-4 bg-gray-800/50 rounded-xl">
                <ShieldOff className="text-gray-500" size={24} />
                <div>
                  <p className="text-white font-medium">{t('twoFactor.notEnabled')}</p>
                  <p className="text-gray-400 text-sm">{t('twoFactor.notEnabledSub')}</p>
                </div>
              </div>
              <button onClick={handleSetup} className="w-full py-3 px-4 bg-orange-500 hover:bg-orange-600 text-white font-semibold rounded-xl transition">
                {t('twoFactor.enableBtn')}
              </button>
            </div>
          )}

          {step === 'setup' && setupData && (
            <div className="space-y-6">
              <div className="text-center">
                <p className="text-gray-300 mb-4">{t('twoFactor.scanQr')}</p>
                <div className="inline-block p-4 bg-white rounded-xl">
                  <img src={setupData.qrCode} alt="2FA QR Code" className="w-48 h-48" />
                </div>
              </div>
              <div className="p-4 bg-gray-800/50 rounded-xl">
                <p className="text-gray-400 text-xs mb-1">{t('twoFactor.manualKey')}</p>
                <p className="text-orange-400 font-mono text-sm break-all">{setupData.secret}</p>
              </div>
              {backupCodes && (
                <div className="p-4 bg-yellow-900/20 border border-yellow-800/30 rounded-xl">
                  <p className="text-yellow-400 text-sm font-semibold mb-2">{t('twoFactor.saveBackupCodes')}</p>
                  <p className="text-gray-400 text-xs mb-3">{t('twoFactor.backupCodesSub')}</p>
                  <div className="grid grid-cols-2 gap-2 mb-3">
                    {backupCodes.map((code, i) => (
                      <code key={i} className="text-gray-300 bg-gray-800 px-3 py-1.5 rounded text-sm font-mono text-center">{code}</code>
                    ))}
                  </div>
                  <button onClick={copyBackupCodes} className="flex items-center gap-2 text-sm text-orange-400 hover:text-orange-300">
                    <Copy size={14} /> {t('twoFactor.copyAllCodes')}
                  </button>
                </div>
              )}
              <form onSubmit={handleVerify} className="space-y-4">
                <div>
                  <label className="block text-sm text-gray-300 mb-1.5">{t('twoFactor.codeLabel')}</label>
                  <input
                    type="text"
                    value={verifyCode}
                    onChange={(e) => setVerifyCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                    className="w-full px-4 py-3 bg-gray-800 border border-gray-700 rounded-xl text-white text-center text-2xl tracking-widest font-mono focus:outline-none focus:ring-2 focus:ring-orange-500"
                    placeholder="000000"
                    maxLength={6}
                    autoFocus
                  />
                </div>
                <button type="submit" disabled={verifyCode.length !== 6} className="w-full py-3 bg-orange-500 hover:bg-orange-600 disabled:opacity-50 text-white font-semibold rounded-xl transition">
                  {t('twoFactor.verifyEnableBtn')}
                </button>
              </form>
            </div>
          )}

          {step === 'enabled' && (
            <div className="space-y-6">
              {adminSetup && (
                <Link to="/admin/dashboard" className="block text-center rounded-xl bg-orange-500 px-4 py-3 font-semibold text-white">
                  {t('nav.dashboard')}
                </Link>
              )}
              <div className="flex items-center gap-3 p-4 bg-green-900/20 border border-green-800/30 rounded-xl">
                <ShieldCheck className="text-green-400" size={24} />
                <div>
                  <p className="text-white font-medium">{t('twoFactor.isEnabled')}</p>
                  <p className="text-gray-400 text-sm">{t('twoFactor.isEnabledSub')}</p>
                </div>
              </div>
              <div className="space-y-3">
                <h3 className="text-white font-medium">{t('twoFactor.manage')}</h3>
                <form onSubmit={handleDisable} className="space-y-3">
                  <input
                    type="text"
                    value={disableCode}
                    onChange={(e) => setDisableCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                    className="w-full px-4 py-3 bg-gray-800 border border-gray-700 rounded-xl text-white text-center font-mono focus:outline-none focus:ring-2 focus:ring-orange-500"
                    placeholder={t('twoFactor.manageCodePh')}
                    maxLength={6}
                  />
                  <div className="flex gap-3">
                    <button type="submit" disabled={disableCode.length !== 6} className="flex-1 py-2.5 bg-red-600 hover:bg-red-700 disabled:opacity-50 text-white font-medium rounded-xl transition text-sm">
                      {t('twoFactor.disableBtn')}
                    </button>
                    <button type="button" onClick={handleRegenBackup} disabled={disableCode.length !== 6} className="flex-1 py-2.5 bg-gray-700 hover:bg-gray-600 disabled:opacity-50 text-white font-medium rounded-xl transition text-sm flex items-center justify-center gap-2">
                      <RefreshCw size={14} /> {t('twoFactor.newBackupCodesBtn')}
                    </button>
                  </div>
                </form>
              </div>
              {adminSetup && (
                <div className="space-y-3 border-t border-gray-800 pt-5">
                  <div>
                    <h3 className="text-white font-medium">Passkeys</h3>
                    <p className="text-gray-400 text-sm">Use Touch ID, Face ID, Windows Hello, or a security key after password sign-in. TOTP remains your fallback.</p>
                  </div>
                  {passkeys.length > 0 && (
                    <div className="space-y-2">
                      {passkeys.map((passkey) => (
                        <div key={passkey.id} className="flex items-center justify-between gap-3 rounded-lg bg-gray-800/60 px-3 py-2">
                          <div className="min-w-0">
                            <p className="truncate text-sm text-white">{passkey.deviceName}</p>
                            <p className="text-xs text-gray-500">Added {passkey.createdAt ? new Date(passkey.createdAt).toLocaleDateString() : 'recently'}</p>
                          </div>
                          <button type="button" onClick={() => handleRevokePasskey(passkey)} disabled={passkeyBusy} className="shrink-0 text-xs text-red-400 hover:text-red-300 disabled:opacity-50">Revoke</button>
                        </div>
                      ))}
                    </div>
                  )}
                  <button type="button" onClick={handleRegisterPasskey} disabled={passkeyBusy} className="w-full rounded-xl border border-orange-500/60 px-4 py-2.5 text-sm font-semibold text-orange-400 hover:bg-orange-500/10 disabled:opacity-50">
                    {passkeyBusy ? 'Working...' : 'Register a passkey'}
                  </button>
                </div>
              )}
            </div>
          )}

          {step === 'backupCodes' && backupCodes && (
            <div className="space-y-6">
              <div className="p-4 bg-yellow-900/20 border border-yellow-800/30 rounded-xl">
                <p className="text-yellow-400 text-sm font-semibold mb-2">{t('twoFactor.newBackupTitle')}</p>
                <p className="text-gray-400 text-xs mb-3">{t('twoFactor.newBackupSub')}</p>
                <div className="grid grid-cols-2 gap-2 mb-3">
                  {backupCodes.map((code, i) => (
                    <code key={i} className="text-gray-300 bg-gray-800 px-3 py-1.5 rounded text-sm font-mono text-center">{code}</code>
                  ))}
                </div>
                <button onClick={copyBackupCodes} className="flex items-center gap-2 text-sm text-orange-400 hover:text-orange-300">
                  <Copy size={14} /> {t('twoFactor.copyAllCodes')}
                </button>
              </div>
              <button onClick={() => setStep('enabled')} className="w-full py-3 bg-gray-700 hover:bg-gray-600 text-white font-medium rounded-xl transition">
                {t('twoFactor.doneBtn')}
              </button>
            </div>
          )}
        </div>
      </div>
      </main>
      <Footer />
    </div>
  );
}
