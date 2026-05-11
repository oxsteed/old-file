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

function moneyFromCents(cents) {
  return new Intl.NumberFormat(undefined, {
    style: 'currency',
    currency: 'USD',
  }).format(Number(cents || 0) / 100);
}

function formatDate(value) {
  if (!value) return 'Not set';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Not set';
  return date.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

function titleCase(value) {
  return String(value || '').replace(/_/g, ' ').replace(/^\w/, (char) => char.toUpperCase());
}

export default function OrderHistoryPage() {
  return (
    <OrderErrorBoundary componentName="Order History">
      <OrderHistoryPageContent />
    </OrderErrorBoundary>
  );
}

function OrderHistoryPageContent() {
  const { t } = useTranslation();
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
      setError(err.response?.data?.error || 'Failed to load orders');
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
            <p className="orders-kicker">Purchase history</p>
            <h1>{t('orders.title')}</h1>
            <p>
              Track marketplace purchases, product orders, fulfillment status, receipts, and follow-up
              in one place so buying through OxSteed feels organized from cart to completion.
            </p>
          </div>
          <div className="orders-hero-actions">
            <Link to="/products" className="orders-btn orders-btn-primary">
              <ShoppingBag size={16} />
              Browse products
            </Link>
            <button type="button" className="orders-btn" onClick={loadOrders} disabled={loading}>
              <RefreshCw size={16} />
              Refresh
            </button>
          </div>
        </header>

        <section className="orders-stats" aria-label="Order summary">
          <SummaryCard label={t('orders.totalOrders')} value={derivedStats.total_orders} icon={Receipt} />
          <SummaryCard label={t('orders.completedOrders')} value={derivedStats.completed_orders} icon={CheckCircle2} tone="success" />
          <SummaryCard label={t('orders.pendingOrders')} value={derivedStats.pending_orders} icon={Clock3} tone="warn" />
          <SummaryCard label={t('orders.totalSpent')} value={moneyFromCents(derivedStats.total_spent_cents)} icon={ShoppingBag} />
        </section>

        <section className="orders-panel" aria-label={t('orders.yourOrders')}>
          <div className="orders-panel-header">
            <div>
              <h2>{t('orders.yourOrders')}</h2>
              <p>Filter orders by payment and fulfillment state, then open any order for details.</p>
            </div>
            <div className="orders-filters">
              {['all', 'pending', 'paid', 'completed', 'cancelled'].map(status => (
                <button
                  key={status}
                  type="button"
                  onClick={() => setFilter(status)}
                  className={filter === status ? 'active' : ''}
                >
                  {t(`orders.status.${status}`)}
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
              <button type="button" className="orders-btn" onClick={loadOrders}>Try again</button>
            </div>
          ) : orders.length === 0 ? (
            <EmptyOrders filter={filter} />
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
                    <small>OxSteed marketplace order</small>
                  </div>
                  <span>{formatDate(order.created_at)}</span>
                  <span>{order.item_count || '-'}</span>
                  <span className="orders-total">{moneyFromCents(order.total_cents)}</span>
                  <span className={`orders-status orders-status-${order.status}`}>
                    {titleCase(t(`orders.status.${order.status}`) || order.status)}
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

        <section className="orders-guide" aria-label="How orders connect">
          <GuideItem icon={Store} title="Products and supplies" text="Orders track purchases from the product marketplace, including items a business sells through OxSteed." />
          <GuideItem icon={Truck} title="Fulfillment" text="Status makes it easier to see what is pending, paid, processing, completed, cancelled, or refunded." />
          <GuideItem icon={Package} title="Shared carts" text="Orders can start from a cart you build yourself or a shared cart someone sends you." />
          <GuideItem icon={Receipt} title="Records" text="Orders sit beside invoices and payments as part of the customer’s financial paper trail." />
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

function EmptyOrders({ filter }) {
  const filtered = filter !== 'all';
  return (
    <div className="orders-empty">
      <div className="orders-empty-main">
        <div className="orders-empty-icon">
          <ShoppingBag size={34} />
        </div>
        <p className="orders-kicker">{filtered ? 'No matching orders' : 'No orders yet'}</p>
        <h2>{filtered ? 'Nothing matches this filter yet.' : 'Your order history is ready before your first purchase.'}</h2>
        <p>
          {filtered
            ? 'Try another status or return to all orders to see your full purchase history.'
            : 'When you buy products, checkout from a shared cart, or purchase supplies through OxSteed, your receipts and order status will appear here.'}
        </p>
        <div className="orders-empty-actions">
          <Link to="/products" className="orders-btn orders-btn-primary">
            Browse products
            <ArrowRight size={16} />
          </Link>
          <Link to="/tool-rentals" className="orders-btn">Browse tool rentals</Link>
          <Link to="/invoices" className="orders-btn">View invoices</Link>
        </div>
      </div>
      <div className="orders-empty-side">
        <h3>What this page will help with</h3>
        <ul>
          <li>Review product and marketplace purchases.</li>
          <li>Track status from payment through completion.</li>
          <li>Keep receipts connected to your money records.</li>
          <li>Return to order details if support or follow-up is needed.</li>
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
