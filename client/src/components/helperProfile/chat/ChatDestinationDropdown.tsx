import React, { useRef, useState, useEffect } from 'react';
import { ChevronDown, Building2, User } from 'lucide-react';
import type { ChatDestination, ChatStatus } from '../../../types/helperProfile';
import StatusBadge from './StatusBadge';

interface ChatDestinationDropdownProps {
  destination: ChatDestination;
  helperName: string;
  helperStatus: ChatStatus;
  oxsteedStatus: ChatStatus;
  onChange: (dest: ChatDestination) => void;
}

const DESTINATIONS: { key: ChatDestination; label: string; sub: string; icon: React.ElementType }[] = [
  {
    key: 'helper',
    label: 'Talk to this helper',
    sub: 'Message the business directly',
    icon: User,
  },
  {
    key: 'oxsteed',
    label: 'Talk to OxSteed',
    sub: 'Platform support & help',
    icon: Building2,
  },
];

const ChatDestinationDropdown: React.FC<ChatDestinationDropdownProps> = ({
  destination,
  helperName,
  helperStatus,
  oxsteedStatus,
  onChange,
}) => {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  // Close on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  // Close on Escape — stopImmediatePropagation when the dropdown itself is
  // open so no other document-level Escape handler (e.g. SupportWidget) fires
  // in the same event dispatch. stopPropagation() alone is insufficient here
  // because it only stops propagation to ancestor nodes (window); sibling
  // listeners registered on document still run. stopImmediatePropagation()
  // prevents all remaining listeners on the same node from executing.
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && open) {
        e.stopImmediatePropagation();
        setOpen(false);
      }
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [open]);

  const currentStatus = destination === 'helper' ? helperStatus : oxsteedStatus;
  const currentLabel =
    destination === 'helper' ? helperName : 'OxSteed Support';

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((p) => !p)}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label="Select chat destination"
        className="flex items-center gap-2 px-3 py-2 rounded-xl bg-gray-800 hover:bg-gray-700/80 border border-gray-700 transition-colors w-full text-left"
      >
        <div className="flex-1 min-w-0">
          <p className="text-xs text-gray-500 leading-none mb-0.5">Chatting with</p>
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
          aria-label="Chat destination options"
          className="absolute top-full left-0 right-0 mt-1.5 bg-gray-800 border border-gray-700 rounded-xl shadow-xl z-20 overflow-hidden"
        >
          {DESTINATIONS.map((d) => {
            const status = d.key === 'helper' ? helperStatus : oxsteedStatus;
            const label = d.key === 'helper' ? helperName : 'OxSteed Support';
            const Icon = d.icon;
            const selected = destination === d.key;
            return (
              <button
                key={d.key}
                role="option"
                aria-selected={selected}
                onClick={() => { onChange(d.key); setOpen(false); }}
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
                  <p
                    className={`text-sm font-medium truncate ${
                      selected ? 'text-white' : 'text-gray-300'
                    }`}
                  >
                    {label}
                  </p>
                  <p className="text-xs text-gray-500 truncate">{d.sub}</p>
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
