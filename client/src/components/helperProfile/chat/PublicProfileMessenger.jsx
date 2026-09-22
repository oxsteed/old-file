import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import MessengerLauncher from './MessengerLauncher.jsx';
import MessengerDock, { MessengerInviteCard } from './MessengerDock.jsx';
import MessengerGuestGate from './MessengerGuestGate.jsx';
import ChatPanel from './ChatPanel';
import {
  clearGuestVerifiedSession,
  getMessengerPhaseWithVerification,
  readGuestContact,
  readGuestVerifiedSession,
} from './messengerDockState.js';

/**
 * Shared public-profile messenger: one open state drives header CTA,
 * floating launcher, and the desktop/mobile dock.
 */
export default function PublicProfileMessenger({
  open,
  onOpen,
  onClose,
  session,
  helperName,
  helperId,
  businessId = null,
  avatarUrl,
  avatarShape = 'round',
  isGuest = false,
  allowLiveChat = true,
  allowGuestContact = true,
  destination,
  onDestinationChange,
  entityKind = 'helper',
  launcherBottomOffset = undefined,
  showLauncher = true,
  showInviteCard = false,
  subtitle = '',
}) {
  const { t } = useTranslation();
  const [guestContactSaved, setGuestContactSaved] = useState(false);
  const [guestVerified, setGuestVerified] = useState(false);
  const [otpPending, setOtpPending] = useState(false);
  const [hasOpened, setHasOpened] = useState(false);

  useEffect(() => {
    if (open) setHasOpened(true);
  }, [open]);

  useEffect(() => {
    if (!isGuest) {
      setGuestContactSaved(true);
      setGuestVerified(true);
      setOtpPending(false);
      return;
    }
    const saved = readGuestContact(helperId, businessId);
    const verified = readGuestVerifiedSession(helperId, businessId);
    setGuestContactSaved(Boolean(saved));
    setGuestVerified(Boolean(verified));
    setOtpPending(Boolean(saved) && !verified);
  }, [isGuest, helperId, businessId, open]);

  const phase = useMemo(
    () =>
      getMessengerPhaseWithVerification({
        dockOpen: open,
        isAuthenticated: !isGuest,
        guestContactSaved,
        guestVerified,
        allowGuestContact,
        otpPending,
      }),
    [open, isGuest, guestContactSaved, guestVerified, allowGuestContact, otpPending],
  );

  const handleGuestContinue = useCallback(() => {
    setGuestContactSaved(true);
    setOtpPending(true);
  }, []);

  const handleGuestVerified = useCallback(() => {
    setGuestVerified(true);
    setOtpPending(false);
    setGuestContactSaved(true);
  }, []);

  const handleGuestSessionExpired = useCallback(() => {
    clearGuestVerifiedSession(helperId, businessId);
    setGuestVerified(false);
    setOtpPending(true);
    setGuestContactSaved(true);
  }, [helperId, businessId]);

  const disclaimer = (
    <p className="messenger-dock__disclaimer">
      {entityKind === 'business'
        ? t('helperProfile.messenger.disclaimerBusiness')
        : t('helperProfile.messenger.disclaimerHelper')}
    </p>
  );

  const showGate = open && (phase === 'guest_gate' || phase === 'guest_otp');
  const showThread = hasOpened && !showGate;

  return (
    <>
      {showInviteCard ? (
        <MessengerInviteCard displayName={helperName} onOpen={onOpen} />
      ) : null}

      {showLauncher ? (
        <MessengerLauncher
          open={open}
          onOpen={onOpen}
          displayName={helperName}
          avatarUrl={avatarUrl}
          avatarShape={avatarShape}
          bottomOffset={launcherBottomOffset}
        />
      ) : null}

      <MessengerDock
        open={open}
        onClose={onClose}
        displayName={helperName}
        subtitle={subtitle}
        avatarUrl={avatarUrl}
        avatarShape={avatarShape}
        footer={showThread ? disclaimer : null}
      >
        {showGate ? (
          <MessengerGuestGate
            displayName={helperName}
            helperId={helperId}
            businessId={businessId}
            onContinue={handleGuestContinue}
            onVerified={handleGuestVerified}
            entityKind={entityKind}
          />
        ) : null}
        {showThread ? (
          <ChatPanel
            key={isGuest ? `guest-${guestVerified ? 'verified' : guestContactSaved ? 'otp' : 'pending'}` : 'auth'}
            session={session}
            helperName={helperName}
            helperId={helperId}
            businessId={businessId}
            isGuest={isGuest}
            allowLiveChat={allowLiveChat}
            variant="dock"
            onClose={onClose}
            dockOpen={open}
            className="chat-panel--dock h-full overflow-hidden flex flex-col"
            destination={destination}
            onDestinationChange={onDestinationChange}
            onGuestSessionExpired={handleGuestSessionExpired}
          />
        ) : null}
      </MessengerDock>
    </>
  );
}

export { MessengerInviteCard };
