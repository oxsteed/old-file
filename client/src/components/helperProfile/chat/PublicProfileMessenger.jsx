import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import MessengerLauncher from './MessengerLauncher.jsx';
import MessengerDock, { MessengerInviteCard } from './MessengerDock.jsx';
import MessengerGuestGate from './MessengerGuestGate.jsx';
import ChatPanel from './ChatPanel';
import {
  getMessengerPhase,
  readGuestContact,
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
  businessId,
  avatarUrl,
  avatarShape = 'round',
  isGuest = false,
  allowLiveChat = true,
  allowGuestContact = true,
  destination,
  onDestinationChange,
  entityKind = 'helper',
  launcherBottomOffset,
  showLauncher = true,
  showInviteCard = false,
  subtitle,
}) {
  const { t } = useTranslation();
  const [guestContactSaved, setGuestContactSaved] = useState(false);
  const [hasOpened, setHasOpened] = useState(false);

  useEffect(() => {
    if (open) setHasOpened(true);
  }, [open]);

  useEffect(() => {
    if (!isGuest) {
      setGuestContactSaved(true);
      return;
    }
    const saved = readGuestContact(helperId, businessId);
    setGuestContactSaved(Boolean(saved));
  }, [isGuest, helperId, businessId, open]);

  const phase = useMemo(
    () =>
      getMessengerPhase({
        dockOpen: open,
        isAuthenticated: !isGuest,
        guestContactSaved,
        allowGuestContact,
      }),
    [open, isGuest, guestContactSaved, allowGuestContact],
  );

  const handleGuestContinue = useCallback(() => {
    setGuestContactSaved(true);
  }, []);

  const disclaimer = (
    <p className="messenger-dock__disclaimer">
      {entityKind === 'business'
        ? t('helperProfile.messenger.disclaimerBusiness')
        : t('helperProfile.messenger.disclaimerHelper')}
    </p>
  );

  const showGate = open && phase === 'guest_gate';
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
            entityKind={entityKind}
          />
        ) : null}
        {showThread ? (
          <ChatPanel
            key={isGuest ? `guest-${guestContactSaved ? 'ready' : 'pending'}` : 'auth'}
            session={session}
            helperName={helperName}
            helperId={helperId}
            businessId={businessId}
            isGuest={isGuest}
            allowLiveChat={allowLiveChat}
            variant="dock"
            onClose={onClose}
            className="chat-panel--dock h-full overflow-hidden flex flex-col"
            destination={destination}
            onDestinationChange={onDestinationChange}
          />
        ) : null}
      </MessengerDock>
    </>
  );
}

export { MessengerInviteCard };
