import React, { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import api from '../../../api/axios';
import {
  canContinueAsGuest,
  isValidGuestEmail,
  writeGuestContact,
  writeGuestVerifiedSession,
} from './messengerDockState.js';
import './MessengerDock.css';

/**
 * In-dock guest gate with email OTP verification (parity with support guest rigor).
 * Steps: contact (name+email) → otp → onVerified(session).
 */
export default function MessengerGuestGate({
  displayName = '',
  helperId,
  businessId,
  onContinue,
  onVerified,
  initialName = '',
  initialEmail = '',
  entityKind = 'helper',
}) {
  const { t } = useTranslation();
  const [step, setStep] = useState('contact'); // contact | otp
  const [name, setName] = useState(initialName);
  const [email, setEmail] = useState(initialEmail);
  const [code, setCode] = useState('');
  const [accessCode, setAccessCode] = useState('');
  const [sessionId, setSessionId] = useState(null);
  const [emailMasked, setEmailMasked] = useState('');
  const [accessCodeRequired, setAccessCodeRequired] = useState(false);
  const [historyExpired, setHistoryExpired] = useState(false);
  const [touched, setTouched] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const ready = useMemo(
    () => canContinueAsGuest({ name, email }),
    [name, email],
  );

  const emailError =
    touched && email.trim() && !isValidGuestEmail(email)
      ? t('helperProfile.messenger.guestInvalidEmail')
      : null;

  const entityLabel =
    entityKind === 'business'
      ? t('helperProfile.messenger.entityBusiness')
      : t('helperProfile.messenger.entityHelper');

  const startVerification = async (event) => {
    event.preventDefault();
    setTouched(true);
    setError('');
    if (!ready || busy) return;
    setBusy(true);
    try {
      const payload = { name: name.trim(), email: email.trim() };
      writeGuestContact(helperId, businessId, payload);
      const { data } = await api.post('/chat/sessions/guest/verify/start', {
        helperId,
        ...(businessId ? { businessId } : {}),
        guestName: payload.name,
        guestEmail: payload.email,
      });
      setSessionId(data.sessionId);
      setEmailMasked(data.emailMasked || payload.email);
      setAccessCodeRequired(Boolean(data.accessCodeRequired));
      setHistoryExpired(Boolean(data.previousHistoryExpired));
      setStep('otp');
      onContinue?.(payload);
    } catch (err) {
      setError(
        err?.response?.data?.error
          || t('helperProfile.messenger.guestVerifyStartError'),
      );
    } finally {
      setBusy(false);
    }
  };

  const submitCode = async (event) => {
    event.preventDefault();
    setError('');
    const otp = code.trim();
    if (!/^\d{6}$/.test(otp) || !sessionId || busy) {
      setError(t('helperProfile.messenger.guestOtpInvalid'));
      return;
    }
    setBusy(true);
    try {
      const { data } = await api.post('/chat/sessions/guest/verify', {
        sessionId,
        guestEmail: email.trim(),
        code: otp,
        ...(accessCode.trim() ? { accessCode: accessCode.trim() } : {}),
      });
      const verified = {
        guestToken: data.guestToken,
        sessionId: data.sessionId || sessionId,
        email: email.trim(),
        name: name.trim(),
        helperId: data.helperId || helperId,
        businessId: data.businessId ?? businessId ?? null,
        providerOnline: Boolean(data.providerOnline),
        expiresInSeconds: data.expiresInSeconds || 24 * 3600,
        historyAccessExpiresAt: data.historyAccessExpiresAt || null,
      };
      writeGuestVerifiedSession(helperId, businessId, verified);
      onVerified?.(verified);
    } catch (err) {
      const code = err?.response?.data?.code || '';
      const expired = /expir|otp_expired|code_expired|invalid_or_expired/i.test(
        `${code} ${err?.response?.data?.error || ''}`,
      );
      setError(
        expired
          ? t('helperProfile.messenger.guestOtpExpired')
          : (err?.response?.data?.code === 'invalid_access_code'
            ? t('helperProfile.messenger.guestAccessCodeInvalid')
            : (err?.response?.data?.error || t('helperProfile.messenger.guestOtpInvalid'))),
      );
    } finally {
      setBusy(false);
    }
  };

  const resendCode = async () => {
    if (!sessionId || busy) return;
    setBusy(true);
    setError('');
    try {
      await api.post('/chat/sessions/guest/verify/resend', {
        sessionId,
        guestEmail: email.trim(),
      });
    } catch (err) {
      setError(
        err?.response?.data?.error
          || t('helperProfile.messenger.guestOtpResendError'),
      );
    } finally {
      setBusy(false);
    }
  };

  if (step === 'otp') {
    return (
      <form className="messenger-guest-gate" onSubmit={submitCode} noValidate>
        <p className="messenger-guest-gate__eyebrow">
          {t('helperProfile.messenger.guestOtpEyebrow')}
        </p>
        <h3 className="messenger-guest-gate__title">
          {t('helperProfile.messenger.guestOtpTitle')}
        </h3>
        <p className="messenger-guest-gate__body">
          {t('helperProfile.messenger.guestOtpBody', {
            email: emailMasked || email,
            name: displayName,
          })}
        </p>
        {historyExpired ? (
          <p className="messenger-guest-gate__notice" role="status">
            {t('helperProfile.messenger.guestHistoryExpired')}{' '}
            <Link to="/join">{t('helperProfile.messenger.createAccountToRecover')}</Link>
          </p>
        ) : null}

        <div className="messenger-guest-gate__fields">
          <label>
            <span className="messenger-guest-gate__label">
              {t('helperProfile.messenger.guestOtpLabel')}
            </span>
            <input
              type="text"
              inputMode="numeric"
              pattern="[0-9]*"
              maxLength={6}
              className="messenger-guest-gate__input"
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
              placeholder={t('helperProfile.messenger.guestOtpPlaceholder')}
              autoComplete="one-time-code"
              autoFocus
              required
            />
          </label>
          <label>
            <span className="messenger-guest-gate__label">
              {t('helperProfile.messenger.guestAccessCodeLabel')}
              {!accessCodeRequired ? ` (${t('common.optional') || 'optional'})` : ''}
            </span>
            <input
              type="text"
              inputMode="text"
              maxLength={32}
              className="messenger-guest-gate__input"
              value={accessCode}
              onChange={(e) => setAccessCode(e.target.value.replace(/[^a-z0-9]/gi, '').slice(0, 32).toUpperCase())}
              placeholder={t('helperProfile.messenger.guestAccessCodePlaceholder')}
              autoComplete="one-time-code"
              required={accessCodeRequired}
            />
            <small className="messenger-guest-gate__help">{t('helperProfile.messenger.guestAccessCodeHelp')}</small>
          </label>
          {error ? (
            <p className="messenger-guest-gate__error" role="alert">{error}</p>
          ) : null}
        </div>

        <div className="messenger-guest-gate__actions">
          <button
            type="submit"
            className="messenger-guest-gate__primary"
            disabled={busy || code.trim().length !== 6 || (accessCodeRequired && accessCode.trim().length < 8)}
          >
            {busy
              ? t('helperProfile.messenger.guestOtpVerifying')
              : t('helperProfile.messenger.guestOtpSubmit')}
          </button>
          <button
            type="button"
            className="messenger-guest-gate__secondary"
            onClick={resendCode}
            disabled={busy}
          >
            {t('helperProfile.messenger.guestOtpResend')}
          </button>
          <button
            type="button"
            className="messenger-guest-gate__secondary"
            onClick={() => { setStep('contact'); setCode(''); setError(''); }}
            disabled={busy}
          >
            {t('helperProfile.messenger.guestOtpBack')}
          </button>
        </div>
      </form>
    );
  }

  return (
    <form className="messenger-guest-gate" onSubmit={startVerification} noValidate>
      <p className="messenger-guest-gate__eyebrow">
        {t('helperProfile.messenger.guestEyebrow')}
      </p>
      <h3 className="messenger-guest-gate__title">
        {t('helperProfile.messenger.guestTitle', { name: displayName })}
      </h3>
      <p className="messenger-guest-gate__body">
        {t('helperProfile.messenger.guestBody', {
          name: displayName,
          entity: entityLabel,
        })}
      </p>

      <div className="messenger-guest-gate__fields">
        <label>
          <span className="messenger-guest-gate__label">
            {t('helperProfile.messenger.guestNameLabel')}
          </span>
          <input
            type="text"
            className="messenger-guest-gate__input"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={t('helperProfile.messenger.guestNamePlaceholder')}
            autoComplete="name"
            autoFocus
            required
          />
        </label>
        <label>
          <span className="messenger-guest-gate__label">
            {t('helperProfile.messenger.guestEmailLabel')}
          </span>
          <input
            type="email"
            className="messenger-guest-gate__input"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            onBlur={() => setTouched(true)}
            placeholder={t('helperProfile.messenger.guestEmailPlaceholder')}
            autoComplete="email"
            required
          />
        </label>
        {emailError ? (
          <p className="messenger-guest-gate__error" role="alert">{emailError}</p>
        ) : null}
        {error ? (
          <p className="messenger-guest-gate__error" role="alert">{error}</p>
        ) : null}
      </div>

      <div className="messenger-guest-gate__actions">
        <button
          type="submit"
          className="messenger-guest-gate__primary"
          disabled={!ready || busy}
        >
          {busy
            ? t('helperProfile.messenger.guestVerifySending')
            : t('helperProfile.messenger.continueAsGuest')}
        </button>
        <Link to="/login" className="messenger-guest-gate__secondary">
          {t('helperProfile.messenger.signInInstead')}
        </Link>
      </div>
    </form>
  );
}
