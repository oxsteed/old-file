import React, { useRef, useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronDown, Building2, User } from 'lucide-react';
import type { ChatDestination, ChatStatus } from '../../../types/helperProfile';
import StatusBadge from './StatusBadge';

interface ChatDestinationDropdownProps {
  destination: ChatDestination;
  helperName: string;
  helperStatus: ChatStatus;
  oxsteedStatus: ChatStatus;
  allowLiveChat?: boolean;
  onChange: (dest: ChatDestination) => void;
}

const DEST_KEYS: { key: ChatDestination; icon: React.ElementType }[] = [
  { key: 'helper', icon: User },
  { key: 'oxsteed', icon: Building2 },
];

const ChatDestinationDropdown: React.FC<ChatDestinationDropdownProps> = ({
  destination,
  helperName,
  helperStatus,
  oxsteedStatus,
  allowLiveChat = true,
  onChange,
}) => {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const openRef = useRef(open);
  useEffect(() => { openRef.current = open; }, [open]);

  // Helper destination stays selectable offline (AI path). Live badge is separate.
  // allowLiveChat only gates the LIVE affordance, not messaging the provider AI.
  void allowLiveChat;

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (openRef.current && ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && openRef.current) {
        e.stopImmediatePropagation();
        setOpen(false);
      }
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const isProviderDest = destination === 'helper' || destination === 'business';
  const currentStatus = isProviderDest ? helperStatus : oxsteedStatus;
  const currentLabel = isProviderDest
    ? helperName
    : t('helperProfile.chat.oxsteedAssistantLabel');

  const destLabel = (key: ChatDestination) =>
    key === 'helper' || key === 'business' ? helperName : t('helperProfile.chat.oxsteedAssistantLabel');
  const destTitle = (key: ChatDestination) =>
    key === 'helper' || key === 'business' ? t('helperProfile.chat.talkToHelper') : t('helperProfile.chat.talkToOxsteed');
  const destSub = (key: ChatDestination) =>
    key === 'helper' || key === 'business' ? t('helperProfile.chat.helperMsgSub') : t('helperProfile.chat.oxsteedSub');

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((p) => !p)}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={t('helperProfile.chat.selectChatDest')}
        className="flex items-center gap-2 px-3 py-2 rounded-xl bg-gray-800 hover:bg-gray-700/80 border border-gray-700 transition-colors w-full text-left"
      >
        <div className="flex-1 min-w-0">
          <p className="text-xs text-gray-500 leading-none mb-0.5">{t('helperProfile.chat.chattingWith')}</p>
          <p className="text-sm font-semibold text-white truncate">{currentLabel}</p>
        </div>
        <StatusBadge status={currentStatus} className="flex-shrink-0" />
        <ChevronDown
          className={`w-4 h-4 text-gray-400 flex-shrink-0 transition-transform ${open ? 'rotate-180' : ''}`}
          aria-hidden="true"
        />
      </button>

      {open && (
        <div
          role="listbox"
          aria-label={t('helperProfile.chat.chatDestOptions')}
          className="absolute top-full left-0 right-0 mt-1.5 bg-gray-800 border border-gray-700 rounded-xl shadow-xl z-20 overflow-hidden"
        >
          {DEST_KEYS.map(({ key, icon: Icon }) => {
            const status = key === 'helper' ? helperStatus : oxsteedStatus;
            const label = destLabel(key);
            const title = destTitle(key);
            const sub = destSub(key);
            const selected = (destination === key || (key === 'helper' && destination === 'business'));
            const helperOffline = key === 'helper' && helperStatus !== 'live';
            const liveDisabledNote = key === 'helper' && helperStatus === 'live' && !allowLiveChat;
            const statusHint = helperOffline
              ? t('helperProfile.chat.helperAiAvailable')
              : liveDisabledNote
              ? t('helperProfile.chat.liveChatDisabled')
              : sub;

            return (
              <button
                key={key}
                role="option"
                aria-selected={selected}
                onClick={() => { onChange(key); setOpen(false); }}
                className={`w-full flex items-center gap-3 px-4 py-3 text-left transition-colors ${
                  selected
                    ? 'bg-brand-500/10 border-l-2 border-brand-500'
                    : 'hover:bg-gray-700/60 border-l-2 border-transparent'
                }`}
              >
                <div
                  className={`w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 ${
                    selected ? 'bg-brand-500/20' : 'bg-gray-700'
                  }`}
                >
                  <Icon
                    className={`w-4 h-4 ${selected ? 'text-brand-400' : 'text-gray-400'}`}
                    aria-hidden="true"
                  />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <p
                      className={`text-sm font-medium truncate ${
                        selected ? 'text-white' : 'text-gray-300'
                      }`}
                    >
                      {title}
                    </p>
                    {key === 'helper' && helperStatus === 'live' && allowLiveChat && (
                      <span className="inline-block px-2 py-0.5 bg-emerald-500/20 text-emerald-300 text-xs font-semibold rounded">
                        LIVE
                      </span>
                    )}
                    {key === 'oxsteed' && (
                      <span className="inline-block px-2 py-0.5 bg-sky-500/20 text-sky-300 text-xs font-semibold rounded">
                        AI
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-gray-500 truncate">
                    {statusHint}
                  </p>
                  <p className="text-xs text-gray-600 truncate">{label}</p>
                </div>
                <StatusBadge status={status} className="flex-shrink-0" />
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
};

export default ChatDestinationDropdown;
