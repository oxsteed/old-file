// OxSteed Food - in-store self-order kiosk. Fullscreen tablet experience,
// McDonald's style: touch to start -> eat in / take out -> build order ->
// confirm -> big queue number, then auto-reset for the next guest.
// Guests order without an account; payment happens at the counter.
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { getFoodRestaurant, placeFoodOrder, formatFoodMoney } from '../../api/food';
import { FoodBrand } from './foodShared';
import { ItemModal } from './FoodRestaurantPage';
import '../../styles/FoodPages.css';

const RESET_AFTER_MS = 20000;

export default function FoodKioskPage() {
  const { restaurantId } = useParams();
  const { t } = useTranslation();
  const [data, setData] = useState(null);
  const [step, setStep] = useState('start'); // start | mode | menu | review | done
  const [fulfillment, setFulfillment] = useState('dine_in');
  const [cart, setCart] = useState([]);
  const [activeItem, setActiveItem] = useState(null);
  const [guestName, setGuestName] = useState('');
  const [placing, setPlacing] = useState(false);
  const [placedOrder, setPlacedOrder] = useState(null);
  const [orderError, setOrderError] = useState(false);
  const resetTimer = useRef(null);

  useEffect(() => {
    getFoodRestaurant(restaurantId).then(setData).catch(() => setData(null));
  }, [restaurantId]);

  const resetAll = () => {
    clearTimeout(resetTimer.current);
    setStep('start');
    setCart([]);
    setGuestName('');
    setPlacedOrder(null);
    setOrderError(false);
    setActiveItem(null);
  };

  useEffect(() => () => clearTimeout(resetTimer.current), []);

  const currency = data?.restaurant?.currency_code || 'USD';
  const total = useMemo(() => cart.reduce((s, l) => s + l.unitTotalCents * l.quantity, 0), [cart]);
  const sections = useMemo(() => {
    if (!data) return [];
    return [
      ...(data.menu || []),
      ...((data.uncategorizedItems || []).length
        ? [{ id: 'other', name: t('food.restaurant.otherItems'), items: data.uncategorizedItems }]
        : []),
    ];
  }, [data, t]);

  const submit = async () => {
    setPlacing(true);
    setOrderError(false);
    try {
      const order = await placeFoodOrder(restaurantId, {
        orderSource: 'kiosk',
        fulfillmentType: fulfillment,
        guestName: guestName.trim() || undefined,
        items: cart.map((line) => ({
          menuItemId: line.menuItemId,
          quantity: line.quantity,
          modifierIds: line.modifierIds,
          specialInstructions: line.specialInstructions,
        })),
      });
      setPlacedOrder(order);
      setStep('done');
      resetTimer.current = setTimeout(resetAll, RESET_AFTER_MS);
    } catch {
      setOrderError(true);
    } finally {
      setPlacing(false);
    }
  };

  if (!data?.restaurant) {
    return (
      <div className="fd-kiosk-start">
        <FoodBrand size={64} />
        <p>{t('food.common.loading')}</p>
      </div>
    );
  }

  if (step === 'start') {
    return (
      <div className="fd-kiosk-start" onClick={() => setStep('mode')} role="button" tabIndex={0} onKeyDown={(e) => e.key === 'Enter' && setStep('mode')}>
        <FoodBrand size={84} />
        <h1>{data.restaurant.display_name}</h1>
        <p>{t('food.kiosk.touchToStart')}</p>
      </div>
    );
  }

  if (step === 'mode') {
    return (
      <div className="fd-screen">
        <div className="fd-screen-header">
          <FoodBrand size={36} />
          <h1 className="fd-screen-title">{t('food.kiosk.whereEating')}</h1>
          <button type="button" className="fd-btn fd-btn-secondary fd-btn-sm" onClick={resetAll}>
            {t('food.kiosk.startOver')}
          </button>
        </div>
        <div className="fd-row" style={{ gap: '1rem', marginTop: '4rem' }}>
          <button
            type="button"
            className={`fd-kiosk-choice${fulfillment === 'dine_in' ? ' fd-selected' : ''}`}
            onClick={() => { setFulfillment('dine_in'); setStep('menu'); }}
          >
            🍽️ {t('food.kiosk.eatIn')}
          </button>
          <button
            type="button"
            className={`fd-kiosk-choice${fulfillment === 'pickup' ? ' fd-selected' : ''}`}
            onClick={() => { setFulfillment('pickup'); setStep('menu'); }}
          >
            🥡 {t('food.kiosk.takeOut')}
          </button>
        </div>
      </div>
    );
  }

  if (step === 'done' && placedOrder) {
    return (
      <div className="fd-kiosk-start" onClick={resetAll} role="button" tabIndex={0} onKeyDown={(e) => e.key === 'Enter' && resetAll()}>
        <FoodBrand size={64} />
        <h1>{t('food.kiosk.thanks')}</h1>
        <p>{t('food.order.yourNumber')}</p>
        <div className="fd-queue-big">#{placedOrder.queue_number}</div>
        <p>{t('food.order.payInStoreNote')}</p>
        <p>{t('food.order.total')}: <strong>{formatFoodMoney(placedOrder.total_cents, currency)}</strong></p>
        <p style={{ fontSize: '0.95rem', color: '#94a3b8' }}>{t('food.kiosk.tapForNext')}</p>
      </div>
    );
  }

  return (
    <div className="fd-screen">
      <div className="fd-screen-header">
        <FoodBrand size={36} />
        <h1 className="fd-screen-title">{data.restaurant.display_name}</h1>
        <button type="button" className="fd-btn fd-btn-secondary fd-btn-sm" onClick={resetAll}>
          {t('food.kiosk.startOver')}
        </button>
      </div>

      <div className="fd-kiosk-body">
        {step === 'menu' && (
          <>
            {sections.map((section) => (
              <section key={section.id}>
                <h2 className="fd-kds-col-title" style={{ marginTop: '1.2rem' }}>{section.name}</h2>
                <div className="fd-kiosk-itemgrid">
                  {(section.items || [])
                    .filter((item) => item.is_available)
                    .map((item) => (
                      <div
                        key={item.id}
                        className="fd-kiosk-item"
                        onClick={() => setActiveItem(item)}
                        role="button"
                        tabIndex={0}
                        onKeyDown={(e) => e.key === 'Enter' && setActiveItem(item)}
                      >
                        <h4>{item.name}</h4>
                        <strong style={{ color: '#f97316' }}>{formatFoodMoney(item.price_cents, currency)}</strong>
                      </div>
                    ))}
                </div>
              </section>
            ))}
            {sections.length === 0 && <p className="fd-kds-meta">{t('food.restaurant.noMenu')}</p>}
          </>
        )}

        {step === 'review' && (
          <div style={{ maxWidth: 560, margin: '0 auto' }}>
            <h2>{t('food.order.yourOrder')}</h2>
            {cart.map((line, index) => (
              <div key={index} className="fd-cart-line" style={{ borderColor: '#334155' }}>
                <span>
                  {line.quantity}× {line.name}
                  {line.modifierNames?.length > 0 && (
                    <em style={{ display: 'block', fontSize: '0.78rem', color: '#94a3b8' }}>
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
              <span>{formatFoodMoney(total, currency)}</span>
            </div>
            <div className="fd-field" style={{ marginTop: '1rem' }}>
              <label htmlFor="fd-kiosk-name" style={{ color: '#f8fafc' }}>{t('food.kiosk.nameForOrder')}</label>
              <input
                id="fd-kiosk-name"
                value={guestName}
                onChange={(e) => setGuestName(e.target.value)}
                maxLength={140}
                style={{ background: '#1e293b', borderColor: '#334155', color: '#f8fafc' }}
              />
            </div>
            <p className="fd-pay-note">{t('food.order.payInStoreNote')}</p>
            {orderError && <p style={{ color: '#f87171' }}>{t('food.order.placeError')}</p>}
            <div className="fd-row" style={{ justifyContent: 'space-between', marginTop: '1rem' }}>
              <button type="button" className="fd-btn fd-btn-secondary" onClick={() => setStep('menu')}>
                {t('food.kiosk.addMore')}
              </button>
              <button type="button" className="fd-btn" disabled={placing || cart.length === 0} onClick={submit}>
                {placing ? t('food.order.placing') : t('food.order.placeOrder')}
              </button>
            </div>
          </div>
        )}
      </div>

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

      {step === 'menu' && cart.length > 0 && (
        <div className="fd-cartbar">
          <span>
            {t('food.order.itemsInCart', { n: cart.reduce((s, l) => s + l.quantity, 0) })}
            {' · '}
            <strong>{formatFoodMoney(total, currency)}</strong>
          </span>
          <button type="button" className="fd-btn" onClick={() => setStep('review')}>
            {t('food.order.reviewOrder')}
          </button>
        </div>
      )}
    </div>
  );
}
