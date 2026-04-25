import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import adminApi from '../../api/admin';
import { useAuth } from '../../hooks/useAuth';

export default function ConsultingPayments() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const [packages, setPackages] = useState([]);
  const [purchases, setPurchases] = useState([]);
  const [invoices, setInvoices] = useState([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState('packages');
  const [selectedPackage, setSelectedPackage] = useState(null);
  const [paymentLoading, setPaymentLoading] = useState(false);

  useEffect(() => {
    loadData();
  }, []);

  async function loadData() {
    try {
      setLoading(true);
      const [pkgRes, purchaseRes, invoiceRes] = await Promise.all([
        adminApi.get('/api/consulting/packages'),
        adminApi.get('/api/consulting/my-purchases'),
        adminApi.get('/api/consulting/invoices'),
      ]);
      setPackages(pkgRes.data || []);
      setPurchases(purchaseRes.data || []);
      setInvoices(invoiceRes.data || []);
    } catch (err) {
      console.error('Error loading consulting payment data', err);
    } finally {
      setLoading(false);
    }
  }

  async function handlePurchase(packageId) {
    if (!packageId) return;
    try {
      setPaymentLoading(true);
      // Create payment intent
      const intentRes = await adminApi.post('/api/consulting/payment-intent', { package_id: packageId });

      // Initialize Stripe payment
      const stripe = window.Stripe || null;
      if (!stripe) {
        alert(t('consulting.payment.stripeError'));
        return;
      }

      // For now, just show the intent was created
      // Full Stripe integration would happen here
      setSelectedPackage(null);
      setPaymentLoading(false);
      alert(t('consulting.payment.intentCreated'));
      loadData();
    } catch (err) {
      console.error('Payment error', err);
      alert(t('consulting.payment.error'));
      setPaymentLoading(false);
    }
  }

  const containerStyle = {
    maxWidth: '1200px',
    margin: '0 auto',
    padding: '2rem',
  };

  const tabsStyle = {
    display: 'flex',
    gap: '1rem',
    marginBottom: '2rem',
    borderBottom: '2px solid var(--color-border)',
    paddingBottom: '1rem',
  };

  const tabStyle = (isActive) => ({
    padding: '0.75rem 1.5rem',
    background: 'none',
    border: 'none',
    cursor: 'pointer',
    fontWeight: isActive ? '600' : '400',
    color: isActive ? 'var(--color-primary)' : 'var(--color-text-muted)',
    borderBottom: isActive ? '3px solid var(--color-primary)' : 'none',
    fontSize: '1rem',
  });

  const gridStyle = {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))',
    gap: '2rem',
    marginBottom: '2rem',
  };

  const cardStyle = {
    background: 'var(--color-surface)',
    border: '1px solid var(--color-border)',
    borderRadius: '8px',
    padding: '2rem',
  };

  const priceStyle = {
    fontSize: '2rem',
    fontWeight: '700',
    color: 'var(--color-primary)',
    margin: '1rem 0',
  };

  const buttonStyle = {
    background: 'var(--color-primary)',
    color: 'white',
    border: 'none',
    borderRadius: '4px',
    padding: '0.75rem 1.5rem',
    cursor: 'pointer',
    fontSize: '0.95rem',
    fontWeight: '600',
    width: '100%',
    marginTop: '1rem',
  };

  const tableStyle = {
    width: '100%',
    borderCollapse: 'collapse',
    marginTop: '1rem',
  };

  const thStyle = {
    background: 'var(--color-bg)',
    padding: '1rem',
    textAlign: 'left',
    borderBottom: '2px solid var(--color-border)',
    fontWeight: '600',
  };

  const tdStyle = {
    padding: '1rem',
    borderBottom: '1px solid var(--color-border)',
  };

  if (loading) {
    return (
      <div style={containerStyle}>
        <p>{t('common.loading')}</p>
      </div>
    );
  }

  return (
    <div style={containerStyle}>
      <h1 style={{ marginBottom: '2rem', fontSize: '2rem', fontWeight: '700' }}>
        {t('consulting.payment.title')}
      </h1>

      {/* Tabs */}
      <div style={tabsStyle}>
        <button
          style={tabStyle(activeTab === 'packages')}
          onClick={() => setActiveTab('packages')}
        >
          {t('consulting.payment.availablePackages')}
        </button>
        <button
          style={tabStyle(activeTab === 'purchases')}
          onClick={() => setActiveTab('purchases')}
        >
          {t('consulting.payment.myPurchases')}
        </button>
        <button
          style={tabStyle(activeTab === 'invoices')}
          onClick={() => setActiveTab('invoices')}
        >
          {t('consulting.payment.invoices')}
        </button>
      </div>

      {/* Packages Tab */}
      {activeTab === 'packages' && (
        <div>
          <h2 style={{ marginBottom: '1.5rem', fontSize: '1.5rem', fontWeight: '600' }}>
            {t('consulting.payment.availablePackages')}
          </h2>
          <div style={gridStyle}>
            {packages.map(pkg => (
              <div key={pkg.id} style={cardStyle}>
                <h3 style={{ marginBottom: '0.5rem', fontSize: '1.25rem' }}>
                  {pkg.name}
                </h3>
                <p style={{ color: 'var(--color-text-muted)', marginBottom: '1rem' }}>
                  {pkg.tier}
                </p>
                <div style={priceStyle}>
                  ${(pkg.price_cents / 100).toFixed(2)}
                </div>
                <p style={{ marginBottom: '1rem' }}>
                  {pkg.session_count} {t('consulting.payment.sessions')}
                </p>
                <p style={{ color: 'var(--color-text-muted)', fontSize: '0.9rem' }}>
                  {pkg.description}
                </p>
                <button
                  style={buttonStyle}
                  onClick={() => handlePurchase(pkg.id)}
                  disabled={paymentLoading}
                >
                  {paymentLoading ? t('common.sending') : t('consulting.payment.purchaseNow')}
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Purchases Tab */}
      {activeTab === 'purchases' && (
        <div>
          <h2 style={{ marginBottom: '1.5rem', fontSize: '1.5rem', fontWeight: '600' }}>
            {t('consulting.payment.myPurchases')}
          </h2>
          {purchases.length > 0 ? (
            <table style={tableStyle}>
              <thead>
                <tr>
                  <th style={thStyle}>{t('consulting.payment.packageName')}</th>
                  <th style={thStyle}>{t('consulting.payment.amount')}</th>
                  <th style={thStyle}>{t('consulting.payment.sessionsRemaining')}</th>
                  <th style={thStyle}>{t('consulting.payment.purchaseDate')}</th>
                </tr>
              </thead>
              <tbody>
                {purchases.map(purchase => (
                  <tr key={purchase.id}>
                    <td style={tdStyle}>{purchase.package_name || purchase.name}</td>
                    <td style={tdStyle}>
                      ${(purchase.total_cost_cents / 100).toFixed(2)}
                    </td>
                    <td style={tdStyle}>{purchase.sessions_remaining}</td>
                    <td style={tdStyle}>
                      {new Date(purchase.purchase_date).toLocaleDateString()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p style={{ color: 'var(--color-text-muted)' }}>
              {t('consulting.payment.noPurchases')}
            </p>
          )}
        </div>
      )}

      {/* Invoices Tab */}
      {activeTab === 'invoices' && (
        <div>
          <h2 style={{ marginBottom: '1.5rem', fontSize: '1.5rem', fontWeight: '600' }}>
            {t('consulting.payment.invoices')}
          </h2>
          {invoices.length > 0 ? (
            <table style={tableStyle}>
              <thead>
                <tr>
                  <th style={thStyle}>{t('consulting.payment.invoiceNumber')}</th>
                  <th style={thStyle}>{t('consulting.payment.amount')}</th>
                  <th style={thStyle}>{t('consulting.payment.status')}</th>
                  <th style={thStyle}>{t('consulting.payment.dueDate')}</th>
                </tr>
              </thead>
              <tbody>
                {invoices.map(invoice => (
                  <tr key={invoice.id}>
                    <td style={tdStyle}>{invoice.invoice_number}</td>
                    <td style={tdStyle}>
                      ${(invoice.amount_cents / 100).toFixed(2)}
                    </td>
                    <td style={tdStyle}>
                      <span style={{
                        background: 'var(--color-bg)',
                        padding: '0.25rem 0.75rem',
                        borderRadius: '12px',
                        fontSize: '0.85rem',
                      }}>
                        {invoice.status}
                      </span>
                    </td>
                    <td style={tdStyle}>
                      {new Date(invoice.due_date).toLocaleDateString()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p style={{ color: 'var(--color-text-muted)' }}>
              {t('consulting.payment.noInvoices')}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
