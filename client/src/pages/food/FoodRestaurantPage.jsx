// OxSteed Food - restaurant menu + cart + order placement (pay in store).
import React, { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import toast from 'react-hot-toast';
import { useAuth } from '../../context/AuthContext';
import { getFoodRestaurant, placeFoodOrder, formatFoodMoney } from '../../api/food';
import { FoodBrand } from './foodShared';
import '../../styles/FoodPages.css';

export function ItemModal({ item, currency, onClose, onAdd, t }) {
  const [quantity, setQuantity] = useState(1);
  const [selected, setSelected] = useState({}); // groupId -> Set(modifierId)
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

  const modifierIds = Object.values(selected).flatMap((set) => Array.from(set));
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
    (group) => group.isRequired && (selected[group.id]?.size || 0) < Math.max(1, group.minSelect)
  );

  return (
    <div className="fd-modal-overlay" onClick={onClose} role="presentation">
      <div className="fd-modal" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
        <h3>{item.name}</h3>
        {item.description && <p style={{ color: 'var(--muted-text)' }}>{item.description}</p>}

        {(item.modifierGroups || []).map((group) => (
          <div key={group.id} className="fd-modgroup">
            <div className="fd-modgroup-name">
              {group.name}
              {group.isRequired ? ' *' : ''}
            </div>
            {(group.options || [])
              .filter((o) => o.isAvailable !== false)
              .map((option) => {
                const isOn = selected[group.id]?.has(option.id);
                return (
                  <div
                    key={option.id}
                    className={`fd-modoption${isOn ? ' fd-selected' : ''}`}
                    onClick={() => toggle(group, option)}
                    role="button"
                    tabIndex={0}
                    onKeyDown={(e) => e.key === 'Enter' && toggle(group, option)}
                  >
                    <span>{option.name}</span>
                    {Number(option.priceDeltaCents) !== 0 && (
                      <span>+{formatFoodMoney(option.priceDeltaCents, currency)}</span>
                    )}
                  </div>
                );
              })}
          </div>
        ))}

        <div className="fd-qty-row">
          <button type="button" className="fd-qty-btn" onClick={() => setQuantity((q) => Math.max(1, q - 1))}>-</button>
          <strong>{quantity}</strong>
          <button type="button" className="fd-qty-btn" onClick={() => setQuantity((q) => Math.min(99, q + 1))}>+</button>
        </div>

        <div className="fd-field">
          <label htmlFor="fd-item-notes">{t('food.order.specialInstructions')}</label>
          <input
            id="fd-item-notes"
            value={instructions}
            onChange={(e) => setInstructions(e.target.value)}
            maxLength={500}
          />
        </div>

        <div className="fd-row" style={{ justifyContent: 'flex-end' }}>
          <button type="button" className="fd-btn fd-btn-secondary" onClick={onClose}>
            {t('food.common.cancel')}
          </button>
          <button
            type="button"
            className="fd-btn"
            disabled={missingRequired}
            onClick={() =>
              onAdd({
                menuItemId: item.id,
                name: item.name,
                quantity,
                modifierIds,
                modifierNames: (item.modifierGroups || []).flatMap((group) =>
                  (group.options || [])
                    .filter((o) => selected[group.id]?.has(o.id))
                    .map((o) => o.name)
                ),
                unitTotalCents: Number(item.price_cents) + modifierTotal,
                specialInstructions: instructions.trim() || undefined,
              })
            }
          >
            {t('food.order.addToOrder', { total: formatFoodMoney(lineTotal, currency) })}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function FoodRestaurantPage() {
  const { restaurantId } = useParams();
  const { t } = useTranslation();
  const { user } = useAuth();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [activeItem, setActiveItem] = useState(null);
  const [cart, setCart] = useState([]);
  const [cartOpen, setCartOpen] = useState(false);
  const [fulfillment, setFulfillment] = useState('pickup');
  const [tableLabel, setTableLabel] = useState('');
  const [guestName, setGuestName] = useState('');
  const [placing, setPlacing] = useState(false);
  const [placedOrder, setPlacedOrder] = useState(null);

  useEffect(() => {
    let alive = true;
    getFoodRestaurant(restaurantId)
      .then((d) => alive && setData(d))
      .catch(() => alive && setData(null))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [restaurantId]);

  const currency = data?.restaurant?.currency_code || 'USD';
  const cartTotal = useMemo(
    () => cart.reduce((sum, line) => sum + line.unitTotalCents * line.quantity, 0),
    [cart]
  );

  const submitOrder = async () => {
    if (cart.length === 0) return;
    setPlacing(true);
    try {
      const order = await placeFoodOrder(restaurantId, {
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
      setCart([]);
      setCartOpen(false);
    } catch (err) {
      const message = err?.response?.data?.error?.message || err?.response?.data?.message;
      toast.error(typeof message === 'string' ? message : t('food.order.placeError'));
    } finally {
      setPlacing(false);
    }
  };

  if (loading) return <div className="fd-page fd-empty">{t('food.common.loading')}</div>;
  if (!data?.restaurant) {
    return (
      <div className="fd-page fd-empty">
        <p>{t('food.restaurant.notFound')}</p>
        <Link to="/food" className="fd-btn">{t('food.common.backToFood')}</Link>
      </div>
    );
  }

  const { restaurant, menu = [], uncategorizedItems = [] } = data;

  if (placedOrder) {
    return (
      <div className="fd-page fd-confirm">
        <FoodBrand size={48} />
        <h2>{t('food.order.confirmedTitle')}</h2>
        <p>{t('food.order.yourNumber')}</p>
        <div className="fd-queue-big">#{placedOrder.queue_number}</div>
        <p className="fd-pay-note">{t('food.order.payInStoreNote')}</p>
        <p>{t('food.order.total')}: <strong>{formatFoodMoney(placedOrder.total_cents, currency)}</strong></p>
        <div className="fd-row" style={{ justifyContent: 'center', marginTop: '1rem' }}>
          <Link to={`/restaurants/queue/${restaurant.id}`} className="fd-btn fd-btn-secondary">
            {t('food.order.watchQueue')}
          </Link>
          <button type="button" className="fd-btn" onClick={() => setPlacedOrder(null)}>
            {t('food.order.orderAgain')}
          </button>
        </div>
      </div>
    );
  }

  const sections = [
    ...menu,
    ...(uncategorizedItems.length
      ? [{ id: 'other', name: t('food.restaurant.otherItems'), items: uncategorizedItems }]
      : []),
  ];

  return (
    <div className="fd-page" style={{ paddingBottom: cart.length ? '6rem' : undefined }}>
      <div className="fd-rest-header">
        {restaurant.logo_url ? (
          <img src={restaurant.logo_url} alt="" className="fd-rest-logo" />
        ) : (
          <div className="fd-rest-logo" aria-hidden="true">🍽️</div>
        )}
        <div>
          <h1 className="fd-hero-title">{restaurant.display_name}</h1>
          <p className="fd-hero-sub">
            {[restaurant.address_city, restaurant.address_country].filter(Boolean).join(', ')}
            {' · '}
            {t('food.restaurant.prepTime', { min: restaurant.prep_time_min })}
          </p>
        </div>
      </div>

      {!restaurant.accepts_online_orders && (
        <p className="fd-pay-note">{t('food.restaurant.onlineClosed')}</p>
      )}

      {sections.length === 0 && <div className="fd-empty">{t('food.restaurant.noMenu')}</div>}

      {sections.map((section) => (
        <section key={section.id}>
          <h2 className="fd-cat-title">{section.name}</h2>
          {(section.items || []).map((item) => (
            <div
              key={item.id}
              className={`fd-menu-item${item.is_available ? '' : ' fd-unavailable'}`}
              onClick={() => item.is_available && restaurant.accepts_online_orders && setActiveItem(item)}
              role="button"
              tabIndex={0}
              onKeyDown={(e) =>
                e.key === 'Enter' && item.is_available && restaurant.accepts_online_orders && setActiveItem(item)
              }
            >
              <div>
                <h4>{item.name}</h4>
                {item.description && <p>{item.description}</p>}
                {!item.is_available && <p>{t('food.restaurant.soldOut')}</p>}
              </div>
              <span className="fd-price">{formatFoodMoney(item.price_cents, currency)}</span>
            </div>
          ))}
        </section>
      ))}

      {activeItem && (
        <ItemModal
          item={activeItem}
          currency={currency}
          t={t}
          onClose={() => setActiveItem(null)}
          onAdd={(line) => {
            setCart((prev) => [...prev, line]);
            setActiveItem(null);
          }}
        />
      )}

      {cart.length > 0 && (
        <div className="fd-cartbar">
          <span>
            {t('food.order.itemsInCart', { n: cart.reduce((s, l) => s + l.quantity, 0) })}
            {' · '}
            <strong>{formatFoodMoney(cartTotal, currency)}</strong>
          </span>
          <button type="button" className="fd-btn" onClick={() => setCartOpen(true)}>
            {t('food.order.reviewOrder')}
          </button>
        </div>
      )}

      {cartOpen && (
        <div className="fd-modal-overlay" onClick={() => setCartOpen(false)} role="presentation">
          <div className="fd-modal" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
            <h3>{t('food.order.yourOrder')}</h3>
            {cart.map((line, index) => (
              <div key={index} className="fd-cart-line">
                <span>
                  {line.quantity}× {line.name}
                  {line.modifierNames?.length > 0 && (
                    <em style={{ display: 'block', fontSize: '0.78rem', color: 'var(--muted-text)' }}>
                      {line.modifierNames.join(', ')}
                    </em>
                  )}
                </span>
                <span className="fd-row" style={{ gap: '0.5rem' }}>
                  {formatFoodMoney(line.unitTotalCents * line.quantity, currency)}
                  <button
                    type="button"
                    className="fd-btn fd-btn-danger fd-btn-sm"
                    aria-label={t('food.common.remove')}
                    onClick={() => setCart((prev) => prev.filter((_, i) => i !== index))}
                  >
                    ×
                  </button>
                </span>
              </div>
            ))}
            <div className="fd-total-row">
              <span>{t('food.order.total')}</span>
              <span>{formatFoodMoney(cartTotal, currency)}</span>
            </div>

            <div className="fd-field" style={{ marginTop: '0.9rem' }}>
              <label htmlFor="fd-fulfillment">{t('food.order.fulfillment')}</label>
              <select id="fd-fulfillment" value={fulfillment} onChange={(e) => setFulfillment(e.target.value)}>
                <option value="pickup">{t('food.order.pickup')}</option>
                <option value="dine_in">{t('food.order.dineIn')}</option>
              </select>
            </div>
            {fulfillment === 'dine_in' && (
              <div className="fd-field">
                <label htmlFor="fd-table">{t('food.order.tableLabel')}</label>
                <input id="fd-table" value={tableLabel} onChange={(e) => setTableLabel(e.target.value)} maxLength={80} />
              </div>
            )}
            {!user && (
              <div className="fd-field">
                <label htmlFor="fd-guest-name">{t('food.order.guestName')}</label>
                <input id="fd-guest-name" value={guestName} onChange={(e) => setGuestName(e.target.value)} maxLength={140} />
              </div>
            )}

            <p className="fd-pay-note">{t('food.order.payInStoreNote')}</p>

            <div className="fd-row" style={{ justifyContent: 'flex-end', marginTop: '0.8rem' }}>
              <button type="button" className="fd-btn fd-btn-secondary" onClick={() => setCartOpen(false)}>
                {t('food.common.keepBrowsing')}
              </button>
              <button type="button" className="fd-btn" onClick={submitOrder} disabled={placing || cart.length === 0}>
                {placing ? t('food.order.placing') : t('food.order.placeOrder')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
