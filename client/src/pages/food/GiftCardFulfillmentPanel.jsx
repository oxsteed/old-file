import React, { useEffect, useRef, useState } from 'react';
import api from '../../api/axios';
import { moneyMinor } from '../../lib/moneyExact';
import {
  parseCreditMajorAmount,
  getCreditMinorUnits,
} from '../../lib/creditCurrency';

export default function GiftCardFulfillmentPanel({
  restaurantId,
  t,
  revision,
}) {
  const [cards, setCards] = useState([]),
    [report, setReport] = useState([]),
    [next, setNext] = useState(null),
    [before, setBefore] = useState(null);
  const [reportBefore, setReportBefore] = useState(null),
    [reportNext, setReportNext] = useState(null);
  const [reload, setReload] = useState(0),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [deliveryEnabled, setDeliveryEnabled] = useState(false);
  const [selected, setSelected] = useState(null),
    [reference, setReference] = useState(''),
    [recipient, setRecipient] = useState(''),
    [action, setAction] = useState('confirm_not_sent');
  const [statement, setStatement] = useState({
    cardId: '',
    currencyCode: '',
    source: '',
    externalReference: '',
    amount: '',
    note: '',
  });
  const [notice, setNotice] = useState('');
  const generation = useRef(0);
  useEffect(() => {
    const version = ++generation.current;
    setCards([]);
    setReport([]);
    setError('');
    Promise.all([
      api.get(`/restaurants/${restaurantId}/gift-cards`, {
        params: { before: before || undefined },
      }),
      api.get(`/restaurants/${restaurantId}/gift-cards/reconciliation`, {
        params: { before: reportBefore || undefined },
      }),
    ])
      .then(([a, b]) => {
        if (version !== generation.current) return;
        setCards(a.data.cards);
        setNext(a.data.next);
        setDeliveryEnabled(a.data.deliveryEnabled);
        setReport(b.data.rows);
        setReportNext(b.data.next);
      })
      .catch(() => {
        if (version === generation.current)
          setError(t('giftFulfillment.loadError'));
      });
    return () => {
      generation.current++;
    };
  }, [restaurantId, t, revision, reload, before, reportBefore]);
  useEffect(() => {
    setBefore(null);
    setReportBefore(null);
    setSelected(null);
    setStatement({
      cardId: '',
      currencyCode: '',
      source: '',
      externalReference: '',
      amount: '',
      note: '',
    });
  }, [restaurantId]);
  const refresh = () => setReload((n) => n + 1);
  const mutate = async (path, body) => {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await api.post(`/restaurants/${restaurantId}/gift-cards/${path}`, body);
      setNotice(t('giftFulfillment.saved'));
      setSelected(null);
      setReference('');
      refresh();
    } catch {
      setError(t('giftFulfillment.actionError'));
    } finally {
      setBusy(false);
    }
  };
  const print = async (card) => {
    const target = window.open('', '_blank');
    if (!target) {
      setError(t('giftFulfillment.popup'));
      return;
    }
    target.opener = null;
    setBusy(true);
    try {
      const r = await api.get(
        `/restaurants/${restaurantId}/gift-cards/${card.cardId}/print`,
        { responseType: 'text' },
      );
      const url = URL.createObjectURL(
        new Blob([r.data], { type: 'text/html' }),
      );
      target.location.replace(url);
      setTimeout(() => URL.revokeObjectURL(url), 60000);
    } catch {
      target.close();
      setError(t('giftFulfillment.actionError'));
    } finally {
      setBusy(false);
    }
  };
  const download = async () => {
    setBusy(true);
    try {
      const r = await api.get(
        `/restaurants/${restaurantId}/gift-cards/reconciliation`,
        {
          params: { format: 'csv', before: reportBefore || undefined },
          responseType: 'blob',
        },
      );
      const url = URL.createObjectURL(r.data),
        a = document.createElement('a');
      a.href = url;
      a.download = 'gift-card-reconciliation-page.csv';
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch {
      setError(t('giftFulfillment.actionError'));
    } finally {
      setBusy(false);
    }
  };
  const reconcile = async (event) => {
    event.preventDefault();
    let amount;
    try {
      amount = parseCreditMajorAmount(statement.amount, statement.currencyCode);
      if (
        /^0(?:\.0+)?$/.test(statement.amount) &&
        (statement.amount.split('.')[1]?.length || 0) <=
          getCreditMinorUnits(statement.currencyCode)
      )
        amount = 0;
      if (!Number.isSafeInteger(amount) || amount < 0) throw Error();
    } catch {
      setError(t('giftFulfillment.invalidAmount'));
      return;
    }
    await mutate(`${statement.cardId}/reconciliation`, {
      source: statement.source,
      externalReference: statement.externalReference,
      currencyCode: statement.currencyCode,
      externalBalanceCents: amount,
      note: statement.note,
    });
  };
  return (
    <div className="fd-settings-card-body">
      <h3>{t('giftFulfillment.title')}</h3>
      <p>
        {t(
          deliveryEnabled
            ? 'giftFulfillment.deliveryOn'
            : 'giftFulfillment.deliveryPaused',
        )}
      </p>
      <p>{t('giftFulfillment.printHint')}</p>
      {error && <p role="alert">{error}</p>}
      {notice && <p role="status">{notice}</p>}
      <button className="fd-btn-secondary"
        type="button"
        onClick={refresh}
        disabled={busy}
        data-track="gift.refresh"
      >
        {t('giftFulfillment.refresh')}
      </button>
      <div className="fd-table-wrap">
        <table className="fd-table">
          <thead>
            <tr>
              <th>{t('giftFulfillment.card')}</th>
              <th>{t('giftCards.amount')}</th>
              <th>{t('giftCards.status')}</th>
              <th>{t('giftFulfillment.actions')}</th>
            </tr>
          </thead>
          <tbody>
            {cards.map((card) => (
              <tr key={card.id}>
                <td>
                  #{card.cardId} · {card.codeLast4}
                </td>
                <td>{moneyMinor(card.balanceCents, card.currencyCode)}</td>
                <td>{t(`giftFulfillment.states.${card.status}`)}</td>
                <td>
                  {card.canPrint && (
                    <button className="fd-btn-secondary"
                      type="button"
                      disabled={busy}
                      onClick={() => print(card)}
                      data-track="gift.print"
                    >
                      {t('giftFulfillment.print')}
                    </button>
                  )}
                  {(card.status === 'ready' ||
                    ['failed', 'needs_review'].includes(card.status)) && (
                    <button className="fd-btn-secondary"
                      type="button"
                      disabled={busy}
                      onClick={() => {
                        setSelected(card);
                        setReference('');
                        setRecipient('');
                      }}
                      data-track="gift.manage"
                    >
                      {t(
                        card.kind === 'physical'
                          ? 'giftFulfillment.handoff'
                          : 'giftFulfillment.resolve',
                      )}
                    </button>
                  )}
                  {card.providerId && (
                    <small>
                      {t('giftFulfillment.providerReference')}:{' '}
                      {card.providerId}
                    </small>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {next && (
        <button className="fd-btn-secondary"
          type="button"
          onClick={() => setBefore(next)}
          data-track="gift.next"
        >
          {t('giftFulfillment.next')}
        </button>
      )}
      {before && (
        <button className="fd-btn-secondary"
          type="button"
          onClick={() => setBefore(null)}
          data-track="gift.first"
        >
          {t('giftFulfillment.first')}
        </button>
      )}
      {selected && (
        <form
          className="fd-settings-grid"
          onSubmit={(e) => {
            e.preventDefault();
            mutate(
              `${selected.cardId}/${selected.kind === 'physical' ? 'handoff' : 'delivery-resolution'}`,
              selected.kind === 'physical'
                ? { reference }
                : {
                    action,
                    evidence: reference,
                    ...(recipient ? { recipientEmail: recipient } : {}),
                  },
            );
          }}
          data-track="gift.fulfill"
        >
          <p>
            #{selected.cardId} ·{' '}
            {t(
              selected.kind === 'physical'
                ? 'giftFulfillment.handoffHint'
                : 'giftFulfillment.resolveHint',
            )}
          </p>
          {selected.kind === 'e_gift' && (
            <>
              <label className="fd-field">
                {t('giftFulfillment.resolution')}
                <select
                  value={action}
                  onChange={(e) => setAction(e.target.value)}
                >
                  <option value="confirm_not_sent">
                    {t('giftFulfillment.notSent')}
                  </option>
                  <option value="confirm_delivered">
                    {t('giftFulfillment.delivered')}
                  </option>
                </select>
              </label>
              {action === 'confirm_not_sent' && (
                <label className="fd-field">
                  {t('giftFulfillment.newRecipient')}
                  <input
                    type="email"
                    value={recipient}
                    onChange={(e) => setRecipient(e.target.value)}
                    maxLength={254}
                  />
                </label>
              )}
            </>
          )}
          <label className="fd-field">
            {t('giftFulfillment.evidence')}
            <input
              required
              maxLength={160}
              value={reference}
              onChange={(e) => setReference(e.target.value)}
            />
          </label>
          <button disabled={busy} data-track="gift.fulfill-save">
            {t('giftFulfillment.save')}
          </button>
          <button className="fd-btn-secondary"
            type="button"
            onClick={() => setSelected(null)}
            data-track="gift.fulfill-cancel"
          >
            {t('giftFulfillment.cancel')}
          </button>
        </form>
      )}
      <h3>{t('giftFulfillment.reconciliation')}</h3>
      <p>{t('giftFulfillment.reconciliationHint')}</p>
      <button className="fd-btn-secondary"
        type="button"
        disabled={busy}
        onClick={download}
        data-track="gift.export"
      >
        {t('giftFulfillment.export')}
      </button>
      <div className="fd-table-wrap">
        <table className="fd-table">
          <thead>
            <tr>
              <th>{t('giftFulfillment.card')}</th>
              <th>{t('giftFulfillment.balance')}</th>
              <th>{t('giftFulfillment.ledger')}</th>
              <th>{t('giftFulfillment.statement')}</th>
              <th>{t('giftFulfillment.variance')}</th>
              <th>{t('giftFulfillment.actions')}</th>
            </tr>
          </thead>
          <tbody>
            {report.map((row) => (
              <tr key={row.id}>
                <td>
                  #{row.id} · {row.code_last4}
                </td>
                <td>{moneyMinor(row.balance_cents, row.currency_code)}</td>
                <td>
                  {moneyMinor(row.ledger_balance_cents, row.currency_code)}
                  {String(row.balance_cents) !==
                    String(row.ledger_balance_cents) && (
                    <strong> · {t('giftFulfillment.mismatch')}</strong>
                  )}
                </td>
                <td>
                  {row.reconciliation_id
                    ? `${row.source} / ${row.external_reference} · ${t(row.statement_current ? 'giftFulfillment.current' : 'giftFulfillment.stale')}`
                    : t('giftFulfillment.unreconciled')}
                </td>
                <td>
                  {row.reconciliation_id
                    ? moneyMinor(row.variance_cents, row.currency_code)
                    : '—'}
                </td>
                <td>
                  <button className="fd-btn-secondary"
                    type="button"
                    onClick={() =>
                      setStatement({
                        cardId: row.id,
                        currencyCode: row.currency_code,
                        source: '',
                        externalReference: '',
                        amount: '',
                        note: '',
                      })
                    }
                    data-track="gift.record-statement"
                  >
                    {t('giftFulfillment.record')}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {reportNext && (
        <button className="fd-btn-secondary"
          type="button"
          onClick={() => setReportBefore(reportNext)}
          data-track="gift.statement-next"
        >
          {t('giftFulfillment.next')}
        </button>
      )}
      {reportBefore && (
        <button className="fd-btn-secondary"
          type="button"
          onClick={() => setReportBefore(null)}
          data-track="gift.statement-first"
        >
          {t('giftFulfillment.first')}
        </button>
      )}
      {statement.cardId && (
        <form
          className="fd-settings-grid"
          onSubmit={reconcile}
          data-track="gift.reconcile"
        >
          <p>
            #{statement.cardId} · {statement.currencyCode}
          </p>
          {['source', 'externalReference', 'amount', 'note'].map((key) => (
            <label className="fd-field" key={key}>
              {t(`giftFulfillment.${key}`)}
              <input
                required={key !== 'note'}
                value={statement[key]}
                type={key === 'amount' ? 'number' : 'text'}
                min={key === 'amount' ? 0 : undefined}
                step={
                  key === 'amount'
                    ? 10 ** -getCreditMinorUnits(statement.currencyCode)
                    : undefined
                }
                maxLength={key === 'note' ? 500 : key === 'source' ? 80 : 160}
                onChange={(e) =>
                  setStatement((s) => ({ ...s, [key]: e.target.value }))
                }
              />
            </label>
          ))}
          <button disabled={busy} data-track="gift.reconcile-save">
            {t('giftFulfillment.save')}
          </button>
        </form>
      )}
    </div>
  );
}
