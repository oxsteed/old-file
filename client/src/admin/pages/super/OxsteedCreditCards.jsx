import { useEffect, useRef, useState } from 'react';
import { CreditCard, RefreshCw } from 'lucide-react';
import adminApi from '../../../lib/adminApi';
import { createStableIdempotencyKeyStore } from './creditIdempotency';
import { formatCreditDateTime } from '../../../lib/creditDateTime';
import { safeCreditErrorMessage } from '../../../lib/creditErrors';

// NOTE: this admin surface is not yet part of the credit i18n contract
// (see client/scripts/verify-i18n.mjs verifyCreditTranslationSurface) -- it
// intentionally ships in English first, matching how the rest of the main
// admin console still has unlocalized workflow copy pending. Localize this
// alongside the next full i18n pass rather than partially wiring it now.

const CARD_STATUSES = ['pending', 'active', 'frozen', 'lost', 'stolen', 'revoked', 'expired'];
const CARD_TYPES = ['virtual', 'physical'];
const FULFILLMENT_ORDER = ['pending', 'printed', 'shipped', 'delivered'];
const CARD_PAGE_SIZE = 50;

function statusClass(status) {
  if (status === 'active') return 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300';
  if (status === 'pending') return 'border-sky-500/30 bg-sky-500/10 text-sky-300';
  if (status === 'frozen') return 'border-amber-500/30 bg-amber-500/10 text-amber-300';
  if (['lost', 'stolen', 'revoked', 'expired'].includes(status)) return 'border-red-500/30 bg-red-500/10 text-red-300';
  return 'border-gray-700 bg-gray-900 text-gray-400';
}

function Badge({ status }) {
  return <span className={`inline-flex rounded-full border px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.14em] ${statusClass(status)}`}>{status}</span>;
}

function dateTime(value) {
  return formatCreditDateTime(value, value ? 'Unknown' : 'Not available');
}

function nextFulfillmentStatus(current) {
  const index = FULFILLMENT_ORDER.indexOf(current);
  return index >= 0 && index < FULFILLMENT_ORDER.length - 1 ? FULFILLMENT_ORDER[index + 1] : null;
}

const emptyForm = {
  cardType: 'virtual',
  customerId: '',
  currencyCode: 'USD',
  nickname: '',
  reason: '',
  addressLine1: '',
  city: '',
  state: '',
  postalCode: '',
  country: 'US',
};

