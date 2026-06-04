import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  ArrowRight,
  CheckCircle2,
  Clock3,
  Package,
  Receipt,
  RefreshCw,
  ShoppingBag,
  Store,
  Truck,
} from 'lucide-react';
import api from '../api/axios';
import PageMeta from '../components/PageMeta';
import PageShell from '../components/PageShell';
import OrderErrorBoundary from '../components/OrderErrorBoundary';
import './OrderHistoryPage.css';

function moneyFromCents(cents, language) {
  return new Intl.NumberFormat(language || undefined, {
    style: 'currency',
    currency: 'USD',
  }).format(Number(cents || 0) / 100);
}

function formatDate(value, language, fallback) {
  if (!value) return fallback;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return fallback;
  return date.toLocaleDateString(language || undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

function statusLabel(status, t) {
  const key = String(status || 'pending').toLowerCase();
  return t(`orders.statusLabels.${key}`, {
    defaultValue: key.replace(/_/g, ' ').replace(/^\w/, (char) => char.toUpperCase()),
  });
}

export default function OrderHistoryPage() {
  return (
    <OrderErrorBoundary componentNameKey="orderErrorBoundary.componentNames.orderHistory">
      <OrderHistoryPageContent />
    </OrderErrorBoundary>
  );
}

function OrderHistoryPageContent() {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [stats, setStats] = useState(null);
  const [filter, setFilter] = useState('all');

  useEffect(() => {
    loadOrders();
    loadStats();
  }, [filter]);

  const loadOrders = async () => {
    try {
      setLoading(true);
      setError(null);
      const params = filter !== 'all' ? { status: filter } : {};
      const response = await api.get('/orders', { params });
      setOrders(response.data.data || []);
    } catch (err) {
      setError(err.response?.data?.error || t('orders.loadError'));
    } finally {
      setLoading(false);
    }
  };

  const loadStats = async () => {
    try {
      const response = await api.get('/orders/stats');
      setStats(response.data.data);
    } catch (err) {
      console.error('Failed to load stats:', err);
    }
  };

  const language = i18n.resolvedLanguage || i18n.language;
  const notSetText = t('orders.notSet');

  const derivedStats = useMemo(() => ({
    total_orders: stats?.total_orders ?? orders.length,
    completed_orders: stats?.completed_orders ?? orders.filter((order) => order.status === 'completed').length,
    pending_orders: stats?.pending_orders ?? orders.filter((order) => ['pending', 'paid', 'processing'].includes(order.status)).length,
    total_spent_cents: stats?.total_spent_cents ?? orders.reduce((sum, order) => sum + Number(order.total_cents || 0), 0),
  }), [orders, stats]);

  return (
    <PageShell>
      <PageMeta title={t('orders.title')} description={t('orders.description')} />
      <div className="orders-page">
        <header className="orders-hero">
          <div>
            <p className="orders-kicker">{t('orders.kicker')}</p>
            <h1>{t('orders.title')}</h1>
            <p>{t('orders.heroDescription')}</p>
          </div>
          <div className="orders-hero-actions">
            <Link to="/products" className="orders-btn orders-btn-primary">
              <ShoppingBag size={16} />
              {t('orders.browseProducts')}
            </Link>
            <button type="button" className="orders-btn" onClick={loadOrders} disabled={loading}>
              <RefreshCw size={16} />
              {t('common.refresh')}
            </button>
          </div>
        </header>

        <section className="orders-stats" aria-label={t('orders.summaryAriaLabel')}>
          <SummaryCard label={t('orders.totalOrders')} value={derivedStats.total_orders} icon={Receipt} />
          <SummaryCard label={t('orders.completedOrders')} value={derivedStats.completed_orders} icon={CheckCircle2} tone="success" />
          <SummaryCard label={t('orders.pendingOrders')} value={derivedStats.pending_orders} icon={Clock3} tone="warn" />
          <SummaryCard label={t('orders.totalSpent')} value={moneyFromCents(derivedStats.total_spent_cents, language)} icon={ShoppingBag} />
        </section>

        <section className="orders-panel" aria-label={t('orders.yourOrders')}>
          <div className="orders-panel-header">
            <div>
              <h2>{t('orders.yourOrders')}</h2>
              <p>{t('orders.panelDescription')}</p>
            </div>
            <div className="orders-filters">
              {['all', 'pending', 'paid', 'completed', 'cancelled'].map(status => (
                <button
                  key={status}
                  type="button"
                  onClick={() => setFilter(status)}
                  className={filter === status ? 'active' : ''}
                >
                  {statusLabel(status, t)}
                </button>
              ))}
            </div>
          </div>

          {loading ? (
            <div className="orders-loading">
              <div className="orders-spinner" />
              <p>{t('common.loading')}</p>
            </div>
          ) : error ? (
            <div className="orders-error">
              <p>{error}</p>
              <button type="button" className="orders-btn" onClick={loadOrders}>{t('common.tryAgain')}</button>
            </div>
          ) : orders.length === 0 ? (
            <EmptyOrders filter={filter} t={t} />
          ) : (
            <div className="orders-list">
              <div className="orders-list-head">
                <span>{t('orders.orderId')}</span>
                <span>{t('orders.date')}</span>
                <span>{t('orders.items')}</span>
                <span>{t('orders.total')}</span>
                <span>{t('orders.status')}</span>
                <span>{t('common.action')}</span>
              </div>
              {orders.map(order => (
                <article key={order.id} className="orders-row">
                  <div>
                    <strong>#{order.id}</strong>
                    <small>{t('orders.marketplaceOrder')}</small>
                  </div>
                  <span>{formatDate(order.created_at, language, notSetText)}</span>
                  <span>{order.item_count || '-'}</span>
                  <span className="orders-total">{moneyFromCents(order.total_cents, language)}</span>
                  <span className={`orders-status orders-status-${order.status}`}>
                    {statusLabel(order.status, t)}
                  </span>
                  <button type="button" onClick={() => navigate(`/orders/${order.id}`)}>
                    {t('common.view')}
                    <ArrowRight size={15} />
                  </button>
                </article>
              ))}
            </div>
          )}
        </section>

        <section className="orders-guide" aria-label={t('orders.guide.ariaLabel')}>
          <GuideItem icon={Store} title={t('orders.guide.products.title')} text={t('orders.guide.products.text')} />
          <GuideItem icon={Truck} title={t('orders.guide.fulfillment.title')} text={t('orders.guide.fulfillment.text')} />
          <GuideItem icon={Package} title={t('orders.guide.sharedCarts.title')} text={t('orders.guide.sharedCarts.text')} />
          <GuideItem icon={Receipt} title={t('orders.guide.records.title')} text={t('orders.guide.records.text')} />
        </section>
      </div>
    </PageShell>
  );
}

function SummaryCard({ label, value, icon: Icon, tone = 'neutral' }) {
  return (
    <div className={`orders-summary-card tone-${tone}`}>
      <div className="orders-summary-icon">
        <Icon size={18} />
      </div>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function EmptyOrders({ filter, t }) {
  const filtered = filter !== 'all';
  return (
    <div className="orders-empty">
      <div className="orders-empty-main">
        <div className="orders-empty-icon">
          <ShoppingBag size={34} />
        </div>
        <p className="orders-kicker">{filtered ? t('orders.empty.filteredKicker') : t('orders.empty.kicker')}</p>
        <h2>{filtered ? t('orders.empty.filteredTitle') : t('orders.empty.title')}</h2>
        <p>
          {filtered
            ? t('orders.empty.filteredText')
            : t('orders.empty.text')}
        </p>
        <div className="orders-empty-actions">
          <Link to="/products" className="orders-btn orders-btn-primary">
            {t('orders.browseProducts')}
            <ArrowRight size={16} />
          </Link>
          <Link to="/tool-rentals" className="orders-btn">{t('orders.browseToolRentals')}</Link>
          <Link to="/invoices" className="orders-btn">{t('orders.viewInvoices')}</Link>
        </div>
      </div>
      <div className="orders-empty-side">
        <h3>{t('orders.empty.helpTitle')}</h3>
        <ul>
          <li>{t('orders.empty.help1')}</li>
          <li>{t('orders.empty.help2')}</li>
          <li>{t('orders.empty.help3')}</li>
          <li>{t('orders.empty.help4')}</li>
        </ul>
      </div>
    </div>
  );
}

function GuideItem({ icon: Icon, title, text }) {
  return (
    <div className="orders-guide-item">
      <Icon size={18} />
      <h3>{title}</h3>
      <p>{text}</p>
    </div>
  );
}
