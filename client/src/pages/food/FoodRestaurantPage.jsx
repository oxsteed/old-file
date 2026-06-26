// OxSteed Restaurants – redesigned restaurant profile (v2 design comp).
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import toast from 'react-hot-toast';
import { useAuth } from '../../context/AuthContext';
import {
  getFoodRestaurant,
  placeFoodOrder,
  formatFoodMoney,
  listFoodPromotions,
} from '../../api/food';
import Navbar from '../../components/Navbar';
import Footer from '../../components/Footer';
import FoodOrderConfirmation from './FoodOrderConfirmation';
import '../../styles/FoodRestaurantPage.css';

// ─── Item modifier modal ─────────────────────────────────────────────────────

export function ItemModal({ item, currency, onClose, onAdd, t }) {
  const [quantity, setQuantity] = useState(1);
  const [selected, setSelected] = useState({});
  const [instructions, setInstructions] = useState('');

  const toggle = (group, option) => {
    setSelected((prev) => {
      const current = new Set(prev[group.id] || []);
      if (current.has(option.id)) {
        current.delete(option.id);
      } else {
        if (group.maxSelect === 1) current.clear();
        if (current.size >= group.maxSelect) return prev;
        current.add(option.id);
      }
      return { ...prev, [group.id]: current };
    });
  };

  const modifierIds = Object.values(selected).flatMap((s) => Array.from(s));
  const modifierTotal = (item.modifierGroups || []).reduce((sum, group) => {
    const chosen = selected[group.id] || new Set();
    return (
      sum +
      (group.options || [])
        .filter((o) => chosen.has(o.id))
        .reduce((s, o) => s + Number(o.priceDeltaCents || 0), 0)
    );
  }, 0);
  const lineTotal = (Number(item.price_cents) + modifierTotal) * quantity;
  const missingRequired = (item.modifierGroups || []).some(
    (g) => g.isRequired && (selected[g.id]?.size || 0) < Math.max(1, g.minSelect || 1)
  );

  return (
    <div className="rp-modal-overlay" onClick={onClose} role="presentation">
      <div
        className="rp-modal"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
      >
        {item.image_url && (
          <div className="rp-modal-hero">
            <img src={item.image_url} alt={item.name} />
          </div>
        )}
        <div className="rp-modal-body">
          <h3 className="rp-modal-item-name">{item.name}</h3>
          {item.description && (
            <p className="rp-modal-item-desc">{item.description}</p>
          )}
          <p className="rp-modal-item-price">
            {formatFoodMoney(item.price_cents, currency)}
          </p>

          {(item.modifierGroups || []).map((group) => (
            <div key={group.id} className="rp-modgroup">
              <div className="rp-modgroup-name">
                {group.name}
                {group.isRequired && (
                  <span className="rp-mod-required">Required</span>
                )}
              </div>
              {(group.options || [])
                .filter((o) => o.isAvailable !== false)
                .map((option) => {
                  const isOn = selected[group.id]?.has(option.id);
                  return (
                    <div
                      key={option.id}
                      className={`rp-modoption${isOn ? ' selected' : ''}`}
                      onClick={() => toggle(group, option)}
                      role="button"
                      tabIndex={0}
                      onKeyDown={(e) => e.key === 'Enter' && toggle(group, option)}
                    >
                      <span
                        className={`rp-modcheck${group.maxSelect === 1 ? ' radio' : ''}`}
                      >
                        {isOn ? '●' : '○'}
                      </span>
                      <span className="rp-modoption-name">{option.name}</span>
                      {Number(option.priceDeltaCents) !== 0 && (
                        <span className="rp-modoption-price">
                          +{formatFoodMoney(option.priceDeltaCents, currency)}
                        </span>
                      )}
                    </div>
                  );
                })}
            </div>
          ))}

          <div className="rp-modal-instructions">
            <label htmlFor="rp-item-notes">
              {t('food.order.specialInstructions', {
                defaultValue: 'Special instructions',
              })}
            </label>
            <textarea
              id="rp-item-notes"
              value={instructions}
              onChange={(e) => setInstructions(e.target.value)}
              maxLength={500}
              rows={2}
              placeholder="Allergies, substitutions…"
            />
          </div>

          <div className="rp-modal-qty-row">
            <div className="rp-qty-stepper">
              <button
                type="button"
                className="rp-qty-btn"
                onClick={() => setQuantity((q) => Math.max(1, q - 1))}
              >
                −
              </button>
              <span className="rp-qty-count">{quantity}</span>
              <button
                type="button"
                className="rp-qty-btn"
                onClick={() => setQuantity((q) => Math.min(99, q + 1))}
              >
                +
              </button>
            </div>
            <button
              type="button"
              className="rp-modal-add-btn"
              disabled={missingRequired}
              onClick={() =>
                onAdd({
                  menuItemId: item.id,
                  name: item.name,
                  quantity,
                  modifierIds,
                  modifierNames: (item.modifierGroups || []).flatMap((g) =>
                    (g.options || [])
                      .filter((o) => selected[g.id]?.has(o.id))
                      .map((o) => o.name)
                  ),
                  unitTotalCents: Number(item.price_cents) + modifierTotal,
                  specialInstructions: instructions.trim() || undefined,
                })
              }
            >
              {t('food.order.addToOrder', {
                defaultValue: `Add · ${formatFoodMoney(lineTotal, currency)}`,
                total: formatFoodMoney(lineTotal, currency),
              })}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Hours list helper ────────────────────────────────────────────────────────

function HoursList({ hours }) {
  if (!hours) return null;
  const days = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  const dayKeys = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];
  if (typeof hours === 'string') {
    return <p style={{ fontSize: 13, color: '#64748b', margin: 0 }}>{hours}</p>;
  }
  if (Array.isArray(hours)) {
    return (
      <ul className="rp-hours-list">
        {hours.map((row, i) => (
          <li key={i}>
            <span className="rp-hours-day">{row.day || row.label || row.name}</span>
            <span className="rp-hours-time">{row.hours || row.time || row.value || 'Closed'}</span>
          </li>
        ))}
      </ul>
    );
  }
  return (
    <ul className="rp-hours-list">
      {days.map((d, i) => {
        const val = hours[dayKeys[i]] || hours[d.toLowerCase()] || hours[d];
        return val ? (
          <li key={d}>
            <span className="rp-hours-day">{d}</span>
            <span className="rp-hours-time">{val}</span>
          </li>
        ) : null;
      })}
    </ul>
  );
}

// ─── SVG map placeholder ──────────────────────────────────────────────────────

function MapPlaceholder({ restaurant }) {
  const city = restaurant.address_city || '';
  return (
    <div className="rp-map-card">
      <svg viewBox="0 0 280 140" xmlns="http://www.w3.org/2000/svg" style={{ display: 'block', width: '100%', height: 'auto' }}>
        <rect width="280" height="140" fill="#e8edf2" />
        <rect x="0" y="62" width="280" height="16" fill="#fff" opacity="0.7" />
        <rect x="120" y="0" width="16" height="140" fill="#fff" opacity="0.7" />
        <rect x="0" y="100" width="280" height="10" fill="#fff" opacity="0.4" />
        <rect x="60" y="0" width="10" height="140" fill="#fff" opacity="0.4" />
        <rect x="200" y="0" width="10" height="140" fill="#fff" opacity="0.4" />
        <rect x="10" y="10" width="48" height="48" rx="4" fill="#d1d5db" opacity="0.6" />
        <rect x="10" y="82" width="48" height="48" rx="4" fill="#d1d5db" opacity="0.6" />
        <rect x="140" y="10" width="56" height="48" rx="4" fill="#d1d5db" opacity="0.6" />
        <rect x="140" y="82" width="56" height="48" rx="4" fill="#d1d5db" opacity="0.6" />
        <rect x="214" y="10" width="58" height="48" rx="4" fill="#d1d5db" opacity="0.5" />
        <rect x="214" y="82" width="58" height="48" rx="4" fill="#d1d5db" opacity="0.5" />
        <circle cx="128" cy="70" r="14" fill="#ff8c00" opacity="0.9" />
        <circle cx="128" cy="70" r="6" fill="#fff" />
        <circle cx="128" cy="70" r="3" fill="#ff8c00" />
      </svg>
      {city && <p className="rp-map-label">{city}</p>}
    </div>
  );
}

// ─── Contact list helper ──────────────────────────────────────────────────────

function ContactList({ restaurant }) {
  return (
    <ul className="rp-contact-list">
      {restaurant.phone && (
        <li>
          <span className="rp-contact-icon">📞</span>
          <a href={`tel:${restaurant.phone}`}>{restaurant.phone}</a>
        </li>
      )}
      {restaurant.email && (
        <li>
          <span className="rp-contact-icon">✉️</span>
          <a href={`mailto:${restaurant.email}`}>{restaurant.email}</a>
        </li>
      )}
      {restaurant.website_url && (
        <li>
          <span className="rp-contact-icon">🌐</span>
          <a href={restaurant.website_url} target="_blank" rel="noopener noreferrer">
            {restaurant.website_url.replace(/^https?:\/\//, '')}
          </a>
        </li>
      )}
      {(restaurant.address_line1 || restaurant.address_city) && (
        <li>
          <span className="rp-contact-icon">📍</span>
          <span>
            {[
              restaurant.address_line1,
              restaurant.address_city,
              restaurant.address_state,
              restaurant.address_country,
            ]
              .filter(Boolean)
              .join(', ')}
          </span>
        </li>
      )}
    </ul>
  );
}

// ─── Main page component ──────────────────────────────────────────────────────

export default function FoodRestaurantPage() {
  const { restaurantId } = useParams();
  const navigate = useNavigate();
  const { t } = useTranslation();
  const { user } = useAuth();

  // Data state
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [promotions, setPromotions] = useState([]);

  // UI state
  const [activeTab, setActiveTab] = useState('menu');
  const [activeCategory, setActiveCategory] = useState(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [dietaryFilter, setDietaryFilter] = useState('all');
  const [saved, setSaved] = useState(false);

  // Cart state
  const [activeItem, setActiveItem] = useState(null);
  const [cart, setCart] = useState([]);
  const [cartOpen, setCartOpen] = useState(false);
  const [fulfillment, setFulfillment] = useState('pickup');
  const [tableLabel, setTableLabel] = useState('');
  const [guestName, setGuestName] = useState('');
  const [placing, setPlacing] = useState(false);
  const [placedOrder, setPlacedOrder] = useState(null);
  const [trackingToken, setTrackingToken] = useState(null);

  // Fetch restaurant data
  useEffect(() => {
    let alive = true;
    setLoading(true);
    getFoodRestaurant(restaurantId)
      .then((d) => { if (alive) setData(d); })
      .catch(() => { if (alive) setData(null); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [restaurantId]);

  // Fetch promotions
  useEffect(() => {
    if (!restaurantId) return;
    listFoodPromotions(restaurantId)
      .then((p) => setPromotions(Array.isArray(p) ? p : (p?.promotions || [])))
      .catch(() => setPromotions([]));
  }, [restaurantId]);

  const currency = data?.restaurant?.currency_code || 'USD';
  const cartTotal = useMemo(
    () => cart.reduce((sum, line) => sum + line.unitTotalCents * line.quantity, 0),
    [cart]
  );
  const cartCount = cart.reduce((s, l) => s + l.quantity, 0);

  const submitOrder = async () => {
    if (cart.length === 0) return;
    setPlacing(true);
    try {
      const { order, trackingToken: token } = await placeFoodOrder(restaurantId, {
        orderSource: 'web',
        fulfillmentType: fulfillment,
        tableLabel: fulfillment === 'dine_in' ? tableLabel.trim() || undefined : undefined,
        guestName: !user ? guestName.trim() || undefined : undefined,
        items: cart.map((line) => ({
          menuItemId: line.menuItemId,
          quantity: line.quantity,
          modifierIds: line.modifierIds,
          specialInstructions: line.specialInstructions,
        })),
      });
      setPlacedOrder(order);
      setTrackingToken(token || null);
      setCart([]);
      setCartOpen(false);
    } catch (err) {
      const message =
        err?.response?.data?.error?.message || err?.response?.data?.message;
      toast.error(
        typeof message === 'string'
          ? message
          : t('food.order.placeError', { defaultValue: 'Unable to place order. Please try again.' })
      );
    } finally {
      setPlacing(false);
    }
  };

  // ── Loading ────────────────────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="rp-root">
        <div className="rp-loading-screen">
          <div className="rp-loading-spinner" />
          <p>Loading menu…</p>
        </div>
      </div>
    );
  }

  // ── Not found ──────────────────────────────────────────────────────────────
  if (!data?.restaurant) {
    return (
      <div className="rp-root">
        <div className="rp-not-found">
          <div style={{ fontSize: 48, marginBottom: 12 }}>🍽️</div>
          <p style={{ fontWeight: 600, marginBottom: 16 }}>Restaurant not found</p>
          <Link
            to="/restaurants"
            style={{
              textDecoration: 'none',
              display: 'inline-block',
              padding: '12px 28px',
              background: '#ff8c00',
              color: '#fff',
              borderRadius: 12,
              fontWeight: 600,
            }}
          >
            Browse Restaurants
          </Link>
        </div>
      </div>
    );
  }

  const { restaurant, menu = [], uncategorizedItems = [] } = data;

  // ── Order placed ───────────────────────────────────────────────────────────
  if (placedOrder) {
    return (
      <FoodOrderConfirmation
        restaurantId={restaurant.id}
        order={placedOrder}
        trackingToken={trackingToken}
        currency={currency}
        variant="page"
      >
        <div style={{ display: 'flex', gap: 12, justifyContent: 'center', marginTop: 16, flexWrap: 'wrap' }}>
          <Link
            to={`/restaurants/queue/${restaurant.id}`}
            style={{ textDecoration: 'none', padding: '12px 24px', border: '1.5px solid #ff8c00', color: '#ff8c00', borderRadius: 12, fontWeight: 600 }}
          >
            Watch Queue
          </Link>
          <button
            type="button"
            style={{ padding: '12px 24px', background: '#ff8c00', color: '#fff', border: 'none', borderRadius: 12, fontWeight: 600, cursor: 'pointer' }}
            onClick={() => { setPlacedOrder(null); setTrackingToken(null); }}
          >
            Order Again
          </button>
        </div>
      </FoodOrderConfirmation>
    );
  }

  // ── Menu sections ──────────────────────────────────────────────────────────
  const allSections = [
    ...menu,
    ...(uncategorizedItems.length
      ? [{ id: 'other', name: 'Other Items', items: uncategorizedItems }]
      : []),
  ];

  const filteredSections = allSections
    .map((sec) => ({
      ...sec,
      items: (sec.items || []).filter((item) => {
        if (searchQuery) {
          const q = searchQuery.toLowerCase();
          if (
            !item.name?.toLowerCase().includes(q) &&
            !item.description?.toLowerCase().includes(q)
          )
            return false;
        }
        if (dietaryFilter !== 'all') {
          const tags = item.dietary_tags || item.tags || [];
          if (dietaryFilter === 'vegetarian' && !tags.includes('vegetarian') && !tags.includes('vegan')) return false;
          if (dietaryFilter === 'vegan' && !tags.includes('vegan')) return false;
          if (dietaryFilter === 'gluten-free' && !tags.includes('gluten-free') && !tags.includes('gf')) return false;
          if (dietaryFilter === 'spicy' && !tags.includes('spicy')) return false;
        }
        return true;
      }),
    }))
    .filter((sec) =>
      sec.items.length > 0 || (searchQuery === '' && dietaryFilter === 'all')
    );

  // Restaurant derived values
  const rating = parseFloat(restaurant.avg_rating || restaurant.rating || 0);
  const reviewCount = Number(restaurant.review_count || restaurant.reviews_count || 0);
  const isOpen = restaurant.is_open !== false;
  const coverUrl = restaurant.cover_photo_url || restaurant.image_url;
  const cuisineType = restaurant.cuisine_type || restaurant.category || restaurant.type || 'Restaurant';
  const prepMin = Number(restaurant.prep_time_min || restaurant.estimated_prep_minutes || 25);
  const priceRange = '$'.repeat(Math.min(4, Math.max(1, restaurant.price_range || 2)));
  const reviews = restaurant.recent_reviews || restaurant.reviews || [];
  const visibleCat = activeCategory || allSections[0]?.id;

  const typePills = [
    { icon: '🏪', label: 'All' },
    { icon: '🥘', label: 'Haitian' },
    { icon: '🍕', label: 'Pizza' },
    { icon: '🍔', label: 'Burgers' },
    { icon: '🌮', label: 'Mexican' },
    { icon: '🍣', label: 'Sushi' },
    { icon: '🥗', label: 'Healthy' },
  ];

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <>
    <Navbar />
    <div className="rp-root">
      <div className="rp-page-wrap">

        {/* ── Mobile sticky nav ── */}
        <nav className="rp-nav">
          <button
            className="rp-nav-back"
            type="button"
            onClick={() => navigate(-1)}
            aria-label="Back"
          >
            ←
          </button>
          <span className="rp-nav-title">{restaurant.display_name}</span>
          <button
            className="rp-nav-cart"
            type="button"
            onClick={() => cartCount > 0 && setCartOpen(true)}
            aria-label="View cart"
          >
            <span className="rp-nav-cart-icon">🛒</span>
            {cartCount > 0 && <span className="rp-nav-cart-badge">{cartCount}</span>}
          </button>
        </nav>

        {/* ── Type switcher row ── */}
        <div className="rp-type-row">
          {typePills.map((pill, i) => (
            <button
              key={pill.label}
              type="button"
              className={`rp-type-pill${i === 0 ? ' active' : ''}`}
            >
              {pill.icon} {pill.label}
            </button>
          ))}
        </div>

        {/* ── Hero ── */}
        <div className="rp-hero-wrap">
          {coverUrl ? (
            <img src={coverUrl} alt="" className="rp-hero-img" />
          ) : (
            <div className="rp-hero-fallback" />
          )}
          <div className="rp-hero-gradient" />
          <svg className="rp-hero-dots" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
            <defs>
              <pattern id="rp-dot-pattern" x="0" y="0" width="20" height="20" patternUnits="userSpaceOnUse">
                <circle cx="2" cy="2" r="1.5" fill="white" />
              </pattern>
            </defs>
            <rect width="100%" height="100%" fill="url(#rp-dot-pattern)" />
          </svg>
          {rating > 0 && (
            <div className="rp-hero-rating">
              <span>⭐</span>
              <span>{rating.toFixed(1)}</span>
              {reviewCount > 0 && (
                <span className="rp-hero-rating-count">({reviewCount})</span>
              )}
            </div>
          )}
          <div className="rp-hero-status">
            <span className={`rp-status-dot${isOpen ? '' : ' closed'}`} />
            <span>{isOpen ? 'Open now' : 'Closed'}</span>
          </div>
        </div>

        {/* ── Info card ── */}
        <div className="rp-info-card">
          <div className="rp-info-top-row">
            <div className="rp-logo-wrap">
              <div className="rp-logo">
                {restaurant.logo_url ? (
                  <img
                    src={restaurant.logo_url}
                    alt={restaurant.display_name}
                    style={{ width: '100%', height: '100%', objectFit: 'cover', borderRadius: '50%' }}
                  />
                ) : (
                  <span style={{ fontSize: 28 }}>🍽️</span>
                )}
              </div>
            </div>
            <div className="rp-info-action-row">
              <button
                type="button"
                className={`rp-icon-btn${saved ? ' saved' : ''}`}
                onClick={() => setSaved((s) => !s)}
                aria-label={saved ? 'Unsave' : 'Save'}
              >
                {saved ? '❤️' : '🤍'}
              </button>
              <button
                type="button"
                className="rp-icon-btn"
                aria-label="Share"
                onClick={() => {
                  if (navigator.share) {
                    navigator.share({ title: restaurant.display_name, url: window.location.href }).catch(() => {});
                  } else if (navigator.clipboard) {
                    navigator.clipboard.writeText(window.location.href);
                    toast.success('Link copied!');
                  }
                }}
              >
                ↗
              </button>
            </div>
          </div>

          <span className="rp-type-badge">{cuisineType}</span>
          <h1 className="rp-rest-name">{restaurant.display_name}</h1>

          <p className="rp-rest-meta">
            {[restaurant.address_city, restaurant.address_state, restaurant.address_country]
              .filter(Boolean)
              .join(', ')}
            {restaurant.description && (
              <span style={{ display: 'block', marginTop: 2, opacity: 0.8 }}>
                {restaurant.description}
              </span>
            )}
          </p>

          <div className="rp-rating-row">
            {rating > 0 && (
              <>
                <span className="rp-stars">
                  {'★'.repeat(Math.round(rating))}{'☆'.repeat(5 - Math.round(rating))}
                </span>
                <span className="rp-rating-val">{rating.toFixed(1)}</span>
                {reviewCount > 0 && <span className="rp-review-count">({reviewCount})</span>}
                <span className="rp-dot-sep">·</span>
              </>
            )}
            <span>{prepMin}–{prepMin + 10} min</span>
            <span className="rp-dot-sep">·</span>
            <span>{priceRange}</span>
          </div>

          {/* Fulfillment toggle */}
          <div className="rp-fulfillment-toggle">
            <button
              type="button"
              className={`rp-fulfillment-btn${fulfillment === 'pickup' ? ' active' : ''}`}
              onClick={() => setFulfillment('pickup')}
            >
              🏃 Pickup
            </button>
            <button
              type="button"
              className={`rp-fulfillment-btn${fulfillment === 'dine_in' ? ' active' : ''}`}
              onClick={() => setFulfillment('dine_in')}
            >
              🪑 Dine In
            </button>
            <button
              type="button"
              className={`rp-fulfillment-btn${fulfillment === 'delivery' ? ' active' : ''}`}
              onClick={() => setFulfillment('delivery')}
            >
              🛵 Delivery
            </button>
          </div>

          {/* Info chips */}
          <div className="rp-chips-row">
            <div className="rp-chip">
              <span>🕐</span>
              <span>{prepMin}–{prepMin + 10} min</span>
            </div>
            {restaurant.delivery_fee_cents != null && (
              <div className="rp-chip">
                <span>💳</span>
                <span>
                  {restaurant.delivery_fee_cents === 0
                    ? 'Free delivery'
                    : `${formatFoodMoney(restaurant.delivery_fee_cents, currency)} fee`}
                </span>
              </div>
            )}
            {restaurant.minimum_order_cents != null && (
              <div className="rp-chip">
                <span>📦</span>
                <span>Min {formatFoodMoney(restaurant.minimum_order_cents, currency)}</span>
              </div>
            )}
          </div>
        </div>

        <div className="rp-separator" />

        {/* ── Main grid ── */}
        <div className="rp-main-grid">

          {/* Desktop sidebar */}
          <aside className="rp-sidebar">
            <div className="rp-side-card">
              <button type="button" className="rp-cta-btn" onClick={() => setActiveTab('menu')}>
                Start Order
              </button>
              {cartCount > 0 && (
                <button
                  type="button"
                  className="rp-secondary-btn"
                  onClick={() => setCartOpen(true)}
                  style={{ marginTop: 8 }}
                >
                  View Cart ({cartCount}) · {formatFoodMoney(cartTotal, currency)}
                </button>
              )}
            </div>

            {restaurant.hours && (
              <div className="rp-side-card">
                <p className="rp-side-card-title">Hours</p>
                <HoursList hours={restaurant.hours} />
              </div>
            )}

            <div className="rp-side-card" style={{ padding: 0, overflow: 'hidden', borderRadius: 12 }}>
              <MapPlaceholder restaurant={restaurant} />
            </div>

            <div className="rp-side-card">
              <p className="rp-side-card-title">Contact</p>
              <ContactList restaurant={restaurant} />
            </div>
          </aside>

          {/* Main content */}
          <div className="rp-main-content">

            {/* Sticky search + dietary */}
            <div className="rp-sticky-search">
              <div className="rp-search-wrap">
                <span className="rp-search-icon" aria-hidden="true">🔍</span>
                <input
                  className="rp-search-input"
                  type="search"
                  placeholder="Search menu…"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  aria-label="Search menu items"
                />
                {searchQuery && (
                  <button
                    type="button"
                    className="rp-search-clear"
                    onClick={() => setSearchQuery('')}
                    aria-label="Clear search"
                  >
                    ×
                  </button>
                )}
              </div>
              <div className="rp-diet-row">
                {[
                  { key: 'all', label: 'All' },
                  { key: 'vegetarian', label: '🌿 Vegetarian' },
                  { key: 'vegan', label: '🥦 Vegan' },
                  { key: 'gluten-free', label: '🌾 GF' },
                  { key: 'spicy', label: '🌶️ Spicy' },
                ].map(({ key, label }) => (
                  <button
                    key={key}
                    type="button"
                    className={`rp-diet-chip${dietaryFilter === key ? ' active' : ''}`}
                    onClick={() => setDietaryFilter(key)}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>

            {/* Tab bar */}
            <div className="rp-tab-bar">
              {[
                { key: 'menu', label: 'Menu' },
                { key: 'info', label: 'Info' },
                { key: 'reviews', label: 'Reviews' },
                { key: 'deals', label: 'Deals' },
              ].map(({ key, label }) => (
                <button
                  key={key}
                  type="button"
                  className={`rp-tab${activeTab === key ? ' active' : ''}`}
                  onClick={() => setActiveTab(key)}
                >
                  {label}
                </button>
              ))}
            </div>

            {/* ── MENU ── */}
            {activeTab === 'menu' && (
              <div className="rp-panel">
                {allSections.length > 1 && (
                  <div className="rp-cat-row">
                    {allSections.map((sec) => (
                      <button
                        key={sec.id}
                        type="button"
                        className={`rp-cat-pill${visibleCat === sec.id ? ' active' : ''}`}
                        onClick={() => {
                          setActiveCategory(sec.id);
                          const el = document.getElementById(`rp-sec-${sec.id}`);
                          if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
                        }}
                      >
                        {sec.name}
                      </button>
                    ))}
                  </div>
                )}

                {allSections.length === 0 && (
                  <div className="rp-empty-state">
                    <div className="rp-empty-icon">🍽️</div>
                    <p>No menu items yet.</p>
                  </div>
                )}

                {filteredSections.length === 0 && allSections.length > 0 && (
                  <div className="rp-empty-state">
                    <div className="rp-empty-icon">🔍</div>
                    <p>No items match your search.</p>
                    <button
                      type="button"
                      className="rp-secondary-btn"
                      style={{ marginTop: 12, width: 'auto', padding: '8px 20px' }}
                      onClick={() => { setSearchQuery(''); setDietaryFilter('all'); }}
                    >
                      Clear filters
                    </button>
                  </div>
                )}

                {filteredSections.map((sec) => (
                  <div key={sec.id} id={`rp-sec-${sec.id}`} className="rp-menu-section">
                    {filteredSections.length > 1 && (
                      <h2 className="rp-cat-title">{sec.name}</h2>
                    )}
                    {(sec.items || []).map((item) => {
                      const canOrder =
                        item.is_available !== false &&
                        restaurant.accepts_online_orders !== false;
                      return (
                        <div
                          key={item.id}
                          className={`rp-menu-item${item.is_available === false ? ' unavailable' : ''}`}
                          onClick={() => canOrder && setActiveItem(item)}
                          role="button"
                          tabIndex={0}
                          onKeyDown={(e) => e.key === 'Enter' && canOrder && setActiveItem(item)}
                        >
                          {item.image_url ? (
                            <img src={item.image_url} alt="" className="rp-item-img" loading="lazy" />
                          ) : (
                            <div className="rp-item-img-placeholder" aria-hidden="true">🍽️</div>
                          )}
                          <div className="rp-item-body">
                            <p className="rp-item-name">{item.name}</p>
                            {item.description && (
                              <p className="rp-item-desc">{item.description}</p>
                            )}
                            {item.is_available === false && (
                              <p className="rp-item-sold-out">Sold out</p>
                            )}
                            <p className="rp-item-price">
                              {formatFoodMoney(item.price_cents, currency)}
                            </p>
                          </div>
                          {canOrder && (
                            <button
                              type="button"
                              className="rp-add-btn"
                              onClick={(e) => { e.stopPropagation(); setActiveItem(item); }}
                              aria-label={`Add ${item.name}`}
                            >
                              +
                            </button>
                          )}
                        </div>
                      );
                    })}
                  </div>
                ))}
              </div>
            )}

            {/* ── INFO ── */}
            {activeTab === 'info' && (
              <div className="rp-panel rp-info-panel">
                <p className="rp-panel-section-title">Hours</p>
                {restaurant.hours ? (
                  <HoursList hours={restaurant.hours} />
                ) : (
                  <p style={{ color: '#94a3b8', fontSize: 13 }}>Hours not available</p>
                )}
                <p className="rp-panel-section-title" style={{ marginTop: 20 }}>Location</p>
                <div style={{ borderRadius: 12, overflow: 'hidden' }}>
                  <MapPlaceholder restaurant={restaurant} />
                </div>
                <p className="rp-panel-section-title" style={{ marginTop: 20 }}>Contact</p>
                <ContactList restaurant={restaurant} />
              </div>
            )}

            {/* ── REVIEWS ── */}
            {activeTab === 'reviews' && (
              <div className="rp-panel rp-reviews-panel">
                {rating > 0 || reviews.length > 0 ? (
                  <>
                    <div className="rp-rating-hero">
                      <div className="rp-rating-big-col">
                        <div className="rp-big-rating">{rating.toFixed(1)}</div>
                        <div className="rp-big-stars">
                          {'★'.repeat(Math.round(rating))}{'☆'.repeat(5 - Math.round(rating))}
                        </div>
                        {reviewCount > 0 && (
                          <div className="rp-big-count">{reviewCount} reviews</div>
                        )}
                      </div>
                      <div className="rp-rating-bars">
                        {[5, 4, 3, 2, 1].map((star) => {
                          const cnt = reviews.filter((r) => Math.round(r.rating) === star).length;
                          const pct = reviews.length > 0 ? (cnt / reviews.length) * 100 : 0;
                          return (
                            <div key={star} className="rp-bar-row">
                              <span className="rp-bar-label">{star}</span>
                              <div className="rp-bar-track">
                                <div className="rp-bar-fill" style={{ width: `${pct}%` }} />
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                    {reviews.map((rev, i) => (
                      <div key={rev.id || i} className="rp-review-card">
                        <div className="rp-review-header">
                          <span className="rp-reviewer-name">
                            {rev.reviewer_name || rev.customer_name || 'Guest'}
                          </span>
                          <span className="rp-review-date">
                            {rev.created_at ? new Date(rev.created_at).toLocaleDateString() : ''}
                          </span>
                        </div>
                        <div className="rp-review-stars">{'★'.repeat(Math.round(rev.rating || 5))}</div>
                        {rev.comment && <p className="rp-review-text">{rev.comment}</p>}
                      </div>
                    ))}
                  </>
                ) : (
                  <div className="rp-empty-state">
                    <div className="rp-empty-icon">⭐</div>
                    <p>No reviews yet. Be the first!</p>
                  </div>
                )}
              </div>
            )}

            {/* ── DEALS ── */}
            {activeTab === 'deals' && (
              <div className="rp-panel rp-deals-panel">
                {promotions.length > 0 ? (
                  promotions.map((promo, i) => (
                    <div key={promo.id || i} className="rp-promo-card">
                      <p className="rp-promo-title">{promo.title || promo.name}</p>
                      {promo.description && (
                        <p className="rp-promo-desc">{promo.description}</p>
                      )}
                      {promo.code && <span className="rp-promo-code">{promo.code}</span>}
                      {promo.discount_percent && (
                        <span className="rp-promo-badge">{promo.discount_percent}% off</span>
                      )}
                    </div>
                  ))
                ) : (
                  <div className="rp-empty-state">
                    <div className="rp-empty-icon">🏷️</div>
                    <p>No active deals right now.</p>
                    <p style={{ color: '#94a3b8', fontSize: 13, marginTop: 4 }}>
                      Check back later for promotions.
                    </p>
                  </div>
                )}
              </div>
            )}

          </div>{/* end rp-main-content */}
        </div>{/* end rp-main-grid */}
      </div>{/* end rp-page-wrap */}

      {/* ── Floating cart ── */}
      {cartCount > 0 && !cartOpen && (
        <div className="rp-float-cart">
          <button
            type="button"
            className="rp-float-cart-btn"
            onClick={() => setCartOpen(true)}
          >
            <span className="rp-float-badge">{cartCount}</span>
            <span>View Cart</span>
            <span className="rp-float-sep">·</span>
            <span>{formatFoodMoney(cartTotal, currency)}</span>
          </button>
        </div>
      )}

      {/* ── Cart drawer ── */}
      {cartOpen && (
        <>
          <div
            className="rp-cart-backdrop"
            onClick={() => setCartOpen(false)}
            role="presentation"
          />
          <div className="rp-cart-drawer" role="dialog" aria-modal="true" aria-label="Your order">
            <div className="rp-drawer-handle" />
            <div className="rp-drawer-header">
              <span className="rp-drawer-title">Your Order</span>
              <button
                type="button"
                className="rp-drawer-close"
                onClick={() => setCartOpen(false)}
                aria-label="Close cart"
              >
                ×
              </button>
            </div>
            <div className="rp-drawer-body">
              {cart.length === 0 ? (
                <div className="rp-cart-empty">
                  <div className="rp-cart-empty-icon">🛒</div>
                  <p className="rp-cart-empty-text">Your cart is empty</p>
                  <p style={{ color: '#94a3b8', fontSize: 13, margin: 0 }}>Add items from the menu</p>
                </div>
              ) : (
                <>
                  {cart.map((line, idx) => (
                    <div key={idx} className="rp-cart-item">
                      <div className="rp-cart-item-info">
                        <p className="rp-cart-item-name">{line.name}</p>
                        {line.modifierNames?.length > 0 && (
                          <p className="rp-cart-item-mods">{line.modifierNames.join(', ')}</p>
                        )}
                        <div className="rp-qty-stepper">
                          <button
                            type="button"
                            className="rp-qty-btn"
                            onClick={() => {
                              if (line.quantity <= 1) {
                                setCart((prev) => prev.filter((_, i) => i !== idx));
                              } else {
                                setCart((prev) =>
                                  prev.map((l, i) =>
                                    i === idx ? { ...l, quantity: l.quantity - 1 } : l
                                  )
                                );
                              }
                            }}
                          >
                            −
                          </button>
                          <span className="rp-qty-count">{line.quantity}</span>
                          <button
                            type="button"
                            className="rp-qty-btn"
                            onClick={() =>
                              setCart((prev) =>
                                prev.map((l, i) =>
                                  i === idx ? { ...l, quantity: l.quantity + 1 } : l
                                )
                              )
                            }
                          >
                            +
                          </button>
                        </div>
                      </div>
                      <span className="rp-cart-item-price">
                        {formatFoodMoney(line.unitTotalCents * line.quantity, currency)}
                      </span>
                    </div>
                  ))}
                  <div className="rp-cart-totals">
                    <div className="rp-total-row">
                      <span>Subtotal</span>
                      <span>{formatFoodMoney(cartTotal, currency)}</span>
                    </div>
                    <div className="rp-total-row grand">
                      <span>Total</span>
                      <strong>{formatFoodMoney(cartTotal, currency)}</strong>
                    </div>
                  </div>
                </>
              )}
            </div>
            <div className="rp-drawer-footer">
              {fulfillment === 'dine_in' && (
                <div className="rp-guest-field">
                  <label htmlFor="rp-table">Table / Seat</label>
                  <input
                    id="rp-table"
                    value={tableLabel}
                    onChange={(e) => setTableLabel(e.target.value)}
                    placeholder="e.g. Table 4"
                    maxLength={80}
                  />
                </div>
              )}
              {!user && (
                <div className="rp-guest-field">
                  <label htmlFor="rp-guest">Your name (optional)</label>
                  <input
                    id="rp-guest"
                    value={guestName}
                    onChange={(e) => setGuestName(e.target.value)}
                    placeholder="e.g. Marie"
                    maxLength={140}
                  />
                </div>
              )}
              <p className="rp-pay-note">💳 Pay at the counter when your order is ready</p>
              <button
                type="button"
                className="rp-place-order-btn"
                onClick={submitOrder}
                disabled={placing || cart.length === 0}
              >
                {placing
                  ? 'Placing order…'
                  : `Place Order · ${formatFoodMoney(cartTotal, currency)}`}
              </button>
            </div>
          </div>
        </>
      )}

      {/* ── Item modal ── */}
      {activeItem && (
        <ItemModal
          item={activeItem}
          currency={currency}
          t={t}
          onClose={() => setActiveItem(null)}
          onAdd={(line) => {
            setCart((prev) => [...prev, line]);
            setActiveItem(null);
            toast.success(`${line.name} added to order`);
          }}
        />
      )}
    </div>
    <Footer />
    </>
  );
}
