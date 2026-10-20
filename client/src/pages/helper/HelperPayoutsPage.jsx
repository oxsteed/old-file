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
  return (
    <div className="min-h-screen flex flex-col bg-gray-950">
      <PageMeta title={t('helperPayouts.title')} noIndex />
      <Navbar />
      <main className="flex-1 max-w-2xl mx-auto w-full px-4 py-8 space-y-4">
        <h1 className="text-2xl font-bold text-white">{t('helperPayouts.title')}</h1>
        {/* Review P2-2-F08: W-9 compliance path when the tax-identity gate blocks payouts. */}
        {taxBlocked && (
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
              disabled={paying || !d.payouts_enabled || d.configured === false || !(d.instant_payout_amount_cents > 0)}
              className="rounded-lg bg-orange-500 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50" data-track="ui.ac312e2612.2">
              {paying ? t('helperPayouts.requesting') : t('helperPayouts.instantButton', { amount: cents(d.instant_payout_amount_cents) })}
            </button>
          </div>
        )}
      </main>
      <Footer />
    </div>
  );
}
