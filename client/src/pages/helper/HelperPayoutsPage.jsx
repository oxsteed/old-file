import { useEffect, useState, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import toast from 'react-hot-toast';
import api from '../../api/axios';
import Navbar from '../../components/Navbar';
import Footer from '../../components/Footer';
import PageMeta from '../../components/PageMeta';
import { formatMoney } from '../../lib/format';

const cents = (n) => formatMoney((Number(n) || 0) / 100, { currency: 'USD' });

function methodDetail(method, t) {
  if (method.method_type === 'paypal') return method.paypal_email || t('helperPayouts.methods.paypal');
  if (method.method_type === 'stripe_connect') return method.stripe_account_id || t('helperPayouts.methods.stripeConnect');
  return [method.bank_name, method.account_last_four ? `••${method.account_last_four}` : null].filter(Boolean).join(' · ')
    || t('helperPayouts.methods.bankAccount');
}

// Payout destination management: the server mutations all require a fresh
// TOTP step-up code (backup codes are deliberately not accepted) and an
// active onboarding step; both failures surface as guidance, not dead ends.
function PayoutMethodsSection() {
  const { t } = useTranslation();
  const [methods, setMethods] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [totp, setTotp] = useState('');
  const [busy, setBusy] = useState(false);
  const [busyId, setBusyId] = useState(null);
  const [form, setForm] = useState({
    method_type: 'bank_account',
    account_holder_name: '',
    bank_name: '',
    account_last_four: '',
    routing_number_last_four: '',
    account_type: 'checking',
    paypal_email: '',
  });

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const { data } = await api.get('/payouts/payout-methods');
      setMethods(data?.payout_methods || []);
    } catch {
      setError(t('helperPayouts.methods.loadFailed'));
    } finally {
      setLoading(false);
    }
  }, [t]);
  useEffect(() => { load(); }, [load]);

  const describeError = (err, fallback) => {
    const code = err?.response?.data?.code;
    if (code === 'totp_stepup_required') return t('helperPayouts.methods.totpEnroll');
    if (code === 'totp_stepup_invalid') return t('helperPayouts.methods.totpInvalid');
    return err?.response?.data?.message || err?.response?.data?.error || fallback;
  };

  const mutate = async (fn, doneKey) => {
    const code = totp.replace(/[\s-]/g, '');
    if (!code) {
      setError(t('helperPayouts.methods.totpMissing'));
      return;
    }
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await fn(code);
      setTotp('');
      setNotice(t(doneKey));
      await load();
    } catch (err) {
      setError(describeError(err, t('helperPayouts.methods.actionFailed')));
    } finally {
      setBusy(false);
    }
  };

  const addMethod = async (event) => {
    event.preventDefault();
    const body = { method_type: form.method_type };
    if (form.method_type === 'bank_account') {
      body.account_holder_name = form.account_holder_name.trim() || undefined;
      body.bank_name = form.bank_name.trim() || undefined;
      body.account_last_four = form.account_last_four.trim() || undefined;
      body.routing_number_last_four = form.routing_number_last_four.trim() || undefined;
      body.account_type = form.account_type || undefined;
    } else if (form.method_type === 'paypal') {
      body.account_holder_name = form.account_holder_name.trim() || undefined;
      body.paypal_email = form.paypal_email.trim() || undefined;
    } else {
      body.account_holder_name = form.account_holder_name.trim() || undefined;
    }
    await mutate(
      (code) => api.post('/payouts/payout-methods', { ...body, totp_code: code }),
      'helperPayouts.methods.methodAdded',
    );
  };

  const setPrimary = (method) => mutate(
    (code) => api.put(`/payouts/payout-methods/${method.id}`, { is_primary: true, totp_code: code }),
    'helperPayouts.methods.methodPrimary',
  );

  const deactivate = (method) => mutate(
    (code) => api.put(`/payouts/payout-methods/${method.id}`, { status: 'inactive', totp_code: code }),
    'helperPayouts.methods.methodDeactivated',
  );

  const remove = (method) => {
    if (!window.confirm(t('helperPayouts.methods.confirmDelete'))) return;
    setBusyId(method.id);
    setError('');
    setNotice('');
    const code = totp.replace(/[\s-]/g, '');
    if (!code) {
      setError(t('helperPayouts.methods.totpMissing'));
      setBusyId(null);
      return;
    }
    api.delete(`/payouts/payout-methods/${method.id}`, { data: { totp_code: code } })
      .then(() => {
        setTotp('');
        setNotice(t('helperPayouts.methods.methodDeleted'));
        load();
      })
      .catch((err) => setError(describeError(err, t('helperPayouts.methods.actionFailed'))))
      .finally(() => setBusyId(null));
  };

  const setField = (key) => (event) => setForm((prev) => ({ ...prev, [key]: event.target.value }));

  return (
    <section className="rounded-2xl border border-gray-700 bg-gray-900 p-5 space-y-4">
      <h2 className="text-lg font-semibold text-white">{t('helperPayouts.methods.title')}</h2>
      <p className="text-sm text-gray-400">{t('helperPayouts.methods.copy')}</p>
      {notice && <p role="status" className="text-sm text-emerald-300">{notice}</p>}
      {error && (
        <p role="alert" className="text-sm text-red-300">
          {error}
          {error === t('helperPayouts.methods.totpEnroll') && (
            <> <Link to="/settings/2fa" className="font-semibold text-orange-400">{t('helperPayouts.methods.totpEnrollCta')}</Link></>
          )}
        </p>
      )}
      {loading && <p role="status" className="text-gray-400">{t('helperPayouts.methods.loading')}</p>}
      {!loading && methods.length === 0 && !error && <p className="text-sm text-gray-400">{t('helperPayouts.methods.empty')}</p>}
      {!loading && methods.length > 0 && (
        <ul className="space-y-3">
          {methods.map((method) => (
            <li key={method.id} className="rounded-xl border border-gray-700 p-4 space-y-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="font-semibold text-white">{methodDetail(method, t)}</span>
                <span className="flex items-center gap-2">
                  {method.is_primary && <span className="rounded-full bg-orange-500/20 px-2 py-0.5 text-xs font-semibold text-orange-300">{t('helperPayouts.methods.primary')}</span>}
                  <span className="text-xs text-gray-400">{method.status}</span>
                </span>
              </div>
              <div className="flex flex-wrap gap-2">
                {!method.is_primary && (
                  <button type="button" onClick={() => setPrimary(method)} disabled={busy} className="rounded-lg bg-gray-800 px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50" data-track="ui.ac312e2612.3">
                    {t('helperPayouts.methods.setPrimary')}
                  </button>
                )}
                {method.status !== 'inactive' && (
                  <button type="button" onClick={() => deactivate(method)} disabled={busy} className="rounded-lg bg-gray-800 px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50" data-track="ui.ac312e2612.4">
                    {t('helperPayouts.methods.deactivate')}
                  </button>
                )}
                <button type="button" onClick={() => remove(method)} disabled={busyId === method.id} className="rounded-lg bg-gray-800 px-3 py-1.5 text-xs font-semibold text-red-300 disabled:opacity-50" data-track="ui.ac312e2612.5">
                  {busyId === method.id ? t('helperPayouts.methods.deleting') : t('helperPayouts.methods.deleteMethod')}
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
      <form onSubmit={addMethod} className="space-y-3 border-t border-gray-700 pt-4" data-track="ui.ac312e2612.6">
        <label className="block text-sm text-gray-300">
          {t('helperPayouts.methods.methodType')}
          <select value={form.method_type} onChange={setField('method_type')} className="mt-1 w-full rounded-lg bg-gray-800 px-3 py-2 text-white">
            <option value="bank_account">{t('helperPayouts.methods.bankAccount')}</option>
            <option value="paypal">{t('helperPayouts.methods.paypal')}</option>
            <option value="stripe_connect">{t('helperPayouts.methods.stripeConnect')}</option>
          </select>
        </label>
        <label className="block text-sm text-gray-300">
          {t('helperPayouts.methods.holderLabel')}
          <input value={form.account_holder_name} onChange={setField('account_holder_name')} placeholder={t('helperPayouts.methods.holderPlaceholder')} className="mt-1 w-full rounded-lg bg-gray-800 px-3 py-2 text-white" />
        </label>
        {form.method_type === 'bank_account' && (
          <>
            <label className="block text-sm text-gray-300">
              {t('helperPayouts.methods.bankLabel')}
              <input value={form.bank_name} onChange={setField('bank_name')} placeholder={t('helperPayouts.methods.bankPlaceholder')} className="mt-1 w-full rounded-lg bg-gray-800 px-3 py-2 text-white" />
            </label>
            <div className="grid grid-cols-2 gap-3">
              <label className="block text-sm text-gray-300">
                {t('helperPayouts.methods.lastFourLabel')}
                <input value={form.account_last_four} onChange={(event) => setForm((prev) => ({ ...prev, account_last_four: event.target.value.replace(/\D/g, '').slice(0, 4) }))} inputMode="numeric" placeholder={t('helperPayouts.methods.lastFourPlaceholder')} className="mt-1 w-full rounded-lg bg-gray-800 px-3 py-2 text-white" />
              </label>
              <label className="block text-sm text-gray-300">
                {t('helperPayouts.methods.routingLastFourLabel')}
                <input value={form.routing_number_last_four} onChange={(event) => setForm((prev) => ({ ...prev, routing_number_last_four: event.target.value.replace(/\D/g, '').slice(0, 4) }))} inputMode="numeric" placeholder={t('helperPayouts.methods.lastFourPlaceholder')} className="mt-1 w-full rounded-lg bg-gray-800 px-3 py-2 text-white" />
              </label>
            </div>
            <label className="block text-sm text-gray-300">
              {t('helperPayouts.methods.accountTypeLabel')}
              <select value={form.account_type} onChange={setField('account_type')} className="mt-1 w-full rounded-lg bg-gray-800 px-3 py-2 text-white">
                <option value="checking">{t('helperPayouts.methods.accountChecking')}</option>
                <option value="savings">{t('helperPayouts.methods.accountSavings')}</option>
              </select>
            </label>
          </>
        )}
        {form.method_type === 'paypal' && (
          <label className="block text-sm text-gray-300">
            {t('helperPayouts.methods.paypalEmailLabel')}
            <input type="email" value={form.paypal_email} onChange={setField('paypal_email')} placeholder={t('helperPayouts.methods.paypalEmailPlaceholder')} className="mt-1 w-full rounded-lg bg-gray-800 px-3 py-2 text-white" />
          </label>
        )}
        {form.method_type === 'stripe_connect' && (
          <p className="text-sm text-gray-400">{t('helperPayouts.methods.stripeNote')}</p>
        )}
        <label className="block text-sm text-gray-300">
          {t('helperPayouts.methods.totpLabel')}
          <input required value={totp} onChange={(event) => setTotp(event.target.value.replace(/[\s-]/g, '').slice(0, 8))} inputMode="numeric" placeholder={t('helperPayouts.methods.totpPlaceholder')} className="mt-1 w-full rounded-lg bg-gray-800 px-3 py-2 text-white" />
          <span className="mt-1 block text-xs text-gray-500">{t('helperPayouts.methods.totpHint')}</span>
        </label>
        <button type="submit" disabled={busy} className="rounded-lg bg-orange-500 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50" data-track="ui.ac312e2612.7">
          {busy ? t('helperPayouts.methods.addingMethod') : t('helperPayouts.methods.addMethod')}
        </button>
      </form>
    </section>
  );
}

// Review P2-481: helper payout balance and instant payout.
export default function HelperPayoutsPage() {
  const { t } = useTranslation();
  const [state, setState] = useState({ status: 'loading', data: null });
  const [paying, setPaying] = useState(false);
  // Review P2-2-F08: the requireTaxIdentity gate 403s with code
  // tax_identity_required; surface the W-9 path instead of a dead end.
  const [taxBlocked, setTaxBlocked] = useState(false);

  const load = useCallback(async () => {
    setState({ status: 'loading', data: null });
    try {
      const { data } = await api.get('/payments/payout/balance');
      setState({ status: 'success', data });
    } catch {
      setState({ status: 'error', data: null });
    }
  }, []);
  useEffect(() => { load(); }, [load]);

  async function requestInstant() {
    const amount = state.data?.instant_payout_amount_cents || 0;
    if (!window.confirm(t('helperPayouts.confirm', { amount: cents(amount) }))) return;
    setPaying(true);
    try {
      const { data } = await api.post('/payments/payout/instant');
      if (data?.status === 'no_available_balance') toast(t('helperPayouts.noBalance'));
      else toast.success(t('helperPayouts.requested', { amount: cents(data?.amount_cents) }));
      load();
    } catch (err) {
      const code = err.response?.data?.code;
      // Review P2-2-F08: point helpers at the in-app W-9 form instead of a
      // generic failure when the tax-identity gate blocks the payout.
      if (code === 'tax_identity_required') {
        setTaxBlocked(true);
        toast.error(t('helperPayouts.taxIdentityRequired'));
      } else {
        toast.error(code === 'payouts_not_enabled' ? t('helperPayouts.notEnabled') : t('helperPayouts.failed'));
      }
    } finally {
      setPaying(false);
    }
  }

  const d = state.data;
  // Proactive W-9 unlock path: the balance endpoint reports the tax-identity
  // gate state, so helpers see the "complete your W-9" CTA before attempting
  // a payout, not only after a 403. taxBlocked covers the reactive case.
  const taxIdentityBlocked = d?.tax_identity ? d.tax_identity.ready === false : false;
  const showTaxBanner = taxBlocked || taxIdentityBlocked;
  return (
    <div className="min-h-screen flex flex-col bg-gray-950">
      <PageMeta title={t('helperPayouts.title')} noIndex />
      <Navbar />
      <main className="flex-1 max-w-2xl mx-auto w-full px-4 py-8 space-y-4">
        <h1 className="text-2xl font-bold text-white">{t('helperPayouts.title')}</h1>
        {/* Review P2-2-F08: W-9 compliance path when the tax-identity gate blocks payouts. */}
        {showTaxBanner && (
          <div role="alert" className="rounded-2xl border border-amber-700 bg-amber-950/50 p-5 text-amber-200">
            <p className="font-semibold text-sm">{t('helperPayouts.taxBlockedTitle')}</p>
            <p className="text-sm mt-1 text-amber-200/80">{t('helperPayouts.taxBlockedCopy')}</p>
            <Link to="/settings?tab=tax" className="mt-3 inline-block rounded-lg bg-amber-500 px-4 py-2 text-sm font-semibold text-white hover:bg-amber-600">
              {t('helperPayouts.taxBlockedCta')}
            </Link>
          </div>
        )}
        {state.status === 'loading' && <p role="status" className="text-gray-400">{t('helperPayouts.loading')}</p>}
        {state.status === 'error' && (
          <div role="alert" className="text-gray-300">
            <p>{t('helperPayouts.loadFailed')}</p>
            <button type="button" onClick={load} className="mt-2 text-orange-400" data-track="ui.ac312e2612.1">{t('helperPayouts.retry')}</button>
          </div>
        )}
        {state.status === 'success' && !d?.connected && (
          <div className="rounded-2xl border border-gray-700 bg-gray-900 p-5 text-gray-300">
            <p>{t('helperPayouts.notConnected')}</p>
            <Link to="/invoices" className="mt-2 inline-block font-semibold text-orange-400">{t('helperPayouts.setup')}</Link>
          </div>
        )}
        {state.status === 'success' && d?.connected && (
          <div className="rounded-2xl border border-gray-700 bg-gray-900 p-5 space-y-3">
            {!d.payouts_enabled && <p role="alert" className="text-amber-300">{t('helperPayouts.notEnabled')}</p>}
            {d.configured === false && <p className="text-gray-400">{t('helperPayouts.unconfigured')}</p>}
            {d.configured !== false && (
              <dl className="grid grid-cols-2 gap-3 text-sm">
                <dt className="text-gray-400">{t('helperPayouts.available')}</dt><dd className="text-white text-end">{cents(d.available_cents)}</dd>
                <dt className="text-gray-400">{t('helperPayouts.pending')}</dt><dd className="text-white text-end">{cents(d.pending_cents)}</dd>
                <dt className="text-gray-400">{t('helperPayouts.instantAvailable')}</dt><dd className="text-white text-end">{cents(d.instant_available_cents)}</dd>
              </dl>
            )}
            <p className="text-xs text-gray-500">{t('helperPayouts.limitNote', { max: cents(d.instant_payout_max_cents || 50000) })}</p>
            <button type="button" onClick={requestInstant}
              disabled={paying || taxIdentityBlocked || !d.payouts_enabled || d.configured === false || !(d.instant_payout_amount_cents > 0)}
              className="rounded-lg bg-orange-500 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50" data-track="ui.ac312e2612.2">
              {paying ? t('helperPayouts.requesting') : t('helperPayouts.instantButton', { amount: cents(d.instant_payout_amount_cents) })}
            </button>
          </div>
        )}
        <PayoutMethodsSection />
      </main>
      <Footer />
    </div>
  );
}
