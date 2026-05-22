// client/src/components/PlatformApprovalBanner.jsx
//
// Sticky status banner you can drop at the top of any mode dashboard. Polls
// the user's approval state for the given mode and renders either:
//   * nothing                — if no gate exists or status is 'approved'
//   * orange CTA banner      — if status is 'not_requested' / 'rejected' / 'revoked'
//   * blue pending banner    — if status is 'requested'
//
// Clicking the CTA opens <PlatformApprovalModal>.

import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Shield, Clock, ArrowRight } from 'lucide-react';
import { getMyApproval } from '../api/modePlatformApprovals';
import PlatformApprovalModal from './PlatformApprovalModal';

export default function PlatformApprovalBanner({ mode }) {
  const { t } = useTranslation();
  const [state, setState] = useState({ loading: true, status: null, policy: null });
  const [modalOpen, setModalOpen] = useState(false);

  const refresh = () => {
    if (!mode) return;
    getMyApproval(mode)
      .then((res) => setState({
        loading: false,
        status: res.approval?.status || 'not_requested',
        policy: res.policy,
      }))
      .catch(() => setState({ loading: false, status: null, policy: null }));
  };

  useEffect(() => { refresh(); /* eslint-disable-next-line */ }, [mode]);

  if (state.loading) return null;
  if (!state.policy?.requires_approval) return null;
  if (state.status === 'approved') return null;

  const isPending = state.status === 'requested';

  return (
    <>
      <div
        className="rounded-xl border p-4 flex items-center gap-3 flex-wrap"
        style={{
          borderColor: isPending ? 'rgba(59,130,246,0.35)' : 'rgba(249,115,22,0.4)',
          background: isPending ? 'rgba(59,130,246,0.08)' : 'rgba(249,115,22,0.08)',
        }}
      >
        {isPending
          ? <Clock size={18} className="text-blue-400 flex-shrink-0" />
          : <Shield size={18} className="text-orange-500 flex-shrink-0" />}
        <div className="flex-1 min-w-0">
          <div className="text-sm font-semibold" style={{ color: 'var(--color-text, #f3f4f6)' }}>
            {isPending
              ? t(`platformApproval.banner.${mode}.pendingTitle`, {
                  defaultValue: t('platformApproval.banner.default.pendingTitle', { defaultValue: 'Approval request under review' }),
                })
              : t(`platformApproval.banner.${mode}.title`, {
                  defaultValue: t('platformApproval.banner.default.title', { defaultValue: 'OxSteed approval required' }),
                })}
          </div>
          <div className="text-xs mt-0.5" style={{ color: 'var(--color-text-muted, #94a3b8)' }}>
            {isPending
              ? t(`platformApproval.banner.${mode}.pendingHint`, {
                  defaultValue: t('platformApproval.banner.default.pendingHint', { defaultValue: "We'll email you when it's decided." }),
                })
              : t(`platformApproval.banner.${mode}.hint`, {
                  defaultValue: t('platformApproval.banner.default.hint', { defaultValue: 'Submit a quick application to start accepting paying clients.' }),
                })}
          </div>
        </div>
        <button
          type="button"
          onClick={() => setModalOpen(true)}
          className={`inline-flex items-center gap-1.5 text-xs font-semibold px-3 py-2 rounded-md ${isPending ? 'border border-gray-600 hover:bg-white/5 text-gray-300' : 'bg-orange-500 hover:bg-orange-600 text-white'}`}
        >
          {isPending
            ? t('platformApproval.banner.viewStatus', { defaultValue: 'View status' })
            : t('platformApproval.banner.requestNow', { defaultValue: 'Request approval' })}
          {!isPending && <ArrowRight size={12} />}
        </button>
      </div>

      <PlatformApprovalModal
        mode={mode}
        open={modalOpen}
        initialPolicy={state.policy}
        onClose={() => { setModalOpen(false); refresh(); }}
        onApproved={refresh}
      />
    </>
  );
}
