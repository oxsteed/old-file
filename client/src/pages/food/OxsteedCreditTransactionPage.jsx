import { useEffect, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  AlertCircle,
  ArrowDownLeft,
  ArrowLeft,
  ArrowUpRight,
  Building2,
  ExternalLink,
  Printer,
  Receipt,
  RefreshCw,
  ShieldCheck,
} from 'lucide-react';
import toast from 'react-hot-toast';
import Navbar from '../../components/Navbar';
import Footer from '../../components/Footer';
import PageMeta from '../../components/PageMeta';
import { getOxsteedCreditTransaction } from '../../api/oxsteedCredit';
import { formatCreditMinorUnits } from '../../lib/creditCurrency';
import './OxsteedCreditPage.css';

const money = formatCreditMinorUnits;

function dateTime(value, t) {
  if (!value) return t('noDate');
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? t('noDate')
    : new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(date);
}

function errorMessage(error, t) {
  return error?.response?.data?.error?.message
    || error?.response?.data?.message
    || error?.message
    || t('transactionUnavailable');
}

function transactionLabel(transaction, t) {
  return {
    load: t('transactionLoad'),
    purchase: t('transactionPurchase'),
    refund: t('transactionRefund'),
    transfer: t('transactionTransfer'),
    adjustment: t('transactionAdjustment'),
    conversion_debit: t('transactionConversionDebit'),
    conversion_fee: t('transactionConversionFee'),
    conversion_credit: t('transactionConversionCredit'),
    expiration: t('transactionExpiration'),
    chargeback: t('transactionChargeback'),
  }[transaction?.transactionType] || t('transactionActivity');
}

function referenceLabel(value, t) {
  if (!value) return t('notProvided');
  return {
    food_order: t('referenceFoodOrder'),
    food_order_refund: t('referenceFoodOrderRefund'),
    customer_transfer: t('referenceCustomerTransfer'),
    admin_load: t('referenceAdminLoad'),
    admin_adjustment: t('referenceAdminAdjustment'),
    oxsteed_credit_purchase: t('referenceCreditPurchase'),
    credit_settlement: t('referenceCreditSettlement'),
  }[value] || t('referenceOther');
}

export default function OxsteedCreditTransactionPage() {
  const { t } = useTranslation('credit');
  const { transactionId } = useParams();
  const [searchParams] = useSearchParams();
  const currencyCode = searchParams.get('currency') || 'USD';
  const [transaction, setTransaction] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = async () => {
    setLoading(true);
    setError('');
    try {
      setTransaction(await getOxsteedCreditTransaction(transactionId, { currencyCode }));
    } catch (requestError) {
      const message = errorMessage(requestError, t);
      setError(message);
      toast.error(message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, [transactionId, currencyCode]);

  const printReceipt = () => window.print();
  const positive = transaction?.direction === 'credit';
  const currency = transaction?.currencyCode || currencyCode;
  const orderPath = transaction?.orderId ? `/food/orders/${transaction.orderId}` : null;

  return (
    <>
      <PageMeta title={t('transactionReceipt')} description={t('transactionDescription')} noIndex />
      <Navbar />
      <main className="ox-credit-page">
        <div className="ox-credit-shell">
          <Link to="/oxsteed-credit" className="ox-credit-back"><ArrowLeft size={16} /> {t('backToRestaurants')}</Link>
          <header className="ox-credit-hero">
            <div>
              <p className="ox-credit-eyebrow">{t('partnerEyebrow')}</p>
              <h1>{t('transactionReceipt')}</h1>
              <p>{t('transactionDescription')}</p>
            </div>
            <button type="button" className="ox-credit-refresh ox-credit-print-button" onClick={printReceipt} disabled={!transaction}><Printer size={16} /> {t('printPdf')}</button>
          </header>

          {loading ? <div className="ox-credit-loading">{t('loadingTransaction')}</div> : error ? (
            <section className="ox-credit-panel ox-credit-error-panel" role="alert">
              <AlertCircle size={26} />
              <strong>{t('transactionUnavailable')}</strong>
              <span>{error}</span>
              <button type="button" className="ox-credit-refresh" onClick={load}><RefreshCw size={15} /> {t('tryAgain')}</button>
            </section>
          ) : transaction ? (
            <>
              <section className={`ox-credit-receipt-card ${positive ? 'positive' : 'negative'}`}>
                <div className="ox-credit-receipt-top">
                  <span className="ox-credit-receipt-icon">{positive ? <ArrowDownLeft size={22} /> : <ArrowUpRight size={22} />}</span>
                  <div><p className="ox-credit-eyebrow">{transactionLabel(transaction, t)}</p><strong>{positive ? '+' : '-'}{money(transaction.amountCents, currency)}</strong><span>{dateTime(transaction.postedAt || transaction.createdAt, t)}</span></div>
                  <span className="ox-credit-receipt-status"><ShieldCheck size={14} /> {t('posted')}</span>
                </div>
                <div className="ox-credit-receipt-grid">
                  <div><span>{t('currencyLabel')}</span><strong>{currency}</strong></div>
                  <div><span>{t('activityType')}</span><strong>{transactionLabel(transaction, t)}</strong></div>
                  <div><span>{t('balanceAfter')}</span><strong>{money(transaction.balanceAfterCents, currency)}</strong></div>
                  <div><span>{t('transactionId')}</span><strong>{transaction.id}</strong></div>
                </div>
              </section>

              <div className="ox-credit-sections ox-credit-detail-sections">
                <section className="ox-credit-panel">
                  <div className="ox-credit-panel-heading"><div><p className="ox-credit-eyebrow">{t('context')}</p><h2>{t('relatedDetails')}</h2></div><Receipt size={21} color="#d66e0c" /></div>
                  <div className="ox-credit-detail-list">
                    <div><span>{t('description')}</span><strong>{transaction.description || t('ledgerEntry')}</strong></div>
                    <div><span>{t('restaurant')}</span><strong>{transaction.restaurantName || t('notTiedRestaurant')}</strong></div>
                    {orderPath && <div><span>{t('foodOrder')}</span><strong><Link to={orderPath}>{t('viewOrder')} #{transaction.orderId} <ExternalLink size={13} /></Link></strong></div>}
                    <div><span>{t('referenceType')}</span><strong>{referenceLabel(transaction.referenceType, t)}</strong></div>
                    <div><span>{t('referenceId')}</span><strong className="ox-credit-detail-code">{transaction.referenceId || t('notProvided')}</strong></div>
                  </div>
                </section>

                <section className="ox-credit-panel">
                  <div className="ox-credit-panel-heading"><div><p className="ox-credit-eyebrow">{t('assistance')}</p><h2>{t('needHelp')}</h2></div><Building2 size={21} color="#15727a" /></div>
                  <div className="ox-credit-help-content">
                    <p>{t('incorrectEntryCopy')}</p>
                    <Link to="/oxsteed-credit#credit-activity" className="ox-credit-secondary-link">{t('reportAProblem')} <ArrowUpRight size={15} /></Link>
                    <div className="ox-credit-security-note"><AlertCircle size={15} /> {t('needHelp')} <Link to="/support/escalation">{t('contactSupport')}</Link></div>
                  </div>
                </section>
              </div>
            </>
          ) : null}
        </div>
      </main>
      <Footer />
    </>
  );
}