export default function OxsteedCreditCards({ currencyOptions = ['USD'], busy = false }) {
  const [cards, setCards] = useState([]);
  const [statusFilter, setStatusFilter] = useState('all');
  const [cardTypeFilter, setCardTypeFilter] = useState('all');
  const [customerFilter, setCustomerFilter] = useState('');
  const [appliedCustomerFilter, setAppliedCustomerFilter] = useState('');
  const [offset, setOffset] = useState(0);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [form, setForm] = useState(emptyForm);
  // One-time secrets (raw credential / activation code) are shown once, right
  // after the mutation that minted them, then discarded from state -- never
  // persisted or refetchable.
  const [revealedSecret, setRevealedSecret] = useState(null);
  const idempotencyKeysRef = useRef(createStableIdempotencyKeyStore());

  const load = async () => {
    setLoading(true);
    setError('');
    try {
      const params = { limit: CARD_PAGE_SIZE, offset };
      if (statusFilter !== 'all') params.status = statusFilter;
      if (cardTypeFilter !== 'all') params.cardType = cardTypeFilter;
      if (appliedCustomerFilter) params.customerId = appliedCustomerFilter;
      const response = await adminApi.get('/admin/super/oxsteed-credit/cards', { params });
      setCards(response.data?.cards || []);
    } catch (err) {
      setError(safeCreditErrorMessage(err, 'Unable to load OxSteed Credit cards.'));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, [statusFilter, cardTypeFilter, appliedCustomerFilter, offset]);

  const submitIssue = async (event) => {
    event.preventDefault();
    if (!form.customerId.trim()) {
      setError('A customer UUID is required to issue a card.');
      return;
    }
    if (form.cardType === 'physical' && !form.addressLine1.trim()) {
      setError('A shipping address is required for a physical card.');
      return;
    }
    setSaving(true);
    setError('');
    setNotice('');
    setRevealedSecret(null);
    try {
      const basePayload = {
        customerId: form.customerId.trim(),
        currencyCode: form.currencyCode,
        nickname: form.nickname.trim() || undefined,
        reason: form.reason.trim() || undefined,
      };
      const isPhysical = form.cardType === 'physical';
      const payload = isPhysical ? {
        ...basePayload,
        shippingAddress: {
          line1: form.addressLine1.trim(),
          city: form.city.trim() || undefined,
          state: form.state.trim() || undefined,
          postalCode: form.postalCode.trim() || undefined,
          country: form.country.trim() || 'US',
        },
      } : basePayload;
      const endpoint = isPhysical
        ? '/admin/super/oxsteed-credit/cards/issue-physical'
        : '/admin/super/oxsteed-credit/cards/issue-virtual';
      const response = await adminApi.post(endpoint, payload, {
        headers: { 'Idempotency-Key': idempotencyKeysRef.current.get('credit-card-issue', payload) },
      });
      idempotencyKeysRef.current.clear('credit-card-issue', payload);
      const card = response.data?.card;
      if (card?.credential) {
        setRevealedSecret({ type: 'credential', value: card.credential, cardId: card.id });
      }
      setNotice(response.data?.replayed
        ? 'This card was already issued for that idempotency key.'
        : isPhysical
          ? 'Physical card created and queued for fulfillment.'
          : 'Virtual card issued and active immediately.');
      setForm(emptyForm);
      await load();
    } catch (err) {
      setError(safeCreditErrorMessage(err, 'Unable to issue this card.'));
    } finally {
      setSaving(false);
    }
  };

  const advanceFulfillment = async (card) => {
    const target = nextFulfillmentStatus(card.fulfillmentStatus);
    if (!target) return;
    setSaving(true);
    setError('');
    setNotice('');
    setRevealedSecret(null);
    try {
      const payload = { fulfillmentStatus: target };
      const response = await adminApi.post(`/admin/super/oxsteed-credit/cards/${card.id}/fulfillment`, payload, {
        headers: { 'Idempotency-Key': idempotencyKeysRef.current.get(`credit-card-fulfillment-${card.id}`, payload) },
      });
      idempotencyKeysRef.current.clear(`credit-card-fulfillment-${card.id}`, payload);
      const updated = response.data?.card;
      if (updated?.activationCode) {
        setRevealedSecret({ type: 'activationCode', value: updated.activationCode, cardId: card.id });
      }
      setNotice(`Card moved to "${target}".`);
      await load();
    } catch (err) {
      setError(safeCreditErrorMessage(err, 'Unable to update fulfillment status.'));
    } finally {
      setSaving(false);
    }
  };

  const revoke = async (card) => {
    const reason = window.prompt(`Reason for revoking this card (${card.credentialLast4 ? `ending ${card.credentialLast4}` : card.id})?`);
    if (reason === null) return;
    if (!reason.trim()) {
      setError('A reason is required to revoke a card.');
      return;
    }
    setSaving(true);
    setError('');
    setNotice('');
    setRevealedSecret(null);
    try {
      const payload = { reason: reason.trim() };
      const response = await adminApi.post(`/admin/super/oxsteed-credit/cards/${card.id}/revoke`, payload, {
        headers: { 'Idempotency-Key': idempotencyKeysRef.current.get(`credit-card-revoke-${card.id}`, payload) },
      });
      idempotencyKeysRef.current.clear(`credit-card-revoke-${card.id}`, payload);
      setNotice(response.data?.replayed ? 'This card was already revoked.' : 'Card revoked.');
      await load();
    } catch (err) {
      setError(safeCreditErrorMessage(err, 'Unable to revoke this card.'));
    } finally {
      setSaving(false);
    }
  };

  return <section className="rounded-2xl border border-gray-800 bg-[#111318] p-4 sm:p-5">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div>
        <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-orange-400">OxSteed Credit Cards</p>
        <h2 className="mt-1 flex items-center gap-2 text-lg font-semibold text-white"><CreditCard className="h-4 w-4 text-orange-400" /> Issuance &amp; Card Management</h2>
        <p className="mt-1 max-w-3xl text-xs leading-5 text-gray-500">
          Issue a virtual card instantly, or start a physical card's fulfillment queue, directly for a customer who has
          not requested one themselves. Every card is only a credential onto that customer's existing Credit account --
          no new balance is created here.
        </p>
      </div>
      <button type="button" onClick={load} disabled={loading || saving || busy} className="inline-flex items-center gap-2 rounded-xl border border-gray-700 bg-gray-900/70 px-3 py-2 text-xs font-semibold text-gray-300 hover:bg-gray-800 disabled:opacity-50">
        <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} /> Refresh
      </button>
    </div>

    {(error || notice) && (
      <div role={error ? 'alert' : 'status'} aria-live="polite" className={`mt-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border px-3 py-3 text-xs ${error ? 'border-red-500/30 bg-red-950/20 text-red-300' : 'border-emerald-500/30 bg-emerald-950/20 text-emerald-300'}`}>
        <span>{error || notice}</span>
        {error && <button type="button" onClick={load} disabled={loading || saving || busy} className="rounded-lg border border-red-400/30 px-3 py-1.5 font-semibold text-red-200 hover:bg-red-500/10 disabled:opacity-50">Retry</button>}
      </div>
    )}

    {revealedSecret && (
      <div role="alert" aria-live="assertive" className="mt-4 rounded-xl border border-orange-500/40 bg-orange-950/20 p-4 text-xs text-orange-200">
        <p className="font-bold uppercase tracking-[0.12em] text-orange-300">
          {revealedSecret.type === 'credential' ? 'One-time card credential -- shown only now' : 'One-time activation code -- shown only now'}
        </p>
        <p className="mt-2 break-all rounded-lg border border-orange-500/30 bg-black/30 px-3 py-2 font-mono text-sm text-white">{revealedSecret.value}</p>
        <p className="mt-2 text-orange-300/80">
          {revealedSecret.type === 'credential'
            ? 'Hand this to the customer now. It cannot be retrieved again -- reporting the card lost and reissuing is the only recovery path.'
            : 'Print or relay this code to the customer with the physical card. They will enter it once to activate the card after delivery.'}
        </p>
      </div>
    )}

    <form onSubmit={submitIssue} className="mt-5 grid gap-3 rounded-xl border border-gray-800 bg-gray-950/40 p-4 sm:grid-cols-2 lg:grid-cols-4">
      <label className="lg:col-span-2">
        <span className="mb-1 block text-xs font-semibold text-gray-500">Customer UUID</span>
        <input required value={form.customerId} onChange={(event) => setForm({ ...form, customerId: event.target.value })} placeholder="e.g. 11111111-1111-4111-8111-111111111111" className="w-full rounded-xl border border-gray-700 bg-gray-950 px-3 py-3 text-sm text-white outline-none focus:border-orange-400" />
      </label>
      <label>
        <span className="mb-1 block text-xs font-semibold text-gray-500">Card type</span>
        <select value={form.cardType} onChange={(event) => setForm({ ...form, cardType: event.target.value })} className="w-full rounded-xl border border-gray-700 bg-gray-950 px-3 py-3 text-sm text-white outline-none focus:border-orange-400">
          {CARD_TYPES.map((type) => <option key={type} value={type}>{type === 'virtual' ? 'Virtual (active immediately)' : 'Physical (ships to customer)'}</option>)}
        </select>
      </label>
      <label>
        <span className="mb-1 block text-xs font-semibold text-gray-500">Currency</span>
        <select value={form.currencyCode} onChange={(event) => setForm({ ...form, currencyCode: event.target.value })} className="w-full rounded-xl border border-gray-700 bg-gray-950 px-3 py-3 text-sm text-white outline-none focus:border-orange-400">
          {currencyOptions.map((code) => <option key={code} value={code}>{code}</option>)}
        </select>
      </label>
      <label>
        <span className="mb-1 block text-xs font-semibold text-gray-500">Nickname (optional)</span>
        <input value={form.nickname} onChange={(event) => setForm({ ...form, nickname: event.target.value })} placeholder="e.g. Support replacement" className="w-full rounded-xl border border-gray-700 bg-gray-950 px-3 py-3 text-sm text-white outline-none focus:border-orange-400" />
      </label>
      <label className="lg:col-span-3">
        <span className="mb-1 block text-xs font-semibold text-gray-500">Reason (recorded on the audit trail)</span>
        <input value={form.reason} onChange={(event) => setForm({ ...form, reason: event.target.value })} placeholder="e.g. Support-driven replacement per ticket #4821" className="w-full rounded-xl border border-gray-700 bg-gray-950 px-3 py-3 text-sm text-white outline-none focus:border-orange-400" />
      </label>

      {form.cardType === 'physical' && <>
        <label className="lg:col-span-2">
          <span className="mb-1 block text-xs font-semibold text-gray-500">Shipping address line 1</span>
          <input required value={form.addressLine1} onChange={(event) => setForm({ ...form, addressLine1: event.target.value })} className="w-full rounded-xl border border-gray-700 bg-gray-950 px-3 py-3 text-sm text-white outline-none focus:border-orange-400" />
        </label>
        <label>
          <span className="mb-1 block text-xs font-semibold text-gray-500">City</span>
          <input value={form.city} onChange={(event) => setForm({ ...form, city: event.target.value })} className="w-full rounded-xl border border-gray-700 bg-gray-950 px-3 py-3 text-sm text-white outline-none focus:border-orange-400" />
        </label>
        <label>
          <span className="mb-1 block text-xs font-semibold text-gray-500">State / region</span>
          <input value={form.state} onChange={(event) => setForm({ ...form, state: event.target.value })} className="w-full rounded-xl border border-gray-700 bg-gray-950 px-3 py-3 text-sm text-white outline-none focus:border-orange-400" />
        </label>
        <label>
          <span className="mb-1 block text-xs font-semibold text-gray-500">Postal code</span>
          <input value={form.postalCode} onChange={(event) => setForm({ ...form, postalCode: event.target.value })} className="w-full rounded-xl border border-gray-700 bg-gray-950 px-3 py-3 text-sm text-white outline-none focus:border-orange-400" />
        </label>
        <label>
          <span className="mb-1 block text-xs font-semibold text-gray-500">Country</span>
          <input value={form.country} onChange={(event) => setForm({ ...form, country: event.target.value })} className="w-full rounded-xl border border-gray-700 bg-gray-950 px-3 py-3 text-sm text-white outline-none focus:border-orange-400" />
        </label>
      </>}

      <button disabled={busy || saving} className="self-end rounded-xl bg-orange-500 px-4 py-3 text-sm font-semibold text-white hover:bg-orange-400 disabled:opacity-50 lg:col-span-1">
        {saving ? 'Issuing...' : form.cardType === 'physical' ? 'Start physical card' : 'Issue virtual card'}
      </button>
    </form>

    <div className="mt-5 flex flex-wrap items-center justify-between gap-3">
      <h3 className="text-sm font-semibold text-white">All cards</h3>
      <div className="flex flex-wrap items-center justify-end gap-2">
        <input value={customerFilter} onChange={(event) => setCustomerFilter(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') { setAppliedCustomerFilter(customerFilter.trim()); setOffset(0); } }} placeholder="Filter by customer UUID" className="rounded-lg border border-gray-700 bg-gray-950 px-3 py-2 text-xs text-white outline-none focus:border-orange-400" />
        <button type="button" onClick={() => { setAppliedCustomerFilter(customerFilter.trim()); setOffset(0); }} disabled={loading || saving} className="rounded-lg bg-sky-600 px-3 py-2 text-xs font-semibold text-white hover:bg-sky-500 disabled:opacity-50">Search</button>
        <select value={cardTypeFilter} onChange={(event) => { setCardTypeFilter(event.target.value); setOffset(0); }} className="rounded-lg border border-gray-700 bg-gray-950 px-3 py-2 text-xs text-white outline-none focus:border-orange-400">
          <option value="all">All types</option>
          {CARD_TYPES.map((type) => <option key={type} value={type}>{type}</option>)}
        </select>
        <select value={statusFilter} onChange={(event) => { setStatusFilter(event.target.value); setOffset(0); }} className="rounded-lg border border-gray-700 bg-gray-950 px-3 py-2 text-xs text-white outline-none focus:border-orange-400">
          <option value="all">All statuses</option>
          {CARD_STATUSES.map((status) => <option key={status} value={status}>{status}</option>)}
        </select>
        <button type="button" onClick={() => setOffset((current) => Math.max(0, current - CARD_PAGE_SIZE))} disabled={loading || saving || offset === 0} className="rounded-lg border border-gray-700 px-3 py-2 text-xs font-semibold text-gray-300 hover:bg-gray-800 disabled:opacity-50">Previous</button>
        <button type="button" onClick={() => setOffset((current) => current + CARD_PAGE_SIZE)} disabled={loading || saving || cards.length < CARD_PAGE_SIZE} className="rounded-lg border border-gray-700 px-3 py-2 text-xs font-semibold text-gray-300 hover:bg-gray-800 disabled:opacity-50">Next</button>
      </div>
    </div>

    <div className="mt-3 overflow-x-auto rounded-xl border border-gray-800">
      <table className="min-w-[900px] w-full text-left text-xs">
        <thead className="bg-gray-950/70 text-gray-500">
          <tr>
            <th className="px-3 py-3 font-medium">Customer</th>
            <th className="px-3 py-3 font-medium">Type</th>
            <th className="px-3 py-3 font-medium">Status</th>
            <th className="px-3 py-3 font-medium">Fulfillment</th>
            <th className="px-3 py-3 font-medium">Last 4</th>
            <th className="px-3 py-3 font-medium">Issued</th>
            <th className="px-3 py-3 font-medium">Actions</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-800">
          {loading ? <tr><td colSpan="7" className="px-3 py-10 text-center text-gray-500">Loading...</td></tr>
            : !cards.length ? <tr><td colSpan="7" className="px-3 py-10 text-center text-gray-500">No cards match these filters.</td></tr>
            : cards.map((card) => {
              const nextStatus = card.cardType === 'physical' ? nextFulfillmentStatus(card.fulfillmentStatus) : null;
              const canRevoke = !['revoked', 'expired'].includes(card.status);
              return <tr key={card.id}>
                <td className="px-3 py-3 font-mono text-[10px] text-gray-500">{card.customerId}</td>
                <td className="px-3 py-3 text-white">{card.cardType}{card.nickname ? <p className="mt-1 text-gray-600">{card.nickname}</p> : null}</td>
                <td className="px-3 py-3"><Badge status={card.status} /></td>
                <td className="px-3 py-3 text-gray-400">{card.cardType === 'physical' ? card.fulfillmentStatus : '--'}</td>
                <td className="px-3 py-3 font-mono text-gray-400">{card.credentialLast4 || '----'}</td>
                <td className="px-3 py-3 text-gray-500">{dateTime(card.issuedAt)}</td>
                <td className="px-3 py-3">
                  <div className="flex flex-wrap gap-2">
                    {nextStatus && <button type="button" onClick={() => advanceFulfillment(card)} disabled={saving} className="rounded-lg border border-sky-500/30 px-2.5 py-1.5 text-[11px] font-semibold text-sky-300 hover:bg-sky-500/10 disabled:opacity-50">Mark {nextStatus}</button>}
                    {canRevoke && <button type="button" onClick={() => revoke(card)} disabled={saving} className="rounded-lg border border-red-500/30 px-2.5 py-1.5 text-[11px] font-semibold text-red-300 hover:bg-red-500/10 disabled:opacity-50">Revoke</button>}
                  </div>
                </td>
              </tr>;
            })}
        </tbody>
      </table>
    </div>
  </section>;
}
