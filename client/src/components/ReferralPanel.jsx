import { useState, useEffect } from 'react';
import api from '../api/axios';
import toast from 'react-hot-toast';

export default function ReferralPanel() {
  const [data, setData]     = useState(null);
  const [loading, setLoading] = useState(true);
  const [copied, setCopied]   = useState(false);

  useEffect(() => {
    api.get('/referrals/me')
      .then(r => setData(r.data))
      .catch(() => {/* referral feature unavailable */})
      .finally(() => setLoading(false));
  }, []);

  const copy = async (text) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
      toast.success('Copied to clipboard!');
    } catch {
      toast.error('Copy failed — please copy manually.');
    }
  };

  if (loading) {
    return (
      <div className="animate-pulse h-32 bg-gray-800 rounded-xl" />
    );
  }

  if (!data) return null;

  const { referral_code, share_url, reward_type, stats, referred_users } = data;
  const { referrals_count, referral_conversions_count } = stats;

  return (
    <div className="space-y-4">
      {/* Share link */}
      <div className="bg-gray-800 border border-gray-700 rounded-xl p-5">
        <p className="text-sm text-gray-400 mb-1">Your referral link</p>
        <div className="flex items-center gap-2">
          <code className="flex-1 bg-gray-900 text-orange-400 text-sm px-3 py-2 rounded-lg truncate select-all border border-gray-700">
            {share_url}
          </code>
          <button
            onClick={() => copy(share_url)}
            className="shrink-0 px-4 py-2 rounded-lg text-sm font-semibold bg-orange-500 hover:bg-orange-600 text-white transition-colors"
          >
            {copied ? 'Copied!' : 'Copy'}
          </button>
        </div>
        <p className="text-xs text-gray-500 mt-2">
          Share this link. When someone signs up through it, they're linked to your account.
        </p>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 gap-3">
        <div className="bg-gray-800 border border-gray-700 rounded-xl p-4 text-center">
          <p className="text-2xl font-bold text-white">{referrals_count}</p>
          <p className="text-xs text-gray-400 mt-1">People referred</p>
        </div>
        <div className="bg-gray-800 border border-gray-700 rounded-xl p-4 text-center">
          <p className="text-2xl font-bold text-orange-400">{referral_conversions_count}</p>
          <p className="text-xs text-gray-400 mt-1">Converted</p>
        </div>
      </div>

      {/* Reward info */}
      {reward_type && reward_type !== 'none' && (
        <div className="bg-orange-500/10 border border-orange-500/30 rounded-xl p-4">
          <p className="text-sm text-orange-300 font-medium">
            🎁 Reward: {reward_type}
          </p>
          <p className="text-xs text-gray-400 mt-1">
            Earned for each friend who signs up and completes their first job.
          </p>
        </div>
      )}

      {/* Referred users list */}
      {referred_users?.length > 0 && (
        <div className="bg-gray-800 border border-gray-700 rounded-xl p-4">
          <p className="text-sm font-semibold text-gray-300 mb-3">
            People you've referred
          </p>
          <ul className="space-y-2">
            {referred_users.map(u => (
              <li key={u.id} className="flex items-center justify-between text-sm">
                <span className="text-gray-200">{u.first_name}</span>
                <span className="text-xs text-gray-500">
                  {new Date(u.joined_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
