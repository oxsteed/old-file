import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { startRegistration } from '@simplewebauthn/browser';
import toast from 'react-hot-toast';
import { twoFactorAPI, userPasskeyAPI } from '../../api/twoFactor';

export default function PasskeysSection({ adminSetup = false, className = '' }) {
  const { t } = useTranslation();
  const [passkeys, setPasskeys] = useState([]);
  const [passkeyBusy, setPasskeyBusy] = useState(false);
  const [registerOpen, setRegisterOpen] = useState(false);
  const [deviceName, setDeviceName] = useState('');
  const [registerPassword, setRegisterPassword] = useState('');
  const [registerErrors, setRegisterErrors] = useState({});
  const [revokeTarget, setRevokeTarget] = useState(null);

  const passkeyAPI = adminSetup ? twoFactorAPI : userPasskeyAPI;
  const passkeySupported = typeof window !== 'undefined' && Boolean(window.PublicKeyCredential);

  useEffect(() => {
    fetchPasskeys();
  }, [adminSetup]);

  const fetchPasskeys = async () => {
    try {
      const { data } = await passkeyAPI.listPasskeys();
      setPasskeys(Array.isArray(data?.passkeys) ? data.passkeys : []);
    } catch {
      setPasskeys([]);
    }
  };

  const resetRegisterForm = () => {
    setDeviceName('');
    setRegisterPassword('');
    setRegisterErrors({});
  };

  const openRegisterModal = () => {
    if (!passkeySupported || passkeyBusy) return;
    resetRegisterForm();
    setRegisterOpen(true);
  };

  const closeRegisterModal = () => {
    if (passkeyBusy) return;
    setRegisterOpen(false);
    resetRegisterForm();
  };

  const validateRegisterForm = () => {
    const next = {};
    if (!deviceName.trim()) next.deviceName = t('twoFactor.passkeyDeviceNameRequired');
    if (!registerPassword) next.password = t('twoFactor.passkeyPasswordRequired');
    setRegisterErrors(next);
    return Object.keys(next).length === 0;
  };

  const submitRegisterPasskey = async (e) => {
    e.preventDefault();
    if (!validateRegisterForm()) return;
    setPasskeyBusy(true);
    try {
      const trimmedName = deviceName.trim();
      const { data } = await passkeyAPI.registrationOptions();
      const response = await startRegistration({ optionsJSON: data.options });
      await passkeyAPI.verifyRegistration(response, trimmedName, registerPassword);
      await fetchPasskeys();
      setRegisterOpen(false);
      resetRegisterForm();
      toast.success(adminSetup ? t('twoFactor.passkeyRegisteredAdmin') : t('twoFactor.passkeyRegistered'));
    } catch (err) {
      if (err?.name !== 'NotAllowedError') {
        toast.error(err.response?.data?.error || t('twoFactor.passkeyRegisterFailed'));
      }
    } finally {
      setPasskeyBusy(false);
    }
  };

  const confirmRevokePasskey = async () => {
    const passkey = revokeTarget;
    if (!passkey?.id || passkeyBusy) return;
    setPasskeyBusy(true);
    try {
      await passkeyAPI.revokePasskey(passkey.id);
      await fetchPasskeys();
      setRevokeTarget(null);
      toast.success(t('twoFactor.passkeyRevoked'));
    } catch (err) {
      toast.error(err.response?.data?.error || t('twoFactor.passkeyRevokeFailed'));
    } finally {
      setPasskeyBusy(false);
    }
  };

  const passkeyDateLabel = (passkey) => (
    passkey.createdAt
      ? t('twoFactor.passkeyAddedOn', { date: new Date(passkey.createdAt).toLocaleDateString() })
      : t('twoFactor.passkeyAddedRecently')
  );

  return (
    <div className={className}>
      <div>
        <h3 className="font-medium text-content">{t('twoFactor.passkeysTitle')}</h3>
        <p className="text-sm text-muted">
          {adminSetup ? t('twoFactor.passkeysDescAdmin') : t('twoFactor.passkeysDescUser')}
        </p>
      </div>

      {!passkeySupported && (
        <p
          className="rounded-xl border px-4 py-3 text-sm"
          style={{
            borderColor: 'color-mix(in srgb, var(--color-warning) 35%, transparent)',
            background: 'var(--color-warning-bg)',
            color: 'var(--color-warning)',
          }}
          role="status"
        >
          {t('twoFactor.passkeyUnsupportedInline')}
        </p>
      )}

      {passkeys.length > 0 && (
        <div className="space-y-2">
          {passkeys.map((passkey) => (
            <div
              key={passkey.id}
              className="flex items-center justify-between gap-3 rounded-lg bg-surface-2/80 px-3 py-2"
            >
              <div className="min-w-0">
                <p className="truncate text-sm text-content">{passkey.deviceName}</p>
                <p className="text-xs text-muted">{passkeyDateLabel(passkey)}</p>
              </div>
              <button
                type="button"
                onClick={() => setRevokeTarget(passkey)}
                disabled={passkeyBusy}
                className="shrink-0 text-xs hover:opacity-90 disabled:opacity-50"
                style={{ color: 'var(--color-error)' }}
              >
                {t('twoFactor.passkeyRevokeBtn')}
              </button>
            </div>
          ))}
        </div>
      )}

      <button
        type="button"
        onClick={openRegisterModal}
        disabled={passkeyBusy || !passkeySupported}
        className="w-full rounded-xl border border-primary/60 px-4 py-2.5 text-sm font-semibold text-primary hover:bg-primary-bg disabled:opacity-50"
      >
        {passkeyBusy && !registerOpen && !revokeTarget
          ? t('twoFactor.passkeyWorking')
          : t('twoFactor.registerPasskey')}
      </button>

      {registerOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
          role="presentation"
          onClick={closeRegisterModal}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="passkey-register-title"
            className="w-full max-w-md rounded-2xl border border-border bg-surface p-6 text-content shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 id="passkey-register-title" className="text-lg font-semibold text-content">
              {t('twoFactor.passkeyRegisterTitle')}
            </h2>
            <form onSubmit={submitRegisterPasskey} className="mt-4 space-y-4">
              <div>
                <label htmlFor="passkey-device-name" className="mb-1.5 block text-sm text-muted">
                  {t('twoFactor.passkeyDeviceNameLabel')}
                </label>
                <input
                  id="passkey-device-name"
                  type="text"
                  value={deviceName}
                  onChange={(e) => {
                    setDeviceName(e.target.value);
                    if (registerErrors.deviceName) setRegisterErrors((prev) => ({ ...prev, deviceName: undefined }));
                  }}
                  className="w-full rounded-xl border border-border bg-surface-2 px-4 py-3 text-content focus:outline-none focus:ring-2 focus:ring-primary"
                  placeholder={t('twoFactor.passkeyDeviceNamePlaceholder')}
                  autoFocus
                  disabled={passkeyBusy}
                />
                {registerErrors.deviceName && (
                  <p className="mt-1 text-xs" style={{ color: 'var(--color-error)' }} role="alert">{registerErrors.deviceName}</p>
                )}
              </div>
              <div>
                <label htmlFor="passkey-register-password" className="mb-1.5 block text-sm text-muted">
                  {t('twoFactor.passkeyPasswordLabel')}
                </label>
                <input
                  id="passkey-register-password"
                  type="password"
                  value={registerPassword}
                  onChange={(e) => {
                    setRegisterPassword(e.target.value);
                    if (registerErrors.password) setRegisterErrors((prev) => ({ ...prev, password: undefined }));
                  }}
                  className="w-full rounded-xl border border-border bg-surface-2 px-4 py-3 text-content focus:outline-none focus:ring-2 focus:ring-primary"
                  autoComplete="current-password"
                  disabled={passkeyBusy}
                />
                {registerErrors.password && (
                  <p className="mt-1 text-xs" style={{ color: 'var(--color-error)' }} role="alert">{registerErrors.password}</p>
                )}
              </div>
              <div className="flex gap-3 pt-1">
                <button
                  type="button"
                  onClick={closeRegisterModal}
                  disabled={passkeyBusy}
                  className="flex-1 rounded-xl border border-border px-4 py-2.5 text-sm font-medium text-content hover:bg-surface-2 disabled:opacity-50"
                >
                  {t('twoFactor.passkeyRegisterCancel')}
                </button>
                <button
                  type="submit"
                  disabled={passkeyBusy}
                  className="flex-1 rounded-xl bg-action px-4 py-2.5 text-sm font-semibold text-on-action hover:bg-action-hover disabled:opacity-50"
                >
                  {passkeyBusy ? t('twoFactor.passkeyWorking') : t('twoFactor.passkeyRegisterSubmit')}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {revokeTarget && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
          role="presentation"
          onClick={() => !passkeyBusy && setRevokeTarget(null)}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="passkey-revoke-title"
            className="w-full max-w-md rounded-2xl border border-border bg-surface p-6 text-content shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 id="passkey-revoke-title" className="text-lg font-semibold text-content">
              {t('twoFactor.passkeyRevokeTitle')}
            </h2>
            <p className="mt-2 text-sm text-muted">
              {t('twoFactor.passkeyRevokeConfirm', {
                name: revokeTarget.deviceName || t('twoFactor.passkeyThisDevice'),
              })}
            </p>
            <div className="mt-5 flex gap-3">
              <button
                type="button"
                onClick={() => setRevokeTarget(null)}
                disabled={passkeyBusy}
                className="flex-1 rounded-xl border border-border px-4 py-2.5 text-sm font-medium text-content hover:bg-surface-2 disabled:opacity-50"
              >
                {t('twoFactor.passkeyRevokeCancel')}
              </button>
              <button
                type="button"
                onClick={confirmRevokePasskey}
                disabled={passkeyBusy}
                className="flex-1 rounded-xl px-4 py-2.5 text-sm font-semibold text-on-solid hover:opacity-90 disabled:opacity-50"
                style={{ background: 'var(--color-error)' }}
              >
                {passkeyBusy ? t('twoFactor.passkeyWorking') : t('twoFactor.passkeyRevokeConfirmBtn')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
