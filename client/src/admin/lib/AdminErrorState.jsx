import { AlertCircle, RefreshCw } from 'lucide-react';

/**
 * AdminErrorState — error panel with a retry button.
 *
 * Use instead of rendering an empty list/queue when a fetch fails, so
 * staff never mistake an outage for "all clear".
 *
 * Props:
 *  - title: string (optional)
 *  - message: string (optional, defaults to a generic load-failure line)
 *  - onRetry(): void (optional — hides the button when absent)
 */
export default function AdminErrorState({ title, message, onRetry }) {
  return (
    <div className="rounded-lg border border-red-900/60 bg-red-950/30 p-6 text-center">
      <AlertCircle size={28} className="mx-auto text-red-400" />
      {title && <h3 className="mt-2 text-base font-semibold text-white">{title}</h3>}
      <p className="mt-1 text-sm text-gray-300">
        {message || 'Something went wrong loading this data. Please try again.'}
      </p>
      {onRetry && (
        <button
          type="button"
          onClick={onRetry}
          className="mt-4 inline-flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium text-white bg-blue-600 hover:bg-blue-500"
        >
          <RefreshCw size={15} />
          Retry
        </button>
      )}
    </div>
  );
}
