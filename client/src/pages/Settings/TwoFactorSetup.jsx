import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { twoFactorAPI } from '../../api/twoFactor';
import toast from 'react-hot-toast';
import { Shield, ShieldCheck, ShieldOff, ArrowLeft, Copy, RefreshCw } from 'lucide-react';

export default function TwoFactorSetup() {
  const [status, setStatus] = useState(null);
  const [loading, setLoading] = useState(true);
  const [setupData, setSetupData] = useState(null);
  const [verifyCode, setVerifyCode] = useState('');
  const [disableCode, setDisableCode] = useState('');
  const [backupCodes, setBackupCodes] = useState(null);
  const [step, setStep] = useState('status');

  useEffect(() => { fetchStatus(); }, []);

  const fetchStatus = async () => {
    try {
      const { data } = await twoFactorAPI.getStatus();
      setStatus(data);
      setStep(data.enabled ? 'enabled' : 'status');
    } catch (err) {
      toast.error('Failed to load 2FA status');
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
      toast.error(err.response?.data?.error || 'Setup failed');
    }
  };

  const handleVerify = async (e) => {
    e.preventDefault();
    try {
      await twoFactorAPI.verifySetup(verifyCode);
      toast.success('2FA enabled successfully!');
      setStep('enabled');
      fetchStatus();
    } catch (err) {
      toast.error(err.response?.data?.error || 'Invalid code');
    }
  };

  const handleDisable = async (e) => {
    e.preventDefault();
    try {
      await twoFactorAPI.disable(disableCode);
      toast.success('2FA disabled');
      setStatus({ enabled: false });
      setStep('status');
      setDisableCode('');
    } catch (err) {
      toast.error(err.response?.data?.error || 'Invalid code');
    }
  };

  const handleRegenBackup = async (e) => {
    e.preventDefault();
    try {
      const { data } = await twoFactorAPI.regenerateBackupCodes(disableCode);
      setBackupCodes(data.backupCodes);
      setStep('backupCodes');
      toast.success('New backup codes generated');
    } catch (err) {
      toast.error(err.response?.data?.error || 'Failed');
    }
  };

  const copyBackupCodes = () => {
    if (backupCodes) {
      navigator.clipboard.writeText(backupCodes.join('\n'));
      toast.success('Backup codes copied!');
    }
  };

  if (loading) return (
    <div className="min-h-screen bg-gray-950 flex items-center justify-center">
      <div className="animate-spin h-8 w-8 border-2 border-orange-500 border-t-transparent rounded-full" />
    </div>
  );

  return (
    <div className="min-h-screen bg-gray-950 py-12 px-4">
      <div className="max-w-lg mx-auto">
        <Link to="/dashboard" className="inline-flex items-center gap-2 text-gray-400 hover:text-white mb-8 transition">
          <ArrowLeft size={18} /> Back to Dashboard
        </Link>

        <div className="bg-gray-900 border border-gray-800 rounded-2xl p-8">
          <div className="flex items-center gap-3 mb-6">
            <Shield className="text-orange-500" size={28} />
            <div>
              <h1 className="text-2xl font-bold text-white">Two-Factor Authentication</h1>
              <p className="text-gray-400 text-sm">Add an extra layer of security to your account</p>
            </div>
          </div>

          {step === 'status' && (
            <div className="space-y-6">
              <div className="flex items-center gap-3 p-4 bg-gray-800/50 rounded-xl">
                <ShieldOff className="text-gray-500" size={24} />
                <div>
                  <p className="text-white font-medium">2FA is not enabled</p>
                  <p className="text-gray-400 text-sm">Secure your account with an authenticator app</p>
                </div>
              </div>
              <button onClick={handleSetup} className="w-full py-3 px-4 bg-orange-500 hover:bg-orange-600 text-white font-semibold rounded-xl transition">
                Enable Two-Factor Authentication
              </button>
            </div>
          )}

          {step === 'setup' && setupData && (
            <div className="space-y-6">
              <div className="text-center">
                <p className="text-gray-300 mb-4">Scan this QR code with your authenticator app (Google Authenticator, Authy, etc.)</p>
                <div className="inline-block p-4 bg-white rounded-xl">
                  <img src={setupData.qrCode} alt="2FA QR Code" className="w-48 h-48" />
                </div>
              </div>
              <div className="p-4 bg-gray-800/50 rounded-xl">
                <p className="text-gray-400 text-xs mb-1">Manual entry key:</p>
                <p className="text-orange-400 font-mono text-sm break-all">{setupData.secret}</p>
              </div>
              {backupCodes && (
                <div className="p-4 bg-yellow-900/20 border border-yellow-800/30 rounded-xl">
                  <p className="text-yellow-400 text-sm font-semibold mb-2">Save your backup codes!</p>
                  <p className="text-gray-400 text-xs mb-3">Store these in a safe place. Each code can only be used once.</p>
                  <div className="grid grid-cols-2 gap-2 mb-3">
                    {backupCodes.map((code, i) => (
                      <code key={i} className="text-gray-300 bg-gray-800 px-3 py-1.5 rounded text-sm font-mono text-center">{code}</code>
                    ))}
                  </div>
                  <button onClick={copyBackupCodes} className="flex items-center gap-2 text-sm text-orange-400 hover:text-orange-300">
                    <Copy size={14} /> Copy all codes
                  </button>
                </div>
              )}
              <form onSubmit={handleVerify} className="space-y-4">
                <div>
                  <label className="block text-sm text-gray-300 mb-1.5">Enter 6-digit code from your app</label>
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
                  Verify & Enable 2FA
                </button>
              </form>
            </div>
          )}

          {step === 'enabled' && (
            <div className="space-y-6">
              <div className="flex items-center gap-3 p-4 bg-green-900/20 border border-green-800/30 rounded-xl">
                <ShieldCheck className="text-green-400" size={24} />
                <div>
                  <p className="text-white font-medium">2FA is enabled</p>
                  <p className="text-gray-400 text-sm">Your account is protected with TOTP</p>
                </div>
              </div>
              <div className="space-y-3">
                <h3 className="text-white font-medium">Manage 2FA</h3>
                <form onSubmit={handleDisable} className="space-y-3">
                  <input
                    type="text"
                    value={disableCode}
                    onChange={(e) => setDisableCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                    className="w-full px-4 py-3 bg-gray-800 border border-gray-700 rounded-xl text-white text-center font-mono focus:outline-none focus:ring-2 focus:ring-orange-500"
                    placeholder="Enter 6-digit code to manage"
                    maxLength={6}
                  />
                  <div className="flex gap-3">
                    <button type="submit" disabled={disableCode.length !== 6} className="flex-1 py-2.5 bg-red-600 hover:bg-red-700 disabled:opacity-50 text-white font-medium rounded-xl transition text-sm">
                      Disable 2FA
                    </button>
                    <button type="button" onClick={handleRegenBackup} disabled={disableCode.length !== 6} className="flex-1 py-2.5 bg-gray-700 hover:bg-gray-600 disabled:opacity-50 text-white font-medium rounded-xl transition text-sm flex items-center justify-center gap-2">
                      <RefreshCw size={14} /> New Backup Codes
                    </button>
                  </div>
                </form>
              </div>
            </div>
          )}

          {step === 'backupCodes' && backupCodes && (
            <div className="space-y-6">
              <div className="p-4 bg-yellow-900/20 border border-yellow-800/30 rounded-xl">
                <p className="text-yellow-400 text-sm font-semibold mb-2">New Backup Codes</p>
                <p className="text-gray-400 text-xs mb-3">Previous codes are now invalid. Save these securely.</p>
                <div className="grid grid-cols-2 gap-2 mb-3">
                  {backupCodes.map((code, i) => (
                    <code key={i} className="text-gray-300 bg-gray-800 px-3 py-1.5 rounded text-sm font-mono text-center">{code}</code>
                  ))}
                </div>
                <button onClick={copyBackupCodes} className="flex items-center gap-2 text-sm text-orange-400 hover:text-orange-300">
                  <Copy size={14} /> Copy all codes
                </button>
              </div>
              <button onClick={() => setStep('enabled')} className="w-full py-3 bg-gray-700 hover:bg-gray-600 text-white font-medium rounded-xl transition">
                Done
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
