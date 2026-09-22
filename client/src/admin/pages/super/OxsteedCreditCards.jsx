import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { CreditCard, RefreshCw } from 'lucide-react';
import adminApi from '../../../lib/adminApi';
import { createStableIdempotencyKeyStore } from './creditIdempotency';
import { formatCreditDateTime } from '../../../lib/creditDateTime';
import { safeCreditErrorMessage } from '../../../lib/creditErrors';

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

function Badge({ status, t }) {
  return <span className={`inline-flex rounded-full border px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.14em] ${statusClass(status)}`}>{t(`cards.status.${status}`, { defaultValue: status })}</span>;
}

function dateTime(value, t) {
  return formatCreditDateTime(value, value ? t('cards.unknown') : t('cards.notAvailable'), t.lng);
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
  const { t } = useTranslation('credit');
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
      setError(safeCreditErrorMessage(err, t('cards.errors.load')));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, [statusFilter, cardTypeFilter, appliedCustomerFilter, offset]);

  const submitIssue = async (event) => {
    event.preventDefault();
    if (!form.customerId.trim()) {
      setError(t('cards.errors.customerUuid'));
      return;
    }
    if (form.cardType === 'physical' && !form.addressLine1.trim()) {
      setError(t('cards.errors.shippingAddress'));
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
        ? t('cards.adminSuccess.alreadyIssued')
        : isPhysical
        ? t('cards.adminSuccess.physicalCreated')
          : t('cards.adminSuccess.virtualIssued'));
      setForm(emptyForm);
      await load();
    } catch (err) {
      setError(safeCreditErrorMessage(err, t('cards.errors.issue')));
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
      setNotice(t('cards.adminSuccess.moved', { status: t(`cards.fulfillment.${target}`, { defaultValue: target }) }));
      await load();
    } catch (err) {
      setError(safeCreditErrorMessage(err, t('cards.errors.fulfillment')));
    } finally {
      setSaving(false);
    }
  };

  const revoke = async (card) => {
    const reason = window.prompt(t('cards.confirm.revoke', { card: card.credentialLast4 ? t('cards.ending', { last4: card.credentialLast4 }) : card.id }));
    if (reason === null) return;
    if (!reason.trim()) {
      setError(t('cards.errors.revokeReason'));
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
      setNotice(response.data?.replayed ? t('cards.adminSuccess.alreadyRevoked') : t('cards.adminSuccess.revoked'));
      await load();
    } catch (err) {
      setError(safeCreditErrorMessage(err, t('cards.errors.revoke')));
    } finally {
      setSaving(false);
    }
  };

  return <section className="rounded-2xl border border-gray-800 bg-[#111318] p-4 sm:p-5">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div>
        <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-orange-400">{t('cards.adminTitle')}</p>
        <h2 className="mt-1 flex items-center gap-2 text-lg font-semibold text-white"><CreditCard className="h-4 w-4 text-orange-400" /> {t('cards.adminSubtitle')}</h2>
        <p className="mt-1 max-w-3xl text-xs leading-5 text-gray-500">
          {t('cards.adminDescription')}
        </p>
      </div>
      <button type="button" onClick={load} disabled={loading || saving || busy} className="inline-flex items-center gap-2 rounded-xl border border-gray-700 bg-gray-900/70 px-3 py-2 text-xs font-semibold text-gray-300 hover:bg-gray-800 disabled:opacity-50">
        <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} /> {t('cards.refresh')}
      </button>
    </div>

    {(error || notice) && (
      <div role={error ? 'alert' : 'status'} aria-live="polite" className={`mt-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border px-3 py-3 text-xs ${error ? 'border-red-500/30 bg-red-950/20 text-red-300' : 'border-emerald-500/30 bg-emerald-950/20 text-emerald-300'}`}>
        <span>{error || notice}</span>
        {error && <button type="button" onClick={load} disabled={loading || saving || busy} className="rounded-lg border border-red-400/30 px-3 py-1.5 font-semibold text-red-200 hover:bg-red-500/10 disabled:opacity-50">{t('cards.retry')}</button>}
      </div>
    )}

    {revealedSecret && (
      <div role="alert" aria-live="assertive" className="mt-4 rounded-xl border border-orange-500/40 bg-orange-950/20 p-4 text-xs text-orange-200">
        <p className="font-bold uppercase tracking-[0.12em] text-orange-300">
          {revealedSecret.type === 'credential' ? t('cards.secretTitle') : t('cards.activationSecretTitle')}
        </p>
        <p className="mt-2 break-all rounded-lg border border-orange-500/30 bg-black/30 px-3 py-2 font-mono text-sm text-white">{revealedSecret.value}</p>
        <p className="mt-2 text-orange-300/80">
          {revealedSecret.type === 'credential' ? t('cards.adminCredentialDescription') : t('cards.adminActivationDescription')}
        </p>
      </div>
    )}

    <form onSubmit={submitIssue} className="mt-5 grid gap-3 rounded-xl border border-gray-800 bg-gray-950/40 p-4 sm:grid-cols-2 lg:grid-cols-4">
      <label className="lg:col-span-2">
        <span className="mb-1 block text-xs font-semibold text-gray-500">{t('cards.customerUuid')}</span>
        <input required value={form.customerId} onChange={(event) => setForm({ ...form, customerId: event.target.value })} placeholder={t('cards.customerUuidPlaceholder')} className="w-full rounded-xl border border-gray-700 bg-gray-950 px-3 py-3 text-sm text-white outline-none focus:border-orange-400" />
      </label>
      <label>
        <span className="mb-1 block text-xs font-semibold text-gray-500">{t('cards.cardType')}</span>
        <select value={form.cardType} onChange={(event) => setForm({ ...form, cardType: event.target.value })} className="w-full rounded-xl border border-gray-700 bg-gray-950 px-3 py-3 text-sm text-white outline-none focus:border-orange-400">
          {CARD_TYPES.map((type) => <option key={type} value={type}>{type === 'virtual' ? t('cards.virtualActiveImmediately') : t('cards.physicalShipsCustomer')}</option>)}
        </select>
      </label>
      <label>
        <span className="mb-1 block text-xs font-semibold text-gray-500">{t('cards.currency')}</span>
        <select value={form.currencyCode} onChange={(event) => setForm({ ...form, currencyCode: event.target.value })} className="w-full rounded-xl border border-gray-700 bg-gray-950 px-3 py-3 text-sm text-white outline-none focus:border-orange-400">
          {currencyOptions.map((code) => <option key={code} value={code}>{code}</option>)}
        </select>
      </label>
      <label>
        <span className="mb-1 block text-xs font-semibold text-gray-500">{t('cards.nicknameOptional')}</span>
        <input value={form.nickname} onChange={(event) => setForm({ ...form, nickname: event.target.value })} placeholder={t('cards.adminNicknamePlaceholder')} className="w-full rounded-xl border border-gray-700 bg-gray-950 px-3 py-3 text-sm text-white outline-none focus:border-orange-400" />
      </label>
      <label className="lg:col-span-3">
        <span className="mb-1 block text-xs font-semibold text-gray-500">{t('cards.reasonAudit')}</span>
        <input value={form.reason} onChange={(event) => setForm({ ...form, reason: event.target.value })} placeholder={t('cards.reasonPlaceholder')} className="w-full rounded-xl border border-gray-700 bg-gray-950 px-3 py-3 text-sm text-white outline-none focus:border-orange-400" />
      </label>

      {form.cardType === 'physical' && <>
        <label className="lg:col-span-2">
          <span className="mb-1 block text-xs font-semibold text-gray-500">{t('cards.shippingAddressLine1')}</span>
          <input required value={form.addressLine1} onChange={(event) => setForm({ ...form, addressLine1: event.target.value })} className="w-full rounded-xl border border-gray-700 bg-gray-950 px-3 py-3 text-sm text-white outline-none focus:border-orange-400" />
        </label>
        <label>
          <span className="mb-1 block text-xs font-semibold text-gray-500">{t('cards.city')}</span>
          <input value={form.city} onChange={(event) => setForm({ ...form, city: event.target.value })} className="w-full rounded-xl border border-gray-700 bg-gray-950 px-3 py-3 text-sm text-white outline-none focus:border-orange-400" />
        </label>
        <label>
          <span className="mb-1 block text-xs font-semibold text-gray-500">{t('cards.stateRegion')}</span>
          <input value={form.state} onChange={(event) => setForm({ ...form, state: event.target.value })} className="w-full rounded-xl border border-gray-700 bg-gray-950 px-3 py-3 text-sm text-white outline-none focus:border-orange-400" />
        </label>
        <label>
          <span className="mb-1 block text-xs font-semibold text-gray-500">{t('cards.postalCode')}</span>
          <input value={form.postalCode} onChange={(event) => setForm({ ...form, postalCode: event.target.value })} className="w-full rounded-xl border border-gray-700 bg-gray-950 px-3 py-3 text-sm text-white outline-none focus:border-orange-400" />
        </label>
        <label>
          <span className="mb-1 block text-xs font-semibold text-gray-500">{t('cards.country')}</span>
          <input value={form.country} onChange={(event) => setForm({ ...form, country: event.target.value })} className="w-full rounded-xl border border-gray-700 bg-gray-950 px-3 py-3 text-sm text-white outline-none focus:border-orange-400" />
        </label>
      </>}

      <button disabled={busy || saving} className="self-end rounded-xl bg-orange-500 px-4 py-3 text-sm font-semibold text-white hover:bg-orange-400 disabled:opacity-50 lg:col-span-1">
        {saving ? t('cards.issuing') : form.cardType === 'physical' ? t('cards.startPhysical') : t('cards.issueVirtual')}
      </button>
    </form>

    <div className="mt-5 flex flex-wrap items-center justify-between gap-3">
      <h3 className="text-sm font-semibold text-white">{t('cards.allCards')}</h3>
      <div className="flex flex-wrap items-center justify-end gap-2">
        <input value={customerFilter} onChange={(event) => setCustomerFilter(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') { setAppliedCustomerFilter(customerFilter.trim()); setOffset(0); } }} placeholder={t('cards.filterCustomer')} className="rounded-lg border border-gray-700 bg-gray-950 px-3 py-2 text-xs text-white outline-none focus:border-orange-400" />
        <button type="button" onClick={() => { setAppliedCustomerFilter(customerFilter.trim()); setOffset(0); }} disabled={loading || saving} className="rounded-lg bg-sky-600 px-3 py-2 text-xs font-semibold text-white hover:bg-sky-500 disabled:opacity-50">{t('cards.search')}</button>
        <select value={cardTypeFilter} onChange={(event) => { setCardTypeFilter(event.target.value); setOffset(0); }} className="rounded-lg border border-gray-700 bg-gray-950 px-3 py-2 text-xs text-white outline-none focus:border-orange-400">
          <option value="all">{t('cards.allTypes')}</option>
          {CARD_TYPES.map((type) => <option key={type} value={type}>{type === 'virtual' ? t('cards.virtualCard') : t('cards.physicalCard')}</option>)}
        </select>
        <select value={statusFilter} onChange={(event) => { setStatusFilter(event.target.value); setOffset(0); }} className="rounded-lg border border-gray-700 bg-gray-950 px-3 py-2 text-xs text-white outline-none focus:border-orange-400">
          <option value="all">{t('cards.allStatuses')}</option>
          {CARD_STATUSES.map((status) => <option key={status} value={status}>{t(`cards.status.${status}`, { defaultValue: status })}</option>)}
        </select>
        <button type="button" onClick={() => setOffset((current) => Math.max(0, current - CARD_PAGE_SIZE))} disabled={loading || saving || offset === 0} className="rounded-lg border border-gray-700 px-3 py-2 text-xs font-semibold text-gray-300 hover:bg-gray-800 disabled:opacity-50">{t('cards.previous')}</button>
        <button type="button" onClick={() => setOffset((current) => current + CARD_PAGE_SIZE)} disabled={loading || saving || cards.length < CARD_PAGE_SIZE} className="rounded-lg border border-gray-700 px-3 py-2 text-xs font-semibold text-gray-300 hover:bg-gray-800 disabled:opacity-50">{t('cards.next')}</button>
      </div>
    </div>

    <div className="mt-3 overflow-x-auto rounded-xl border border-gray-800">
      <table className="min-w-[900px] w-full text-left text-xs">
        <thead className="bg-gray-950/70 text-gray-500">
          <tr>
            <th className="px-3 py-3 font-medium">{t('cards.customer')}</th>
            <th className="px-3 py-3 font-medium">{t('cards.cardType')}</th>
            <th className="px-3 py-3 font-medium">{t('cards.statusLabel')}</th>
            <th className="px-3 py-3 font-medium">{t('cards.fulfillmentLabelPlain')}</th>
            <th className="px-3 py-3 font-medium">{t('cards.last4')}</th>
            <th className="px-3 py-3 font-medium">{t('cards.issuedLabel')}</th>
            <th className="px-3 py-3 font-medium">{t('cards.actions')}</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-800">
          {loading ? <tr><td colSpan="7" className="px-3 py-10 text-center text-gray-500">{t('cards.loading')}</td></tr>
            : !cards.length ? <tr><td colSpan="7" className="px-3 py-10 text-center text-gray-500">{t('cards.noMatches')}</td></tr>
            : cards.map((card) => {
              const nextStatus = card.cardType === 'physical' ? nextFulfillmentStatus(card.fulfillmentStatus) : null;
              const canRevoke = !['revoked', 'expired'].includes(card.status);
              return <tr key={card.id}>
                <td className="px-3 py-3 font-mono text-[10px] text-gray-500">{card.customerId}</td>
                <td className="px-3 py-3 text-white">{card.cardType === 'virtual' ? t('cards.virtualCard') : t('cards.physicalCard')}{card.nickname ? <p className="mt-1 text-gray-600">{card.nickname}</p> : null}</td>
                <td className="px-3 py-3"><Badge status={card.status} t={t} /></td>
                <td className="px-3 py-3 text-gray-400">{card.cardType === 'physical' ? t(`cards.fulfillment.${card.fulfillmentStatus}`, { defaultValue: card.fulfillmentStatus }) : t('cards.notApplicable')}</td>
                <td className="px-3 py-3 font-mono text-gray-400">{card.credentialLast4 || t('cards.last4Empty')}</td>
                <td className="px-3 py-3 text-gray-500">{dateTime(card.issuedAt, t)}</td>
                <td className="px-3 py-3">
                  <div className="flex flex-wrap gap-2">
                    {nextStatus && <button type="button" onClick={() => advanceFulfillment(card)} disabled={saving} className="rounded-lg border border-sky-500/30 px-2.5 py-1.5 text-[11px] font-semibold text-sky-300 hover:bg-sky-500/10 disabled:opacity-50">{t('cards.mark', { status: t(`cards.fulfillment.${nextStatus}`, { defaultValue: nextStatus }) })}</button>}
                    {canRevoke && <button type="button" onClick={() => revoke(card)} disabled={saving} className="rounded-lg border border-red-500/30 px-2.5 py-1.5 text-[11px] font-semibold text-red-300 hover:bg-red-500/10 disabled:opacity-50">{t('cards.revoke')}</button>}
                  </div>
                </td>
              </tr>;
            })}
        </tbody>
      </table>
    </div>
  </section>;
}
