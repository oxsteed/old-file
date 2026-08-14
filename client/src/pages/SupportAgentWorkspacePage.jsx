import { useSearchParams } from 'react-router-dom';
import PageShell from '../components/PageShell';
import SupportConversationWorkspace from '../components/support/SupportConversationWorkspace';

export default function SupportAgentWorkspacePage() {
  const [searchParams] = useSearchParams();
  const businessId = searchParams.get('business');

  return (
    <PageShell>
      <main className="min-h-screen bg-[radial-gradient(circle_at_top_left,rgba(249,115,22,0.14),transparent_30%),linear-gradient(180deg,#07101d_0%,#020617_100%)] px-4 py-8 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-7xl">
          <SupportConversationWorkspace businessId={businessId} embedded />
        </div>
      </main>
    </PageShell>
  );
}
