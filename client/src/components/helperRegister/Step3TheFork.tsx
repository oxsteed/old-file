interface Props {
  onContinue: () => void;
  onFinishLater: () => void;
}

export default function Step3TheFork({ onContinue, onFinishLater }: Props) {
  return (
    <div className="max-w-md mx-auto text-center">
      <div className="w-16 h-16 bg-green-500/10 rounded-full flex items-center justify-center mx-auto mb-6">
        <svg className="w-8 h-8 text-green-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
        </svg>
      </div>

      <h2 className="text-2xl font-bold text-white mb-2">Email verified</h2>
      <p className="text-gray-400 mb-8">
        Your account is created. Complete your profile now to appear in search results and start getting jobs.
      </p>

      <div className="space-y-3">
        <button onClick={onContinue}
          className="w-full py-3 bg-orange-500 hover:bg-orange-600 text-white font-bold rounded-lg transition text-lg">
          Continue Setup
        </button>

        <button onClick={onFinishLater}
          className="w-full py-3 bg-transparent border border-gray-600 text-gray-300 hover:border-gray-500 hover:text-white rounded-lg transition">
          Log In Now, Finish Later
        </button>
      </div>

      <p className="text-gray-500 text-xs mt-6">
        Helpers with complete profiles are 3x more likely to get their first job within a week.
      </p>
    </div>
  );
}
