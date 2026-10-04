import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  ArrowRight,
  CheckCircle2,
  Clock3,
  Receipt,
  RefreshCw,
  RotateCcw,
  ShoppingBag,
} from 'lucide-react';
import toast from 'react-hot-toast';
import { listMyFoodOrders } from '../api/food';
import PageMeta from '../components/PageMeta';
import PageShell from '../components/PageShell';
import OrderErrorBoundary from '../components/OrderErrorBoundary';
import './OrderHistoryPage.css';

const COMPLETED_ORDER_STATUSES = new Set(['completed', 'delivered', 'picked_up']);
const CANCELLED_ORDER_STATUSES = new Set(['cancelled', 'refunded', 'rejected']);

function moneyFromCents(cents, language, currency = 'USD') {
  return new Intl.NumberFormat(language || undefined, {
    style: 'currency',
    currency: currency || 'USD',
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

function matchesOrderFilter(order, filter) {
  const status = String(order.status || '').toLowerCase();
  if (filter === 'all') return true;
  if (filter === 'completed') return COMPLETED_ORDER_STATUSES.has(status);
  if (filter === 'cancelled') return CANCELLED_ORDER_STATUSES.has(status);
  if (filter === 'active') return !COMPLETED_ORDER_STATUSES.has(status) && !CANCELLED_ORDER_STATUSES.has(status);
  return status === filter;
}

function itemCount(order) {
  return (order.items || []).reduce((total, item) => total + Number(item.quantity || 0), 0);
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
  const [filter, setFilter] = useState('all');

  useEffect(() => {
    loadOrders();
  }, []);

  const loadOrders = async () => {
    try {
      setLoading(true);
      setError(null);
      setOrders(await listMyFoodOrders());
    } catch (err) {
      setError(err.response?.data?.error || t('orders.loadError'));
    } finally {
      setLoading(false);
    }
  };

  const language = i18n.resolvedLanguage || i18n.language;
  const notSetText = t('orders.notSet');
  const visibleOrders = useMemo(
    () => orders.filter((order) => matchesOrderFilter(order, filter)),
    [filter, orders],
  );

  // RB1 — One-tap reorder: jump to the restaurant with the past order; the
  // restaurant page rebuilds the cart from the current menu and opens it.
  const handleReorder = (order) => {
    const restaurantId = order.restaurant_id ?? order.restaurantId;
    if (!restaurantId) {
      toast.error(t('food.restaurant.reorderError'));
      return;
    }
    navigate(`/food/restaurants/${restaurantId}`, { state: { reorderOrder: order } });
  };
  const isPastOrder = (order) => !matchesOrderFilter(order, 'active');

  const derivedStats = useMemo(() => ({
    total_orders: orders.length,
    completed_orders: orders.filter((order) => COMPLETED_ORDER_STATUSES.has(String(order.status || '').toLowerCase())).length,
    active_orders: orders.filter((order) => matchesOrderFilter(order, 'active')).length,
  }), [orders]);

  return (
    <PageShell>
      <PageMeta title={t('orders.title')} description={t('orders.description')} />
      <div className="orders-page">
        <header className="orders-hero">
          <div>
            <p className="orders-kicker">{t('orders.foodKicker')}</p>
            <h1>{t('orders.title')}</h1>
            <p>{t('orders.foodHeroDescription')}</p>
          </div>
          <div className="orders-hero-actions">
            <Link to="/restaurants" className="orders-btn orders-btn-primary">
              <ShoppingBag size={16} />
              {t('orders.browseRestaurants')}
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
          <SummaryCard label={t('orders.activeOrders')} value={derivedStats.active_orders} icon={Clock3} tone="warn" />
        </section>

        <section className="orders-panel" aria-label={t('orders.yourOrders')}>
          <div className="orders-panel-header">
            <div>
              <h2>{t('orders.yourOrders')}</h2>
              <p>{t('orders.panelDescription')}</p>
            </div>
            <div className="orders-filters">
              {['all', 'active', 'completed', 'cancelled'].map(status => (
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
          ) : visibleOrders.length === 0 ? (
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
              {visibleOrders.map(order => (
                <article key={order.id} className="orders-row">
                  <div>
                    <strong>#{order.id}</strong>
                    <small>{order.restaurant_name || t('orders.restaurantOrder')}</small>
                  </div>
                  <span>{formatDate(order.created_at, language, notSetText)}</span>
                  <span>{itemCount(order) || '-'}</span>
                  <span className="orders-total">{moneyFromCents(order.total_cents, language, order.currency_code)}</span>
                  <span className={`orders-status orders-status-${order.status}`}>
                    {statusLabel(order.status, t)}
                  </span>
                  <div className="orders-row-actions">
                    {isPastOrder(order) && (
                      <button type="button" onClick={() => handleReorder(order)}>
                        <RotateCcw size={15} />
                        {t('food.restaurant.reorder')}
                      </button>
                    )}
                    <button type="button" onClick={() => navigate(`/food/orders/${order.id}`)}>
                      {t('common.view')}
                      <ArrowRight size={15} />
                    </button>
                  </div>
                </article>
              ))}
            </div>
          )}
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
            : t('orders.empty.foodText')}
        </p>
        <div className="orders-empty-actions">
          <Link to="/restaurants" className="orders-btn orders-btn-primary">
            {t('orders.browseRestaurants')}
            <ArrowRight size={16} />
          </Link>
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
