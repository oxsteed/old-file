// OxSteed Restaurants — public restaurant profile (v3 design comp).
// 1:1 port of the design prototype, wired to the live /food API and rendered
// inside the real site shell (Navbar + Footer). Per-restaurant accent theming,
// featured grid, item-modifier modal, and a full multi-step cart/checkout
// drawer (cart → details → payment → confirmed). Payment follows the backend
// restaurant contract: pay_at_restaurant by default, restaurant_credit when
// the signed-in customer holds an active wallet, and pay_now only when the
// restaurant payment flows now launch with restaurant credit, pay-at-restaurant,
// and direct payment proof capture.

import React, { useEffect, useMemo, useState } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import toast from 'react-hot-toast';
import { useAuth } from '../../context/AuthContext';
import {
  getFoodRestaurant,
  placeFoodOrder,
  uploadFoodAsset,
  listFoodPromotions,
  listMyFoodOrders,
  getMyFoodRestaurantWallet,
  formatFoodMoney,
} from '../../api/food';
import { useLiveFoodOrder } from './useLiveFoodOrder';
import { FOOD_STATUS_KEYS } from './foodShared';
import Navbar from '../../components/Navbar';
import Footer from '../../components/Footer';
import '../../styles/FoodRestaurantPage.css';

// ── Active-order persistence ─────────────────────────────────────────────────
// Keeps the public tracking token so a guest can recover their order status
// after closing the tab (orders are considered stale after 2 hours).
const ACTIVE_ORDER_KEY = (restaurantId) => `ox.food.activeOrder.${restaurantId}`;
const ACTIVE_ORDER_TTL_MS = 2 * 60 * 60 * 1000;
const DRAFT_ORDER_KEY = (restaurantId) => `ox.food.draft.${restaurantId}`;

function loadActiveOrder(restaurantId) {
  try {
    const raw = localStorage.getItem(ACTIVE_ORDER_KEY(restaurantId));
    if (!raw) return null;
    const saved = JSON.parse(raw);
    if (!saved?.trackingToken || Date.now() - Number(saved.at || 0) > ACTIVE_ORDER_TTL_MS) {
      localStorage.removeItem(ACTIVE_ORDER_KEY(restaurantId));
      return null;
    }
    return saved;
  } catch {
    return null;
  }
}

function saveActiveOrder(restaurantId, entry) {
  try {
    localStorage.setItem(ACTIVE_ORDER_KEY(restaurantId), JSON.stringify({ ...entry, at: Date.now() }));
  } catch { /* storage full / private mode — non-fatal */ }
}

function clearActiveOrder(restaurantId) {
  try { localStorage.removeItem(ACTIVE_ORDER_KEY(restaurantId)); } catch { /* non-fatal */ }
}

function loadDraftOrder(restaurantId) {
  try {
    const raw = localStorage.getItem(DRAFT_ORDER_KEY(restaurantId));
    if (!raw) return null;
    const saved = JSON.parse(raw);
    if (!saved || typeof saved !== 'object') {
      localStorage.removeItem(DRAFT_ORDER_KEY(restaurantId));
      return null;
    }
    return saved;
  } catch {
    return null;
  }
}

function saveDraftOrder(restaurantId, entry) {
  try {
    localStorage.setItem(DRAFT_ORDER_KEY(restaurantId), JSON.stringify({ ...entry, at: Date.now() }));
  } catch { /* storage full / private mode — non-fatal */ }
}

function clearDraftOrder(restaurantId) {
  try { localStorage.removeItem(DRAFT_ORDER_KEY(restaurantId)); } catch { /* non-fatal */ }
}

const SERIF = "'Instrument Serif', Georgia, 'Times New Roman', serif";

// ── Category → photo gradient (fallback when an item has no photo) ────────────
const GRADS = {
  Popular: 'linear-gradient(135deg,#92400e,#d97706)',
  Mains: 'linear-gradient(135deg,#7c2d12,#c2410c)',
  Sides: 'linear-gradient(135deg,#a16207,#f59e0b)',
  Drinks: 'linear-gradient(135deg,#164e63,#0891b2)',
  Espresso: 'linear-gradient(135deg,#1c1917,#57534e)',
  Food: 'linear-gradient(135deg,#92400e,#d97706)',
  Cold: 'linear-gradient(135deg,#164e63,#0e7490)',
  Draughts: 'linear-gradient(135deg,#78350f,#d97706)',
  Cocktails: 'linear-gradient(135deg,#4c1d95,#7c3aed)',
  Noodles: 'linear-gradient(135deg,#b45309,#d97706)',
  Rice: 'linear-gradient(135deg,#d97706,#f59e0b)',
  Extras: 'linear-gradient(135deg,#064e3b,#059669)',
  Plates: 'linear-gradient(135deg,#7c2d12,#c2410c)',
  Sandwiches: 'linear-gradient(135deg,#a16207,#ca8a04)',
  Pastries: 'linear-gradient(135deg,#a16207,#f59e0b)',
  Bread: 'linear-gradient(135deg,#92400e,#b45309)',
  Burgers: 'linear-gradient(135deg,#991b1b,#ef4444)',
  Packages: 'linear-gradient(135deg,#164e63,#06b6d4)',
  default: 'linear-gradient(135deg,#374151,#6b7280)',
};
const GRAD_PALETTE = Object.values(GRADS).filter((g) => g !== GRADS.default);
function gradFor(name) {
  if (GRADS[name]) return GRADS[name];
  // stable pick from the palette so each category looks distinct
  let hash = 0;
  const str = String(name || '');
  for (let i = 0; i < str.length; i += 1) hash = (hash * 31 + str.charCodeAt(i)) >>> 0;
  return GRAD_PALETTE[hash % GRAD_PALETTE.length] || GRADS.default;
}

// ── Theming helpers ──────────────────────────────────────────────────────────
function hexToRgba(hex, a) {
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(String(hex || '').trim());
  if (!m) return `rgba(255,140,0,${a})`;
  let h = m[1];
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return `rgba(${r},${g},${b},${a})`;
}

const CUISINE_EMOJI = [
  [/(haitian|caribbean|jerk|creole)/i, '🍛'],
  [/(coffee|cafe|café|espresso)/i, '☕'],
  [/(bar|pub|brew|beer|cocktail)/i, '🍺'],
  [/(bakery|patisserie|pastry|bread)/i, '🥐'],
  [/(bbq|smoke|grill|truck)/i, '🍖'],
  [/(ramen|noodle|asian|sushi|thai|japanese|chinese)/i, '🍜'],
  [/(burger|fast|quick)/i, '🍔'],
  [/(pizza|italian)/i, '🍕'],
  [/(taco|mexican|burrito)/i, '🌮'],
  [/(salad|healthy|vegan|vegetarian)/i, '🥗'],
];
function emojiForCuisine(tags) {
  const text = (Array.isArray(tags) ? tags.join(' ') : String(tags || '')).toLowerCase();
  const hit = CUISINE_EMOJI.find(([re]) => re.test(text));
  return hit ? hit[1] : '🍽️';
}

const FULFILLMENT_LABELS = { pickup: 'Takeout', dine_in: 'Dine-in', delivery: 'Delivery', kiosk: 'Kiosk' };
const TAG_LABELS = {
  vegetarian: 'Vegetarian', vegan: 'Vegan', gf: 'GF', 'gluten-free': 'GF',
  spicy: '🌶 Spicy', veg: 'Vegetarian', halal: 'Halal', keto: 'Keto', dairy_free: 'Dairy-free',
};
const cap = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);

