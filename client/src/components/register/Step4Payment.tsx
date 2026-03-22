import React, { useState } from 'react';

interface Step4PaymentProps {
  onNext: (paymentData: { paymentMethod: string; skipPayment: boolean }) => void;
  onBack: () => void;
}

export default function Step4Payment({ onNext, onBack }: Step4PaymentProps) {
  const [paymentMethod, setPaymentMethod] = useState<string>('skip');
  const [loading, setLoading] = useState(false);

  const handleNext = async () => {
    setLoading(true);
    try {
      onNext({
        paymentMethod: paymentMethod === 'skip' ? 'none' : paymentMethod,
        skipPayment: paymentMethod === 'skip',
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="max-w-2xl mx-auto">
      <h2 className="text-2xl font-bold text-gray-800 mb-2">Payment Method</h2>
      <p className="text-gray-600 mb-6 text-sm">
        Add a payment method to book services. You can also do this later.
      </p>

      <div className="space-y-3 mb-6">
        {/* Skip option */}
        <button
          type="button"
          onClick={() => setPaymentMethod('skip')}
          className={`w-full p-4 border-2 rounded-lg text-left transition ${
            paymentMethod === 'skip'
              ? 'border-blue-600 bg-blue-50'
              : 'border-gray-200 hover:border-gray-300'
          }`}
        >
          <div className="flex items-center">
            <div className={`w-4 h-4 rounded-full border-2 mr-3 flex items-center justify-center ${
              paymentMethod === 'skip' ? 'border-blue-600' : 'border-gray-300'
            }`}>
              {paymentMethod === 'skip' && <div className="w-2 h-2 rounded-full bg-blue-600" />}
            </div>
            <div>
              <span className="font-semibold text-gray-800 block">Skip for now</span>
              <span className="text-sm text-gray-500">Add a payment method later when you book your first service</span>
            </div>
          </div>
        </button>

        {/* Card option - placeholder for Stripe */}
        <button
          type="button"
          onClick={() => setPaymentMethod('card')}
          className={`w-full p-4 border-2 rounded-lg text-left transition ${
            paymentMethod === 'card'
              ? 'border-blue-600 bg-blue-50'
              : 'border-gray-200 hover:border-gray-300'
          }`}
        >
          <div className="flex items-center">
            <div className={`w-4 h-4 rounded-full border-2 mr-3 flex items-center justify-center ${
              paymentMethod === 'card' ? 'border-blue-600' : 'border-gray-300'
            }`}>
              {paymentMethod === 'card' && <div className="w-2 h-2 rounded-full bg-blue-600" />}
            </div>
            <div>
              <span className="font-semibold text-gray-800 block">Credit or Debit Card</span>
              <span className="text-sm text-gray-500">Securely add your card via Stripe</span>
            </div>
          </div>
        </button>
      </div>

      {/* Stripe card element placeholder */}
      {paymentMethod === 'card' && (
        <div className="mb-6 p-4 border border-gray-300 rounded-lg bg-gray-50">
          <p className="text-sm text-gray-600 mb-3">Card details will be securely handled by Stripe.</p>
          <div className="border border-gray-300 rounded p-3 bg-white min-h-[44px] flex items-center">
            <span className="text-gray-400 text-sm">Stripe card element will render here</span>
          </div>
          <p className="text-xs text-gray-400 mt-2">
            Your card info is encrypted and sent directly to Stripe. OxSteed never sees your full card number.
          </p>
        </div>
      )}

      {/* Navigation */}
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
          onClick={handleNext}
          disabled={loading}
          className="px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 transition"
        >
          {loading ? 'Processing...' : paymentMethod === 'skip' ? 'Skip & Continue' : 'Save & Continue'}
        </button>
      </div>
    </div>
  );
}
