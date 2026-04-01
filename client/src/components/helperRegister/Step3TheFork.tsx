interface Props {
  onContinue: () => void;
  onFinishLater: () => void;
}

export default function Step3TheFork({ onContinue, onFinishLater }: Props) {
  return (
    <div className="max-w-md mx-auto text-center">
      <div className="w-16 h-16 bg-green-500/10 rounded-full flex items-center justify-center mx-auto mb-6">
        <svg
          className="w-8 h-8 text-green-500"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={2}
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
        </svg>
      </div>

      <h2 className="text-2xl font-bold text-white mb-2">Email verified!</h2>
      <p className="text-gray-400 mb-2">
        Your account is ready. Complete your profile to appear in search results and start receiving job requests.
      </p>
      <p className="text-gray-500 text-sm mb-8">
        It only takes a few minutes — you can pause and come back anytime from your dashboard.
      </p>

      <div className="space-y-3">
        <button
          onClick={onContinue}
          className="w-full py-3 bg-orange-500 hover:bg-orange-600 text-white font-bold rounded-lg transition text-lg"
        >
          Complete My Profile →
        </button>

        <button
          onClick={onFinishLater}
          className="w-full py-3 bg-transparent border border-gray-700 text-gray-400 hover:border-gray-500 hover:text-white rounded-lg transition text-sm"
        >
          Go to Dashboard, Finish Later
        </button>
      </div>

      <div className="mt-6 p-3 bg-gray-800/50 rounded-lg border border-gray-700/50">
        <p className="text-gray-400 text-xs leading-relaxed">
          <span className="text-orange-400 font-medium">Heads up:</span> Helpers with a complete profile are 3× more likely to land their first job within a week.
          Your profile won't appear in search results until setup is done.
        </p>
      </div>
    </div>
  );
}
