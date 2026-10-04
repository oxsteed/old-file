import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { AlertCircle, ArrowUpRight, RefreshCw, Store, WalletCards } from 'lucide-react';
import Navbar from '../../components/Navbar';
import Footer from '../../components/Footer';
import PageMeta from '../../components/PageMeta';
import WalletRestaurantWallets from './WalletRestaurantWallets';
import {
  getOxsteedCreditAccount,
  getOxsteedCreditAccountDetails,
  getOxsteedCreditStatus,
  listOxsteedCreditAccounts,
} from '../../api/oxsteedCredit';
import toast from 'react-hot-toast';
import './OxsteedCreditPage.css';
import { formatCreditMinorUnits } from '../../lib/creditCurrency';
import { formatCreditDateTime } from '../../lib/creditDateTime';
import { safeCreditErrorMessage } from '../../lib/creditErrors';

const money = formatCreditMinorUnits;

function creditStatusLabel(value, t) {
  return {
    active: t('activeStatus'),
    suspended: t('suspendedStatus'),
    closed: t('closedStatus'),
    under_review: t('underReviewStatus'),
  }[value] || t('statusUnknown');
}

// Wallet is the overview page: one glance at every balance OxSteed holds
// for the customer. OxSteed Credit gets a summary card that links to its
// dedicated page; restaurant wallets render in full below. Ledgers are
// never merged and balances are never combined.
export default function WalletPage() {
  const { t } = useTranslation('credit');
  const [account, setAccount] = useState(null);
  const [accountDetails, setAccountDetails] = useState(null);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [railStatus, setRailStatus] = useState(null);
  const [restaurantWalletCount, setRestaurantWalletCount] = useState(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(null);
  const [refreshing, setRefreshing] = useState(false);
  const loadRequestRef = useRef(0);

  const load = useCallback(async ({ quiet = false } = {}) => {
    const requestId = ++loadRequestRef.current;
    const isCurrentRequest = () => requestId === loadRequestRef.current;
    if (quiet) setRefreshing(true);
    else setLoading(true);
    if (isCurrentRequest()) setLoadError(null);
    try {
      const existingAccounts = await listOxsteedCreditAccounts().catch(() => []);
      const preferredCurrency = existingAccounts[0]?.currencyCode || 'USD';
      const [accountResult, railResult] = await Promise.all([
        getOxsteedCreditAccount({ currencyCode: preferredCurrency }).catch(() => null),
        getOxsteedCreditStatus().catch(() => null),
      ]);
      if (!isCurrentRequest()) return;
      setAccount(accountResult);
      setRailStatus(railResult);
      getOxsteedCreditAccountDetails({ currencyCode: preferredCurrency }).then((details) => {
        if (isCurrentRequest()) setAccountDetails(details);
      }).catch(() => { /* details are non-critical */ });
    } catch (error) {
      if (isCurrentRequest()) {
        const message = safeCreditErrorMessage(error, t('errorLoad'));
        setLoadError(message);
        toast.error(message);
      }
    } finally {
      if (isCurrentRequest()) {
        setLoading(false);
        setRefreshing(false);
      }
    }
  }, [t]);

  useEffect(() => {
    load();
    return () => { loadRequestRef.current += 1; };
  }, [load]);

  const currency = account?.currencyCode || 'USD';
  const accountStatus = account?.status || 'active';
  const balanceCents = Number(account?.balanceCents || 0);
  const reservedCents = Number(account?.reservedCents || 0);
  const availableCents = Number(account?.availableBalanceCents ?? Math.max(0, balanceCents - reservedCents));

  return (
    <>
      <PageMeta
        title={t('walletTitle')}
        description={t('walletDescription')}
        noIndex
      />
      <Navbar />
      <main className="ox-credit-page">
        <div className="ox-credit-shell">
          <header className="ox-credit-hero">
            <div>
              <h1>{t('walletTitle')}</h1>
              <p>{t('walletDescription')}</p>
            </div>
            <div className="ox-credit-hero-actions">
              <button type="button" className="ox-credit-refresh" onClick={() => load({ quiet: true })} disabled={loading || refreshing}>
                <RefreshCw size={16} className={refreshing ? 'ox-credit-spin' : ''} /> {t('refresh')}
              </button>
            </div>
          </header>

          {railStatus && !railStatus.enabled && <section className="ox-credit-rail-note" role="status"><AlertCircle size={19} /><div><strong>{t('pausedTitle')}</strong><span>{t('pausedBody')}</span></div></section>}

          <section aria-label={t('balancesTitle')}>
            <div className="ox-credit-panel-heading">
              <div>
                <p className="ox-credit-eyebrow">{t('walletTitle')}</p>
                <h2>{t('balancesTitle')}</h2>
              </div>
            </div>
            <div className="ox-credit-balance-strip">
              <div className="ox-credit-balance-card">
                {loading ? (
                  <div className="ox-credit-loading" role="status" aria-live="polite">{t('loadingAccount')}</div>
                ) : loadError && !account ? (
                  <div className="ox-credit-error-panel" role="alert"><AlertCircle size={20} /><strong>{t('errorLoad')}</strong><span>{loadError}</span></div>
                ) : (
                  <>
                    <div className="ox-credit-balance-top"><span className="ox-credit-wallet-icon"><WalletCards size={23} /></span><div><span>{t('balance')}</span><strong>{money(balanceCents, currency)}</strong></div><span className={`ox-credit-status ${accountStatus === 'active' ? 'active' : ''}`}>{creditStatusLabel(accountStatus, t)}</span></div>
                    <div className="ox-credit-balance-grid"><div><span>{t('availableToSpend')}</span><strong>{money(availableCents, currency)}</strong></div><div><span>{t('reserved')}</span><strong>{money(reservedCents, currency)}</strong></div><div><span>{t('currency')}</span><strong>{currency}</strong></div></div>
                    <Link to="/oxsteed-credit" className="ox-credit-detail-link">{t('manageOxsteedCredit')} <ArrowUpRight size={14} /></Link>
                  </>
                )}
              </div>
              <div className="ox-credit-balance-card ox-credit-balance-card--restaurant">
                <div className="ox-credit-balance-top"><span className="ox-credit-wallet-icon"><Store size={23} /></span><div><span>{t('restaurantWalletsTitle')}</span><strong>{restaurantWalletCount == null ? '—' : t('walletsCount', { count: restaurantWalletCount })}</strong></div></div>
                <p className="ox-credit-panel-copy">{t('restaurantCreditCardCopy')}</p>
                <a href="#restaurant-credit" className="ox-credit-detail-link">{t('viewRestaurantCredits')} <ArrowUpRight size={14} /></a>
              </div>
            </div>
          </section>

          {accountDetails && (
            <section className="ox-credit-panel ox-credit-details-panel" aria-labelledby="wallet-details-heading">
              <button type="button" className="ox-credit-details-toggle" onClick={() => setDetailsOpen((open) => !open)} aria-expanded={detailsOpen}>
                <span id="wallet-details-heading">{t('accountDetails')}</span>
                <ArrowUpRight size={16} className={detailsOpen ? 'ox-credit-details-open' : ''} />
              </button>
              {detailsOpen && (
                <dl className="ox-credit-details-list">
                  <div><dt>{t('lastStatementBalance')}</dt><dd>{accountDetails.lastStatement ? money(accountDetails.lastStatement.balanceCents, currency) : '—'}</dd></div>
                  <div><dt>{t('lastStatementDate')}</dt><dd>{accountDetails.lastStatement ? accountDetails.lastStatement.to : '—'}</dd></div>
                  <div><dt>{t('pendingDeposits')}</dt><dd>+{money(accountDetails.pendingDeposits.totalCents, currency)}{accountDetails.pendingDeposits.count > 0 ? ` (${accountDetails.pendingDeposits.count})` : ''}</dd></div>
                  <div><dt>{t('pendingWithdrawalsLabel')}</dt><dd>-{money(accountDetails.pendingWithdrawals.totalCents, currency)}{accountDetails.pendingWithdrawals.count > 0 ? ` (${accountDetails.pendingWithdrawals.count})` : ''}</dd></div>
                  <div><dt>{t('lastDepositAmount')}</dt><dd>{accountDetails.lastDeposit ? money(accountDetails.lastDeposit.amountCents, currency) : '—'}</dd></div>
                  <div><dt>{t('lastDepositDate')}</dt><dd>{accountDetails.lastDeposit ? formatCreditDateTime(accountDetails.lastDeposit.createdAt, '—') : '—'}</dd></div>
                </dl>
              )}
            </section>
          )}

          <WalletRestaurantWallets onWalletsLoaded={setRestaurantWalletCount} />

          <p className="ox-credit-footnote" role="note">{t('disclaimerBody')}</p>
        </div>
      </main>
      <Footer />
    </>
  );
}
