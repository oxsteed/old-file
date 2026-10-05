import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { issueCreditCardSecurityChallenge } from '../../api/oxsteedCredit';
import './CardSecurity.css';

export function cardSecurityError(error, t) {
  const code = error?.response?.data?.code || error?.response?.data?.error?.code;
  const key = {
    credit_card_security_locked: 'locked', credit_card_security_cooldown: 'cooldown',
    credit_card_security_password_invalid: 'passwordInvalid', credit_card_security_mfa_required: 'mfaInvalid',
    credit_card_security_code_invalid: 'codeInvalid', credit_card_security_challenge_invalid: 'challengeInvalid',
    credit_card_security_action_blocked: 'blocked', credit_card_security_actor_invalid: 'actorInvalid',
    credit_card_security_delivery_unavailable: 'deliveryFailed',
  }[code] || 'failed';
  return t(`cards.security.${key}`);
}

// Mounted once per action: neither credentials nor verification grants are
// persisted. The stable request key also survives a response-loss retry.
export default function CardSecurityDialog({ operation, onComplete, onClose }) {
  const { t } = useTranslation('credit');
  const dialog = useRef(null);
  const [password, setPassword] = useState('');
  const [mfaCode, setMfaCode] = useState('');
  const [code, setCode] = useState('');
  const [challenge, setChallenge] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    const prior = document.activeElement;
    dialog.current?.showModal();
    return () => { dialog.current?.close(); prior?.focus?.(); };
  }, []);
  useEffect(() => {
    if (challenge) dialog.current?.querySelector('input')?.focus();
  }, [challenge]);
  const submit = async event => {
    event.preventDefault();
    if (busy) return;
    setBusy(true); setError('');
    try {
      if (!challenge) {
        const result = await issueCreditCardSecurityChallenge(operation.card.id, {
          action: operation.action, ...operation.payload, password, mfaCode,
        });
        setPassword(''); setMfaCode(''); setChallenge(result.challenge);
      } else {
        await onComplete(operation, { stepupChallengeId: challenge.id, stepupCode: code });
        onClose();
      }
    } catch (failure) { setError(cardSecurityError(failure, t)); }
    finally { setBusy(false); }
  };
  return <dialog ref={dialog} className="card-security-dialog" aria-labelledby="card-security-title"
    onCancel={event => { event.preventDefault(); if (!busy) onClose(); }}>
    <h2 id="card-security-title">{t('cards.security.title')}</h2>
    <p>{t('cards.security.description')}</p>
    <form onSubmit={submit}>
      {!challenge ? <>
        <label>{t('cards.security.password')}<input type="password" autoComplete="current-password"
          required maxLength={1024} value={password} onChange={event => setPassword(event.target.value)} disabled={busy} /></label>
        <label>{t('cards.security.mfa')}<input inputMode="numeric" autoComplete="one-time-code"
          pattern="[0-9]{6}" maxLength={6} value={mfaCode} onChange={event => setMfaCode(event.target.value)} disabled={busy} /></label>
      </> : <>
        <p role="status">{t('cards.security.sent')}</p>
        <label>{t('cards.security.emailCode')}<input inputMode="numeric" autoComplete="one-time-code"
          required pattern="[0-9]{6}" maxLength={6} value={code} onChange={event => setCode(event.target.value)} disabled={busy} /></label>
      </>}
      {error && <p role="alert">{error}</p>}
      <div className="card-security-actions">
        <button type="submit" disabled={busy}>{t(busy ? 'cards.security.working' : challenge ? 'cards.security.verify' : 'cards.security.send')}</button>
        {challenge && <button type="button" disabled={busy} onClick={() => { setChallenge(null); setCode(''); setError(''); }}>{t('cards.security.restart')}</button>}
        <button type="button" disabled={busy} onClick={onClose}>{t('cards.security.cancel')}</button>
      </div>
    </form>
  </dialog>;
}
