import { useState } from 'react';
import api from '../../api/axios';

interface Props { token: string; onSuccess: (tier: string) => void; }

const tiers = [
  { id: 'free', name: 'Free', price: '$0/mo', features: ['Create profile', 'Accept jobs', 'Basic support'] },
  { id: 'basic', name: 'Basic Verified', price: '$19.99/mo', features: ['Identity verified + background check', 'Verified badge on profile', 'Priority placement in search', 'Appears in Verified-Only filters'] },
  { id: 'pro', name: 'Pro Verified', price: '$39.99/mo', features: ['Everything in Basic Verified', 'Featured profile placement', 'Free instant payouts', 'Monthly profile analytics', 'Priority dispute resolution'] }
];

export default function Step3TierSelection({ token, onSuccess }: Props) {
  const [selected, setSelected] = useState('free');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async () => {
    setLoading(true); setError('');
    try {
      await api.post('/auth/helper/register/tier', { token, tier: selected });
      onSuccess(selected);
    } catch (err: any) {
      setError(err.response?.data?.error || 'Failed to save tier');
    } finally { setLoading(false); }
  };

  return (
    <div className="space-y-5 max-w-lg mx-auto">
      <h1 className="text-2xl font-bold text-white">Choose Your Plan</h1>
      <p className="text-gray-400 text-sm">Step 3 of 7 - Select a tier that fits your needs</p>

      {error && <p className="text-red-400 text-sm">{error}</p>}

      <div className="space-y-3">
        {tiers.map(tier => (
          <button key={tier.id} type="button" onClick={() => setSelected(tier.id)}
            className={`w-full p-4 rounded-xl border-2 text-left transition ${
              selected === tier.id
                ? 'border-orange-500 bg-orange-500/10'
                : 'border-gray-700 bg-gray-900 hover:border-gray-600'
            }`}>
            <div className="flex justify-between items-center mb-2">
              <span className="text-white font-semibold">{tier.name}</span>
              <span className="text-orange-400 font-bold">{tier.price}</span>
            </div>
            <ul className="space-y-1">
              {tier.features.map((f, i) => (
                <li key={i} className="text-gray-400 text-sm flex items-center gap-2">
                  <span className="text-green-400">&#10003;</span> {f}
                </li>
              ))}
            </ul>
          </button>
        ))}
      </div>

      <button onClick={handleSubmit} disabled={loading}
        className="w-full py-3 bg-orange-500 hover:bg-orange-600 text-white font-semibold rounded-lg disabled:opacity-50 transition">
        {loading ? 'Saving...' : selected === 'free' ? 'Continue to Terms' : 'Continue to W-9'}
      </button>
    </div>
  );
}
