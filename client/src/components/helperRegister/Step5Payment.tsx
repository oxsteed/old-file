import { useState } from 'react';
import api from '../../api/axios';

interface Props { token: string; tier: string; onSuccess: () => void; }

export default function Step5Payment({ token, tier, onSuccess }: Props) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleSkip = async () => {
    // For now, record payment setup as placeholder
    // In production, Stripe Elements would be integrated here
    setLoading(true); setError('');
    try {
      await api.post('/auth/helper/register/payment', {
        token,
        stripeCustomerId: null,
        subscriptionId: null,
        backgroundCheckPaymentIntentId: null
      });
      onSuccess();
    } catch (err: any) {
      setError(err.response?.data?.error || 'Failed to record payment');
    } finally { setLoading(false); }
  };

  const tierInfo: Record<string, { name: string; price: string }> = {
    basic: { name: 'Basic Verified', price: '$19.99/mo' },
    pro: { name: 'Pro Verified', price: '$39.99/mo' }
  };
  const info = tierInfo[tier] || { name: tier, price: '' };

  return (
    <div className="space-y-5 max-w-lg mx-auto">
      <h1 className="text-2xl font-bold text-white">Payment Setup</h1>
      <p className="text-gray-400 text-sm">Step 5 of 7 - Set up your subscription</p>

      {error && <p className="text-red-400 text-sm">{error}</p>}

      <div className="p-4 bg-gray-900 border border-gray-700 rounded-xl">
        <div className="flex justify-between items-center mb-3">
          <span className="text-white font-semibold">{info.name}</span>
          <span className="text-orange-400 font-bold">{info.price}</span>
        </div>
        <p className="text-gray-400 text-sm">Includes identity verification, background check, and verified badge.</p>
      </div>

      <div className="p-4 bg-gray-800 border border-gray-600 rounded-xl">
        <p className="text-gray-300 text-sm text-center">
          Stripe payment integration will be connected here.
          <br />For now, continue to complete registration.
        </p>
      </div>

      <button onClick={handleSkip} disabled={loading}
        className="w-full py-3 bg-orange-500 hover:bg-orange-600 text-white font-semibold rounded-lg disabled:opacity-50 transition">
        {loading ? 'Processing...' : 'Continue to Terms'}
      </button>
    </div>
  );
}
