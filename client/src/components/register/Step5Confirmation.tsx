import React from 'react';

interface Step5ConfirmationProps {
  registrationData: {
    fullName: string;
    email: string;
    accountType: string;
  };
}

export default function Step5Confirmation({ registrationData }: Step5ConfirmationProps) {
  return (
    <div className="max-w-2xl mx-auto text-center">
      {/* Success icon */}
      <div className="mb-6">
        <div className="w-20 h-20 bg-green-100 rounded-full flex items-center justify-center mx-auto">
          <svg className="w-10 h-10 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
          </svg>
        </div>
      </div>

      <h2 className="text-2xl font-bold text-gray-800 mb-2">Welcome to OxSteed!</h2>
      <p className="text-gray-600 mb-6">
        Your account has been created successfully, {registrationData.fullName}.
      </p>

      {/* Account summary */}
      <div className="bg-gray-50 rounded-lg p-6 mb-6 text-left max-w-md mx-auto">
        <h3 className="font-semibold text-gray-800 mb-3">Account Summary</h3>
        <div className="space-y-2 text-sm">
          <div className="flex justify-between">
            <span className="text-gray-500">Name</span>
            <span className="text-gray-800 font-medium">{registrationData.fullName}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-gray-500">Email</span>
            <span className="text-gray-800 font-medium">{registrationData.email}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-gray-500">Account Type</span>
            <span className="text-gray-800 font-medium capitalize">{registrationData.accountType}</span>
          </div>
        </div>
      </div>

      {/* Next steps */}
      <div className="bg-blue-50 rounded-lg p-6 mb-6 text-left max-w-md mx-auto">
        <h3 className="font-semibold text-blue-800 mb-3">What's Next?</h3>
        <ul className="space-y-2 text-sm text-blue-700">
          <li className="flex items-start">
            <span className="mr-2">1.</span>
            <span>Check your email for a verification link</span>
          </li>
          <li className="flex items-start">
            <span className="mr-2">2.</span>
            <span>Browse available services in your area</span>
          </li>
          <li className="flex items-start">
            <span className="mr-2">3.</span>
            <span>Book your first service!</span>
          </li>
        </ul>
      </div>

      {/* CTA buttons */}
      <div className="flex flex-col sm:flex-row gap-3 justify-center">
        <a
          href="/login"
          className="px-8 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition font-medium"
        >
          Go to Login
        </a>
        <a
          href="/"
          className="px-8 py-3 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 transition font-medium"
        >
          Back to Home
        </a>
      </div>
    </div>
  );
}
