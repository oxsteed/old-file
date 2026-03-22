import { useState, useRef } from 'react';
import api from '../../api/axios';

interface Props { token: string; onSuccess: () => void; }

export default function Step6Terms({ token, onSuccess }: Props) {
  const [scrolledToBottom, setScrolledToBottom] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const scrollRef = useRef<HTMLDivElement>(null);

  const handleScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    if (el.scrollTop + el.clientHeight >= el.scrollHeight - 20) {
      setScrolledToBottom(true);
    }
  };

  const handleAccept = async () => {
    setLoading(true); setError('');
    try {
      await api.post('/auth/helper/register/accept-terms', { token });
      onSuccess();
    } catch (err: any) {
      setError(err.response?.data?.error || 'Failed to accept terms');
    } finally { setLoading(false); }
  };

  return (
    <div className="space-y-4 max-w-lg mx-auto">
      <h1 className="text-2xl font-bold text-white">Helper Terms of Service</h1>
      <p className="text-gray-400 text-sm">Step 6 of 7 - Review and accept terms</p>
      <p className="text-yellow-400 text-xs">Scroll to the bottom to enable acceptance.</p>

      {error && <p className="text-red-400 text-sm">{error}</p>}

      <div ref={scrollRef} onScroll={handleScroll}
        className="h-64 overflow-y-auto bg-gray-900 border border-gray-700 rounded-lg p-4 text-gray-300 text-sm leading-relaxed">
        <h3 className="font-bold text-white mb-2">OxSteed Helper Agreement</h3>
        <p className="mb-2">Version 2026-03-20</p>
        <p className="mb-2">By accepting these terms, you agree to provide services through the OxSteed platform as an independent contractor.</p>
        <h4 className="font-semibold text-white mt-3 mb-1">1. Independent Contractor Status</h4>
        <p className="mb-2">You acknowledge that you are an independent contractor and not an employee of OxSteed. You are responsible for your own taxes, insurance, and business operations.</p>
        <h4 className="font-semibold text-white mt-3 mb-1">2. Service Standards</h4>
        <p className="mb-2">You agree to provide services professionally, arrive on time, communicate clearly with customers, and maintain appropriate licenses and insurance for your work.</p>
        <h4 className="font-semibold text-white mt-3 mb-1">3. Platform Fees</h4>
        <p className="mb-2">OxSteed charges a service fee on completed jobs. Fee rates vary by tier and are disclosed before job acceptance.</p>
        <h4 className="font-semibold text-white mt-3 mb-1">4. Background Checks</h4>
        <p className="mb-2">Verified tier helpers consent to background checks. Results may affect account eligibility.</p>
        <h4 className="font-semibold text-white mt-3 mb-1">5. Payment Terms</h4>
        <p className="mb-2">Payments are processed through the platform. Payouts are made on a weekly basis for free tier and instantly for Pro tier helpers.</p>
        <h4 className="font-semibold text-white mt-3 mb-1">6. Account Termination</h4>
        <p className="mb-2">OxSteed reserves the right to suspend or terminate accounts that violate these terms, receive consistent negative reviews, or fail to maintain professional standards.</p>
        <h4 className="font-semibold text-white mt-3 mb-1">7. Dispute Resolution</h4>
        <p className="mb-2">Disputes will be handled through OxSteed's internal resolution process. Both parties agree to participate in good faith.</p>
        <h4 className="font-semibold text-white mt-3 mb-1">8. Liability</h4>
        <p className="mb-2">Helpers are responsible for any damages caused during service delivery. OxSteed is not liable for actions taken by helpers.</p>
        <p className="mt-4 text-gray-500">End of Helper Terms of Service.</p>
      </div>

      <button onClick={handleAccept} disabled={!scrolledToBottom || loading}
        className="w-full py-3 bg-orange-500 hover:bg-orange-600 text-white font-semibold rounded-lg disabled:opacity-50 transition">
        {loading ? 'Accepting...' : !scrolledToBottom ? 'Scroll to bottom to accept' : 'I Accept - Send Verification Code'}
      </button>
    </div>
  );
}
