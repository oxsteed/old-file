// Step 2: Terms Acceptance - Customer Registration
import { useState } from 'react';
import api from '../../api/axios';
import toast from 'react-hot-toast';

interface Props {
  registrationToken: string;
  firstName: string;
  lastName: string;
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

export default function Step2Terms({ registrationToken, firstName, lastName, onSuccess }: Props) {
  const [scrolledToBottom, setScrolledToBottom] = useState(false);
  const [termsAccepted, setTermsAccepted] = useState(false);
  const [privacyAccepted, setPrivacyAccepted] = useState(false);
  const [brokerAccepted, setBrokerAccepted] = useState(false);
  const [signatureAccepted, setSignatureAccepted] = useState(false);
  const [sigFirstName, setSigFirstName] = useState(firstName);
  const [sigLastName, setSigLastName] = useState(lastName);
  const [loading, setLoading] = useState(false);

  const today = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });

  const handleScroll = (e: React.UIEvent<HTMLDivElement>) => {
    const { scrollTop, scrollHeight, clientHeight } = e.currentTarget;
    if (scrollTop + clientHeight >= scrollHeight - 10) {
      setScrolledToBottom(true);
    }
  };

  const allAccepted = termsAccepted && privacyAccepted && brokerAccepted && signatureAccepted && sigFirstName.trim() && sigLastName.trim();

  const handleAccept = async () => {
    if (!allAccepted) return;
    setLoading(true);
    try {
      await api.post('/auth/register/accept-terms', {
        token: registrationToken,
        termsAccepted,
        privacyAccepted,
        brokerAccepted,
        electronicSignature: {
          firstName: sigFirstName.trim(),
          lastName: sigLastName.trim(),
          date: new Date().toISOString(),
        },
      });
      toast.success('Terms accepted. Check your email for verification code.');
      onSuccess();
    } catch (err: any) {
      toast.error(err.response?.data?.error || 'Failed to accept terms');
    } finally {
      setLoading(false);
    }
  };

  const inputClass = 'px-3 py-2 bg-gray-900 border border-gray-700 rounded-lg text-white placeholder-gray-500 focus:ring-2 focus:ring-orange-500 focus:border-transparent transition text-sm';

  return (
    <div>
      <h2 className="text-2xl font-bold text-center mb-2">Terms & Conditions</h2>
      <p className="text-gray-400 text-sm text-center mb-6">Please review our terms of service. Scroll to read all terms.</p>

      <div
        onScroll={handleScroll}
        className="max-h-64 overflow-y-auto border border-gray-700 rounded-lg p-4 mb-6 bg-gray-900/50"
        tabIndex={0}
        role="region"
        aria-label="Terms and conditions content"
      >
        {termsItems.map((item, idx) => (
          <div key={idx} className={idx < termsItems.length - 1 ? 'mb-4 pb-4 border-b border-gray-700' : 'mb-2'}>
            <h3 className="text-orange-400 font-semibold mb-1">{idx + 1}. {item.title}</h3>
            <p className="text-gray-300 text-sm">{item.summary}</p>
          </div>
        ))}
      </div>

      {!scrolledToBottom && (
        <p className="text-yellow-400 text-xs text-center mb-4">
          Please scroll down to read all terms before accepting.
        </p>
      )}

      {/* Individual checkboxes */}
      <div className="space-y-4 mb-6">
        <label className="flex items-start gap-2 text-gray-300 text-sm cursor-pointer">
          <input type="checkbox" checked={termsAccepted}
            onChange={e => setTermsAccepted(e.target.checked)}
            disabled={!scrolledToBottom}
            className="rounded border-gray-600 mt-0.5 accent-orange-500" />
          <span>I have read and agree to the{' '}
            <a href="/terms" target="_blank" className="text-orange-400 underline hover:text-orange-300">Terms & Conditions</a>
            {' '}(effective March 27, 2026).
          </span>
        </label>

        <label className="flex items-start gap-2 text-gray-300 text-sm cursor-pointer">
          <input type="checkbox" checked={privacyAccepted}
            onChange={e => setPrivacyAccepted(e.target.checked)}
            disabled={!scrolledToBottom}
            className="rounded border-gray-600 mt-0.5 accent-orange-500" />
          <span>I have read and agree to the{' '}
            <a href="/privacy" target="_blank" className="text-orange-400 underline hover:text-orange-300">Privacy Policy</a>
            {' '}(effective March 27, 2026).
          </span>
        </label>

        <label className="flex items-start gap-2 text-gray-300 text-sm cursor-pointer">
          <input type="checkbox" checked={brokerAccepted}
            onChange={e => setBrokerAccepted(e.target.checked)}
            disabled={!scrolledToBottom}
            className="rounded border-gray-600 mt-0.5 accent-orange-500" />
          <span>I understand that OxSteed acts as a connection platform (broker) and is not a party to service agreements unless Tier 3 protection is activated. I accept the{' '}
            <a href="/terms#liability" target="_blank" className="text-orange-400 underline hover:text-orange-300">Service Agreement & Liability Disclosure</a>.
          </span>
        </label>

        {/* Electronic Signature checkbox with name and date */}
        <div className="border border-gray-700 rounded-lg p-4 bg-gray-900/30">
          <label className="flex items-start gap-2 text-gray-300 text-sm cursor-pointer mb-3">
            <input type="checkbox" checked={signatureAccepted}
              onChange={e => setSignatureAccepted(e.target.checked)}
              disabled={!scrolledToBottom}
              className="rounded border-gray-600 mt-0.5 accent-orange-500" />
            <span>I acknowledge and accept all of the above agreements.</span>
          </label>
          <div className="ml-6 space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs text-gray-400 mb-1">First Name</label>
                <input type="text" value={sigFirstName}
                  onChange={e => setSigFirstName(e.target.value)}
                  className={inputClass + ' w-full'}
                  placeholder="First Name" />
              </div>
              <div>
                <label className="block text-xs text-gray-400 mb-1">Last Name</label>
                <input type="text" value={sigLastName}
                  onChange={e => setSigLastName(e.target.value)}
                  className={inputClass + ' w-full'}
                  placeholder="Last Name" />
              </div>
            </div>
            <div>
              <label className="block text-xs text-gray-400 mb-1">Date</label>
              <input type="text" value={today} disabled
                className={inputClass + ' w-full opacity-60 cursor-not-allowed'} />
            </div>
          </div>
        </div>
      </div>

      <p className="text-gray-500 text-xs text-center mb-4">
        By accepting, a record of your full name, acceptance timestamp, and IP address will be stored for legal enforceability.
      </p>

      <button
        onClick={handleAccept}
        disabled={!allAccepted || loading}
        className="w-full py-3 bg-orange-500 hover:bg-orange-600 text-white font-bold rounded-lg disabled:opacity-50 transition text-lg"
        title={!allAccepted ? 'Please review and accept all agreements above' : ''}
      >
        {loading ? 'Processing...' : 'I Accept & Continue'}
      </button>
    </div>
  );
}
