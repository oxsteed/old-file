import React from 'react';
import { UserCheck, Building2, X } from 'lucide-react';
import type { ChatDestination } from '../../../types/helperProfile';

interface HandoffBannerProps {
  destination: ChatDestination;
  agentName: string;
  onDismiss?: () => void;
}

const HandoffBanner: React.FC<HandoffBannerProps> = ({
  destination,
  agentName,
  onDismiss,
}) => {
  const isHelper = destination === 'helper';

  return (
    <div
      role="alert"
      aria-live="assertive"
      className={`flex items-center gap-3 px-4 py-3 border-b ${
        isHelper
          ? 'bg-brand-900/30 border-brand-800 text-brand-200'
          : 'bg-violet-900/30 border-violet-800 text-violet-200'
      }`}
    >
      <div
        className={`w-7 h-7 rounded-full flex items-center justify-center flex-shrink-0 ${
          isHelper ? 'bg-brand-500/20' : 'bg-violet-500/20'
        }`}
        aria-hidden="true"
      >
        {isHelper ? (
          <UserCheck className="w-4 h-4 text-brand-400" />
        ) : (
          <Building2 className="w-4 h-4 text-violet-400" />
        )}
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-xs font-semibold">
          {isHelper ? 'Helper joined the conversation' : 'Support agent joined'}
        </p>
        <p className="text-xs opacity-70 mt-0.5">
          <span className="font-medium">{agentName}</span> has taken over from the AI assistant.
        </p>
      </div>
      {onDismiss && (
        <button
          onClick={onDismiss}
          className="flex-shrink-0 p-1 rounded-full opacity-60 hover:opacity-100 transition-opacity"
          aria-label="Dismiss handoff notice"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      )}
    </div>
  );
};

export default HandoffBanner;
