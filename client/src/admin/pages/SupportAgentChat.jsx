import SupportConversationWorkspace from '../../components/support/SupportConversationWorkspace';
import { SupportPageShell } from '../components/support/SupportPageChrome';
import useAdminSupportAvailability from '../hooks/useAdminSupportAvailability';

export default function SupportAgentChat() {
  const { availability, liveReady, busy, toggleAvailability } = useAdminSupportAvailability();
  return (
    <SupportPageShell>
      <div className="mb-4 flex justify-end">
        <button
          type="button"
          onClick={toggleAvailability}
          disabled={busy || availability === null}
          className={`inline-flex items-center gap-2 rounded-xl border px-4 py-2 text-sm font-semibold transition disabled:opacity-50 ${liveReady ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-200' : 'border-gray-700 bg-gray-900 text-gray-300'}`}
        >
          <span className={`h-2.5 w-2.5 rounded-full ${liveReady ? 'bg-emerald-400' : availability ? 'bg-amber-400' : 'bg-gray-600'}`} />
          {liveReady ? 'Live support ready' : availability ? 'Connecting to live support' : 'Go online for live support'}
        </button>
      </div>
      <SupportConversationWorkspace />
    </SupportPageShell>
  );
}
