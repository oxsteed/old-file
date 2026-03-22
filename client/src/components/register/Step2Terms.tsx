// Step 2: Terms Acceptance - Customer Registration
import { useState } from 'react';
import api from '../../api/axios';
import toast from 'react-hot-toast';

interface Props {
  registrationToken: string;
  onSuccess: () => void;
}

const termsItems = [
  {
    title: 'Service Agreement',
    summary: 'You agree to use OxSteed as a platform connecting customers with independent service providers. OxSteed facilitates connections but is not a party to service agreements unless both parties opt into Tier 3 payment protection.',
  },
  {
    title: 'Payment Terms',
    summary: 'Payments are processed through our secure payment system. Service fees are charged upon booking confirmation. Cancellation policies vary by provider.',
  },
  {
    title: 'Liability Limitations',
    summary: 'OxSteed acts as a marketplace platform. While we vet providers, ultimate responsibility for service quality lies with the independent helper. OxSteed is not liable for damages unless Tier 3 protection is mutually activated.',
  },
  {
    title: 'Privacy & Data Use',
    summary: 'We collect and process personal data to provide our services. We do not sell your personal data to third parties.',
  },
  {
    title: 'Account Responsibilities',
    summary: 'You are responsible for maintaining the security of your account credentials and for all activities under your account.',
  },
];

export default function Step2Terms({ registrationToken, onSuccess }: Props) {
  const [scrolledToBottom, setScrolledToBottom] = useState(false);
  const [accepted, setAccepted] = useState(false);
  const [loading, setLoading] = useState(false);

  const handleScroll = (e: React.UIEvent<HTMLDivElement>) => {
    const { scrollTop, scrollHeight, clientHeight } = e.currentTarget;
    if (scrollTop + clientHeight >= scrollHeight - 10) {
      setScrolledToBottom(true);
    }
  };

  const handleAccept = async () => {
    if (!accepted) return;
    setLoading(true);
    try {
      await api.post('/auth/register/accept-terms', { token: registrationToken });
      toast.success('Terms accepted. Check your email for verification code.');
      onSuccess();
    } catch (err: any) {
      toast.error(err.response?.data?.error || 'Failed to accept terms');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div>
      <div className="text-center mb-4">
        <h2 className="text-2xl font-bold text-white mb-2">Terms & Conditions</h2>
        <p className="text-gray-400 text-sm">
          Please review our terms of service. Scroll to read all terms.
        </p>
      </div>

      <div
        className="border border-gray-600 rounded-lg bg-gray-800/50 p-4 mb-4 max-h-80 overflow-y-auto"
        onScroll={handleScroll}
      >
        {termsItems.map((item, idx) => (
          <div key={idx} className="mb-4 last:mb-0">
            <h3 className="font-semibold text-gray-200 mb-1">
              {idx + 1}. {item.title}
            </h3>
            <p className="text-sm text-gray-400 leading-relaxed">{item.summary}</p>
          </div>
        ))}
      </div>

      <div className="mt-4 pt-4 border-t border-gray-700">
        <p className="text-xs text-gray-500">
          By accepting, a record of your acceptance including timestamp and IP address
          will be stored for legal enforceability.
        </p>
      </div>

      {!scrolledToBottom && (
        <p className="text-amber-400 text-sm mb-3 mt-2">
          Please scroll down to read all terms before accepting.
        </p>
      )}

      <label className="flex items-start mb-6 mt-4 cursor-pointer">
        <input
          type="checkbox"
          checked={accepted}
          onChange={(e) => setAccepted(e.target.checked)}
          disabled={!scrolledToBottom}
          className="mt-1 mr-3 accent-blue-500"
        />
        <span className={`text-sm ${!scrolledToBottom ? 'text-gray-500' : 'text-gray-300'}`}>
          I have read, understand, and agree to the OxSteed Terms & Conditions,
          Privacy Policy, and Service Agreement.
        </span>
      </label>

      <button
        onClick={handleAccept}
        disabled={!accepted || loading}
        className="w-full py-3 bg-blue-600 text-white font-semibold rounded-lg hover:bg-blue-500 disabled:opacity-50 transition-colors shadow-lg shadow-blue-600/25"
      >
        {loading ? 'Processing...' : 'I Accept & Continue'}
      </button>
    </div>
  );
}
