import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { acceptQuoteVersion } from '../../api/logistics';
import { formatCreditMinorUnits } from '../../lib/creditCurrency';
import '../../styles/logistics/LogisticsCheckout.css';

/**
 * QuoteAcceptanceGate - blocks payment until the buyer accepts the current
 * quote version (Phase 3).
 *
 * Props:
 *  - quote: checkout-context quote object, with a non-null pending_version:
 *      { id, version, status,
 *        pending_version: { id, version, vs_version, total_delta_cents,
 *          changes: [{ label, kind: 'added'|'removed'|'changed',
 *                      previous_cents, current_cents }] } }
 *  - onAccepted(nextQuote): called after the server confirms acceptance.
 *  - onDecline(): optional, called when the buyer defers ("Not now").
 *
 * Never allows paying against a superseded quote: the parent must not
 * render payment controls while this gate is shown.
 */
export default function QuoteAcceptanceGate({ quote, onAccepted, onDecline }) {
  const { t } = useTranslation();
  const tx = (key, fallback, opts = {}) => t(key, { defaultValue: fallback, ...opts });
  const [accepting, setAccepting] = useState(false);
  const [error, setError] = useState(null);

  const pending = quote?.pending_version;
  if (!quote || !pending) return null;

  const money = (cents) => formatCreditMinorUnits(cents ?? 0, 'USD');
  const changes = pending.changes || [];
  const delta = pending.total_delta_cents ?? 0;

  const accept = async () => {
    if (accepting) return;
    setAccepting(true);
    setError(null);
    try {
      // Fresh idempotency key per acceptance click; a double-click retries
      // the same logical acceptance without creating duplicates server-side.
      const key = globalThis.crypto?.randomUUID
        ? globalThis.crypto.randomUUID()
        : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
      const res = await acceptQuoteVersion(pending.id, key);
      onAccepted?.(res?.data?.quote || res?.quote || null);
    } catch (err) {
      setError(
        err.response?.data?.error
        || err.response?.data?.message
        || tx('logistics.checkout.errors.generic', 'Something went wrong. Please try again.')
      );
    } finally {
      setAccepting(false);
    }
  };

  const changeBadge = (kind) => {
    if (kind === 'added') return tx('logistics.quotes.diff.added', 'Added');
    if (kind === 'removed') return tx('logistics.quotes.diff.removed', 'Removed');
    return tx('logistics.quotes.diff.changed', 'Changed');
  };

  return (
    <section className="lx-quote-gate" aria-labelledby="lx-quote-gate-title">
      <h3 id="lx-quote-gate-title">{tx('logistics.quotes.accept.title', 'A new quote needs your acceptance')}</h3>
      <p className="lx-t-small" style={{ lineHeight: 1.7 }}>
        {tx(
          'logistics.quotes.accept.body',
          'Version {{version}} replaces version {{previous}}. Review what changed, then accept it to continue to payment. You cannot pay against the older version.',
          { version: pending.version, previous: pending.vs_version ?? quote.version ?? '—' }
        )}
      </p>

      <h4 className="lx-t-small lx-t-bold lx-mt-6 lx-mb-4">{tx('logistics.quotes.diff.title', 'What changed')}</h4>
      {changes.length > 0 ? (
        <div className="lx-table-wrap">
          <table className="lx-table lx-t-small">
            <thead>
              <tr>
                <th scope="col">{tx('logistics.checkout.quote.itemized', 'Itemized costs')}</th>
                <th scope="col">{tx('logistics.quotes.diff.title', 'What changed')}</th>
                <th scope="col" style={{ textAlign: 'end' }}>{tx('logistics.checkout.status.amount', 'Amount')}</th>
              </tr>
            </thead>
            <tbody>
              {changes.map((change, idx) => (
                <tr key={`${change.label}-${idx}`}>
                  <td>{change.label}</td>
                  <td>
                    <span className={`lx-diff-change lx-diff-change--${change.kind}`}>
                      {changeBadge(change.kind)}
                    </span>
                  </td>
                  <td style={{ textAlign: 'end' }}>
                    {change.kind === 'added' && money(change.current_cents)}
                    {change.kind === 'removed' && (
                      <span style={{ textDecoration: 'line-through' }}>{money(change.previous_cents)}</span>
                    )}
                    {change.kind === 'changed' && (
                      <>
                        <span style={{ textDecoration: 'line-through' }} className="lx-t-faint">
                          {money(change.previous_cents)}
                        </span>{' '}
                        <strong>{money(change.current_cents)}</strong>
                      </>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="lx-t-small lx-t-faint">{tx('logistics.quotes.diff.noChanges', 'No line-item changes in this version.')}</p>
      )}

      {pending && (
        <p className="lx-t-small lx-mt-6">
          <strong>
            {tx('logistics.quotes.diff.totalChange', 'Total changed by {{amount}}', { amount: money(Math.abs(delta)) })}
          </strong>{' '}
          <span className="lx-t-faint">
            ({delta >= 0
              ? tx('logistics.quotes.increase', 'increase')
              : tx('logistics.quotes.decrease', 'decrease')})
          </span>
        </p>
      )}

      {error && (
        <div className="lx-callout lx-callout--danger lx-mt-6" role="alert">
          <p>{error}</p>
        </div>
      )}

      <div className="lx-btn-row lx-mt-6">
        <button
          type="button"
          className="lx-action-primary"
          onClick={accept}
          disabled={accepting}
          aria-busy={accepting} data-track="ui.7d46cf6dd7.1"
        >
          {accepting
            ? tx('logistics.quotes.accept.accepting', 'Accepting…')
            : tx('logistics.quotes.accept.button', 'Accept quote version {{version}}', { version: pending.version })}
        </button>
        {onDecline && (
          <button type="button" className="lx-action-ghost" onClick={onDecline} disabled={accepting} data-track="ui.7d46cf6dd7.2">
            {tx('logistics.quotes.accept.decline', 'Not now')}
          </button>
        )}
      </div>
      <p className="lx-t-xs lx-t-faint lx-mt-6">
        {tx('logistics.quotes.accept.cannotPayOld', 'Payment is paused until you accept the current quote.')}
      </p>
    </section>
  );
}
