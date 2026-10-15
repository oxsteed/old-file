import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import PageShell from '../../components/PageShell';
import LogisticsLayout from '../../components/logistics/LogisticsLayout';
import { listMyPaymentAttempts } from '../../api/logistics';
import { formatCreditMinorUnits } from '../../lib/creditCurrency';
import '../../styles/logistics/LogisticsHomePage.css';
import '../../styles/logistics/LogisticsWorkspaces.css';
import '../../styles/logistics/LogisticsCheckout.css';

/**
 * LogisticsPaymentsPage - buyer-facing list of all logistics payment
 * attempts (Phase 3).
 *
 * Each row shows the attempt state (pending / processing / succeeded /
 * failed / refunded) plus an explicit settled-vs-awaiting badge: "Settled"
 * appears only when the server confirmed settlement (Stripe webhook or a
 * committed Credit reversal). Awaiting rows link back to checkout for
 * status polling / retry.
 */
export default function LogisticsPaymentsPage() {
  const { t, i18n } = useTranslation();
  const tx = (key, fallback, opts = {}) => t(key, { defaultValue: fallback, ...opts });
  const [attempts, setAttempts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const load = () => {
    setLoading(true);
    setError(null);
    listMyPaymentAttempts({ limit: 50 })
      .then((res) => setAttempts(res?.data?.attempts || res?.attempts || []))
      .catch((err) => setError(
        err.response?.data?.error
        || err.response?.data?.message
        || tx('logistics.checkout.loadError', 'We could not load this checkout. Please try again.')
      ))
      .finally(() => setLoading(false));
  };

  useEffect(() => { load(); }, []);

  const money = (cents) => formatCreditMinorUnits(cents ?? 0, 'USD');
  // Static key map (kept literal so the i18n static-key gate can verify it).
  // Server attempt statuses: pending | processing | succeeded | failed | canceled.
  const stateLabel = (status) => {
    switch (status) {
      case 'pending': return tx('logistics.checkout.payments.states.pending', 'Pending');
      case 'processing': return tx('logistics.checkout.payments.states.processing', 'Processing');
      case 'succeeded': return tx('logistics.checkout.payments.states.succeeded', 'Succeeded');
      case 'failed': return tx('logistics.checkout.payments.states.failed', 'Failed');
      case 'canceled': return tx('logistics.checkout.payments.states.canceled', 'Canceled');
      case 'refunded': return tx('logistics.checkout.payments.states.refunded', 'Refunded');
      default: return status;
    }
  };
  const installmentLabel = (name) => (name === 'final'
    ? tx('logistics.checkout.schedule.final', 'Final balance')
    : tx('logistics.checkout.schedule.deposit', 'Deposit'));
  const methodLabel = (m) => (m === 'credit'
    ? tx('logistics.checkout.method.credit', 'OxSteed Credit')
    : tx('logistics.checkout.method.stripe', 'Card via Stripe'));

  const renderBody = () => {
    if (loading) {
      return (
        <div className="lx-loading" role="status" aria-live="polite">
          <span className="lx-spinner" aria-hidden="true" />
          {tx('logistics.checkout.loading', 'Loading checkout…')}
        </div>
      );
    }
    if (error) {
      return (
        <div className="lx-empty" role="alert">
          <p>{error}</p>
          <button type="button" onClick={load} className="lx-action-secondary">
            {tx('logistics.workspace.dataError.retry', 'Try again')}
          </button>
        </div>
      );
    }
    if (attempts.length === 0) {
      return (
        <div className="lx-empty" role="status">
          <div className="lx-empty-icon" aria-hidden="true">💳</div>
          <p>{tx('logistics.checkout.payments.empty', 'No payment attempts yet.')}</p>
          <Link to="/logistics/buyer" className="lx-action-secondary">
            {tx('logistics.checkout.backToDashboard', 'Back to buyer dashboard')}
          </Link>
        </div>
      );
    }
    return (
      <div className="lx-card">
        <div className="lx-table-wrap">
          <table className="lx-table lx-t-small">
            <thead>
              <tr>
                <th scope="col">{tx('logistics.checkout.payments.headers.date', 'Date')}</th>
                <th scope="col">{tx('logistics.checkout.payments.headers.reference', 'Reference')}</th>
                <th scope="col">{tx('logistics.checkout.payments.headers.installment', 'Installment')}</th>
                <th scope="col">{tx('logistics.checkout.payments.headers.method', 'Method')}</th>
                <th scope="col" style={{ textAlign: 'end' }}>{tx('logistics.checkout.payments.headers.amount', 'Amount')}</th>
                <th scope="col">{tx('logistics.checkout.payments.headers.status', 'Status')}</th>
              </tr>
            </thead>
            <tbody>
              {attempts.map((a) => {
                // 'succeeded' is set only with settled_at by the signed
                // webhook / committed Credit settlement: it means settled.
                const settled = a.status === 'succeeded';
                const subjectId = a.purchase_order_id || a.participant_id;
                const checkoutHref = a.subject_type === 'purchase_order' && a.purchase_order_id
                  ? `/logistics/checkout?purchase_order_id=${a.purchase_order_id}&installment=${a.installment}`
                  : a.subject_type === 'pooled_participant' && a.participant_id
                    ? `/logistics/checkout?participant_id=${a.participant_id}&installment=${a.installment}`
                    : null;
                return (
                  <tr key={a.id}>
                    <td>{a.created_at ? new Date(a.created_at).toLocaleDateString(i18n.language) : '—'}</td>
                    <td>
                      {checkoutHref && !settled ? (
                        <Link to={checkoutHref} className="lx-link">{a.reference || (subjectId ? `#${subjectId}` : `#${a.id}`)}</Link>
                      ) : (
                        <span className="lx-code">{a.reference || (subjectId ? `#${subjectId}` : `#${a.id}`)}</span>
                      )}
                    </td>
                    <td>{installmentLabel(a.installment)}</td>
                    <td>{methodLabel(a.method)}</td>
                    <td style={{ textAlign: 'end' }} className="lx-t-bold">{money(a.amount_cents)}</td>
                    <td>
                      <span className="lx-t-small">{stateLabel(a.status)}</span>
                      <br />
                      <span className={`lx-settle-badge ${settled ? 'lx-settle-badge--settled' : 'lx-settle-badge--awaiting'}`}>
                        {settled
                          ? tx('logistics.checkout.payments.settledBadge', 'Settled')
                          : tx('logistics.checkout.payments.awaitingBadge', 'Awaiting settlement')}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    );
  };

  return (
    <PageShell>
      <LogisticsLayout
        title={tx('logistics.checkout.payments.title', 'My logistics payments')}
        subtitle={tx('logistics.checkout.payments.subtitle', 'Every payment attempt, with settlement confirmed by OxSteed.')}
      >
        <div className="lx-workspaces">{renderBody()}</div>
      </LogisticsLayout>
    </PageShell>
  );
}
