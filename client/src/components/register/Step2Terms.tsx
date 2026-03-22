import React, { useState } from 'react';

interface Step2TermsProps {
  onNext: (termsData: {
    termsAccepted: boolean;
    termsVersion: string;
    acceptedAt: string;
    ipAddress: string;
  }) => void;
  onBack: () => void;
}

const TERMS_VERSION = '1.0.0';

const termsItems = [
  {
    title: 'Service Agreement',
    summary: 'You agree to use OxSteed as a platform connecting customers with independent service providers. OxSteed facilitates connections but does not employ providers directly.',
  },
  {
    title: 'Payment Terms',
    summary: 'Payments are processed through our secure payment system. Service fees are charged upon booking confirmation. Cancellation policies vary by service type.',
  },
  {
    title: 'Liability Limitations',
    summary: 'OxSteed acts as a marketplace platform. While we vet providers, ultimate responsibility for service quality lies with the independent provider. Disputes are handled through our resolution process.',
  },
  {
    title: 'Privacy & Data Use',
    summary: 'We collect and process personal data to provide our services, including name, contact info, location, and payment details. We do not sell your personal data to third parties.',
  },
  {
    title: 'Communication Consent',
    summary: 'By registering, you consent to receive service-related communications via email, SMS, and push notifications. You can manage notification preferences in your account settings.',
  },
  {
    title: 'Account Responsibilities',
    summary: 'You are responsible for maintaining the security of your account credentials. You must be 18 years or older to use OxSteed. Accounts found violating our policies may be suspended.',
  },
];

export default function Step2Terms({ onNext, onBack }: Step2TermsProps) {
  const [accepted, setAccepted] = useState(false);
  const [scrolledToBottom, setScrolledToBottom] = useState(false);
  const [loading, setLoading] = useState(false);

  const handleScroll = (e: React.UIEvent<HTMLDivElement>) => {
    const { scrollTop, scrollHeight, clientHeight } = e.currentTarget;
    if (scrollHeight - scrollTop - clientHeight < 20) {
      setScrolledToBottom(true);
    }
  };

  const handleAccept = async () => {
    if (!accepted) return;
    setLoading(true);

    try {
      // Get IP for terms acceptance record
      let ipAddress = 'unknown';
      try {
        const ipRes = await fetch('https://api.ipify.org?format=json');
        const ipData = await ipRes.json();
        ipAddress = ipData.ip;
      } catch {
        // Continue with unknown IP
      }

      const termsData = {
        termsAccepted: true,
        termsVersion: TERMS_VERSION,
        acceptedAt: new Date().toISOString(),
        ipAddress,
      };

      onNext(termsData);
    } catch (err) {
      console.error('Terms acceptance error:', err);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="max-w-2xl mx-auto">
      <h2 className="text-2xl font-bold text-gray-800 mb-2">Terms & Conditions</h2>
      <p className="text-gray-600 mb-4 text-sm">
        Please review our terms of service before continuing. Scroll to read all terms.
      </p>

      {/* Terms scrollable container */}
      <div
        className="border border-gray-300 rounded-lg bg-gray-50 p-4 mb-4 max-h-80 overflow-y-auto"
        onScroll={handleScroll}
      >
        {termsItems.map((item, idx) => (
          <div key={idx} className="mb-4 last:mb-0">
            <h3 className="font-semibold text-gray-800 mb-1">
              {idx + 1}. {item.title}
            </h3>
            <p className="text-sm text-gray-600 leading-relaxed">{item.summary}</p>
          </div>
        ))}

        <div className="mt-6 pt-4 border-t border-gray-300">
          <p className="text-xs text-gray-500">
            Terms Version: {TERMS_VERSION} | Effective Date: January 1, 2025
          </p>
          <p className="text-xs text-gray-500 mt-1">
            By accepting these terms, you acknowledge that you have read, understood, and agree
            to be bound by these Terms & Conditions. A record of your acceptance including
            timestamp and IP address will be stored for legal enforceability.
          </p>
        </div>
      </div>

      {!scrolledToBottom && (
        <p className="text-amber-600 text-sm mb-3 flex items-center">
          <svg className="w-4 h-4 mr-1" fill="currentColor" viewBox="0 0 20 20">
            <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
          </svg>
          Please scroll down to read all terms before accepting.
        </p>
      )}

      {/* Acceptance checkbox */}
      <label className="flex items-start mb-6 cursor-pointer">
        <input
          type="checkbox"
          checked={accepted}
          onChange={(e) => setAccepted(e.target.checked)}
          disabled={!scrolledToBottom}
          className="mt-1 mr-3"
        />
        <span className={`text-sm ${!scrolledToBottom ? 'text-gray-400' : 'text-gray-700'}`}>
          I have read, understand, and agree to the OxSteed Terms & Conditions,
          Privacy Policy, and Service Agreement. I acknowledge that my acceptance
          is legally binding.
        </span>
      </label>

      {/* Navigation buttons */}
      <div className="flex justify-between">
        <button
          type="button"
          onClick={onBack}
          className="px-6 py-2 border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-50 transition"
        >
          Back
        </button>
        <button
          type="button"
          onClick={handleAccept}
          disabled={!accepted || loading}
          className="px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition"
        >
          {loading ? 'Processing...' : 'I Accept — Continue'}
        </button>
      </div>
    </div>
  );
}
