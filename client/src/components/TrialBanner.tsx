// client/src/components/TrialBanner.tsx
// Floating banner for active Pro trials. Drop into any dashboard layout.
// Reads trial state from AuthContext user object.

import { Link } from 'react-router-dom';
import { Zap } from 'lucide-react';
import { useAuth } from '../context/AuthContext';

export default function TrialBanner() {
  const { user } = useAuth();

  // Nothing to show if no trial or already paid pro
  if (!user) return null;
  const isTrialActive = user.is_trial_active;
  const daysLeft = user.trial_days_left ?? 0;
  const isPaidPro = user.membership_tier === 'pro' && !isTrialActive;

  if (!isTrialActive || isPaidPro) return null;

  // Urgency color ramp
  const urgent = daysLeft <= 7;
  const warning = daysLeft <= 14;

  return (
    <div
      className={`flex items-center gap-3 px-4 py-2.5 rounded-xl border shadow-sm transition-colors ${
        urgent
          ? 'bg-red-900/20 border-red-700/40 text-red-300'
          : warning
          ? 'bg-amber-900/20 border-amber-700/40 text-amber-300'
          : 'bg-violet-900/20 border-violet-700/40 text-violet-300'
      }`}
    >
      {/* Status */}
      <div className="flex flex-col min-w-0">
        <span className={`text-xs font-bold uppercase tracking-wider ${
          urgent ? 'text-red-400' : warning ? 'text-amber-400' : 'text-violet-400'
        }`}>
          Trial is active
        </span>
        <span className="text-sm font-semibold text-white">
          {daysLeft} {daysLeft === 1 ? 'Day' : 'Days'} Left
        </span>
      </div>

      {/* Upgrade CTA */}
      <Link
        to="/upgrade"
        className={`ml-auto flex items-center gap-1.5 px-4 py-1.5 rounded-lg text-sm font-semibold transition-all whitespace-nowrap ${
          urgent
            ? 'bg-red-500 hover:bg-red-600 text-white'
            : 'bg-white/10 hover:bg-white/20 text-white border border-white/20'
        }`}
      >
        <Zap size={14} />
        Upgrade Now
      </Link>
    </div>
  );
}
