import React, { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  canContinueAsGuest,
  isValidGuestEmail,
  writeGuestContact,
} from './messengerDockState.js';
import './MessengerDock.css';

/**
 * In-dock guest contact gate. Continues via the same sessionStorage keys
 * ChatPanel already restores from, then unlocks the thread/composer.
 */
export default function MessengerGuestGate({
  displayName = '',
  helperId,
  businessId,
  onContinue,
  initialName = '',
  initialEmail = '',
  entityKind = 'helper',
}) {
  const { t } = useTranslation();
  const [name, setName] = useState(initialName);
  const [email, setEmail] = useState(initialEmail);
  const [touched, setTouched] = useState(false);

  const ready = useMemo(
    () => canContinueAsGuest({ name, email }),
    [name, email],
  );

  const emailError =
    touched && email.trim() && !isValidGuestEmail(email)
      ? t('helperProfile.messenger.guestInvalidEmail')
      : null;

  const handleContinue = (event) => {
    event.preventDefault();
    setTouched(true);
    if (!ready) return;
    const payload = { name: name.trim(), email: email.trim() };
    writeGuestContact(helperId, businessId, payload);
    onContinue?.(payload);
  };

  const entityLabel =
    entityKind === 'business'
      ? t('helperProfile.messenger.entityBusiness')
      : t('helperProfile.messenger.entityHelper');

  return (
    <form className="messenger-guest-gate" onSubmit={handleContinue} noValidate>
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
          <p className="messenger-guest-gate__error" role="alert">
            {emailError}
          </p>
        ) : null}
      </div>

      <div className="messenger-guest-gate__actions">
        <button
          type="submit"
          className="messenger-guest-gate__primary"
          disabled={!ready}
        >
          {t('helperProfile.messenger.continueAsGuest')}
        </button>
        <Link to="/login" className="messenger-guest-gate__secondary">
          {t('helperProfile.messenger.signInInstead')}
        </Link>
      </div>
    </form>
  );
}
