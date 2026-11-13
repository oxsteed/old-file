// Business Hub > Clients > All customers: the business-scoped Customer 360.
// Shows only this business's own relationship with each customer (CRM record,
// appointments, invoices, restaurant orders) as allowed by the caller's
// permissions and store scope. Read-only; every read is audited server-side.

import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { getBusinessCustomer360, listBusinessCustomers360 } from '../../api/businesses';
import { formatDate, formatMoney } from '../../lib/format';
import '../../styles/BusinessCustomer360.css';

const K = 'businessCustomer360';

function Section({ title, state, children, copy }) {
  return (
    <section className="bc360-section" data-section-state={state}>
      <h4>{title}</h4>
      {state === 'restricted' ? <p className="bc360-muted">{copy('restricted')}</p>
        : state === 'none' ? <p className="bc360-muted">{copy('none')}</p> : children}
    </section>
  );
}

export default function BusinessCustomer360({ bizId, currency }) {
  const { t } = useTranslation();
  const copy = (key, o) => t(`${K}.${key}`, o);
  const [search, setSearch] = useState('');
  const [list, setList] = useState({ customers: [], nextCursor: null });
  const [state, setState] = useState('loading');
  const [selected, setSelected] = useState(null);
  const [detail, setDetail] = useState(null);
  const [detailState, setDetailState] = useState('idle');
  // Domain 1 #9: a failed "Load more" must not wipe the loaded list; the
  // failure is an inline notice and the More button stays for a retry.
  const [moreError, setMoreError] = useState(false);
  const latest = useRef(0);

  // Gap fill 14: keyset paging; "more" passes the server's opaque cursor.
  const load = async (cursor = null, signal) => {
    setMoreError(false);
    const data = await listBusinessCustomers360(bizId, { search: search || undefined, cursor: cursor || undefined }, { signal });
    setList((prev) => ({ ...data, customers: cursor ? [...prev.customers, ...data.customers] : data.customers }));
  };
  useEffect(() => {
    if (!bizId) return undefined;
    const c = new AbortController();
    const timer = setTimeout(() => {
      setState('loading');
      load(null, c.signal).then(() => !c.signal.aborted && setState('ready')).catch((e) => {
        if (c.signal.aborted) return;
        setState(e?.response?.status === 403 ? 'forbidden' : 'error');
      });
    }, search ? 250 : 0);
    return () => { clearTimeout(timer); c.abort(); };
  }, [bizId, search]);

  const open = async (key) => {
    const id = ++latest.current;
    setSelected(key);
    setDetailState('loading');
    try {
      const d = await getBusinessCustomer360(bizId, key);
      if (latest.current === id) { setDetail(d); setDetailState('ready'); }
    } catch {
      if (latest.current === id) setDetailState('error');
    }
  };
  const money = (cents, cur) => formatMoney((Number(cents) || 0) / 100, { currency: cur || currency });

  return (
    <div className="bc360-root">
      <p className="bc360-intro">{copy('intro')}</p>
      <label className="bc360-search">
        <span>{copy('search')}</span>
        <input type="search" value={search} maxLength={80} onChange={(e) => setSearch(e.target.value)} />
      </label>
      {state === 'loading' && <p role="status">{copy('loading')}</p>}
      {state === 'error' && <p role="alert">{copy('loadFailed')}</p>}
      {state === 'forbidden' && <p role="alert">{copy('forbidden')}</p>}
      {state === 'ready' && (
        <div className="bc360-layout">
          <div className="bc360-list">
            {list.access?.customers === 'assigned' && <p className="bc360-muted">{copy('assignedOnly')}</p>}
            {!list.customers.length ? <p>{copy('empty')}</p> : (
              <ul>
                {list.customers.map((c) => (
                  <li key={c.key}>
                    <button type="button" aria-pressed={selected === c.key} onClick={() => open(c.key)} data-customer={c.key} data-track="ui.31436a55e3.1">
                      <strong><bdi>{c.name || copy('unnamed')}</bdi></strong>
                      <span>{(c.via || []).map((v) => copy(`via.${v}`)).join(' · ')}</span>
                      {c.lastAt && <span>{copy('lastSeen', { date: formatDate(c.lastAt) })}</span>}
                    </button>
                  </li>
                ))}
              </ul>
            )}
            {list.nextCursor && (
              <button type="button" className="bct-btn ghost" onClick={() => load(list.nextCursor).catch(() => setMoreError(true))} data-track="ui.31436a55e3.2">{copy('more')}</button>
            )}
            {moreError && <p role="alert">{copy('moreFailed')}</p>}
          </div>
          <div className="bc360-detail" aria-live="polite">
            {detailState === 'idle' && <p className="bc360-muted">{copy('pick')}</p>}
            {detailState === 'loading' && <p role="status">{copy('loading')}</p>}
            {detailState === 'error' && (
              <div>
                <p role="alert">{copy('loadFailed')}</p>
                <button type="button" onClick={() => selected && open(selected)}>{copy('retry')}</button>
              </div>
            )}
            {detailState === 'ready' && detail && (
              <article data-panel="business-customer360">
                <h3><bdi>{detail.customer.name || copy('unnamed')}</bdi></h3>
                <p className="bc360-muted">{copy('scopeNote')}</p>
                {detail.customer.client ? (
                  <dl className="bc360-facts">
                    <div><dt>{copy('status')}</dt><dd>{t(`businessClients.status.${detail.customer.client.status}`, { defaultValue: detail.customer.client.status })}</dd></div>
                    {detail.customer.client.email && <div><dt>{copy('email')}</dt><dd><bdi>{detail.customer.client.email}</bdi></dd></div>}
                    {detail.customer.client.phone && <div><dt>{copy('phone')}</dt><dd><bdi dir="ltr">{detail.customer.client.phone}</bdi></dd></div>}
                    <div><dt>{copy('lifetime')}</dt><dd>{money(detail.customer.client.lifetimeValueCents)}</dd></div>
                    {detail.customer.client.notes && <div><dt>{copy('notes')}</dt><dd>{detail.customer.client.notes}</dd></div>}
                  </dl>
                ) : <p className="bc360-muted">{copy('noCrm')}</p>}
                <Section title={copy('appointments', { count: detail.sections.appointments.total || 0 })} state={detail.sections.appointments.state} copy={copy}>
                  {detail.sections.appointments.noShows > 0 && <p>{copy('noShows', { count: detail.sections.appointments.noShows })}</p>}
                  <ul>{(detail.sections.appointments.items || []).map((a) => (
                    <li key={a.id}><bdi>{a.service || '—'}</bdi> · {formatDate(a.at)} · {copy(`appointmentStatus.${a.status}`)}</li>
                  ))}</ul>
                </Section>
                <Section title={copy('orders', { count: detail.sections.orders.total || 0 })} state={detail.sections.orders.state} copy={copy}>
                  <p>{copy('paid', { amount: money(detail.sections.orders.paidCents) })}</p>
                  {detail.sections.orders.partialStores && <p className="bc360-muted">{copy('partialStores')}</p>}
                  <ul>{(detail.sections.orders.items || []).map((o) => (
                    <li key={o.id}><bdi>{o.restaurant}</bdi> · {formatDate(o.at)} · {money(o.totalCents, o.currency)} · {copy(`orderStatus.${o.status}`)}</li>
                  ))}</ul>
                </Section>
                <Section title={copy('invoices', { count: detail.sections.invoices.total || 0 })} state={detail.sections.invoices.state} copy={copy}>
                  <p>{copy('outstanding', { amount: formatMoney(detail.sections.invoices.outstanding, { currency }) })}</p>
                  <ul>{(detail.sections.invoices.items || []).map((i) => (
                    <li key={i.id}><bdi dir="ltr">{i.number}</bdi> · {formatDate(i.issued)} · {formatMoney(i.total, { currency })} · {copy(`invoiceStatus.${i.status}`)}</li>
                  ))}</ul>
                </Section>
              </article>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
