import { useEffect, useState } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import {
  ArrowLeft, Briefcase, User, MapPin, DollarSign,
  Calendar, Tag, Loader2, Trash2, AlertTriangle, RotateCcw,
} from 'lucide-react';
import { useAuth } from '../../hooks/useAuth';
import adminApi from '../../lib/adminApi';

// ── Helpers ───────────────────────────────────────────────────────────────────

function ts(d) {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric',
  });
}

function money(val) {
  if (val == null) return '—';
  return `$${Number(val).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

const STATUS_COLOR = {
  published:   'bg-blue-900 text-blue-300',
  accepted:    'bg-orange-900 text-orange-300',
  in_progress: 'bg-yellow-900 text-yellow-300',
  completed:   'bg-green-900 text-green-300',
  cancelled:   'bg-red-900 text-red-300',
  disputed:    'bg-purple-900 text-purple-300',
};

const BID_COLOR = {
  pending:   'bg-blue-900 text-blue-300',
  accepted:  'bg-green-900 text-green-300',
  rejected:  'bg-red-900 text-red-300',
  withdrawn: 'bg-gray-700 text-gray-400',
  removed:   'bg-red-900 text-red-400',
};

function Badge({ text, colorClass }) {
  return (
    <span className={`px-2 py-0.5 text-xs rounded-full font-medium ${colorClass}`}>
      {text}
    </span>
  );
}

function Section({ title, children }) {
  return (
    <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
      <div className="px-4 py-3 border-b border-gray-800">
        <h2 className="text-sm font-semibold text-white">{title}</h2>
      </div>
      <div className="p-4">{children}</div>
    </div>
  );
}

// ── Action modals ─────────────────────────────────────────────────────────────

function ActionModal({ title, description, danger = false, confirmLabel, onConfirm, onClose, loading, error, children }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
      onClick={() => !loading && onClose()}>
      <div className="bg-gray-900 border border-gray-700 rounded-2xl p-6 w-full max-w-md shadow-2xl"
        onClick={e => e.stopPropagation()}>
        <h3 className="font-bold text-white text-base mb-1">{title}</h3>
        {description && <p className="text-gray-400 text-sm mb-4">{description}</p>}
        {children}
        {error && <p className="text-red-400 text-xs mt-2">{error}</p>}
        <div className="flex gap-3 mt-4">
          <button onClick={onClose} disabled={loading}
            className="flex-1 px-4 py-2 bg-gray-800 border border-gray-700 text-gray-300 rounded-lg text-sm font-medium hover:bg-gray-700 transition disabled:opacity-50">
            Cancel
          </button>
          <button onClick={onConfirm} disabled={loading}
            className={`flex-1 px-4 py-2 rounded-lg text-sm font-semibold transition disabled:opacity-50 ${
              danger
                ? 'bg-red-600 hover:bg-red-700 text-white'
                : 'bg-orange-500 hover:bg-orange-600 text-white'
            }`}>
            {loading ? 'Working…' : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export default function JobDetail() {
  const { jobId } = useParams();
  const navigate  = useNavigate();
  const { user: me } = useAuth();
  const isSuper   = me?.role === 'super_admin';

  const [job,     setJob]     = useState(null);
  const [bids,    setBids]    = useState([]);
  const [payment, setPayment] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState(null);

  // Modal state
  const [modal,       setModal]       = useState(null); // 'cancel' | 'flag' | 'delete' | 'refund'
  const [modalReason, setModalReason] = useState('');
  const [modalErr,    setModalErr]    = useState('');
  const [modalBusy,   setModalBusy]   = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const { data } = await adminApi.get(`/admin/jobs/${jobId}`);
        setJob(data.job);
        setBids(data.bids || []);
        setPayment(data.payment || null);
      } catch (err) {
        setError(err.response?.data?.error || 'Failed to load job.');
      } finally {
        setLoading(false);
      }
    })();
  }, [jobId]);

  const openModal = (name) => {
    setModal(name);
    setModalReason('');
    setModalErr('');
  };
  const closeModal = () => { setModal(null); setModalErr(''); };

  const runAction = async (action, extraBody = {}) => {
    setModalBusy(true); setModalErr('');
    try {
      if (action === 'delete') {
        if (!modalReason.trim()) { setModalErr('A reason is required.'); setModalBusy(false); return; }
        await adminApi.delete(`/admin/jobs/${jobId}`, { data: { reason: modalReason } });
        navigate('/admin/jobs');
        return;
      }
      if (action === 'refund') {
        await adminApi.post(`/admin/jobs/${jobId}/refund`, { reason: modalReason, ...extraBody });
        const { data } = await adminApi.get(`/admin/jobs/${jobId}`);
        setPayment(data.payment || null);
        closeModal();
        return;
      }
      // forceJobAction: cancel / flag / unflag
      await adminApi.post(`/admin/jobs/${jobId}/action`, { action, reason: modalReason });
      const { data } = await adminApi.get(`/admin/jobs/${jobId}`);
      setJob(data.job);
      closeModal();
    } catch (err) {
      setModalErr(err.response?.data?.error || 'Action failed.');
    } finally {
      setModalBusy(false);
    }
  };

  // ── Loading / error states ────────────────────────────────────────────────

  if (loading) return (
    <div className="flex items-center justify-center h-64">
      <Loader2 size={28} className="animate-spin text-orange-400" />
    </div>
  );

  if (error) return (
    <div className="p-8 text-center">
      <p className="text-red-400 text-sm mb-4">{error}</p>
      <button onClick={() => navigate('/admin/jobs')}
        className="text-sm text-orange-400 hover:text-orange-300">
        ← Back to Jobs
      </button>
    </div>
  );

  const isFlagged = job?.is_flagged;

  return (
    <div className="p-4 sm:p-8 max-w-6xl">

      {/* Back link */}
      <Link to="/admin/jobs"
        className="inline-flex items-center gap-1.5 text-sm text-gray-400 hover:text-white mb-6 transition">
        <ArrowLeft size={14} /> Back to Jobs
      </Link>

      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-4 mb-6">
        <div>
          <div className="flex items-center gap-3 flex-wrap">
            <h1 className="text-2xl font-bold text-white">{job.title}</h1>
            <Badge
              text={(job.status || 'unknown').replace(/_/g, ' ')}
              colorClass={STATUS_COLOR[job.status] || 'bg-gray-700 text-gray-300'}
            />
            {isFlagged && <Badge text="Flagged" colorClass="bg-yellow-900 text-yellow-300" />}
            {job.dispute_status === 'open' && <Badge text="Disputed" colorClass="bg-purple-900 text-purple-300" />}
          </div>
          <p className="text-gray-500 text-xs mt-1 font-mono">{job.id}</p>
        </div>

        {/* Admin action buttons */}
        <div className="flex flex-wrap gap-2">
          {job.status !== 'cancelled' && job.status !== 'completed' && (
            <button onClick={() => openModal('cancel')}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-gray-800 border border-gray-700
                         text-gray-300 hover:border-red-600 hover:text-red-400 rounded-lg text-xs font-medium transition">
              <AlertTriangle size={13} /> Cancel Job
            </button>
          )}
          <button onClick={() => openModal(isFlagged ? 'unflag' : 'flag')}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-gray-800 border border-gray-700
                       text-gray-300 hover:border-yellow-600 hover:text-yellow-400 rounded-lg text-xs font-medium transition">
            {isFlagged ? <RotateCcw size={13} /> : <AlertTriangle size={13} />}
            {isFlagged ? 'Unflag' : 'Flag'}
          </button>
          {isSuper && payment?.status === 'captured' && (
            <button onClick={() => openModal('refund')}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-gray-800 border border-gray-700
                         text-gray-300 hover:border-orange-500 hover:text-orange-400 rounded-lg text-xs font-medium transition">
              <DollarSign size={13} /> Refund
            </button>
          )}
          {isSuper && (
            <button onClick={() => openModal('delete')}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-red-950 border border-red-900
                         text-red-400 hover:bg-red-900 rounded-lg text-xs font-medium transition">
              <Trash2 size={13} /> Delete
            </button>
          )}
        </div>
      </div>

      {/* Two-column layout */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">

        {/* LEFT — main content */}
        <div className="lg:col-span-2 space-y-6">

          {/* Description */}
          {job.description && (
            <Section title="Description">
              <p className="text-sm text-gray-300 whitespace-pre-wrap leading-relaxed">
                {job.description}
              </p>
            </Section>
          )}

          {/* Bids */}
          <Section title={`Bids (${bids.length})`}>
            {bids.length === 0 ? (
              <p className="text-sm text-gray-500 text-center py-4">No bids yet.</p>
            ) : (
              <div className="divide-y divide-gray-800 -m-4">
                {bids.map(b => (
                  <div key={b.id} className="px-4 py-3">
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <Link to={`/admin/users/${b.helper_id}`}
                            className="text-sm font-medium text-white hover:text-orange-300 transition truncate">
                            {b.helper_name}
                          </Link>
                          <span className="text-xs text-gray-500 truncate">{b.helper_email}</span>
                        </div>
                        {b.message && (
                          <p className="text-xs text-gray-400 mt-1 line-clamp-2">{b.message}</p>
                        )}
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <span className="text-sm font-semibold text-white">{money(b.amount)}</span>
                        <Badge
                          text={b.status}
                          colorClass={BID_COLOR[b.status] || 'bg-gray-700 text-gray-300'}
                        />
                      </div>
                    </div>
                    <p className="text-xs text-gray-600 mt-1">{ts(b.created_at)}</p>
                  </div>
                ))}
              </div>
            )}
          </Section>

          {/* Payment */}
          {payment && (
            <Section title="Payment">
              <dl className="grid grid-cols-2 gap-3 text-sm">
                {[
                  ['Status',        <Badge key="s" text={payment.status} colorClass={STATUS_COLOR[payment.status] || 'bg-gray-700 text-gray-300'} />],
                  ['Total Amount',  money(payment.amount)],
                  ['Helper Payout', money(payment.helper_payout)],
                  ['Platform Fee',  payment.platform_fee_cents != null ? money(payment.platform_fee_cents / 100) : '—'],
                  ['Date',          ts(payment.created_at)],
                  ['Stripe PI',     payment.stripe_payment_intent_id
                    ? <span key="pi" className="font-mono text-xs text-gray-400 truncate">{payment.stripe_payment_intent_id}</span>
                    : '—'],
                ].map(([label, val]) => (
                  <div key={label}>
                    <dt className="text-gray-500 text-xs">{label}</dt>
                    <dd className="text-white mt-0.5">{val}</dd>
                  </div>
                ))}
              </dl>
            </Section>
          )}
        </div>

        {/* RIGHT — sidebar */}
        <div className="space-y-6">

          {/* Job details */}
          <Section title="Details">
            <dl className="space-y-3 text-sm">
              {[
                [<MapPin key="loc" size={13} className="text-gray-500" />, 'Location',
                  [job.location_city, job.location_state].filter(Boolean).join(', ') || '—'],
                [<DollarSign key="bud" size={13} className="text-gray-500" />, 'Budget',
                  job.budget_min != null
                    ? `${money(job.budget_min)}${job.budget_max ? ` – ${money(job.budget_max)}` : ''}`
                    : '—'],
                [<Tag key="cat" size={13} className="text-gray-500" />, 'Category', job.category_name || '—'],
                [<Briefcase key="val" size={13} className="text-gray-500" />, 'Job Value',
                  job.job_value != null ? money(job.job_value) : '—'],
                [<Calendar key="cr" size={13} className="text-gray-500" />, 'Created', ts(job.created_at)],
                [<Calendar key="up" size={13} className="text-gray-500" />, 'Updated', ts(job.updated_at)],
              ].map(([icon, label, val]) => (
                <div key={label} className="flex items-start gap-2">
                  <span className="mt-0.5 shrink-0">{icon}</span>
                  <div className="flex-1 min-w-0">
                    <dt className="text-gray-500 text-xs">{label}</dt>
                    <dd className="text-white">{val}</dd>
                  </div>
                </div>
              ))}
            </dl>
          </Section>

          {/* Client */}
          <Section title="Client">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-full bg-gray-700 flex items-center justify-center shrink-0">
                <User size={16} className="text-gray-400" />
              </div>
              <div className="min-w-0">
                <Link to={`/admin/users/${job.client_id}`}
                  className="text-sm font-medium text-white hover:text-orange-300 transition block truncate">
                  {job.client_name}
                </Link>
                <p className="text-xs text-gray-400 truncate">{job.client_email}</p>
              </div>
            </div>
          </Section>

          {/* Helper */}
          <Section title="Helper">
            {job.helper_user_id ? (
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-full bg-gray-700 flex items-center justify-center shrink-0">
                  <User size={16} className="text-gray-400" />
                </div>
                <div className="min-w-0">
                  <Link to={`/admin/users/${job.helper_user_id}`}
                    className="text-sm font-medium text-white hover:text-orange-300 transition block truncate">
                    {job.helper_name}
                  </Link>
                  <p className="text-xs text-gray-400 truncate">{job.helper_email}</p>
                </div>
              </div>
            ) : (
              <p className="text-sm text-gray-500 italic">Unassigned</p>
            )}
          </Section>
        </div>
      </div>

      {/* ── Modals ───────────────────────────────────────────────────────────── */}

      {modal === 'cancel' && (
        <ActionModal
          title="Cancel Job"
          description="This will set the job status to cancelled."
          confirmLabel="Cancel Job"
          danger
          loading={modalBusy}
          error={modalErr}
          onClose={closeModal}
          onConfirm={() => runAction('cancel')}
        >
          <textarea rows={3} value={modalReason} onChange={e => setModalReason(e.target.value)}
            placeholder="Reason (optional)…"
            className="w-full bg-gray-800 border border-gray-700 rounded-lg text-white text-sm p-2.5
                       placeholder-gray-500 focus:border-orange-500 focus:outline-none resize-none" />
        </ActionModal>
      )}

      {(modal === 'flag' || modal === 'unflag') && (
        <ActionModal
          title={isFlagged ? 'Unflag Job' : 'Flag Job'}
          description={isFlagged ? 'Remove the flag from this job.' : 'Mark this job as flagged for review.'}
          confirmLabel={isFlagged ? 'Unflag' : 'Flag'}
          loading={modalBusy}
          error={modalErr}
          onClose={closeModal}
          onConfirm={() => runAction(isFlagged ? 'unflag' : 'flag')}
        >
          <textarea rows={3} value={modalReason} onChange={e => setModalReason(e.target.value)}
            placeholder="Reason (optional)…"
            className="w-full bg-gray-800 border border-gray-700 rounded-lg text-white text-sm p-2.5
                       placeholder-gray-500 focus:border-orange-500 focus:outline-none resize-none" />
        </ActionModal>
      )}

      {modal === 'refund' && (
        <ActionModal
          title="Issue Manual Refund"
          description="This will refund the payment to the client."
          confirmLabel="Issue Refund"
          danger
          loading={modalBusy}
          error={modalErr}
          onClose={closeModal}
          onConfirm={() => runAction('refund')}
        >
          <textarea rows={3} value={modalReason} onChange={e => setModalReason(e.target.value)}
            placeholder="Reason for refund…"
            className="w-full bg-gray-800 border border-gray-700 rounded-lg text-white text-sm p-2.5
                       placeholder-gray-500 focus:border-orange-500 focus:outline-none resize-none" />
        </ActionModal>
      )}

      {modal === 'delete' && (
        <ActionModal
          title="Permanently Delete Job"
          description="This cannot be undone. All associated bids and data will be removed."
          confirmLabel="Delete Job"
          danger
          loading={modalBusy}
          error={modalErr}
          onClose={closeModal}
          onConfirm={() => runAction('delete')}
        >
          <textarea rows={3} value={modalReason} onChange={e => { setModalReason(e.target.value); setModalErr(''); }}
            placeholder="Reason for deletion (required)…"
            className="w-full bg-gray-800 border border-gray-700 rounded-lg text-white text-sm p-2.5
                       placeholder-gray-500 focus:border-red-500 focus:outline-none resize-none" />
        </ActionModal>
      )}
    </div>
  );
}