// ─── Main page component ─────────────────────────────────────────────────────
export default function FoodRestaurantPage() {
  const { restaurantId } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const { t } = useTranslation();
  const { user } = useAuth();

  // Data
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [promotions, setPromotions] = useState([]);
  const [pastOrdersRaw, setPastOrdersRaw] = useState([]);

  // UI
  const [activeTab, setActiveTab] = useState('menu');
  const [activeCategory, setActiveCategory] = useState(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [dietaryFilter, setDietaryFilter] = useState('all');
  const [saved, setSaved] = useState(false);
  const [deliveryMode, setDeliveryMode] = useState('pickup');

  // Cart / checkout
  const [cartItems, setCartItems] = useState([]);
  const [cartOpen, setCartOpen] = useState(false);
  const [cartStep, setCartStep] = useState('cart'); // cart | login | details | payment | confirmed
  const [addressLine1, setAddressLine1] = useState('');
  const [addressLine2, setAddressLine2] = useState('');
  const [promoCode, setPromoCode] = useState('');
  const [deliverySlot, setDeliverySlot] = useState('asap');
  // Payment mode matches the backend restaurant payment contract:
  // pay_at_restaurant (default) | restaurant_credit (signed-in wallet holders).
  const [paymentMethod, setPaymentMethod] = useState('pay_at_restaurant');
  const [paymentReference, setPaymentReference] = useState('');
  const [paymentNote, setPaymentNote] = useState('');
  const [paymentProof, setPaymentProof] = useState(null);
  const [proofUploading, setProofUploading] = useState(false);
  const [wallet, setWallet] = useState(null);
  const [placing, setPlacing] = useState(false);
  const [placedOrder, setPlacedOrder] = useState(null);
  const [placedTrackingToken, setPlacedTrackingToken] = useState(null);
  // Recovered order from a previous visit (tracking token in localStorage).
  const [recoveredOrder, setRecoveredOrder] = useState(null);
  const [draftHydrated, setDraftHydrated] = useState(false);
  const [draftHasContent, setDraftHasContent] = useState(false);

  // Item modal
  const [modalItem, setModalItem] = useState(null);
  const [modalQty, setModalQty] = useState(1);
  const [modalInstructions, setModalInstructions] = useState('');
  const [modalSelections, setModalSelections] = useState({});

  // ── Fetch ───────────────────────────────────────────────────────────────
  useEffect(() => {
    let alive = true;
    setLoading(true);
    getFoodRestaurant(restaurantId)
      .then((d) => { if (alive) setData(d); })
      .catch(() => { if (alive) setData(null); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [restaurantId]);

  useEffect(() => {
    if (!restaurantId) return;
    listFoodPromotions(restaurantId)
      .then((p) => setPromotions(Array.isArray(p) ? p : (p?.promotions || [])))
      .catch(() => setPromotions([]));
  }, [restaurantId]);

  useEffect(() => {
    if (!user) { setPastOrdersRaw([]); return; }
    listMyFoodOrders()
      .then((orders) => setPastOrdersRaw(Array.isArray(orders) ? orders : []))
      .catch(() => setPastOrdersRaw([]));
  }, [user, restaurantId]);

  // Restaurant-credit wallet (signed-in customers only). When present and
  // active, "Restaurant credit" appears as a real payment option.
  useEffect(() => {
    if (!user || !restaurantId) { setWallet(null); return; }
    getMyFoodRestaurantWallet(restaurantId)
      .then((w) => setWallet(w && w.status === 'active' ? w : null))
      .catch(() => setWallet(null));
  }, [user, restaurantId]);

  // Never leave restaurant_credit selected if the wallet disappears (sign-out,
  // wallet suspended, or restaurant switch).
  useEffect(() => {
    if (paymentMethod === 'restaurant_credit' && !wallet) {
      setPaymentMethod('pay_at_restaurant');
    }
  }, [paymentMethod, wallet]);

  // Restore a checkout draft so the same order reappears after sign-in or page
  // refresh. The draft is kept separate from the live tracking token.
  useEffect(() => {
    if (!restaurantId) return;

    setDraftHydrated(false);
    setDraftHasContent(false);

    const draft = loadDraftOrder(restaurantId);
    if (!draft) {
      setCartItems([]);
      setCartOpen(false);
      setCartStep('cart');
      setAddressLine1('');
      setAddressLine2('');
      setPromoCode('');
      setDeliverySlot('asap');
      setPaymentMethod('pay_at_restaurant');
      setPaymentReference('');
      setPaymentNote('');
      setPaymentProof(null);
      setDraftHydrated(true);
      return;
    }

    const savedCartItems = Array.isArray(draft.cartItems) ? draft.cartItems : [];
    const savedStep = draft.cartStep === 'login'
      ? 'details'
      : (draft.cartStep === 'confirmed' ? 'cart' : (draft.cartStep || 'cart'));
    setDraftHasContent(
      savedCartItems.length > 0
      || Boolean(draft.cartOpen)
      || Boolean(draft.addressLine1)
      || Boolean(draft.addressLine2)
      || Boolean(draft.promoCode)
      || Boolean(draft.deliverySlot && draft.deliverySlot !== 'asap')
      || Boolean(draft.paymentMethod && draft.paymentMethod !== 'pay_at_restaurant')
      || Boolean(draft.paymentReference)
      || Boolean(draft.paymentNote)
      || Boolean(draft.paymentProof)
    );
    setCartItems(savedCartItems);
    setCartOpen(savedCartItems.length > 0 || Boolean(draft.cartOpen));
    setCartStep(savedCartItems.length > 0 || savedStep !== 'cart' ? savedStep : 'cart');
    setAddressLine1(String(draft.addressLine1 || ''));
    setAddressLine2(String(draft.addressLine2 || ''));
    setPromoCode(String(draft.promoCode || ''));
    setDeliverySlot(draft.deliverySlot || 'asap');
    setPaymentMethod(draft.paymentMethod || 'pay_at_restaurant');
    setPaymentReference(String(draft.paymentReference || ''));
    setPaymentNote(String(draft.paymentNote || ''));
    setPaymentProof(draft.paymentProof && typeof draft.paymentProof === 'object' ? draft.paymentProof : null);
    if (draft.deliveryMode === 'delivery' || draft.deliveryMode === 'pickup') {
      setDeliveryMode(draft.deliveryMode);
    }
    setDraftHydrated(true);
  }, [restaurantId]);

  // Restore a still-active order from a previous visit so guests can find
  // their queue number again after closing the tab.
  useEffect(() => {
    setRecoveredOrder(loadActiveOrder(restaurantId));
  }, [restaurantId]);

  // Live status (socket + poll) for the just-placed order on the confirmation
  // step, and for the recovered-order banner.
  const { order: liveOrder } = useLiveFoodOrder({
    restaurantId,
    trackingToken: placedTrackingToken,
    initialOrder: placedOrder,
    enabled: Boolean(placedTrackingToken),
  });
  const { order: recoveredLiveOrder } = useLiveFoodOrder({
    restaurantId,
    trackingToken: recoveredOrder?.trackingToken || null,
    initialOrder: null,
    enabled: Boolean(recoveredOrder?.trackingToken) && cartStep !== 'confirmed',
  });

  // Drop the persisted order once it finishes so the banner disappears.
  useEffect(() => {
    if (!recoveredOrder) return;
    const status = recoveredLiveOrder?.status;
    if (status && ['completed', 'cancelled', 'refunded'].includes(status)) {
      clearActiveOrder(restaurantId);
      setRecoveredOrder(null);
    }
  }, [recoveredOrder, recoveredLiveOrder?.status, restaurantId]);

  const restaurant = data?.restaurant;
  const currency = restaurant?.currency_code || 'USD';

  // Default fulfillment from supported modes
  useEffect(() => {
    if (!restaurant) return;
    const modes = Array.isArray(restaurant.fulfillment_modes) ? restaurant.fulfillment_modes : [];
    setDeliveryMode((current) => {
      if (current === 'delivery' && !modes.includes('delivery')) return 'pickup';
      if (draftHasContent) return current;
      return modes.includes('delivery') ? 'delivery' : 'pickup';
    });
  }, [restaurant, draftHasContent]);

  useEffect(() => {
    if (!restaurantId || !draftHydrated) return;
    const hasMeaningfulDraft = cartItems.length > 0
      || cartOpen
      || ['login', 'details', 'payment'].includes(cartStep)
      || addressLine1.trim().length > 0
      || addressLine2.trim().length > 0
      || promoCode.trim().length > 0
      || deliverySlot !== 'asap'
      || paymentMethod !== 'pay_at_restaurant'
      || paymentReference.trim().length > 0
      || paymentNote.trim().length > 0
      || Boolean(paymentProof);
    if (!hasMeaningfulDraft) {
      clearDraftOrder(restaurantId);
      return;
    }
    saveDraftOrder(restaurantId, {
      cartItems,
      cartOpen,
      cartStep,
      addressLine1,
      addressLine2,
      promoCode,
      deliverySlot,
      paymentMethod,
      paymentReference,
      paymentNote,
      paymentProof,
      deliveryMode,
    });
  }, [
    restaurantId,
    draftHydrated,
    cartItems,
    cartOpen,
    cartStep,
    addressLine1,
    addressLine2,
    promoCode,
    deliverySlot,
    paymentMethod,
    paymentReference,
    paymentNote,
    paymentProof,
    deliveryMode,
  ]);

  // ── Cart math ─────────────────────────────────────────────────────────────
  const settings = (restaurant?.settings && typeof restaurant.settings === 'object') ? restaurant.settings : {};
  const supportsDelivery = Array.isArray(restaurant?.fulfillment_modes) && restaurant.fulfillment_modes.includes('delivery');
  const deliveryFeeCents = Number(settings.deliveryFeeCents ?? settings.delivery_fee_cents ?? 0) || 0;
  const minimumOrderCents = Number(settings.minimumOrderCents ?? settings.minimum_order_cents ?? 0) || 0;
  const externalPaymentEnabled = Boolean(settings.externalPaymentEnabled ?? settings.external_payment_enabled ?? false);
  const requireExternalPaymentProof = Boolean(settings.requireExternalPaymentProof ?? settings.require_external_payment_proof ?? false);
  const externalPaymentLabel = String(settings.externalPaymentLabel ?? settings.external_payment_label ?? 'Payment app / QR').trim() || 'Payment app / QR';
  const externalPaymentHandle = String(settings.externalPaymentHandle ?? settings.external_payment_handle ?? '').trim();
  const externalPaymentInstructions = String(settings.externalPaymentInstructions ?? settings.external_payment_instructions ?? '').trim();
  const externalPaymentReferenceHint = String(settings.externalPaymentReferenceHint ?? settings.external_payment_reference_hint ?? 'Include your order number or name in the payment note.').trim();
  const externalPaymentQrUrl = String(settings.externalPaymentQrUrl ?? settings.external_payment_qr_url ?? '').trim();

  useEffect(() => {
    if (paymentMethod === 'direct_payment' && !externalPaymentEnabled) {
      setPaymentMethod('pay_at_restaurant');
    }
  }, [paymentMethod, externalPaymentEnabled]);

  const subtotalCents = useMemo(
    () => cartItems.reduce((s, i) => s + i.unitCents * i.qty, 0),
    [cartItems]
  );
  const cartCount = cartItems.reduce((s, i) => s + i.qty, 0);
  const hasCart = cartCount > 0;
  const feeCents = (deliveryMode === 'delivery' && hasCart) ? deliveryFeeCents : 0;
  const orderTotalCents = subtotalCents + feeCents;
  const checkoutRequiresLogin = !user;
  const externalPaymentHasSubmission = Boolean(paymentProof?.url || paymentReference.trim() || paymentNote.trim());

  const openLoginGate = () => {
    navigate('/login', { state: { from: location } });
  };

  const handlePaymentProofUpload = async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    setProofUploading(true);
    try {
      const uploaded = await uploadFoodAsset(file, 'food-payment-proof');
      setPaymentProof({
        url: uploaded?.url || '',
        key: uploaded?.key || '',
        name: file.name,
        type: uploaded?.content_type || file.type || '',
        sizeBytes: uploaded?.size_bytes || file.size || null,
      });
      toast.success('Receipt uploaded');
    } catch (err) {
      toast.error(err?.response?.data?.error?.message || 'Unable to upload proof of payment.');
    } finally {
      setProofUploading(false);
      event.target.value = '';
    }
  };

  // ── Place the real order ────────────────────────────────────────────────
  const submitOrder = async () => {
    if (cartItems.length === 0) return;
    const fulfillmentType = deliveryMode === 'delivery' ? 'delivery' : 'pickup';
    const paymentMode = paymentMethod === 'restaurant_credit'
      ? 'restaurant_credit'
      : paymentMethod === 'direct_payment'
        ? 'direct_payment'
        : 'pay_at_restaurant';
    const externalPaymentSubmission = paymentMode === 'direct_payment'
      ? {
        method: externalPaymentLabel || 'external_payment',
        label: externalPaymentLabel || 'Payment app / QR',
        handle: externalPaymentHandle || undefined,
        instructions: externalPaymentInstructions || undefined,
        referenceHint: externalPaymentReferenceHint || undefined,
        reference: paymentReference.trim() || undefined,
        note: paymentNote.trim() || undefined,
        proofRequired: requireExternalPaymentProof,
        proof: paymentProof ? {
          attachmentUrl: paymentProof.url || undefined,
          attachmentKey: paymentProof.key || undefined,
          attachmentName: paymentProof.name || undefined,
          attachmentType: paymentProof.type || undefined,
          attachmentSizeBytes: paymentProof.sizeBytes || undefined,
        } : undefined,
      }
      : null;
    if (paymentMode === 'direct_payment' && requireExternalPaymentProof && !(
      paymentProof?.url || paymentReference.trim() || paymentNote.trim()
    )) {
      toast.error('Please upload proof of payment or add a confirmation number.');
      return;
    }
    setPlacing(true);
    try {
      const payload = {
        orderSource: 'web',
        fulfillmentType,
        // Canonical restaurant payment contract mode (card checkout is pay_now).
        paymentMode,
        // Backend currently limits promo codes to restaurant-credit orders.
        discountCode: paymentMode === 'restaurant_credit' && promoCode.trim()
          ? promoCode.trim()
          : undefined,
        items: cartItems.map((line) => ({
          menuItemId: line.menuItemId,
          quantity: line.qty,
          modifierIds: line.modifierIds,
          specialInstructions: line.notes || undefined,
        })),
        ...(paymentMode === 'direct_payment' ? {
          externalPayment: externalPaymentSubmission,
          metadata: {
            externalPayment: externalPaymentSubmission,
          },
        } : {}),
      };
      if (fulfillmentType === 'delivery') {
        payload.deliveryAddress = {
          line1: addressLine1.trim() || restaurant.address_street || '',
          line2: addressLine2.trim() || undefined,
          city: restaurant.address_city || undefined,
          state: restaurant.address_state || undefined,
          country: restaurant.address_country || undefined,
        };
      }
      const { order, trackingToken, payment } = await placeFoodOrder(restaurantId, payload);
      setPlacedOrder(order || {});
      setPlacedTrackingToken(trackingToken || null);
      if (trackingToken) {
        saveActiveOrder(restaurantId, {
          trackingToken,
          queueNumber: order?.queue_number ?? null,
          paymentMode,
          checkoutSessionId: payment?.checkoutSessionId || null,
        });
        setRecoveredOrder(null);
      }
      clearDraftOrder(restaurantId);
      setDraftHasContent(false);
      setCartStep('confirmed');
      setCartItems([]);
      setPaymentReference('');
      setPaymentNote('');
      setPaymentProof(null);
      if (payment?.mode === 'hosted_checkout' && payment?.checkoutUrl) {
        window.location.assign(payment.checkoutUrl);
        return;
      }
    } catch (err) {
      const message = err?.response?.data?.error?.message || err?.response?.data?.message;
      toast.error(typeof message === 'string' ? message : 'Unable to place order. Please try again.');
    } finally {
      setPlacing(false);
    }
  };

  // ── Loading / not found ─────────────────────────────────────────────────
  if (loading) {
    return (
      <>
        <Navbar />
        <div className="rp-root">
          <div className="rp-loading-screen">
            <div className="rp-loading-spinner" />
            <p>Loading menu…</p>
          </div>
        </div>
        <Footer />
      </>
    );
  }

  if (!restaurant) {
    return (
      <>
        <Navbar />
        <div className="rp-root">
          <div className="rp-not-found">
            <div style={{ fontSize: 48 }}>🍽️</div>
            <p style={{ fontWeight: 600 }}>Restaurant not found</p>
            <Link
              to="/restaurants"
              style={{ textDecoration: 'none', padding: '12px 28px', background: '#ff8c00', color: '#fff', borderRadius: 12, fontWeight: 600 }}
            >
              Browse Restaurants
            </Link>
          </div>
        </div>
        <Footer />
      </>
    );
  }

  // ── Derived render values ────────────────────────────────────────────────
  const accent = /^#?[0-9a-f]{3,6}$/i.test(restaurant.brand_accent_hex || '')
    ? (restaurant.brand_accent_hex.startsWith('#') ? restaurant.brand_accent_hex : `#${restaurant.brand_accent_hex}`)
    : '#ff8c00';
  const accentBg = hexToRgba(accent, 0.12);
  const accentFade = hexToRgba(accent, 0.18);
  const accentShadow = hexToRgba(accent, 0.35);
  const coverBg = `linear-gradient(150deg, ${hexToRgba(accent, 0.55)}, #1e293b 55%, #0f172a)`;
  const rootStyle = {
    '--rp-accent': accent,
    '--rp-accent-bg': accentBg,
    '--rp-accent-fade': accentFade,
    '--rp-accent-shadow': accentShadow,
  };

  const emoji = emojiForCuisine(restaurant.cuisine_tags);
  const cuisineLabel = Array.isArray(restaurant.cuisine_tags) && restaurant.cuisine_tags.length
    ? cap(restaurant.cuisine_tags[0]) : 'Restaurant';
  const modeLabels = (restaurant.fulfillment_modes || [])
    .map((m) => FULFILLMENT_LABELS[m]).filter(Boolean);
  const meta = [cuisineLabel, ...modeLabels].filter(Boolean).join(' · ');

  const rating = parseFloat(restaurant.avg_rating || 0) || 0;
  const ratingDisplay = rating > 0 ? rating.toFixed(1) : 'New';
  const reviewCount = Number(restaurant.review_count || 0) || 0;
  const isOpen = restaurant.is_open !== false;
  const openStatus = restaurant.hours_message || (isOpen ? 'Open now' : 'Closed');
  const todayHours = restaurant.hours_message || (isOpen ? 'Open now' : 'Closed');
  const priceRange = settings.priceRange || settings.price_range || '$$';
  const prepMin = Number(restaurant.prep_time_min || 20) || 20;
  const delivTime = `${prepMin}–${prepMin + 10} min`;
  const isPickup = deliveryMode !== 'delivery';
  const delivFee = isPickup
    ? 'Free pickup'
    : (deliveryFeeCents === 0 ? 'Free delivery' : `${formatFoodMoney(deliveryFeeCents, currency)} delivery`);
  const delivMin = minimumOrderCents > 0 ? `${formatFoodMoney(minimumOrderCents, currency)} min. order` : 'No minimum';
  const website = restaurant.website || '';
  const address = [restaurant.address_street, restaurant.address_city, restaurant.address_state, restaurant.address_country]
    .filter(Boolean).join(', ');

  // Operating hours → list
  const weekly = restaurant.operating_hours && typeof restaurant.operating_hours === 'object'
    ? (restaurant.operating_hours.weekly || restaurant.operating_hours) : null;
  const DAY_KEYS = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];
  const DAY_SHORT = { monday: 'Mon', tuesday: 'Tue', wednesday: 'Wed', thursday: 'Thu', friday: 'Fri', saturday: 'Sat', sunday: 'Sun' };
  const fmtRange = (v) => {
    if (!v) return 'Closed';
    if (typeof v === 'string') return v;
    if (v.closed) return 'Closed';
    if (v.open && v.close) return `${v.open} – ${v.close}`;
    if (Array.isArray(v) && v.length) return v.map((r) => `${r.open}–${r.close}`).join(', ');
    return 'Closed';
  };
  const hours = weekly
    ? DAY_KEYS.filter((d) => weekly[d] !== undefined).map((d) => ({ day: DAY_SHORT[d], time: fmtRange(weekly[d]) }))
    : [];

  // Menu sections
  const { menu = [], uncategorizedItems = [] } = data;
  const sections = [
    ...menu,
    ...(uncategorizedItems.length ? [{ id: 'other', name: 'Other Items', items: uncategorizedItems }] : []),
  ].filter((s) => (s.items || []).length > 0);

  const validCatId = activeCategory && sections.some((s) => String(s.id) === String(activeCategory))
    ? activeCategory : (sections[0] ? String(sections[0].id) : null);
  const isFirstCat = sections[0] && String(sections[0].id) === String(validCatId);

  const dietOk = (item) => {
    if (dietaryFilter === 'all') return true;
    const tags = (item.tags || item.dietary_tags || []).map((x) => String(x).toLowerCase());
    if (dietaryFilter === 'vegetarian') return tags.includes('vegetarian') || tags.includes('veg') || tags.includes('vegan');
    if (dietaryFilter === 'vegan') return tags.includes('vegan');
    if (dietaryFilter === 'gf') return tags.includes('gluten-free') || tags.includes('gf');
    if (dietaryFilter === 'spicy') return tags.includes('spicy');
    return true;
  };
  const searchOk = (item) => {
    if (!searchQuery) return true;
    const q = searchQuery.toLowerCase();
    return (item.name || '').toLowerCase().includes(q) || (item.description || '').toLowerCase().includes(q);
  };
  const hasSearch = searchQuery.trim().length > 0;

  const decorate = (item, sectionName) => {
    const tags = (item.tags || item.dietary_tags || []).map((x) => String(x).toLowerCase());
    const firstTag = tags[0];
    return {
      ...item,
      sectionName,
      priceStr: formatFoodMoney(item.price_cents, currency),
      photoGrad: gradFor(sectionName),
      hasTag: !!firstTag,
      tagLabel: firstTag ? (TAG_LABELS[firstTag] || cap(firstTag)) : '',
      canOrder: item.is_available !== false && restaurant.accepts_online_orders !== false,
    };
  };

  const allItemsFlat = sections.flatMap((s) => (s.items || []).map((it) => decorate(it, s.name)));
  const currentSection = sections.find((s) => String(s.id) === String(validCatId));
  const catItems = (currentSection?.items || []).map((it) => decorate(it, currentSection.name));

  const filteredMenu = hasSearch
    ? allItemsFlat.filter(searchOk).filter(dietOk)
    : catItems.filter(dietOk);

  const showGrid = !hasSearch && isFirstCat && filteredMenu.length > 0;
  const showList = !showGrid;
  const isEmpty = showList && filteredMenu.length === 0;
  const gridLabel = dietaryFilter !== 'all' ? `Filtered — ${cap(dietaryFilter)}` : 'Popular Items';

  // Reviews
  const reviewsRaw = restaurant.recent_reviews || restaurant.reviews || [];
  const reviewsList = reviewsRaw.map((r) => {
    const name = r.reviewer_name || r.customer_name || r.author || 'Guest';
    const stars = Math.round(r.rating || 5);
    return {
      name,
      initial: name.charAt(0).toUpperCase(),
      stars: '★'.repeat(stars) + '☆'.repeat(5 - stars),
      text: r.comment || r.body || r.text || '',
      time: r.created_at ? new Date(r.created_at).toLocaleDateString() : (r.time || ''),
    };
  });
  const ratingBars = [5, 4, 3, 2, 1].map((star) => {
    const cnt = reviewsRaw.filter((r) => Math.round(r.rating || 0) === star).length;
    const pct = reviewsRaw.length ? `${Math.round((cnt / reviewsRaw.length) * 100)}%` : '0%';
    return { label: String(star), pct };
  });

  // Promotions → deal cards
  const promos = promotions.map((p) => ({
    title: p.title || p.name || 'Special offer',
    badge: p.code || (p.discount_percent ? `${p.discount_percent}% off` : 'Deal'),
    desc: p.description || p.summary || '',
    sub: p.fine_print || p.terms || (p.ends_at ? `Ends ${new Date(p.ends_at).toLocaleDateString()}` : ''),
  }));

  // Past orders for this restaurant
  const pastOrders = pastOrdersRaw
    .filter((o) => String(o.restaurant_id ?? o.restaurantId) === String(restaurant.id))
    .slice(0, 2)
    .map((o) => {
      const items = Array.isArray(o.items) ? o.items : [];
      const first = items[0];
      const firstName = first?.item_name || first?.name || 'Your order';
      const more = items.length > 1 ? ` + ${items.length - 1} more` : '';
      return {
        summary: `${firstName}${more}`,
        date: o.created_at ? new Date(o.created_at).toLocaleDateString() : '',
        total: formatFoodMoney(o.total_cents || 0, currency),
        thumbGrad: gradFor(firstName),
        items,
      };
    });

  // ── Cart line helpers ─────────────────────────────────────────────────────
  const addLine = (line) => {
    setCartItems((prev) => {
      const ex = prev.find((x) => x.id === line.id);
      if (ex) return prev.map((x) => x.id === line.id ? { ...x, qty: x.qty + line.qty } : x);
      return [...prev, line];
    });
  };
  const quickAdd = (item) => {
    addLine({
      id: `${item.id}::`,
      menuItemId: item.id,
      name: item.name,
      unitCents: Number(item.price_cents) || 0,
      qty: 1,
      photoGrad: item.photoGrad,
      image: item.image_url || null,
      notes: '',
      modifierIds: [],
      modifierNames: [],
    });
    toast.success(`${item.name} added`);
  };
  const incLine = (id) => setCartItems((prev) => prev.map((x) => x.id === id ? { ...x, qty: x.qty + 1 } : x));
  const decLine = (id) => setCartItems((prev) => prev.map((x) => x.id === id ? { ...x, qty: x.qty - 1 } : x).filter((x) => x.qty > 0));

  // ── Item modal: open / modifiers / add ────────────────────────────────────
  const openModal = (item) => {
    const groups = item.modifierGroups || [];
    const initial = {};
    groups.forEach((g) => {
      const radio = (g.maxSelect || g.max_select) === 1;
      if (radio && g.isRequired) {
        const firstOpt = (g.options || []).find((o) => o.isAvailable !== false);
        if (firstOpt) initial[g.id] = firstOpt.id;
      } else if (!radio) {
        initial[g.id] = [];
      }
    });
    setModalItem(item);
    setModalQty(1);
    setModalInstructions('');
    setModalSelections(initial);
  };
  const modalGroups = (modalItem?.modifierGroups || []).map((g) => {
    const radio = (g.maxSelect || g.max_select) === 1;
    const sel = modalSelections[g.id];
    const opts = (g.options || []).filter((o) => o.isAvailable !== false);
    return {
      id: g.id, name: g.name, isRadio: radio, isCheckbox: !radio, isRequired: g.isRequired,
      radioOptions: radio ? opts.map((o) => ({
        id: o.id, label: o.name, priceCents: Number(o.priceDeltaCents) || 0,
        isSelected: sel === o.id,
        onSelect: () => setModalSelections((p) => ({ ...p, [g.id]: o.id })),
      })) : [],
      checkboxOptions: !radio ? opts.map((o) => {
        const arr = Array.isArray(sel) ? sel : [];
        const checked = arr.includes(o.id);
        return {
          id: o.id, label: o.name, priceCents: Number(o.priceDeltaCents) || 0, isChecked: checked,
          onToggle: () => setModalSelections((p) => {
            const cur = Array.isArray(p[g.id]) ? p[g.id] : [];
            return { ...p, [g.id]: checked ? cur.filter((x) => x !== o.id) : [...cur, o.id] };
          }),
        };
      }) : [],
    };
  });
  const modalExtraCents = (modalItem?.modifierGroups || []).reduce((sum, g) => {
    const sel = modalSelections[g.id];
    const opts = g.options || [];
    if ((g.maxSelect || g.max_select) === 1) {
      const o = opts.find((x) => x.id === sel);
      return sum + (o ? Number(o.priceDeltaCents) || 0 : 0);
    }
    const arr = Array.isArray(sel) ? sel : [];
    return sum + opts.filter((x) => arr.includes(x.id)).reduce((s, x) => s + (Number(x.priceDeltaCents) || 0), 0);
  }, 0);
  const modalUnitCents = (Number(modalItem?.price_cents) || 0) + modalExtraCents;
  const modalLineTotal = formatFoodMoney(modalUnitCents * modalQty, currency);
  const modalMissingRequired = (modalItem?.modifierGroups || []).some((g) => {
    if (!g.isRequired) return false;
    const sel = modalSelections[g.id];
    if ((g.maxSelect || g.max_select) === 1) return !sel;
    return !(Array.isArray(sel) && sel.length);
  });
  const modalAddToCart = () => {
    if (!modalItem) return;
    const ids = [];
    const names = [];
    (modalItem.modifierGroups || []).forEach((g) => {
      const sel = modalSelections[g.id];
      const opts = g.options || [];
      if ((g.maxSelect || g.max_select) === 1) {
        const o = opts.find((x) => x.id === sel);
        if (o) { ids.push(o.id); names.push(o.name); }
      } else if (Array.isArray(sel)) {
        opts.filter((x) => sel.includes(x.id)).forEach((o) => { ids.push(o.id); names.push(o.name); });
      }
    });
    addLine({
      id: `${modalItem.id}::${ids.join(',')}::${modalInstructions.trim()}`,
      menuItemId: modalItem.id,
      name: modalItem.name,
      unitCents: modalUnitCents,
      qty: modalQty,
      photoGrad: modalItem.photoGrad || gradFor(modalItem.sectionName),
      image: modalItem.image_url || null,
      notes: modalInstructions.trim(),
      modifierIds: ids,
      modifierNames: names,
    });
    toast.success(`${modalItem.name} added`);
    setModalItem(null);
  };

  const reorder = (po) => {
    const lines = (po.items || []).map((it) => {
      const mid = it.menu_item_id ?? it.menuItemId ?? it.id;
      return {
        id: `${mid}::reorder`,
        menuItemId: mid,
        name: it.item_name || it.name || 'Item',
        unitCents: Number(it.unit_price_cents ?? it.unitPriceCents ?? it.price_cents) || 0,
        qty: Number(it.quantity || 1) || 1,
        photoGrad: gradFor(it.item_name || it.name),
        image: null, notes: '', modifierIds: [], modifierNames: [],
      };
    }).filter((l) => l.menuItemId != null);
    if (!lines.length) { toast.error('This order can’t be re-added right now.'); return; }
    setCartItems(lines);
    setCartOpen(true);
    setCartStep('cart');
  };

  const onShare = () => {
    if (navigator.share) {
      navigator.share({ title: restaurant.display_name, url: window.location.href }).catch(() => {});
    } else if (navigator.clipboard) {
      navigator.clipboard.writeText(window.location.href);
      toast.success('Link copied!');
    }
  };

  // Shared inline styles
  const sectionLabel = { fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.07em', color: '#94a3b8', marginBottom: 10 };
  const closeBtn = { width: 32, height: 32, borderRadius: '50%', background: '#f1f5f9', border: 'none', fontSize: 18, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#64748b', lineHeight: 1 };

  const tabs = [
    { key: 'menu', label: 'Menu' },
    { key: 'info', label: 'Info' },
    { key: 'reviews', label: 'Reviews' },
    { key: 'deals', label: 'Deals' },
  ];

  const dietaryChips = [
    { key: 'all', label: 'All' },
    { key: 'vegetarian', label: '🌿 Vegetarian' },
    { key: 'vegan', label: '🌱 Vegan' },
    { key: 'gf', label: 'GF' },
    { key: 'spicy', label: '🌶 Spicy' },
  ];

  const timeSlots = [
    { id: 'asap', label: 'ASAP', sub: `Est. ${delivTime}` },
    { id: '+15', label: 'In 15 minutes', sub: 'Adds 15 min to estimate' },
    { id: '+30', label: 'In 30 minutes', sub: 'Scheduled ahead' },
    { id: 'later', label: 'Schedule for later', sub: 'Choose a specific time' },
  ];
  // Payment options mirror the launch contract (`pay_at_restaurant`,
  // `restaurant_credit`, `direct_payment`). Card checkout remains dormant
  // in backend code, but no launch UI depends on Stripe.
  const walletBalanceCents = Number(wallet?.balanceCents || 0);
  const walletReservedCents = Number(wallet?.reservedCents || 0);
  const walletAvailableCents = Number(
    wallet?.availableBalanceCents ?? Math.max(0, walletBalanceCents - walletReservedCents)
  );
  const walletCoversOrder = walletAvailableCents >= orderTotalCents;
  const paymentMethods = [
    {
      id: 'pay_at_restaurant',
      icon: '🏪',
      label: isPickup ? 'Pay at the restaurant' : 'Pay on delivery',
      sub: 'Pay the restaurant directly when your order is ready',
    },
    ...(wallet ? [{
      id: 'restaurant_credit',
      icon: '💠',
      label: 'Restaurant credit',
      sub: walletCoversOrder
        ? `${formatFoodMoney(walletAvailableCents, wallet.currencyCode || currency)} available`
        : `Insufficient balance — ${formatFoodMoney(walletAvailableCents, wallet.currencyCode || currency)} available`,
      disabled: !walletCoversOrder,
    }] : []),
    ...(externalPaymentEnabled ? [{
      id: 'direct_payment',
      icon: '📲',
      label: externalPaymentLabel || 'Pay with restaurant payment app',
      sub: externalPaymentHandle
        ? `Send to ${externalPaymentHandle}`
        : 'Use the restaurant’s payment instructions and upload proof',
    }] : []),
  ];

  const detailsTitle = isPickup ? 'Pickup Details' : 'Delivery Details';
  const delivFeeLabel = isPickup ? 'Pickup' : 'Delivery fee';
  const delivFeeStr = isPickup ? 'Free' : (feeCents === 0 ? 'Free' : formatFoodMoney(feeCents, currency));

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <>
      <Navbar />
      <div className="rp-root" style={rootStyle}>
        <div className="rp-page-wrap">

          {/* ── Active order recovery banner ── */}
          {recoveredOrder && cartStep !== 'confirmed' && (() => {
            const status = recoveredLiveOrder?.status || 'received';
            const isReady = status === 'ready';
            const queueNumber = recoveredLiveOrder?.queue_number ?? recoveredOrder.queueNumber;
            return (
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 16px', borderRadius: 12, marginBottom: 12, background: isReady ? '#dcfce7' : accentBg, border: `1.5px solid ${isReady ? '#86efac' : accent}` }}>
                <span style={{ width: 9, height: 9, borderRadius: '50%', background: isReady ? '#16a34a' : accent, flexShrink: 0 }} />
                <span style={{ flex: 1, fontSize: 14, fontWeight: 600, color: isReady ? '#166534' : '#0f172a' }}>
                  {queueNumber != null ? `Your order #${queueNumber}` : 'Your order'}
                  {' — '}
                  {isReady ? 'ready for pickup!' : t(FOOD_STATUS_KEYS[status] || FOOD_STATUS_KEYS.received)}
                </span>
                <Link to={`/restaurants/queue/${restaurantId}`} style={{ fontSize: 13, fontWeight: 600, color: isReady ? '#166534' : accent, textDecoration: 'none', whiteSpace: 'nowrap' }}>Watch queue</Link>
                <button
                  type="button"
                  aria-label="Dismiss order status"
                  onClick={() => { clearActiveOrder(restaurantId); setRecoveredOrder(null); }}
                  style={{ width: 28, height: 28, borderRadius: '50%', border: 'none', background: 'rgba(15,23,42,0.08)', color: '#334155', fontSize: 15, cursor: 'pointer', lineHeight: 1, flexShrink: 0 }}
                >
                  ×
                </button>
              </div>
            );
          })()}

          {/* ── Cuisine pills row (decorative quick filters) ── */}
          <div className="rp-type-row">
            <span className="rp-type-pill" style={{ borderColor: accent, background: accent, color: '#fff' }}>{emoji} {cuisineLabel}</span>
            {modeLabels.map((label) => (
              <span key={label} className="rp-type-pill">{label}</span>
            ))}
          </div>

          {/* ── Hero ── */}
          <div className="rp-hero-wrap" style={{ background: coverBg }}>
            {restaurant.cover_photo_url && (
              <img src={restaurant.cover_photo_url} alt="" className="rp-hero-img" />
            )}
            <div className="rp-hero-overlay" />
            <svg className="rp-hero-dots" width="100%" height="100%" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
              <pattern id="rp-dp" x="0" y="0" width="20" height="20" patternUnits="userSpaceOnUse">
                <circle cx="2" cy="2" r="1.5" fill="white" />
              </pattern>
              <rect width="100%" height="100%" fill="url(#rp-dp)" />
            </svg>
            {rating > 0 && (
              <div className="rp-hero-rating"><span style={{ color: '#fbbf24' }}>★</span>{ratingDisplay}</div>
            )}
            <div className="rp-hero-status">
              <span className={`rp-status-dot${isOpen ? '' : ' closed'}`} />{openStatus}
            </div>
          </div>

          {/* ── Info card ── */}
          <div className="rp-info-card">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', marginBottom: 10 }}>
              <div style={{ width: 68, height: 68, borderRadius: 16, background: accent, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 28, border: '3px solid #fff', boxShadow: '0 2px 16px rgba(0,0,0,0.16)', marginTop: -32, flexShrink: 0, overflow: 'hidden' }}>
                {restaurant.logo_url
                  ? <img src={restaurant.logo_url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                  : emoji}
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <button onClick={() => setSaved((s) => !s)} style={{ height: 36, padding: '0 14px', borderRadius: 9999, border: '1.5px solid #e2e8f0', background: '#fff', color: saved ? accent : '#94a3b8', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>
                  {saved ? '♥ Saved' : '♡ Save'}
                </button>
                <button onClick={onShare} aria-label="Share" style={{ height: 36, width: 36, borderRadius: 9999, border: '1.5px solid #e2e8f0', background: '#fff', fontSize: 14, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#64748b' }}>↗</button>
              </div>
            </div>
            <div style={{ display: 'inline-flex', background: accentBg, color: accent, padding: '2px 9px', borderRadius: 4, fontSize: 11, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', marginBottom: 5 }}>{cuisineLabel}</div>
            <h1 style={{ fontFamily: SERIF, fontSize: 28, fontWeight: 400, color: '#0f172a', lineHeight: 1.15, letterSpacing: '-0.01em', marginBottom: 4 }}>{restaurant.display_name}</h1>
            <p style={{ fontSize: 14, color: '#64748b', marginBottom: 10 }}>{meta}</p>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 14 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 3 }}>
                <span style={{ color: '#fbbf24', fontSize: 13 }}>★</span>
                <span style={{ fontSize: 14, fontWeight: 700, color: '#0f172a' }}>{ratingDisplay}</span>
                <span style={{ fontSize: 13, color: '#94a3b8' }}>({reviewCount})</span>
              </div>
              <span style={{ color: '#e2e8f0' }}>·</span>
              <span style={{ fontSize: 14, fontWeight: 600, color: '#64748b' }}>{priceRange}</span>
              <span style={{ color: '#e2e8f0' }}>·</span>
              <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                <span style={{ width: 7, height: 7, borderRadius: '50%', background: isOpen ? '#10b981' : '#94a3b8', flexShrink: 0 }} />
                <span style={{ fontSize: 13, color: '#475569' }}>{todayHours}</span>
              </span>
            </div>
            {/* Fulfillment toggle */}
            <div style={{ display: 'flex', background: '#f1f5f9', borderRadius: 10, padding: 3, marginBottom: 12 }}>
              {supportsDelivery && (
                <button onClick={() => setDeliveryMode('delivery')} style={{ flex: 1, height: 36, borderRadius: 8, border: 'none', fontSize: 13, fontWeight: 600, cursor: 'pointer', transition: 'all 0.15s', background: !isPickup ? '#fff' : 'transparent', color: !isPickup ? '#0f172a' : '#94a3b8', boxShadow: !isPickup ? '0 1px 4px rgba(0,0,0,0.1)' : 'none' }}>🛵 Delivery</button>
              )}
              <button onClick={() => setDeliveryMode('pickup')} style={{ flex: 1, height: 36, borderRadius: 8, border: 'none', fontSize: 13, fontWeight: 600, cursor: 'pointer', transition: 'all 0.15s', background: isPickup ? '#fff' : 'transparent', color: isPickup ? '#0f172a' : '#94a3b8', boxShadow: isPickup ? '0 1px 4px rgba(0,0,0,0.1)' : 'none' }}>🏪 Pickup</button>
            </div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', paddingBottom: 14 }}>
              {[['🕐', delivTime], ['💳', delivFee], ['📦', delivMin]].map(([ic, label]) => (
                <div key={label} style={{ display: 'inline-flex', alignItems: 'center', gap: 5, background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 9999, padding: '5px 12px' }}>
                  <span style={{ fontSize: 12 }}>{ic}</span>
                  <span style={{ fontSize: 13, fontWeight: 600, color: '#0f172a' }}>{label}</span>
                </div>
              ))}
            </div>
          </div>

          <div className="rp-mobile-only rp-divider-block" />

          <div className="rp-main-grid">
            {/* ── Sidebar (desktop) ── */}
            <div className="rp-sidebar">
              <div style={{ background: '#fff', borderRadius: 12, border: '1px solid #e2e8f0', padding: 14, marginBottom: 14 }}>
                <button onClick={() => (hasCart ? setCartOpen(true) : null)} style={{ width: '100%', height: 48, background: accent, color: '#fff', border: 'none', borderRadius: 10, fontSize: 15, fontWeight: 700, cursor: 'pointer', marginBottom: 8 }}>
                  {hasCart ? `Order · ${cartCount} item${cartCount > 1 ? 's' : ''}` : 'Start Order'}
                </button>
                <div style={{ display: 'flex', gap: 8 }}>
                  <button onClick={() => setSaved((s) => !s)} style={{ flex: 1, height: 40, borderRadius: 8, border: '1.5px solid #e2e8f0', background: '#fff', color: saved ? accent : '#94a3b8', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>{saved ? '♥ Saved' : '♡ Save'}</button>
                  <button onClick={onShare} style={{ width: 40, height: 40, borderRadius: 8, border: '1.5px solid #e2e8f0', background: '#fff', fontSize: 14, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#64748b' }}>↗</button>
                </div>
              </div>
              {hours.length > 0 && (
                <div style={{ background: '#fff', borderRadius: 12, border: '1px solid #e2e8f0', overflow: 'hidden', marginBottom: 14 }}>
                  <div style={{ padding: '14px 16px' }}>
                    <p style={sectionLabel}>Hours</p>
                    {hours.map((h) => (
                      <div key={h.day} style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0', fontSize: 13, borderBottom: '1px solid #f8fafc' }}>
                        <span style={{ color: '#64748b' }}>{h.day}</span><span style={{ fontWeight: 500, color: '#0f172a' }}>{h.time}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              {address && (
                <div style={{ background: '#fff', borderRadius: 12, border: '1px solid #e2e8f0', overflow: 'hidden', marginBottom: 14 }}>
                  <div style={{ padding: '14px 16px' }}>
                    <p style={sectionLabel}>Location</p>
                    <MapMini accent={accent} accentFade={accentFade} />
                    <p style={{ fontSize: 13, color: '#475569', lineHeight: 1.5, marginTop: 8 }}>{address}</p>
                  </div>
                </div>
              )}
              {(restaurant.phone || website) && (
                <div style={{ background: '#fff', borderRadius: 12, border: '1px solid #e2e8f0', padding: '14px 16px' }}>
                  <p style={sectionLabel}>Contact</p>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    {restaurant.phone && (
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                        <span style={{ width: 30, height: 30, background: '#f1f5f9', borderRadius: 7, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 13, flexShrink: 0 }}>📞</span>
                        <a href={`tel:${restaurant.phone}`} style={{ fontSize: 13, color: '#0f172a', textDecoration: 'none' }}>{restaurant.phone}</a>
                      </div>
                    )}
                    {website && (
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                        <span style={{ width: 30, height: 30, background: '#f1f5f9', borderRadius: 7, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 13, flexShrink: 0 }}>🌐</span>
                        <a href={website.startsWith('http') ? website : `https://${website}`} target="_blank" rel="noopener noreferrer" style={{ fontSize: 13, color: accent, textDecoration: 'none' }}>{website.replace(/^https?:\/\//, '')}</a>
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>

            {/* ── Main column ── */}
            <div>
              {/* Sticky search + dietary chips */}
              <div className="rp-sticky-search">
                <div style={{ padding: '10px 16px 0' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, background: '#f1f5f9', borderRadius: 10, padding: '10px 14px' }}>
                    <span style={{ fontSize: 14, color: '#94a3b8', flexShrink: 0 }}>🔍</span>
                    <input
                      value={searchQuery}
                      onChange={(e) => { setSearchQuery(e.target.value); setActiveCategory(null); }}
                      placeholder={`Search ${restaurant.display_name}…`}
                      style={{ flex: 1, background: 'none', border: 'none', outline: 'none', fontSize: 14, color: '#0f172a' }}
                    />
                    {hasSearch && (
                      <button onClick={() => setSearchQuery('')} style={{ background: 'none', border: 'none', fontSize: 20, color: '#94a3b8', cursor: 'pointer', lineHeight: 1 }}>×</button>
                    )}
                  </div>
                </div>
                <div className="rp-chip-row">
                  {dietaryChips.map((chip) => {
                    const on = dietaryFilter === chip.key;
                    return (
                      <button key={chip.key} onClick={() => setDietaryFilter(chip.key)} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '5px 13px', borderRadius: 9999, border: `1.5px solid ${on ? accent : '#e2e8f0'}`, background: on ? accentBg : '#fff', color: on ? accent : '#475569', fontSize: 13, fontWeight: 600, whiteSpace: 'nowrap', minHeight: 34, cursor: 'pointer', flexShrink: 0 }}>{chip.label}</button>
                    );
                  })}
                </div>
              </div>

              {/* Tab bar */}
              <div className="rp-tab-sticky">
                {tabs.map((tab) => {
                  const on = activeTab === tab.key;
                  return (
                    <button key={tab.key} onClick={() => setActiveTab(tab.key)} style={{ padding: '12px 22px', border: 'none', background: 'none', fontSize: 14, fontWeight: on ? 700 : 500, color: on ? '#0f172a' : '#94a3b8', cursor: 'pointer', whiteSpace: 'nowrap', borderBottom: on ? `2px solid ${accent}` : '2px solid transparent', minHeight: 44, flexShrink: 0 }}>{tab.label}</button>
                  );
                })}
              </div>

              {/* ── MENU ── */}
              {activeTab === 'menu' && (
                <div className="rp-panel rp-panel-wrap">
                  {sections.length > 1 && (
                    <div className="rp-cat-row">
                      {sections.map((sec) => {
                        const on = String(sec.id) === String(validCatId);
                        return (
                          <button key={sec.id} onClick={() => { setActiveCategory(String(sec.id)); setSearchQuery(''); }} style={{ padding: '5px 15px', borderRadius: 9999, border: `1.5px solid ${on ? accent : '#e2e8f0'}`, background: on ? accent : '#fff', color: on ? '#fff' : '#475569', fontSize: 13, fontWeight: 600, cursor: 'pointer', whiteSpace: 'nowrap', minHeight: 34, flexShrink: 0 }}>{sec.name}</button>
                        );
                      })}
                    </div>
                  )}

                  {/* Reorder */}
                  {pastOrders.length > 0 && !hasSearch && (
                    <div style={{ padding: '14px 16px 2px', borderBottom: '1px solid #f1f5f9' }}>
                      <p style={{ ...sectionLabel, marginBottom: 10 }}>Order again</p>
                      {pastOrders.map((po, i) => (
                        <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 0', borderBottom: '1px solid #f8fafc' }}>
                          <div style={{ width: 44, height: 44, borderRadius: 10, background: po.thumbGrad, flexShrink: 0 }} />
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <p style={{ fontSize: 14, fontWeight: 600, color: '#0f172a', marginBottom: 2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{po.summary}</p>
                            <p style={{ fontSize: 13, color: '#94a3b8' }}>{po.date} · {po.total}</p>
                          </div>
                          <button onClick={() => reorder(po)} style={{ height: 36, padding: '0 16px', borderRadius: 9999, background: accentBg, border: `1.5px solid ${accent}`, color: accent, fontSize: 13, fontWeight: 700, cursor: 'pointer', whiteSpace: 'nowrap', flexShrink: 0 }}>Reorder</button>
                        </div>
                      ))}
                    </div>
                  )}

                  {sections.length === 0 && (
                    <div style={{ textAlign: 'center', padding: '48px 16px' }}>
                      <div style={{ fontSize: 36, marginBottom: 10 }}>🍽️</div>
                      <p style={{ fontSize: 15, fontWeight: 600, color: '#0f172a' }}>No menu items yet</p>
                    </div>
                  )}

                  {/* Featured grid */}
                  {showGrid && (
                    <div style={{ padding: '14px 16px 4px' }}>
                      <p style={{ ...sectionLabel, marginBottom: 10 }}>{gridLabel}</p>
                      <div className="rp-menu-grid">
                        {filteredMenu.map((item) => (
                          <div key={item.id} style={{ borderRadius: 12, overflow: 'hidden', border: '1px solid #f1f5f9', background: '#fff', boxShadow: '0 1px 3px rgba(0,0,0,0.06)' }}>
                            <div onClick={() => item.canOrder && openModal(item)} style={{ cursor: item.canOrder ? 'pointer' : 'default' }}>
                              <div style={{ height: 96, background: item.image_url ? `center/cover url(${item.image_url})` : item.photoGrad, position: 'relative', overflow: 'hidden' }}>
                                <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(to top,rgba(0,0,0,0.3) 0%,transparent 60%)' }} />
                                {item.hasTag && (
                                  <span style={{ position: 'absolute', top: 7, left: 7, background: 'rgba(0,0,0,0.5)', color: '#fff', fontSize: 10, fontWeight: 700, padding: '2px 7px', borderRadius: 9999, backdropFilter: 'blur(4px)' }}>{item.tagLabel}</span>
                                )}
                              </div>
                              <div style={{ padding: '10px 10px 6px' }}>
                                <p style={{ fontSize: 13, fontWeight: 600, color: '#0f172a', lineHeight: 1.3 }}>{item.name}</p>
                              </div>
                            </div>
                            <div style={{ padding: '0 10px 8px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                              <span style={{ fontSize: 14, fontWeight: 700, color: accent }}>{item.priceStr}</span>
                              {item.canOrder && (
                                <button onClick={() => quickAdd(item)} style={{ width: 30, height: 30, borderRadius: 8, background: accent, color: '#fff', border: 'none', fontSize: 20, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 300, lineHeight: 1 }}>+</button>
                              )}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* List view */}
                  {showList && (
                    <div style={{ padding: '4px 16px 8px' }}>
                      {hasSearch && (
                        <p style={{ ...sectionLabel, fontSize: 12, margin: '10px 0' }}>{filteredMenu.length} result{filteredMenu.length !== 1 ? 's' : ''} for "{searchQuery}"</p>
                      )}
                      {filteredMenu.map((item) => (
                        <div key={item.id} style={{ display: 'grid', gridTemplateColumns: '1fr 68px', gap: 12, padding: '13px 0', borderBottom: '1px solid #f8fafc', alignItems: 'start', opacity: item.is_available === false ? 0.55 : 1 }}>
                          <div onClick={() => item.canOrder && openModal(item)} style={{ minWidth: 0, cursor: item.canOrder ? 'pointer' : 'default' }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 8, marginBottom: 3 }}>
                              <span style={{ fontSize: 15, fontWeight: 600, color: '#0f172a', lineHeight: 1.3 }}>{item.name}</span>
                              <span style={{ fontSize: 14, fontWeight: 700, color: accent, whiteSpace: 'nowrap', flexShrink: 0 }}>{item.priceStr}</span>
                            </div>
                            {item.description && <p style={{ fontSize: 13, color: '#64748b', lineHeight: 1.45 }}>{item.description}</p>}
                            {item.is_available === false && <p style={{ fontSize: 12, color: '#ef4444', fontWeight: 600, marginTop: 4 }}>Sold out</p>}
                            {item.hasTag && (
                              <span style={{ display: 'inline-flex', marginTop: 5, background: accentBg, color: accent, fontSize: 11, fontWeight: 600, padding: '2px 8px', borderRadius: 9999 }}>{item.tagLabel}</span>
                            )}
                          </div>
                          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 6, flexShrink: 0 }}>
                            <div onClick={() => item.canOrder && openModal(item)} style={{ width: 64, height: 64, borderRadius: 10, background: item.image_url ? `center/cover url(${item.image_url})` : item.photoGrad, cursor: item.canOrder ? 'pointer' : 'default' }} />
                            {item.canOrder && (
                              <button onClick={() => quickAdd(item)} style={{ width: 32, height: 32, borderRadius: 8, background: accent, color: '#fff', border: 'none', fontSize: 19, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 300, lineHeight: 1 }}>+</button>
                            )}
                          </div>
                        </div>
                      ))}
                      {isEmpty && (
                        <div style={{ textAlign: 'center', padding: '40px 16px' }}>
                          <div style={{ fontSize: 36, marginBottom: 10 }}>🔍</div>
                          <p style={{ fontSize: 15, fontWeight: 600, color: '#0f172a', marginBottom: 4 }}>{hasSearch ? `No results for "${searchQuery}"` : 'No items here yet'}</p>
                          <p style={{ fontSize: 14, color: '#64748b' }}>Try a different {hasSearch ? 'search term' : 'category'}</p>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}

              {/* ── INFO ── */}
              {activeTab === 'info' && (
                <div className="rp-panel rp-panel-wrap">
                  <div style={{ padding: 16, borderBottom: '1px solid #f1f5f9' }}>
                    <p style={sectionLabel}>Hours</p>
                    {hours.length ? hours.map((h) => (
                      <div key={h.day} style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0', fontSize: 14, borderBottom: '1px solid #f8fafc' }}>
                        <span style={{ color: '#64748b' }}>{h.day}</span><span style={{ fontWeight: 500, color: '#0f172a' }}>{h.time}</span>
                      </div>
                    )) : <p style={{ fontSize: 13, color: '#94a3b8' }}>Hours not available</p>}
                  </div>
                  {address && (
                    <div style={{ padding: 16, borderBottom: '1px solid #f1f5f9' }}>
                      <p style={sectionLabel}>Location</p>
                      <MapMini accent={accent} accentFade={accentFade} big />
                      <p style={{ fontSize: 14, color: '#475569', lineHeight: 1.5, marginTop: 10 }}>{address}</p>
                    </div>
                  )}
                  <div style={{ padding: 16 }}>
                    <p style={sectionLabel}>Contact</p>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                      {restaurant.phone && (
                        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                          <span style={{ width: 36, height: 36, background: '#f1f5f9', borderRadius: 8, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 16, flexShrink: 0 }}>📞</span>
                          <a href={`tel:${restaurant.phone}`} style={{ fontSize: 14, color: '#0f172a', textDecoration: 'none' }}>{restaurant.phone}</a>
                        </div>
                      )}
                      {website && (
                        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                          <span style={{ width: 36, height: 36, background: '#f1f5f9', borderRadius: 8, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 16, flexShrink: 0 }}>🌐</span>
                          <a href={website.startsWith('http') ? website : `https://${website}`} target="_blank" rel="noopener noreferrer" style={{ fontSize: 14, color: accent, textDecoration: 'none' }}>{website.replace(/^https?:\/\//, '')}</a>
                        </div>
                      )}
                      {!restaurant.phone && !website && <p style={{ fontSize: 13, color: '#94a3b8' }}>No contact details yet</p>}
                    </div>
                  </div>
                </div>
              )}

              {/* ── REVIEWS ── */}
              {activeTab === 'reviews' && (
                <div className="rp-panel rp-panel-wrap" style={{ padding: 16 }}>
                  {rating > 0 || reviewsList.length ? (
                    <>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 20, padding: 16, background: '#f8fafc', borderRadius: 12, marginBottom: 16 }}>
                        <div style={{ textAlign: 'center', flexShrink: 0 }}>
                          <div style={{ fontFamily: SERIF, fontSize: 48, fontWeight: 400, color: '#0f172a', lineHeight: 1, letterSpacing: '-0.03em' }}>{rating > 0 ? rating.toFixed(1) : '—'}</div>
                          <div style={{ fontSize: 16, color: '#fbbf24', margin: '5px 0', letterSpacing: 2 }}>{'★'.repeat(Math.round(rating)) || '☆☆☆☆☆'}</div>
                          <div style={{ fontSize: 12, color: '#94a3b8' }}>{reviewCount} reviews</div>
                        </div>
                        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 5 }}>
                          {ratingBars.map((bar) => (
                            <div key={bar.label} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: '#94a3b8' }}>
                              <span style={{ width: 8, textAlign: 'right', flexShrink: 0 }}>{bar.label}</span>
                              <div style={{ flex: 1, height: 5, background: '#e2e8f0', borderRadius: 3, overflow: 'hidden' }}>
                                <div style={{ height: '100%', background: accent, width: bar.pct }} />
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                      {reviewsList.map((rev, i) => (
                        <div key={i} style={{ padding: '14px 0', borderBottom: '1px solid #f1f5f9' }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 8 }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                              <div style={{ width: 36, height: 36, borderRadius: '50%', background: accentBg, color: accent, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 14, fontWeight: 700, flexShrink: 0 }}>{rev.initial}</div>
                              <div><p style={{ fontSize: 14, fontWeight: 600, color: '#0f172a', lineHeight: 1.2 }}>{rev.name}</p><p style={{ fontSize: 12, color: '#94a3b8', marginTop: 2 }}>{rev.time}</p></div>
                            </div>
                            <span style={{ fontSize: 12, color: '#fbbf24', letterSpacing: 1, flexShrink: 0 }}>{rev.stars}</span>
                          </div>
                          {rev.text && <p style={{ fontSize: 14, color: '#475569', lineHeight: 1.65 }}>{rev.text}</p>}
                        </div>
                      ))}
                    </>
                  ) : (
                    <div style={{ textAlign: 'center', padding: '40px 16px' }}>
                      <div style={{ fontSize: 36, marginBottom: 10 }}>⭐</div>
                      <p style={{ fontSize: 15, fontWeight: 600, color: '#0f172a' }}>No reviews yet</p>
                      <p style={{ fontSize: 14, color: '#64748b', marginTop: 4 }}>Be the first to review after your order.</p>
                    </div>
                  )}
                </div>
              )}

              {/* ── DEALS ── */}
              {activeTab === 'deals' && (
                <div className="rp-panel rp-panel-wrap" style={{ padding: 16 }}>
                  {promos.length ? promos.map((promo, i) => (
                    <div key={i} style={{ border: '1px solid #e2e8f0', borderLeft: `4px solid ${accent}`, borderRadius: 10, padding: '14px 16px', marginBottom: 12 }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 10, marginBottom: 6 }}>
                        <h3 style={{ fontSize: 15, fontWeight: 700, color: '#0f172a' }}>{promo.title}</h3>
                        <span style={{ fontSize: 11, fontWeight: 700, background: accentBg, color: accent, padding: '3px 8px', borderRadius: 4, whiteSpace: 'nowrap', flexShrink: 0 }}>{promo.badge}</span>
                      </div>
                      {promo.desc && <p style={{ fontSize: 14, fontWeight: 500, color: '#0f172a', marginBottom: 4 }}>{promo.desc}</p>}
                      {promo.sub && <p style={{ fontSize: 13, color: '#94a3b8' }}>{promo.sub}</p>}
                    </div>
                  )) : (
                    <div style={{ textAlign: 'center', padding: '40px 16px' }}>
                      <div style={{ fontSize: 36, marginBottom: 10 }}>🏷️</div>
                      <p style={{ fontSize: 15, fontWeight: 600, color: '#0f172a' }}>No active deals right now</p>
                      <p style={{ fontSize: 14, color: '#64748b', marginTop: 4 }}>Check back later for promotions.</p>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* ── Floating cart ── */}
        {hasCart && !cartOpen && !modalItem && (
          <div className="rp-float-cart">
            <button onClick={() => { setCartOpen(true); setCartStep('cart'); }} style={{ display: 'flex', alignItems: 'center', gap: 14, background: accent, color: '#fff', border: 'none', borderRadius: 16, padding: '14px 22px', fontSize: 15, fontWeight: 700, cursor: 'pointer', boxShadow: `0 8px 28px ${accentShadow}`, minWidth: 240, justifyContent: 'space-between' }}>
              <span style={{ background: 'rgba(0,0,0,0.18)', borderRadius: 8, padding: '3px 10px', fontSize: 13, fontWeight: 700 }}>{cartCount}</span>
              <span>View Cart</span>
              <span>{formatFoodMoney(subtotalCents, currency)}</span>
            </button>
          </div>
        )}

        {/* ── Cart / checkout drawer ── */}
        {cartOpen && (
          <>
            <div className="rp-sheet-backdrop" onClick={() => { setCartOpen(false); setCartStep('cart'); }} />
            <div className="rp-sheet" role="dialog" aria-modal="true" aria-label="Your order">
              <div style={{ display: 'flex', justifyContent: 'center', padding: '12px 0 4px', flexShrink: 0 }}>
                <div style={{ width: 36, height: 4, borderRadius: 2, background: '#e2e8f0' }} />
              </div>

              {/* Headers */}
              {cartStep === 'cart' && (
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '4px 20px 12px', borderBottom: '1px solid #f1f5f9', flexShrink: 0 }}>
                  <div><h2 style={{ fontSize: 18, fontWeight: 700, color: '#0f172a', lineHeight: 1.2 }}>Your Order</h2><p style={{ fontSize: 13, color: '#64748b', marginTop: 2 }}>{restaurant.display_name}</p></div>
                  <button onClick={() => setCartOpen(false)} style={closeBtn}>×</button>
                </div>
              )}
              {(cartStep === 'details' || cartStep === 'payment') && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '4px 20px 12px', borderBottom: '1px solid #f1f5f9', flexShrink: 0 }}>
                  <button onClick={() => setCartStep(cartStep === 'payment' ? 'details' : 'cart')} style={{ width: 36, height: 36, borderRadius: '50%', background: '#f1f5f9', border: 'none', fontSize: 18, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#0f172a', flexShrink: 0 }}>←</button>
                  <div style={{ flex: 1 }}>
                    <h2 style={{ fontSize: 16, fontWeight: 700, color: '#0f172a', lineHeight: 1.2 }}>{cartStep === 'payment' ? 'Payment' : detailsTitle}</h2>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginTop: 4 }}>
                      <div style={{ width: 20, height: 3, borderRadius: 2, background: accent }} />
                      <div style={{ width: 20, height: 3, borderRadius: 2, background: cartStep === 'payment' ? accent : '#e2e8f0' }} />
                    </div>
                  </div>
                  <button onClick={() => setCartOpen(false)} style={closeBtn}>×</button>
                </div>
              )}

              {/* ① empty */}
              {cartStep === 'cart' && cartItems.length === 0 && (
                <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '40px 20px' }}>
                  <div style={{ width: 64, height: 64, borderRadius: '50%', background: '#f1f5f9', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 28, marginBottom: 14 }}>🛒</div>
                  <p style={{ fontSize: 16, fontWeight: 600, color: '#0f172a', marginBottom: 6 }}>Your cart is empty</p>
                  <p style={{ fontSize: 14, color: '#64748b', textAlign: 'center', lineHeight: 1.5 }}>Add items from the menu to get started</p>
                  <button onClick={() => setCartOpen(false)} style={{ marginTop: 20, height: 44, padding: '0 28px', background: accent, color: '#fff', border: 'none', borderRadius: 10, fontSize: 14, fontWeight: 700, cursor: 'pointer' }}>Browse Menu</button>
                </div>
              )}

              {/* ② cart items */}
              {cartStep === 'cart' && cartItems.length > 0 && (
                <>
                  <div style={{ flex: 1, overflowY: 'auto', padding: '4px 20px 0' }}>
                    {cartItems.map((ci) => (
                      <div key={ci.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 0', borderBottom: '1px solid #f8fafc' }}>
                        <div style={{ width: 52, height: 52, borderRadius: 10, background: ci.image ? `center/cover url(${ci.image})` : ci.photoGrad, flexShrink: 0 }} />
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <p style={{ fontSize: 14, fontWeight: 600, color: '#0f172a', lineHeight: 1.3, marginBottom: 2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{ci.name}</p>
                          {(ci.modifierNames?.length > 0 || ci.notes) && (
                            <p style={{ fontSize: 12, color: '#94a3b8', marginBottom: 2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{[...(ci.modifierNames || []), ci.notes].filter(Boolean).join(' · ')}</p>
                          )}
                          <p style={{ fontSize: 13, fontWeight: 700, color: accent }}>{formatFoodMoney(ci.unitCents * ci.qty, currency)}</p>
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
                          <button onClick={() => decLine(ci.id)} style={{ width: 28, height: 28, borderRadius: 8, border: '1.5px solid #e2e8f0', background: '#fff', fontSize: 16, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#64748b', lineHeight: 1 }}>−</button>
                          <span style={{ fontSize: 14, fontWeight: 700, color: '#0f172a', minWidth: 18, textAlign: 'center' }}>{ci.qty}</span>
                          <button onClick={() => incLine(ci.id)} style={{ width: 28, height: 28, borderRadius: 8, background: accent, border: 'none', fontSize: 16, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', lineHeight: 1 }}>+</button>
                        </div>
                      </div>
                    ))}
                  </div>
                  <div style={{ padding: '14px 20px 20px', borderTop: '1px solid #f1f5f9', flexShrink: 0 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 14, color: '#64748b', marginBottom: 6 }}><span>Subtotal</span><span style={{ fontWeight: 600, color: '#0f172a' }}>{formatFoodMoney(subtotalCents, currency)}</span></div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 14, color: '#64748b', marginBottom: 14 }}><span>{delivFeeLabel}</span><span style={{ fontWeight: 600, color: '#0f172a' }}>{delivFeeStr}</span></div>
                      <button onClick={() => { setCartOpen(true); setCartStep('details'); }} style={{ width: '100%', height: 52, background: accent, color: '#fff', border: 'none', borderRadius: 12, fontSize: 16, fontWeight: 700, cursor: 'pointer' }}>Checkout · {formatFoodMoney(orderTotalCents, currency)}</button>
                  </div>
                </>
              )}

              {/* ③ details step */}
              {cartStep === 'details' && (
                <>
                  <div style={{ flex: 1, overflowY: 'auto', padding: '16px 20px 0' }}>
                    {checkoutRequiresLogin ? (
                      <div style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 16, padding: 20, marginBottom: 20 }}>
                        <p style={{ fontSize: 12, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: accent, marginBottom: 10 }}>
                          Sign in required
                        </p>
                        <h3 style={{ fontSize: 22, fontWeight: 700, color: '#0f172a', marginBottom: 10 }}>
                          Sign in to continue checkout
                        </h3>
                        <p style={{ fontSize: 14, lineHeight: 1.7, color: '#64748b' }}>
                          Browsing stays open to everyone, but final checkout is tied to an OxSteed account so your order can be tracked, updated, and recovered later.
                        </p>
                      </div>
                    ) : (
                      <>
                        {!isPickup && (
                          <>
                            <p style={{ ...sectionLabel, color: '#64748b', marginBottom: 6 }}>Street Address</p>
                            <input value={addressLine1} onChange={(e) => setAddressLine1(e.target.value)} placeholder="Street and number…" style={inputStyle} />
                            <p style={{ ...sectionLabel, color: '#64748b', marginBottom: 6 }}>Apt / Suite <span style={{ textTransform: 'none', fontWeight: 400, color: '#94a3b8' }}>(optional)</span></p>
                            <input value={addressLine2} onChange={(e) => setAddressLine2(e.target.value)} placeholder="Apt 4B…" style={{ ...inputStyle, marginBottom: 20 }} />
                          </>
                        )}
                        <p style={{ ...sectionLabel, color: '#64748b' }}>{isPickup ? 'Pickup Time' : 'Delivery Time'}</p>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 20 }}>
                          {timeSlots.map((slot) => {
                            const on = deliverySlot === slot.id;
                            return (
                              <button key={slot.id} onClick={() => setDeliverySlot(slot.id)} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 16px', borderRadius: 10, border: `1.5px solid ${on ? accent : '#e2e8f0'}`, background: on ? accentBg : '#fff', cursor: 'pointer', textAlign: 'left', width: '100%' }}>
                                <div>
                                  <p style={{ fontSize: 14, fontWeight: 600, color: '#0f172a', marginBottom: 2 }}>{slot.label}</p>
                                  <p style={{ fontSize: 12, color: '#94a3b8' }}>{slot.sub}</p>
                                </div>
                                <Radio on={on} accent={accent} />
                              </button>
                            );
                          })}
                        </div>
                      </>
                    )}
                  </div>
                  <div style={{ padding: '14px 20px 20px', borderTop: '1px solid #f1f5f9', flexShrink: 0 }}>
                    {checkoutRequiresLogin ? (
                      <button
                        onClick={() => setCartStep('login')}
                        style={{
                          width: '100%',
                          height: 52,
                          background: accent,
                          color: '#fff',
                          border: 'none',
                          borderRadius: 12,
                          fontSize: 16,
                          fontWeight: 700,
                          cursor: 'pointer',
                        }}
                      >
                        Sign in to Checkout
                      </button>
                    ) : (
                      <button
                        onClick={() => setCartStep('payment')}
                        style={{
                          width: '100%',
                          height: 52,
                          background: accent,
                          color: '#fff',
                          border: 'none',
                          borderRadius: 12,
                          fontSize: 16,
                          fontWeight: 700,
                          cursor: 'pointer',
                        }}
                      >
                        Continue to Payment →
                      </button>
                    )}
                  </div>
                </>
              )}

              {/* ③.5 login gate */}
              {cartStep === 'login' && (
                <>
                  <div style={{ flex: 1, overflowY: 'auto', padding: '18px 20px 0' }}>
                    <div style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 16, padding: 20 }}>
                      <p style={{ fontSize: 12, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: accent, marginBottom: 10 }}>
                        Sign in required
                      </p>
                      <h3 style={{ fontSize: 22, fontWeight: 700, color: '#0f172a', marginBottom: 10 }}>
                        Sign in to place this order
                      </h3>
                      <p style={{ fontSize: 14, lineHeight: 1.7, color: '#64748b' }}>
                        You can browse menus without an account, but checkout is tied to an OxSteed login so your order, status updates, and history stay connected to your profile.
                      </p>
                    </div>
                  </div>
                  <div style={{ padding: '14px 20px 20px', borderTop: '1px solid #f1f5f9', flexShrink: 0 }}>
                    <button
                      onClick={openLoginGate}
                      style={{
                        width: '100%',
                        height: 52,
                        background: accent,
                        color: '#fff',
                        border: 'none',
                        borderRadius: 12,
                        fontSize: 16,
                        fontWeight: 700,
                        cursor: 'pointer',
                        marginBottom: 10,
                      }}
                    >
                      Sign in to Continue
                    </button>
                    <button
                      onClick={() => setCartStep('cart')}
                      style={{
                        width: '100%',
                        height: 44,
                        background: '#f8fafc',
                        color: '#0f172a',
                        border: '1px solid #e2e8f0',
                        borderRadius: 12,
                        fontSize: 14,
                        fontWeight: 600,
                        cursor: 'pointer',
                      }}
                    >
                      Back to Cart
                    </button>
                  </div>
                </>
              )}

              {/* ④ payment step */}
              {cartStep === 'payment' && !checkoutRequiresLogin && (
                <>
                  <div style={{ flex: 1, overflowY: 'auto', padding: '16px 20px 0' }}>
                    <p style={{ ...sectionLabel, color: '#64748b' }}>Payment Method</p>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 20 }}>
                      {paymentMethods.map((pm) => {
                        const on = paymentMethod === pm.id;
                        const disabled = Boolean(pm.disabled);
                        return (
                          <button key={pm.id} disabled={disabled} onClick={() => !disabled && setPaymentMethod(pm.id)} style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '14px 16px', borderRadius: 12, border: `1.5px solid ${on ? accent : '#e2e8f0'}`, background: on ? accentBg : '#fff', cursor: disabled ? 'not-allowed' : 'pointer', opacity: disabled ? 0.55 : 1, textAlign: 'left', width: '100%' }}>
                            <span style={{ fontSize: 24, flexShrink: 0 }}>{pm.icon}</span>
                            <div style={{ flex: 1, minWidth: 0 }}>
                              <p style={{ fontSize: 14, fontWeight: 600, color: '#0f172a', marginBottom: 2 }}>{pm.label}</p>
                              <p style={{ fontSize: 12, color: '#94a3b8' }}>{pm.sub}</p>
                            </div>
                            <Radio on={on} accent={accent} />
                          </button>
                        );
                      })}
                    </div>
                    {user && (
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, margin: '-8px 2px 18px', padding: '11px 13px', borderRadius: 12, background: '#fff8ed', border: '1px solid #fed7aa' }}>
                        <div style={{ minWidth: 0 }}>
                          <strong style={{ display: 'block', color: '#9a4b0c', fontSize: 12 }}>Restaurant credit</strong>
                          <span style={{ color: '#9a6a3c', fontSize: 11 }}>
                            {wallet
                              ? `${formatFoodMoney(walletAvailableCents, wallet.currencyCode || currency)} available${walletReservedCents > 0 ? ` · ${formatFoodMoney(walletReservedCents, wallet.currencyCode || currency)} reserved` : ''}`
                              : 'Request credit, upload proof, or view your balance'}
                          </span>
                        </div>
                        <Link
                          to={`/restaurant-credit?restaurantId=${restaurantId}`}
                          style={{ flexShrink: 0, color: accent, fontSize: 12, fontWeight: 800, textDecoration: 'none' }}
                        >
                          Manage credit →
                        </Link>
                      </div>
                    )}
                    {paymentMethod === 'direct_payment' && (
                      <div style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 16, padding: 16, marginBottom: 20 }}>
                        <p style={{ fontSize: 12, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: accent, marginBottom: 8 }}>
                          External payment
                        </p>
                        <h4 style={{ fontSize: 18, fontWeight: 700, color: '#0f172a', marginBottom: 8 }}>
                          {externalPaymentLabel || 'Payment app / QR'}
                        </h4>
                        {externalPaymentHandle && (
                          <p style={{ fontSize: 14, color: '#475569', marginBottom: 8 }}>
                            Send payment to <strong style={{ color: '#0f172a' }}>{externalPaymentHandle}</strong>
                          </p>
                        )}
                        {externalPaymentInstructions && (
                          <p style={{ fontSize: 14, color: '#475569', lineHeight: 1.6, marginBottom: 10 }}>
                            {externalPaymentInstructions}
                          </p>
                        )}
                        {externalPaymentQrUrl && (
                          <img
                            src={externalPaymentQrUrl}
                            alt="Restaurant payment QR"
                            style={{ width: 156, height: 156, objectFit: 'cover', borderRadius: 14, border: '1px solid #e2e8f0', background: '#fff', marginBottom: 12 }}
                          />
                        )}
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: 12 }}>
                          <div>
                            <p style={{ fontSize: 12, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: '#64748b', marginBottom: 6 }}>Confirmation / reference</p>
                            <input
                              value={paymentReference}
                              onChange={(e) => setPaymentReference(e.target.value)}
                              placeholder={externalPaymentReferenceHint || 'Include your order number or name'}
                              maxLength={120}
                              style={inputStyle}
                            />
                          </div>
                          <div>
                            <p style={{ fontSize: 12, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: '#64748b', marginBottom: 6 }}>Receipt / proof of payment</p>
                            <label style={{ display: 'block', cursor: 'pointer' }}>
                              <input
                                type="file"
                                accept="image/*,application/pdf"
                                onChange={handlePaymentProofUpload}
                                disabled={proofUploading}
                                style={{ display: 'block', width: '100%' }}
                              />
                            </label>
                            <p style={{ fontSize: 12, color: '#94a3b8', marginTop: 6 }}>
                              {proofUploading ? 'Uploading proof…' : 'Upload a screenshot, receipt, or PDF if you have one.'}
                            </p>
                            {paymentProof?.url && (
                              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 10, padding: '10px 12px', borderRadius: 12, border: '1px solid #e2e8f0', background: '#fff' }}>
                                <span style={{ fontSize: 18 }}>📎</span>
                                <div style={{ minWidth: 0 }}>
                                  <strong style={{ display: 'block', fontSize: 13, color: '#0f172a' }}>{paymentProof.name || 'Proof uploaded'}</strong>
                                  <a href={paymentProof.url} target="_blank" rel="noreferrer" style={{ fontSize: 12, color: accent, textDecoration: 'none' }}>Open attachment</a>
                                </div>
                              </div>
                            )}
                          </div>
                          <div>
                            <p style={{ fontSize: 12, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: '#64748b', marginBottom: 6 }}>Message for the restaurant</p>
                            <textarea
                              value={paymentNote}
                              onChange={(e) => setPaymentNote(e.target.value)}
                              placeholder="Anything that will help the restaurant match the payment"
                              maxLength={1000}
                              rows={3}
                              style={{ ...inputStyle, minHeight: 90, resize: 'vertical' }}
                            />
                          </div>
                        </div>
                        {requireExternalPaymentProof && (
                          <p style={{ fontSize: 12, color: '#b45309', marginTop: 10, lineHeight: 1.5 }}>
                            Proof is required for this restaurant before the order can be submitted.
                          </p>
                        )}
                      </div>
                    )}
                    {paymentMethod === 'restaurant_credit' && (
                      <>
                        <p style={{ ...sectionLabel, color: '#64748b' }}>Promo Code <span style={{ textTransform: 'none', fontWeight: 400, color: '#94a3b8' }}>(optional)</span></p>
                        <input
                          value={promoCode}
                          onChange={(e) => setPromoCode(e.target.value.toUpperCase())}
                          placeholder="e.g. SUMMER10"
                          maxLength={40}
                          style={{ ...inputStyle, marginBottom: 20, textTransform: 'uppercase' }}
                        />
                      </>
                    )}
                    <p style={{ ...sectionLabel, color: '#64748b' }}>Order Summary</p>
                    <div style={{ background: '#f8fafc', borderRadius: 12, padding: '14px 16px', marginBottom: 20, border: '1px solid #f1f5f9' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 14, color: '#64748b', marginBottom: 6 }}><span>Subtotal</span><span style={{ fontWeight: 600, color: '#0f172a' }}>{formatFoodMoney(subtotalCents, currency)}</span></div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 14, color: '#64748b', marginBottom: 10 }}><span>{delivFeeLabel}</span><span style={{ fontWeight: 600, color: '#0f172a' }}>{delivFeeStr}</span></div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 16, fontWeight: 700, paddingTop: 10, borderTop: '1px solid #e2e8f0' }}><span style={{ color: '#0f172a' }}>Total</span><span style={{ color: '#0f172a' }}>{formatFoodMoney(orderTotalCents, currency)}</span></div>
                    </div>
                    <p style={{ fontSize: 12, color: '#94a3b8', textAlign: 'center', marginBottom: 4 }}>
                      {paymentMethod === 'restaurant_credit'
                        ? '💠 Your restaurant credit is charged when the order is placed.'
                        : paymentMethod === 'direct_payment'
                          ? '📲 Submit your proof of payment with the order so the restaurant can match it quickly.'
                        : `🏪 Payment is settled with the restaurant ${isPickup ? 'at the counter' : 'on delivery'} when your order is ready. No card is charged online.`}
                    </p>
                  </div>
                  <div style={{ padding: '14px 20px 20px', borderTop: '1px solid #f1f5f9', flexShrink: 0 }}>
                    <button
                      onClick={submitOrder}
                      disabled={placing || proofUploading || (paymentMethod === 'direct_payment' && requireExternalPaymentProof && !externalPaymentHasSubmission)}
                      style={{ width: '100%', height: 52, background: accent, color: '#fff', border: 'none', borderRadius: 12, fontSize: 16, fontWeight: 700, cursor: placing || proofUploading ? 'wait' : 'pointer', opacity: placing || proofUploading || (paymentMethod === 'direct_payment' && requireExternalPaymentProof && !externalPaymentHasSubmission) ? 0.7 : 1 }}
                    >
                      {placing ? 'Placing order…' : `Place Order · ${formatFoodMoney(orderTotalCents, currency)}`}
                    </button>
                  </div>
                </>
              )}

              {/* ⑤ confirmed */}
              {cartStep === 'confirmed' && (() => {
                const shownOrder = liveOrder || placedOrder;
                const shownStatus = shownOrder?.status || 'received';
                const isReady = shownStatus === 'ready';
                const statusLabel = t(FOOD_STATUS_KEYS[shownStatus] || FOOD_STATUS_KEYS.received);
                return (
                  <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '40px 24px' }}>
                    <div style={{ width: 72, height: 72, borderRadius: '50%', background: accentBg, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 32, marginBottom: 16, color: accent }}>✓</div>
                    <h2 style={{ fontFamily: SERIF, fontSize: 26, fontWeight: 400, color: '#0f172a', marginBottom: 8, textAlign: 'center' }}>Order Placed!</h2>
                    <p style={{ fontSize: 14, color: '#64748b', textAlign: 'center', lineHeight: 1.65, marginBottom: 12 }}>
                      {shownOrder?.queue_number != null
                        ? <>Your order number is <strong style={{ color: '#0f172a' }}>#{shownOrder.queue_number}</strong>.<br />We’ll have it ready shortly.</>
                        : <>Your order is confirmed and being prepared.<br />We’ll notify you when it’s ready.</>}
                    </p>
                    {/* Live status (socket + poll via the public tracking token) */}
                    {placedTrackingToken && (
                      <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8, padding: '6px 14px', borderRadius: 9999, background: isReady ? '#dcfce7' : '#f1f5f9', border: `1px solid ${isReady ? '#86efac' : '#e2e8f0'}`, marginBottom: 18 }}>
                        <span style={{ width: 8, height: 8, borderRadius: '50%', background: isReady ? '#16a34a' : accent, flexShrink: 0 }} />
                        <span style={{ fontSize: 13, fontWeight: 600, color: isReady ? '#166534' : '#334155' }}>
                          {isReady ? 'Ready for pickup!' : `Live status: ${statusLabel}`}
                        </span>
                      </div>
                    )}
                    <div style={{ background: '#f8fafc', borderRadius: 14, padding: '18px 24px', width: '100%', textAlign: 'center', border: '1px solid #e2e8f0', marginBottom: 16 }}>
                      <p style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.07em', color: '#94a3b8', marginBottom: 4 }}>Estimated time</p>
                      <p style={{ fontFamily: SERIF, fontSize: 28, color: '#0f172a' }}>{delivTime}</p>
                    </div>
                    <div style={{ display: 'flex', gap: 10, width: '100%' }}>
                      <Link to={`/restaurants/queue/${restaurant.id}`} style={{ flex: 1, textAlign: 'center', height: 44, lineHeight: '44px', background: '#f1f5f9', color: '#0f172a', borderRadius: 10, fontSize: 14, fontWeight: 600, textDecoration: 'none' }}>Watch Queue</Link>
                      <button onClick={() => { setCartOpen(false); setCartStep('cart'); setPlacedOrder(null); setPlacedTrackingToken(null); setRecoveredOrder(loadActiveOrder(restaurantId)); setPaymentReference(''); setPaymentNote(''); setPaymentProof(null); setPaymentMethod('pay_at_restaurant'); }} style={{ flex: 1, height: 44, background: accent, color: '#fff', border: 'none', borderRadius: 10, fontSize: 14, fontWeight: 600, cursor: 'pointer' }}>Back to Menu</button>
                    </div>
                  </div>
                );
              })()}
            </div>
          </>
        )}

        {/* ── Item modal ── */}
        {modalItem && (
          <>
            <div className="rp-sheet-backdrop" onClick={() => setModalItem(null)} />
            <div className="rp-sheet" role="dialog" aria-modal="true" aria-label={modalItem.name}>
              <div style={{ height: 190, background: modalItem.image_url ? `center/cover url(${modalItem.image_url})` : (modalItem.photoGrad || gradFor(modalItem.sectionName)), position: 'relative', flexShrink: 0 }}>
                <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(to bottom,transparent 40%,rgba(0,0,0,0.55) 100%)' }} />
                <div style={{ position: 'absolute', top: 10, left: '50%', transform: 'translateX(-50%)', width: 36, height: 4, borderRadius: 2, background: 'rgba(255,255,255,0.4)' }} />
                <button onClick={() => setModalItem(null)} style={{ position: 'absolute', top: 14, right: 14, width: 36, height: 36, borderRadius: '50%', background: 'rgba(0,0,0,0.35)', color: '#fff', border: 'none', fontSize: 20, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', lineHeight: 1, backdropFilter: 'blur(8px)' }}>×</button>
                <div style={{ position: 'absolute', bottom: 14, left: 20, right: 20 }}>
                  <h2 style={{ fontFamily: SERIF, fontSize: 22, fontWeight: 400, color: '#fff', lineHeight: 1.2, marginBottom: 2 }}>{modalItem.name}</h2>
                  <span style={{ fontSize: 16, fontWeight: 700, color: '#fff' }}>{formatFoodMoney(modalItem.price_cents, currency)}</span>
                </div>
              </div>

              <div style={{ flex: 1, overflowY: 'auto' }}>
                {modalItem.description && (
                  <div style={{ padding: '14px 20px 0' }}>
                    <p style={{ fontSize: 14, color: '#64748b', lineHeight: 1.55 }}>{modalItem.description}</p>
                  </div>
                )}
                {modalGroups.map((group) => (
                  <div key={group.id} style={{ padding: '16px 20px', borderTop: '1px solid #f1f5f9' }}>
                    <p style={{ ...sectionLabel, color: '#64748b', marginBottom: 10 }}>{group.name}{group.isRequired && <span style={{ color: accent, marginLeft: 6, textTransform: 'none', letterSpacing: 0 }}>Required</span>}</p>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
                      {group.isRadio && group.radioOptions.map((opt) => (
                        <button key={opt.id} onClick={opt.onSelect} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '11px 14px', borderRadius: 10, border: `1.5px solid ${opt.isSelected ? accent : '#e2e8f0'}`, background: opt.isSelected ? accentBg : '#fff', cursor: 'pointer', textAlign: 'left', width: '100%' }}>
                          <span style={{ fontSize: 14, color: '#0f172a', fontWeight: opt.isSelected ? 600 : 400 }}>{opt.label}{opt.priceCents ? <span style={{ color: '#64748b', fontWeight: 400 }}> +{formatFoodMoney(opt.priceCents, currency)}</span> : null}</span>
                          <Radio on={opt.isSelected} accent={accent} />
                        </button>
                      ))}
                      {group.isCheckbox && group.checkboxOptions.map((opt) => (
                        <button key={opt.id} onClick={opt.onToggle} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '11px 14px', borderRadius: 10, border: `1.5px solid ${opt.isChecked ? accent : '#e2e8f0'}`, background: opt.isChecked ? accentBg : '#fff', cursor: 'pointer', textAlign: 'left', width: '100%' }}>
                          <span style={{ fontSize: 14, color: '#0f172a', fontWeight: opt.isChecked ? 600 : 400 }}>{opt.label}{opt.priceCents ? <span style={{ color: '#64748b', fontWeight: 400 }}> +{formatFoodMoney(opt.priceCents, currency)}</span> : null}</span>
                          <span style={{ width: 20, height: 20, borderRadius: 5, border: `2px solid ${opt.isChecked ? accent : '#cbd5e1'}`, background: opt.isChecked ? accent : '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                            {opt.isChecked && <span style={{ color: '#fff', fontSize: 12, fontWeight: 700, lineHeight: 1 }}>✓</span>}
                          </span>
                        </button>
                      ))}
                    </div>
                  </div>
                ))}
                <div style={{ padding: '16px 20px', borderTop: '1px solid #f1f5f9' }}>
                  <p style={{ ...sectionLabel, color: '#64748b', marginBottom: 8 }}>Special Instructions <span style={{ textTransform: 'none', fontWeight: 400, color: '#94a3b8' }}>(optional)</span></p>
                  <textarea value={modalInstructions} onChange={(e) => setModalInstructions(e.target.value)} maxLength={500} placeholder="E.g. no onions, sauce on the side, extra napkins…" style={{ width: '100%', height: 80, border: '1.5px solid #e2e8f0', borderRadius: 10, padding: 12, fontSize: 14, color: '#0f172a', resize: 'none', outline: 'none', background: '#f8fafc', lineHeight: 1.5 }} />
                </div>
                <div style={{ height: 16 }} />
              </div>

              <div style={{ padding: '12px 20px 20px', borderTop: '1px solid #f1f5f9', flexShrink: 0, background: '#fff' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, background: '#f1f5f9', borderRadius: 12, padding: 4 }}>
                    <button onClick={() => setModalQty((q) => Math.max(1, q - 1))} style={{ width: 38, height: 38, borderRadius: 9, border: 'none', background: '#fff', fontSize: 22, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#64748b', lineHeight: 1, boxShadow: '0 1px 3px rgba(0,0,0,0.1)' }}>−</button>
                    <span style={{ fontSize: 17, fontWeight: 700, color: '#0f172a', minWidth: 26, textAlign: 'center' }}>{modalQty}</span>
                    <button onClick={() => setModalQty((q) => Math.min(99, q + 1))} style={{ width: 38, height: 38, borderRadius: 9, border: 'none', background: accent, fontSize: 22, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', lineHeight: 1 }}>+</button>
                  </div>
                  <button onClick={modalAddToCart} disabled={modalMissingRequired} style={{ flex: 1, height: 50, background: accent, color: '#fff', border: 'none', borderRadius: 12, fontSize: 15, fontWeight: 700, cursor: modalMissingRequired ? 'not-allowed' : 'pointer', opacity: modalMissingRequired ? 0.5 : 1, whiteSpace: 'nowrap' }}>Add {modalQty} · {modalLineTotal}</button>
                </div>
              </div>
            </div>
          </>
        )}
      </div>
      <Footer />
    </>
  );
}

// ── Small presentational helpers ──────────────────────────────────────────────
const inputStyle = {
  width: '100%', height: 48, border: '1.5px solid #e2e8f0', borderRadius: 10,
  padding: '0 14px', fontSize: 14, color: '#0f172a', outline: 'none', background: '#f8fafc', marginBottom: 12,
};

function Radio({ on, accent }) {
  return (
    <span style={{ width: 18, height: 18, borderRadius: '50%', border: `2px solid ${on ? accent : '#cbd5e1'}`, background: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
      {on && <span style={{ width: 8, height: 8, borderRadius: '50%', background: accent }} />}
    </span>
  );
}

// ── Standalone item-modifier modal (shared with the in-store Kiosk page) ──────
// Kept as a named export for backwards compatibility. Self-contained styling
// (uses the .rp-sheet classes) and the original onAdd line contract:
//   { menuItemId, name, quantity, modifierIds, modifierNames, unitTotalCents, specialInstructions }
export function ItemModal({ item, currency = 'USD', onClose, onAdd, t }) {
  const tr = typeof t === 'function' ? t : (_k, o) => (o && o.defaultValue) || '';
  const [quantity, setQuantity] = useState(1);
  const [selected, setSelected] = useState({});
  const [instructions, setInstructions] = useState('');
  const accent = '#ff8c00';
  const accentBg = 'rgba(255,140,0,0.12)';

  const groups = item.modifierGroups || [];
  const toggle = (group, option) => {
    setSelected((prev) => {
      const radio = (group.maxSelect || group.max_select) === 1;
      const cur = new Set(prev[group.id] || []);
      if (cur.has(option.id)) { cur.delete(option.id); }
      else {
        if (radio) cur.clear();
        if (!radio && cur.size >= (group.maxSelect || group.max_select || 99)) return prev;
        cur.add(option.id);
      }
      return { ...prev, [group.id]: cur };
    });
  };

  const modifierIds = Object.values(selected).flatMap((s) => Array.from(s));
  const modifierTotal = groups.reduce((sum, g) => {
    const chosen = selected[g.id] || new Set();
    return sum + (g.options || []).filter((o) => chosen.has(o.id)).reduce((s, o) => s + (Number(o.priceDeltaCents) || 0), 0);
  }, 0);
  const unitTotalCents = (Number(item.price_cents) || 0) + modifierTotal;
  const lineTotal = unitTotalCents * quantity;
  const missingRequired = groups.some((g) => g.isRequired && (selected[g.id]?.size || 0) < Math.max(1, g.minSelect || g.min_select || 1));
  const label = { fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.07em', color: '#64748b', marginBottom: 10 };

  return (
    <>
      <div className="rp-sheet-backdrop" onClick={onClose} role="presentation" />
      <div className="rp-sheet" role="dialog" aria-modal="true" aria-label={item.name}>
        <div style={{ height: 170, background: item.image_url ? `center/cover url(${item.image_url})` : 'linear-gradient(135deg,#92400e,#d97706)', position: 'relative', flexShrink: 0 }}>
          <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(to bottom,transparent 40%,rgba(0,0,0,0.55) 100%)' }} />
          <button onClick={onClose} style={{ position: 'absolute', top: 14, right: 14, width: 36, height: 36, borderRadius: '50%', background: 'rgba(0,0,0,0.35)', color: '#fff', border: 'none', fontSize: 20, cursor: 'pointer', lineHeight: 1 }}>×</button>
          <div style={{ position: 'absolute', bottom: 14, left: 20, right: 20 }}>
            <h2 style={{ fontFamily: SERIF, fontSize: 22, fontWeight: 400, color: '#fff', marginBottom: 2 }}>{item.name}</h2>
            <span style={{ fontSize: 16, fontWeight: 700, color: '#fff' }}>{formatFoodMoney(item.price_cents, currency)}</span>
          </div>
        </div>
        <div style={{ flex: 1, overflowY: 'auto' }}>
          {item.description && (
            <div style={{ padding: '14px 20px 0' }}><p style={{ fontSize: 14, color: '#64748b', lineHeight: 1.55 }}>{item.description}</p></div>
          )}
          {groups.map((group) => (
            <div key={group.id} style={{ padding: '16px 20px', borderTop: '1px solid #f1f5f9' }}>
              <p style={label}>{group.name}{group.isRequired && <span style={{ color: accent, marginLeft: 6, textTransform: 'none', letterSpacing: 0 }}>Required</span>}</p>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
                {(group.options || []).filter((o) => o.isAvailable !== false).map((option) => {
                  const radio = (group.maxSelect || group.max_select) === 1;
                  const on = selected[group.id]?.has(option.id);
                  return (
                    <button key={option.id} onClick={() => toggle(group, option)} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '11px 14px', borderRadius: 10, border: `1.5px solid ${on ? accent : '#e2e8f0'}`, background: on ? accentBg : '#fff', cursor: 'pointer', textAlign: 'left', width: '100%' }}>
                      <span style={{ fontSize: 14, color: '#0f172a', fontWeight: on ? 600 : 400 }}>{option.name}{Number(option.priceDeltaCents) ? <span style={{ color: '#64748b', fontWeight: 400 }}> +{formatFoodMoney(option.priceDeltaCents, currency)}</span> : null}</span>
                      <span style={{ width: radio ? 18 : 20, height: radio ? 18 : 20, borderRadius: radio ? '50%' : 5, border: `2px solid ${on ? accent : '#cbd5e1'}`, background: on && !radio ? accent : '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                        {on && radio && <span style={{ width: 8, height: 8, borderRadius: '50%', background: accent }} />}
                        {on && !radio && <span style={{ color: '#fff', fontSize: 12, fontWeight: 700, lineHeight: 1 }}>✓</span>}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
          <div style={{ padding: '16px 20px', borderTop: '1px solid #f1f5f9' }}>
            <p style={label}>{tr('food.order.specialInstructions', { defaultValue: 'Special instructions' })} <span style={{ textTransform: 'none', fontWeight: 400, color: '#94a3b8' }}>(optional)</span></p>
            <textarea value={instructions} onChange={(e) => setInstructions(e.target.value)} maxLength={500} rows={2} placeholder="Allergies, substitutions…" style={{ width: '100%', minHeight: 70, border: '1.5px solid #e2e8f0', borderRadius: 10, padding: 12, fontSize: 14, color: '#0f172a', resize: 'none', outline: 'none', background: '#f8fafc', lineHeight: 1.5 }} />
          </div>
          <div style={{ height: 12 }} />
        </div>
        <div style={{ padding: '12px 20px 20px', borderTop: '1px solid #f1f5f9', flexShrink: 0, background: '#fff' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, background: '#f1f5f9', borderRadius: 12, padding: 4 }}>
              <button onClick={() => setQuantity((q) => Math.max(1, q - 1))} style={{ width: 38, height: 38, borderRadius: 9, border: 'none', background: '#fff', fontSize: 22, cursor: 'pointer', color: '#64748b', lineHeight: 1, boxShadow: '0 1px 3px rgba(0,0,0,0.1)' }}>−</button>
              <span style={{ fontSize: 17, fontWeight: 700, color: '#0f172a', minWidth: 26, textAlign: 'center' }}>{quantity}</span>
              <button onClick={() => setQuantity((q) => Math.min(99, q + 1))} style={{ width: 38, height: 38, borderRadius: 9, border: 'none', background: accent, fontSize: 22, cursor: 'pointer', color: '#fff', lineHeight: 1 }}>+</button>
            </div>
            <button
              type="button"
              disabled={missingRequired}
              onClick={() => onAdd({
                menuItemId: item.id,
                name: item.name,
                quantity,
                modifierIds,
                modifierNames: groups.flatMap((g) => (g.options || []).filter((o) => selected[g.id]?.has(o.id)).map((o) => o.name)),
                unitTotalCents,
                specialInstructions: instructions.trim() || undefined,
              })}
              style={{ flex: 1, height: 50, background: accent, color: '#fff', border: 'none', borderRadius: 12, fontSize: 15, fontWeight: 700, cursor: missingRequired ? 'not-allowed' : 'pointer', opacity: missingRequired ? 0.5 : 1, whiteSpace: 'nowrap' }}
            >
              {tr('food.order.addToOrder', { defaultValue: `Add · ${formatFoodMoney(lineTotal, currency)}`, total: formatFoodMoney(lineTotal, currency) })}
            </button>
          </div>
        </div>
      </div>
    </>
  );
}

function MapMini({ accent, accentFade, big }) {
  const h = big ? 148 : 100;
  const vb = big ? '0 0 360 148' : '0 0 280 100';
  return (
    <div style={{ width: '100%', height: h, borderRadius: big ? 10 : 8, overflow: 'hidden' }}>
      <svg width="100%" height={h} viewBox={vb} preserveAspectRatio="xMidYMid slice" xmlns="http://www.w3.org/2000/svg">
        <rect width={big ? 360 : 280} height={h} fill="#e2e8f0" />
        <rect x="0" y={big ? 66 : 44} width={big ? 360 : 280} height={big ? 16 : 12} fill="#d1dce8" />
        <rect x={big ? 152 : 116} y="0" width={big ? 56 : 48} height={h} fill="#d1dce8" />
        <circle cx={big ? 180 : 140} cy={big ? 74 : 50} r={big ? 18 : 14} fill={accentFade} />
        <circle cx={big ? 180 : 140} cy={big ? 74 : 50} r={big ? 7 : 6} fill={accent} />
        <circle cx={big ? 180 : 140} cy={big ? 74 : 50} r={big ? 3 : 2.5} fill="white" />
      </svg>
    </div>
  );
}
