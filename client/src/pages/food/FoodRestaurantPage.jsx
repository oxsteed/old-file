// Local Food Directory — public restaurant profile (v3 design comp).
// 1:1 port of the design prototype, wired to the live /food API and rendered
// inside the real site shell (Navbar + Footer). Per-restaurant accent theming,
// featured grid, item-modifier modal, and a full multi-step cart/checkout
// drawer (cart → details → payment → confirmed). Payment follows the backend
// restaurant contract: pay_at_restaurant by default, restaurant_credit when
// the signed-in customer holds an active wallet, and pay_now only when the
// restaurant payment flows now launch with restaurant credit, pay-at-restaurant,
// and direct payment proof capture.

import React, { useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import toast from 'react-hot-toast';
import { loadStripe } from '@stripe/stripe-js/pure';
import { CardElement, Elements, ExpressCheckoutElement, useElements, useStripe } from '@stripe/react-stripe-js';
import { useAuth } from '../../context/AuthContext';
import {
  createFoodCardPaymentIntent,
  createRestaurantTopupIntent,
  getFoodRestaurant,
  getMyFoodRestaurantWallet,
  getRestaurantTopup,
  getRestaurantTopupEligibility,
  issueRestaurantTopupStepupChallenge,
  placeFoodOrder,
  quoteFoodOrder,
  uploadFoodAsset,
  listFoodPromotions,
  listMyFoodOrders,
  sendFoodRestaurantMessage,
  formatFoodMoney,
} from '../../api/food';
import { parseCreditMajorAmount } from '../../lib/creditCurrency';
import { safeCreditErrorMessage } from '../../lib/creditErrors';
import { listSavedPaymentMethods } from '../../api/food';
import {
  getOxsteedCreditAccount,
  getOxsteedCreditEligibility,
  listOxsteedCreditEligiblePartners,
} from '../../api/oxsteedCredit';
import { useLiveFoodOrder } from './useLiveFoodOrder';
import { FOOD_STATUS_KEYS } from './foodShared';
import { notifyMoneyMoment } from '../../utils/pwaInstall';
import { notifyPushMoment } from '../../utils/pushPrompt';
import RestaurantMediaFeed from './components/RestaurantMediaFeed';
import { recordView } from '../../hooks/useRecentlyViewed';
import Navbar from '../../components/Navbar';
import Footer from '../../components/Footer';
import PageMeta from '../../components/PageMeta';
import { getPublicSiteUrl } from '../../utils/seoDescription';
import AddressAutocomplete from '../../components/AddressAutocomplete';
import { SuggestDropdown } from '../../components/SuggestDropdown';
import '../../styles/FoodRestaurantPage.css';

// Stripe for in-checkout card payments and credit top-ups. Same lazy pattern
// as the /restaurant-credit page: null when the publishable key is missing,
// so card surfaces stay hidden instead of crashing.
let stripePromise = null;
function getStripePromise() {
  if (stripePromise) return stripePromise;
  try {
    const key = import.meta.env?.VITE_STRIPE_PUBLISHABLE_KEY;
    stripePromise = key ? loadStripe(key) : null;
    return stripePromise;
  } catch {
    return null;
  }
}

// Quick-amount chips (major currency units) for the in-checkout credit sheet,
// mirroring the /restaurant-credit top-up modal.
const CREDIT_TOPUP_QUICK_AMOUNTS = [25, 50, 100, 250];
const CREDIT_TOPUP_MIN_CENTS = 500;
const CREDIT_TOPUP_MAX_CENTS = 50000;
const CREDIT_TOPUP_STEPUP_CENTS = 25000;
const CREDIT_TOPUP_POLL_INTERVAL_MS = 3000;
const CREDIT_TOPUP_POLL_MAX_ATTEMPTS = 40;

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

// Valid restaurant page tab keys (mirrors the tabs array in the component).
const RESTAURANT_TABS = ['menu', 'info', 'reviews', 'deals', 'media'];

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

const cap = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);

// ─── Main page component ─────────────────────────────────────────────────────
// Snapshot data is supplied only to renderToStaticMarkup: effects and handlers
// are never mounted for the admin customer-view snapshot.
export default function FoodRestaurantPage({ customerSnapshot = null, snapshotTab = 'menu', snapshotCategory = null } = {}) {
  const { restaurantId } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const { t, i18n } = useTranslation();
  const { user } = useAuth();

  // Data
  const [data, setData] = useState(customerSnapshot);
  const [loading, setLoading] = useState(!customerSnapshot);
  const [stripeClient, setStripeClient] = useState(null);
  useEffect(() => {
    if (!customerSnapshot) setStripeClient(getStripePromise());
  }, [customerSnapshot]);
  const [promotions, setPromotions] = useState([]);
  const [pastOrdersRaw, setPastOrdersRaw] = useState([]);

  // UI
  const [activeTab, setActiveTab] = useState(customerSnapshot && snapshotTab === 'info' ? 'info' : 'menu');
  const [activeCategory, setActiveCategory] = useState(customerSnapshot ? snapshotCategory : null);
  const [searchQuery, setSearchQuery] = useState('');
  const [dietaryFilter, setDietaryFilter] = useState('all');
  const [saved, setSaved] = useState(false);
  const [deliveryMode, setDeliveryMode] = useState('pickup');
  // Message-the-restaurant composer
  const [messageOpen, setMessageOpen] = useState(false);
  const [messageSubject, setMessageSubject] = useState('');
  const [messageBody, setMessageBody] = useState('');
  const [sendingMessage, setSendingMessage] = useState(false);
  // Media-tab dish deep link: item id the Media feed asked to jump to.
  const [highlightItemId, setHighlightItemId] = useState(null);
  const pendingMediaDish = useRef(null);

  // Cart / checkout
  const [cartItems, setCartItems] = useState([]);
  const [cartOpen, setCartOpen] = useState(false);
  const [cartStep, setCartStep] = useState('cart'); // cart | login | details | payment | confirmed
  const [addressLine1, setAddressLine1] = useState('');
  const [addressLine2, setAddressLine2] = useState('');
  const [promoCode, setPromoCode] = useState('');
  const [deliverySlot, setDeliverySlot] = useState('asap');
  const [tipPreset, setTipPreset] = useState('none'); // 'none' | 10 | 15 | 20 | 'custom'
  const [customTipText, setCustomTipText] = useState('');
  // Server-authoritative order quote (tax, service fee, delivery fee, tip,
  // discount). The checkout displays this total, not the client estimate.
  const [quote, setQuote] = useState(null);
  const [quoteLoading, setQuoteLoading] = useState(false);
  const [addressError, setAddressError] = useState('');
  const quoteRequestRef = useRef(0);
  const paymentFlipNoticeRef = useRef(null);
  const menuSectionRef = useRef(null);
  // Payment mode matches the backend restaurant payment contract:
  // pay_at_restaurant (default) | restaurant_credit (signed-in wallet holders).
  const [paymentMethod, setPaymentMethod] = useState('pay_at_restaurant');
  const [paymentReference, setPaymentReference] = useState('');
  const [paymentNote, setPaymentNote] = useState('');
  // CC2: order-level notes for the kitchen (allergies, extra sauce).
  const [kitchenNotes, setKitchenNotes] = useState('');
  // CC3: scheduled fulfillment for the 'later' time slot (ISO string).
  const [scheduledFor, setScheduledFor] = useState(null);
  const [scheduleDay, setScheduleDay] = useState('today'); // 'today' | 'tomorrow'
  const [scheduleTime, setScheduleTime] = useState(''); // 'HH:MM'
  // CC5: collapsible item recap on the payment step.
  const [itemsExpanded, setItemsExpanded] = useState(false);
  // CC6: optional pickup contact, prefilled from the user profile.
  const [pickupContactName, setPickupContactName] = useState('');
  const [pickupContactPhone, setPickupContactPhone] = useState('');
  // CC1: in-checkout restaurant-credit bottom sheet.
  const [creditSheetOpen, setCreditSheetOpen] = useState(false);
  // CC7: in-checkout card payment (Stripe Elements).
  const [cardError, setCardError] = useState('');
  const cardFormRef = useRef(null);
  const [paymentProof, setPaymentProof] = useState(null);
  const [proofMethod, setProofMethod] = useState('upload');
  const [proofUploading, setProofUploading] = useState(false);
  const [wallet, setWallet] = useState(null);
  const [oxsteedCreditAccount, setOxsteedCreditAccount] = useState(null);
  const [oxsteedCreditPartner, setOxsteedCreditPartner] = useState(null);
  const [oxsteedCreditEligibility, setOxsteedCreditEligibility] = useState(null);
  const [oxsteedCreditEligibilityLoading, setOxsteedCreditEligibilityLoading] = useState(false);
  const [placing, setPlacing] = useState(false);
  const [placedOrder, setPlacedOrder] = useState(null);
  const [placedTrackingToken, setPlacedTrackingToken] = useState(null);
  const orderIdempotencyRef = useRef({ key: null, fingerprint: null });
  // Recovered order from a previous visit (tracking token in localStorage).
  const [recoveredOrder, setRecoveredOrder] = useState(null);
  const [draftHydrated, setDraftHydrated] = useState(false);
  const [draftHasContent, setDraftHasContent] = useState(false);

  const restaurant = data?.restaurant;
  const currency = restaurant?.currency_code || 'USD';
  // Effects read readiness in their dependency arrays during the loading
  // render, so initialize it before registering those effects.
  const stripeChargesEnabled = Boolean(restaurant?.stripe_charges_enabled);
  const cardPaymentsReady = stripeChargesEnabled && Boolean(stripeClient);

  // Track this restaurant in the client-side "recently viewed" store so the
  // food home page can resume where the user left off.
  useEffect(() => {
    if (!restaurantId || !restaurant) return;
    recordView('restaurants', {
      id: restaurantId,
      title: restaurant.name || '',
      subtitle: '',
      image: restaurant.cover_photo_url || restaurant.logo_url || null,
      href: `/restaurants/r/${restaurantId}`,
    });
  }, [restaurantId, restaurant]);
  const creditCurrency = String(currency).toUpperCase();
  const oxsteedCreditOrderType = deliveryMode === 'delivery' ? 'delivery' : 'pickup';

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

  // Media-tab dish deep link: after the Media feed asks to jump to a dish,
  // switch to the Menu tab, then scroll to the item, flash a highlight, and
  // open the existing item modal (the buy/add-to-cart affordance). Clears
  // filters so the item is guaranteed visible.
  // NOTE: allItemsFlat/openModal are defined below in the render body; the
  // closure reads them when the effect runs, after render, which is safe.
  useEffect(() => {
    if (activeTab !== 'menu' || !pendingMediaDish.current) return;
    const id = pendingMediaDish.current;
    pendingMediaDish.current = null;
    const timer = setTimeout(() => {
      const el = document.getElementById(`menu-item-${id}`);
      if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      setHighlightItemId(id);
      const found = allItemsFlat.find((it) => String(it.id) === String(id));
      if (found && found.canOrder) openModal(found);
      setTimeout(() => setHighlightItemId((cur) => (cur === id ? null : cur)), 2600);
    }, 150);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab]);

  // N1 — Escape closes the topmost open sheet (dish modal, then message
  // composer, then cart), mirroring each sheet's own close affordance.
  useEffect(() => {
    const onKeyDown = (e) => {
      if (e.key !== 'Escape') return;
      if (modalItem) { setModalItem(null); return; }
      if (messageOpen) { if (!sendingMessage) setMessageOpen(false); return; }
      if (cartOpen) { setCartOpen(false); setCartStep('cart'); }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [modalItem, messageOpen, sendingMessage, cartOpen]);

  // N2 — Deep links: shared links carry the active tab and the open dish as
  // ?tab= and ?dish= query params. The URL is the source of truth on a fresh
  // visit (mount / restaurant switch); afterwards state is synced back into
  // the URL with replace (no history spam). The share button copies
  // window.location.href, so it automatically carries both params.
  const pendingUrlDish = useRef(null);
  // Read ?tab= / ?dish= on mount (and on restaurant switch).
  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const tab = params.get('tab');
    if (RESTAURANT_TABS.includes(tab) && tab !== 'menu') setActiveTab(tab);
    const dish = params.get('dish');
    pendingUrlDish.current = dish || null;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [restaurantId]);
  // Open the ?dish= dish once the menu data is available.
  // NOTE: allItemsFlat/openModal are defined below in the render body; the
  // closure reads them when the effect runs, after render, which is safe.
  useEffect(() => {
    if (!pendingUrlDish.current || !data || !allItemsFlat.length) return;
    const id = pendingUrlDish.current;
    pendingUrlDish.current = null;
    const found = allItemsFlat.find((it) => String(it.id) === String(id));
    if (found && found.canOrder) openModal(found);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, activeTab]);
  // Sync the active tab and the open dish back into the URL.
  useEffect(() => {
    const params = new URLSearchParams(location.search);
    params.set('tab', activeTab);
    if (modalItem) params.set('dish', String(modalItem.id));
    else params.delete('dish');
    if (params.toString() !== new URLSearchParams(location.search).toString()) {
      navigate(`${location.pathname}?${params.toString()}`, { replace: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab, modalItem]);

  // RB1 — One-tap reorder from the orders page: location.state carries the
  // past order. Rebuild the cart from the current menu once it is loaded,
  // then clear the state so back-nav/refresh does not re-trigger.
  // NOTE: reorder/allItemsFlat are defined below in the render body; the
  // closure reads them when the effect runs, after render, which is safe.
  const reorderHandledRef = useRef(false);
  useEffect(() => {
    const ro = location.state?.reorderOrder;
    if (!ro || reorderHandledRef.current || !data || !allItemsFlat.length) return;
    reorderHandledRef.current = true;
    navigate(`${location.pathname}${location.search}`, { replace: true, state: {} });
    reorder({ items: ro.items || [] });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, location.state]);

  const jumpToMenuItem = (menuItemId) => {
    const found = allItemsFlat.find((it) => String(it.id) === String(menuItemId));
    if (!found) {
      toast.error(t('food.restaurant.media.dishGone'));
      return;
    }
    pendingMediaDish.current = String(menuItemId);
    setActiveCategory(String(found.sectionId));
    setSearchQuery('');
    setDietaryFilter('all');
    setActiveTab('menu');
  };

  // Restaurant-credit wallet (signed-in customers only). When present and
  // active, "Restaurant credit" appears as a real payment option.
  useEffect(() => {
    if (!user || !restaurantId) { setWallet(null); return; }
    getMyFoodRestaurantWallet(restaurantId)
      .then((w) => setWallet(w && w.status === 'active' ? w : null))
      .catch(() => setWallet(null));
  }, [user, restaurantId]);

  useEffect(() => {
    if (!user || !restaurantId) {
      setOxsteedCreditAccount(null);
      setOxsteedCreditPartner(null);
      setOxsteedCreditEligibility(null);
      return undefined;
    }
    if (!restaurant || String(restaurant.id) !== String(restaurantId)) {
      setOxsteedCreditAccount(null);
      setOxsteedCreditPartner(null);
      setOxsteedCreditEligibility(null);
      return undefined;
    }
    let alive = true;
    getOxsteedCreditAccount({ currencyCode: creditCurrency }).catch(() => null).then((account) => {
      if (!alive) return null;
      setOxsteedCreditAccount(account?.status === 'active' ? account : null);
      return listOxsteedCreditEligiblePartners({
        currencyCode: creditCurrency,
        city: restaurant.address_city,
        state: restaurant.address_state,
        postalCode: restaurant.address_zip,
        country: restaurant.address_country,
        orderType: oxsteedCreditOrderType,
      }).catch(() => []);
    }).then((partners) => {
      if (!alive) return;
      setOxsteedCreditPartner(
        (Array.isArray(partners) ? partners : []).find((partner) => String(partner.restaurantId) === String(restaurantId)) || null
      );
    });
    return () => { alive = false; };
  }, [user, restaurantId, restaurant?.id, restaurant?.currency_code, restaurant?.address_city, restaurant?.address_state, restaurant?.address_zip, restaurant?.address_country, creditCurrency, oxsteedCreditOrderType]);

  // Never leave restaurant_credit selected if the wallet disappears (sign-out,
  // wallet suspended, or restaurant switch).
  useEffect(() => {
    if (paymentMethod === 'restaurant_credit' && !wallet) {
      setPaymentMethod('pay_at_restaurant');
    }
    if (paymentMethod === 'oxsteed_credit' && !oxsteedCreditAccount) {
      setPaymentMethod('pay_at_restaurant');
    }
    if (paymentMethod === 'card' && !cardPaymentsReady) {
      setPaymentMethod('pay_at_restaurant');
    }
  }, [paymentMethod, wallet, oxsteedCreditAccount, cardPaymentsReady]);

  // CC6: prefill the pickup contact from the user profile where available.
  // Only fills empty fields so the customer's own edits are never clobbered.
  useEffect(() => {
    if (!user) return;
    const profileName = [user.first_name, user.last_name].filter(Boolean).join(' ').trim();
    if (profileName) setPickupContactName((cur) => cur || profileName);
    if (user.phone) setPickupContactPhone((cur) => cur || String(user.phone));
  }, [user]);

  // CC3: time options for the 'Schedule for later' slot. Constrained to the
  // restaurant's operating hours when parseable; otherwise falls back to
  // 15-minute increments covering the next 6 hours.
  const scheduleOptions = useMemo(() => {
    if (deliverySlot !== 'later') return [];
    const parseHm = (value) => {
      const m = String(value || '').trim().match(/^(\d{1,2}):(\d{2})$/);
      if (!m) return null;
      const h = Number(m[1]);
      const min = Number(m[2]);
      if (h > 23 || min > 59) return null;
      return { h, min };
    };
    const fmtLabel = (h, min) => {
      const d = new Date();
      d.setHours(h, min, 0, 0);
      return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
    };
    const weekly = restaurant?.operating_hours && typeof restaurant.operating_hours === 'object'
      ? (restaurant.operating_hours.weekly || restaurant.operating_hours)
      : null;
    const dayKeys = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
    const target = new Date();
    if (scheduleDay === 'tomorrow') target.setDate(target.getDate() + 1);
    const dayKey = dayKeys[target.getDay()];
    let openHm = null;
    let closeHm = null;
    const entry = weekly?.[dayKey];
    if (entry && typeof entry === 'object' && !Array.isArray(entry) && !entry.closed) {
      openHm = parseHm(entry.open);
      closeHm = parseHm(entry.close);
    } else if (typeof entry === 'string') {
      const m = entry.match(/(\d{1,2}:\d{2}).*?(\d{1,2}:\d{2})/);
      if (m) {
        openHm = parseHm(m[1]);
        closeHm = parseHm(m[2]);
      }
    }
    const options = [];
    if (openHm && closeHm) {
      const startMin = openHm.h * 60 + openHm.min;
      const endMin = closeHm.h * 60 + closeHm.min;
      const nowMin = scheduleDay === 'today'
        ? new Date().getHours() * 60 + new Date().getMinutes() + 15
        : -1;
      for (let mins = startMin; mins < endMin; mins += 15) {
        if (mins < nowMin) continue;
        const h = Math.floor(mins / 60);
        const min = mins % 60;
        const value = `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`;
        options.push({ value, label: fmtLabel(h, min) });
      }
    } else {
      // Fallback: 15-minute increments for the next 6 hours.
      const base = new Date(Date.now() + 15 * 60 * 1000);
      base.setMinutes(Math.ceil(base.getMinutes() / 15) * 15, 0, 0);
      for (let i = 0; i < 24; i += 1) {
        const slot = new Date(base.getTime() + i * 15 * 60 * 1000);
        const value = `${String(slot.getHours()).padStart(2, '0')}:${String(slot.getMinutes()).padStart(2, '0')}`;
        options.push({ value, label: slot.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) });
      }
    }
    return options;
  }, [deliverySlot, scheduleDay, restaurant]);

  // Keep the selected time valid when the day or slot changes; default to the
  // earliest available option so 'later' is never a dead choice.
  useEffect(() => {
    if (deliverySlot !== 'later') return;
    if (scheduleTime && scheduleOptions.some((o) => o.value === scheduleTime)) return;
    setScheduleTime(scheduleOptions[0]?.value || '');
  }, [deliverySlot, scheduleDay, scheduleOptions, scheduleTime]);

  // Sync the ISO scheduledFor sent in the order payload.
  useEffect(() => {
    if (deliverySlot !== 'later' || !scheduleTime) {
      setScheduledFor(null);
      return;
    }
    const [h, m] = scheduleTime.split(':').map(Number);
    if (!Number.isFinite(h) || !Number.isFinite(m)) {
      setScheduledFor(null);
      return;
    }
    const d = new Date();
    if (scheduleDay === 'tomorrow') d.setDate(d.getDate() + 1);
    d.setHours(h, m, 0, 0);
    setScheduledFor(d.toISOString());
  }, [deliverySlot, scheduleDay, scheduleTime]);

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
      setTipPreset('none');
      setCustomTipText('');
      setPaymentMethod('pay_at_restaurant');
      setPaymentReference('');
      setPaymentNote('');
      setKitchenNotes('');
      setScheduledFor(null);
      setScheduleDay('today');
      setScheduleTime('');
      setPickupContactName('');
      setPickupContactPhone('');
      setPaymentProof(null);
      setProofMethod('upload');
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
      || Boolean(draft.kitchenNotes)
      || Boolean(draft.scheduledFor)
      || Boolean(draft.pickupContactName)
      || Boolean(draft.pickupContactPhone)
      || Boolean(draft.paymentProof)
    );
    setCartItems(savedCartItems);
    setCartOpen(savedCartItems.length > 0 || Boolean(draft.cartOpen));
    setCartStep(savedCartItems.length > 0 || savedStep !== 'cart' ? savedStep : 'cart');
    setAddressLine1(String(draft.addressLine1 || ''));
    setAddressLine2(String(draft.addressLine2 || ''));
    setPromoCode(String(draft.promoCode || ''));
    setDeliverySlot(draft.deliverySlot || 'asap');
    setTipPreset(draft.tipPreset === 'custom' || [10, 15, 20].includes(Number(draft.tipPreset)) ? draft.tipPreset : 'none');
    setCustomTipText(String(draft.customTipText || ''));
    setPaymentMethod(draft.paymentMethod || 'pay_at_restaurant');
    setPaymentReference(String(draft.paymentReference || ''));
    setPaymentNote(String(draft.paymentNote || ''));
    setKitchenNotes(String(draft.kitchenNotes || ''));
    setScheduledFor(draft.scheduledFor || null);
    setScheduleDay(draft.scheduleDay === 'tomorrow' ? 'tomorrow' : 'today');
    setScheduleTime(String(draft.scheduleTime || ''));
    setPickupContactName(String(draft.pickupContactName || ''));
    setPickupContactPhone(String(draft.pickupContactPhone || ''));
    setPaymentProof(draft.paymentProof && typeof draft.paymentProof === 'object' ? draft.paymentProof : null);
    setProofMethod(draft.proofMethod === 'reference' ? 'reference' : (draft.paymentReference ? 'reference' : 'upload'));
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
      || tipPreset !== 'none'
      || customTipText.trim().length > 0
      || paymentMethod !== 'pay_at_restaurant'
      || paymentReference.trim().length > 0
      || paymentNote.trim().length > 0
      || kitchenNotes.trim().length > 0
      || Boolean(scheduledFor)
      || pickupContactName.trim().length > 0
      || pickupContactPhone.trim().length > 0
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
      tipPreset,
      customTipText,
      paymentMethod,
      paymentReference,
      paymentNote,
      kitchenNotes,
      scheduledFor,
      scheduleDay,
      scheduleTime,
      pickupContactName,
      pickupContactPhone,
      paymentProof,
      proofMethod,
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
    tipPreset,
    customTipText,
    paymentMethod,
    paymentReference,
    paymentNote,
    kitchenNotes,
    scheduledFor,
    pickupContactName,
    pickupContactPhone,
    paymentProof,
    proofMethod,
    deliveryMode,
  ]);

  // ── Cart math ─────────────────────────────────────────────────────────────
  const settings = (restaurant?.settings && typeof restaurant.settings === 'object') ? restaurant.settings : {};
  const supportsDelivery = Array.isArray(restaurant?.fulfillment_modes) && restaurant.fulfillment_modes.includes('delivery');
  const deliveryFeeCents = Number(settings.deliveryFeeCents ?? settings.delivery_fee_cents ?? 0) || 0;
  const minimumOrderCents = Number(restaurant?.minimum_order_cents ?? settings.minimumOrderCents ?? settings.minimum_order_cents ?? 0) || 0;
  const externalPaymentEnabled = Boolean(settings.externalPaymentEnabled ?? settings.external_payment_enabled ?? false);
  const requireExternalPaymentProof = Boolean(settings.requireExternalPaymentProof ?? settings.require_external_payment_proof ?? false);
  const defaultExternalPaymentLabel = t('food.restaurant.paymentApp');
  const externalPaymentLabel = String(settings.externalPaymentLabel ?? settings.external_payment_label ?? defaultExternalPaymentLabel).trim() || defaultExternalPaymentLabel;
  const externalPaymentHandle = String(settings.externalPaymentHandle ?? settings.external_payment_handle ?? '').trim();
  const externalPaymentInstructions = String(settings.externalPaymentInstructions ?? settings.external_payment_instructions ?? '').trim();
  const externalPaymentReferenceHint = String(settings.externalPaymentReferenceHint ?? settings.external_payment_reference_hint ?? t('food.restaurant.paymentReferenceHint')).trim();
  const externalPaymentQrUrl = String(settings.externalPaymentQrUrl ?? settings.external_payment_qr_url ?? '').trim();
  const oxsteedPayUrl = String(restaurant?.oxsteed_pay_url ?? '').trim();

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
  // Tip: preset percentages apply to the client subtotal; custom is a typed amount.
  const tipCents = useMemo(() => {
    if (tipPreset === 'custom') {
      const parsed = Number.parseFloat(String(customTipText).replace(/[^0-9.]/g, ''));
      if (!Number.isFinite(parsed) || parsed < 0) return 0;
      return Math.min(Math.round(parsed * 100), 5000000);
    }
    const pct = Number(tipPreset);
    if (Number.isFinite(pct) && pct > 0) return Math.round(subtotalCents * pct / 100);
    return 0;
  }, [tipPreset, customTipText, subtotalCents]);
  // Canonical restaurant payment contract mode (card checkout is pay_now).
  const apiPaymentMode = paymentMethod === 'restaurant_credit'
    ? 'restaurant_credit'
    : paymentMethod === 'oxsteed_credit'
      ? 'oxsteed_credit'
      : paymentMethod === 'card'
        ? 'card'
        : paymentMethod === 'direct_payment'
          ? 'direct_payment'
          : 'pay_at_restaurant';
  const orderItemsPayload = useMemo(
    () => cartItems.map((line) => ({
      menuItemId: line.menuItemId,
      quantity: line.qty,
      modifierIds: line.modifierIds,
      specialInstructions: line.notes || undefined,
    })),
    [cartItems]
  );
  // Authoritative total from the server quote when available; the client
  // estimate is only a fallback (it omits tax and service fees).
  const displayTotalCents = quote && Number.isFinite(Number(quote.totalCents))
    ? Number(quote.totalCents)
    : orderTotalCents;
  const checkoutRequiresLogin = !user;
  const externalPaymentHasSubmission = Boolean(paymentProof?.url || paymentReference.trim());

  const oxsteedCreditCategories = useMemo(
    () => [...new Set(cartItems.map((item) => item.creditCategory).filter(Boolean))],
    [cartItems]
  );
  const oxsteedCreditMenuItemIds = useMemo(
    () => [...new Set(cartItems.map((item) => item.menuItemId).filter(Boolean).map(String))],
    [cartItems]
  );

  useEffect(() => {
    if (!user || !restaurantId || !oxsteedCreditAccount || !oxsteedCreditPartner || cartItems.length === 0) {
      setOxsteedCreditEligibility(null);
      setOxsteedCreditEligibilityLoading(false);
      return undefined;
    }
    let alive = true;
    setOxsteedCreditEligibilityLoading(true);
    getOxsteedCreditEligibility({
      restaurantId,
      amountCents: displayTotalCents,
      currencyCode: oxsteedCreditAccount.currencyCode || creditCurrency,
      orderType: oxsteedCreditOrderType,
      categories: oxsteedCreditCategories.join(','),
      menuItemIds: oxsteedCreditMenuItemIds.join(','),
    })
      .then((result) => { if (alive) setOxsteedCreditEligibility(result); })
      .catch(() => { if (alive) setOxsteedCreditEligibility({ eligible: false, reasonCode: 'credit_eligibility_unavailable', message: 'Credit eligibility could not be checked' }); })
      .finally(() => { if (alive) setOxsteedCreditEligibilityLoading(false); });
    return () => { alive = false; };
  }, [user, restaurantId, oxsteedCreditAccount, oxsteedCreditPartner, cartItems.length, displayTotalCents, creditCurrency, oxsteedCreditOrderType, oxsteedCreditCategories, oxsteedCreditMenuItemIds]);

  // ── Authoritative order quote ─────────────────────────────────────────
  // The server re-prices every order from the DB (tax, service fee, tip,
  // delivery fee, validated discounts), so checkout displays the server
  // quote total instead of the client estimate. Re-quotes (debounced) when
  // the cart, tip, promo, fulfillment mode, address, or payment mode changes.
  useEffect(() => {
    if (!cartOpen || cartItems.length === 0 || !restaurantId || cartStep === 'confirmed') {
      setQuote(null);
      setQuoteLoading(false);
      return undefined;
    }
    const fulfillmentType = deliveryMode === 'delivery' ? 'delivery' : 'pickup';
    // The quote endpoint requires a delivery address for delivery quotes, so
    // wait until the customer types one instead of quoting against an error.
    if (fulfillmentType === 'delivery' && !addressLine1.trim()) {
      setQuote(null);
      setQuoteLoading(false);
      return undefined;
    }
    setQuoteLoading(true);
    const requestId = (quoteRequestRef.current || 0) + 1;
    quoteRequestRef.current = requestId;
    const timer = setTimeout(async () => {
      try {
        const payload = {
          orderSource: 'web',
          fulfillmentType,
          paymentMode: apiPaymentMode,
          tipCents,
          items: orderItemsPayload,
        };
        if (promoCode.trim()) {
          payload.discountCode = promoCode.trim();
        }
        if (fulfillmentType === 'delivery') {
          payload.deliveryAddress = {
            line1: addressLine1.trim(),
            line2: addressLine2.trim() || undefined,
            city: restaurant?.address_city || undefined,
            state: restaurant?.address_state || undefined,
            country: restaurant?.address_country || undefined,
          };
        }
        const nextQuote = await quoteFoodOrder(restaurantId, payload);
        if (quoteRequestRef.current === requestId) setQuote(nextQuote);
      } catch {
        if (quoteRequestRef.current === requestId) setQuote(null);
      } finally {
        if (quoteRequestRef.current === requestId) setQuoteLoading(false);
      }
    }, 450);
    return () => clearTimeout(timer);
  }, [cartOpen, cartItems.length, restaurantId, cartStep, deliveryMode, addressLine1, addressLine2, apiPaymentMode, tipCents, promoCode, orderItemsPayload, restaurant]);

  const openLoginGate = () => {
    navigate('/login', { state: { from: location } });
  };

  // ── Message the restaurant ─────────────────────────────────────────────────
  // Signed-out visitors go through the same login gate the checkout uses; the
  // backend endpoint requires authentication. Signed-in customers get a
  // composer; sending creates (or reuses) one conversation thread per
  // customer + restaurant and the message waits in the restaurant's inbox.
  const handleMessageClick = () => {
    if (!user) {
      openLoginGate();
      return;
    }
    setMessageSubject('');
    setMessageBody('');
    setMessageOpen(true);
  };

  const handleSendMessage = async () => {
    if (sendingMessage) return;
    const body = messageBody.trim();
    if (!body) {
      toast.error(t('food.restaurant.messageRequired'));
      return;
    }
    setSendingMessage(true);
    try {
      // Fresh idempotency key per composer submit: double-submits replay the
      // same record instead of posting twice; the server still reuses the one
      // conversation thread for this customer + restaurant.
      const clientMessageId = typeof crypto !== 'undefined' && crypto.randomUUID
        ? crypto.randomUUID()
        : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
            const r = (Math.random() * 16) | 0;
            return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
          });
      const result = await sendFoodRestaurantMessage(
        restaurantId,
        { subject: messageSubject.trim(), message: body },
        { clientMessageId },
      );
      setMessageOpen(false);
      setMessageSubject('');
      setMessageBody('');
      if (result?.conversationId) {
        navigate(`/messages/${result.conversationId}`);
      } else {
        toast.success(t('food.restaurant.messageSent'));
      }
    } catch (err) {
      const status = err?.response?.status;
      if (status === 429) {
        toast.error(err?.response?.data?.error || t('food.restaurant.messageRateLimited'));
      } else {
        toast.error(err?.response?.data?.error?.message || t('food.restaurant.messageError'));
      }
    } finally {
      setSendingMessage(false);
    }
  };

  // "Start order" with an empty cart is a no-op today; scroll to the menu so
  // the button does something useful instead.
  const handleStartOrder = () => {
    if (hasCart) {
      setCartOpen(true);
      return;
    }
    setActiveTab('menu');
    requestAnimationFrame(() => {
      menuSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
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
      toast.success(t('food.restaurant.receiptUploaded'));
    } catch (err) {
      toast.error(err?.response?.data?.error?.message || t('food.restaurant.proofUploadError'));
    } finally {
      setProofUploading(false);
      event.target.value = '';
    }
  };

  // ── Place the real order ────────────────────────────────────────────────
  // Shared post-payment order placement. Both the CardElement flow and the
  // Express Checkout flow confirm the Stripe PaymentIntent first, then land
  // here with the succeeded intent id. The server re-verifies the intent
  // (402 otherwise), so no order is ever placed on a failed payment.
  const placeOrderAfterPayment = async (stripePaymentIntentId, { fulfillmentType, paymentMode, externalPaymentSubmission }) => {
        const payload = {
          orderSource: 'web',
          fulfillmentType,
          // Canonical restaurant payment contract mode (card checkout is pay_now).
          paymentMode,
          // CC4: promo codes are validated server-side for every payment mode.
          discountCode: promoCode.trim() ? promoCode.trim() : undefined,
          items: orderItemsPayload,
          // The server re-prices everything; send the customer-chosen tip and
          // time slot so the debited total matches the quoted total.
          tipCents: tipCents > 0 ? tipCents : undefined,
          deliverySlot,
          // CC3: the chosen fulfillment time for 'later' slots.
          scheduledFor: deliverySlot === 'later' && scheduledFor ? scheduledFor : undefined,
          // CC2: order-level notes for the kitchen. paymentNote stays as-is
          // for payment matching.
          kitchenNotes: kitchenNotes.trim() || undefined,
          // CC6: optional pickup contact for pickup orders.
          ...(fulfillmentType === 'pickup' ? {
            pickupContactName: pickupContactName.trim() || undefined,
            pickupContactPhone: pickupContactPhone.trim() || undefined,
          } : {}),
          // CC7: the confirmed Stripe PaymentIntent for card orders.
          ...(paymentMethod === 'card' && stripePaymentIntentId ? { stripePaymentIntentId } : {}),
          ...(paymentMode === 'direct_payment' ? {
            externalPayment: externalPaymentSubmission,
            metadata: {
              externalPayment: externalPaymentSubmission,
            },
          } : {}),
        };
        if (fulfillmentType === 'delivery') {
          payload.deliveryAddress = {
            line1: addressLine1.trim(),
            line2: addressLine2.trim() || undefined,
            city: restaurant.address_city || undefined,
            state: restaurant.address_state || undefined,
            country: restaurant.address_country || undefined,
          };
        }
        const requestFingerprint = JSON.stringify(payload);
        const previousRequest = orderIdempotencyRef.current;
        const idempotencyKey = previousRequest.fingerprint === requestFingerprint && previousRequest.key
          ? previousRequest.key
          : (globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`);
        orderIdempotencyRef.current = { key: idempotencyKey, fingerprint: requestFingerprint };
        payload.clientOrderId = idempotencyKey;
        const { order, trackingToken, payment } = await placeFoodOrder(
          restaurantId,
          payload,
          { idempotencyKey }
        );
        orderIdempotencyRef.current = { key: null, fingerprint: null };
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
        // Value moments, sequenced: install prompt first, push soft-ask only
        // when the install UI did not show (never stack two prompts).
        const installShown = notifyMoneyMoment('food_order');
        if (!installShown) notifyPushMoment('food_order', { installEligible: false });
        setCartItems([]);
        setTipPreset('none');
        setCustomTipText('');
        setQuote(null);
        setPaymentReference('');
        setPaymentNote('');
        setKitchenNotes('');
        setScheduledFor(null);
        setScheduleDay('today');
        setScheduleTime('');
        setItemsExpanded(false);
        setCardError('');
        const profileName = user ? [user.first_name, user.last_name].filter(Boolean).join(' ').trim() : '';
        setPickupContactName(profileName);
        setPickupContactPhone(user?.phone ? String(user.phone) : '');
        setPaymentProof(null);
        setProofMethod('upload');
        if (payment?.mode === 'hosted_checkout' && payment?.checkoutUrl) {
          window.location.assign(payment.checkoutUrl);
          return;
        }
  };

  // Mint a Stripe PaymentIntent for the current card total. Shared by the
  // CardElement flow and the Express Checkout flow.
  const createCardIntent = async () => {
    const intentIdempotencyKey = globalThis.crypto?.randomUUID?.()
      || `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const intent = await createFoodCardPaymentIntent({
      restaurantId,
      amountCents: displayTotalCents,
      currency,
      idempotencyKey: intentIdempotencyKey,
    }, intentIdempotencyKey);
    if (!intent?.clientSecret) {
      throw new Error('missing_client_secret');
    }
    return intent;
  };

  const submitOrder = async () => {
    if (cartItems.length === 0) return;
    if (subtotalCents < minimumOrderCents && minimumOrderCents > 0) {
      toast.error(t('food.restaurant.minimumOrderNotMet', { price: formatFoodMoney(minimumOrderCents, currency) }));
      return;
    }
    const fulfillmentType = deliveryMode === 'delivery' ? 'delivery' : 'pickup';
    const paymentMode = apiPaymentMode;
    const externalPaymentSubmission = paymentMode === 'direct_payment'
      ? {
        method: externalPaymentLabel || 'external_payment',
        label: externalPaymentLabel || defaultExternalPaymentLabel,
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
      paymentProof?.url || paymentReference.trim()
    )) {
      toast.error(t('food.restaurant.proofRequiredError'));
      return;
    }
    setPlacing(true);
    try {
      // CC7: card payments confirm the Stripe PaymentIntent before the order
      // is placed. Any failure shows an inline error and the order is NOT
      // placed.
      let stripePaymentIntentId = null;
      if (paymentMethod === 'card') {
        setCardError('');
        if (!cardFormRef.current) {
          setCardError(t('food.restaurant.cardIntentError'));
          return;
        }
        let intent = null;
        try {
          intent = await createCardIntent();
        } catch (intentErr) {
          setCardError(
            intentErr?.response?.data?.error?.message
            || intentErr?.response?.data?.message
            || intentErr?.message
            || t('food.restaurant.cardIntentError')
          );
          return;
        }
        const { error, paymentIntent } = await cardFormRef.current.confirmCardPayment(intent.clientSecret);
        if (error) {
          setCardError(error.message || t('food.restaurant.cardPaymentFailed'));
          return;
        }
        // The server only accepts a succeeded intent (402 otherwise), so the
        // order is placed exclusively on succeeded; anything else is an
        // inline error with no order placed.
        if (!paymentIntent || paymentIntent.status !== 'succeeded') {
          setCardError(t('food.restaurant.cardPaymentFailed'));
          return;
        }
        stripePaymentIntentId = paymentIntent.id;
      }
      await placeOrderAfterPayment(stripePaymentIntentId, { fulfillmentType, paymentMode, externalPaymentSubmission });
    } catch (err) {
      const message = err?.response?.data?.error?.message || err?.response?.data?.message;
      toast.error(typeof message === 'string' ? message : t('food.order.placeError'));
    } finally {
      setPlacing(false);
    }
  };

  // Express Checkout (Apple Pay / Google Pay / Link) entry point. Runs the
  // same validation as submitOrder, mints the intent, confirms with the
  // express payment method, then shares placeOrderAfterPayment. Only offered
  // for card payments; the server re-verifies the intent (402 otherwise).
  const handleExpressConfirm = async () => {
    if (cartItems.length === 0) return;
    if (subtotalCents < minimumOrderCents && minimumOrderCents > 0) {
      toast.error(t('food.restaurant.minimumOrderNotMet', { price: formatFoodMoney(minimumOrderCents, currency) }));
      return;
    }
    const instances = cardFormRef.current?.getStripeInstances?.();
    if (!instances?.stripe || !instances?.elements) {
      setCardError(t('food.restaurant.cardIntentError'));
      return;
    }
    setPlacing(true);
    setCardError('');
    try {
      const intent = await createCardIntent();
      const { error, paymentIntent } = await instances.stripe.confirmPayment({
        elements: instances.elements,
        clientSecret: intent.clientSecret,
        confirmParams: { return_url: window.location.href },
        redirect: 'if_required',
      });
      if (error) {
        setCardError(error.message || t('food.restaurant.cardPaymentFailed'));
        return;
      }
      if (!paymentIntent || paymentIntent.status !== 'succeeded') {
        setCardError(t('food.restaurant.cardPaymentFailed'));
        return;
      }
      await placeOrderAfterPayment(paymentIntent.id, {
        fulfillmentType: deliveryMode === 'delivery' ? 'delivery' : 'pickup',
        paymentMode: apiPaymentMode,
        externalPaymentSubmission: null,
      });
    } catch (err) {
      setCardError(
        err?.response?.data?.error?.message
        || err?.response?.data?.message
        || err?.message
        || t('food.restaurant.cardIntentError')
      );
    } finally {
      setPlacing(false);
    }
  };

  // Payment options mirror the launch contract. OxSteed Credit is a separate
  // signed-in stored-value rail and still requires server-side partner checks.
  // CC7: in-checkout card payments ride Stripe Elements against the
  // restaurant's connected account; the server exposes stripe_charges_enabled.
  const walletBalanceCents = Number(wallet?.balanceCents || 0);
  const walletReservedCents = Number(wallet?.reservedCents || 0);
  const walletAvailableCents = Number(
    wallet?.availableBalanceCents ?? Math.max(0, walletBalanceCents - walletReservedCents)
  );
  const walletCoversOrder = walletAvailableCents >= displayTotalCents;
  const oxsteedCreditBalanceCents = Number(oxsteedCreditAccount?.balanceCents || 0);
  const oxsteedCreditReservedCents = Number(oxsteedCreditAccount?.reservedCents || 0);
  const oxsteedCreditAvailableCents = Number(
    oxsteedCreditAccount?.availableBalanceCents
      ?? Math.max(0, oxsteedCreditBalanceCents - oxsteedCreditReservedCents)
  );
  const oxsteedCreditCoversOrder = oxsteedCreditAvailableCents >= displayTotalCents;
  const oxsteedCreditMaxTransactionCents = oxsteedCreditPartner?.maxTransactionCents == null
    ? null
    : Number(oxsteedCreditPartner.maxTransactionCents);
  const oxsteedCreditExceedsTransactionLimit = Number.isFinite(oxsteedCreditMaxTransactionCents)
    && displayTotalCents > oxsteedCreditMaxTransactionCents;
  const oxsteedCreditPaymentIssue = oxsteedCreditEligibilityLoading
    ? 'Checking eligibility...'
    : oxsteedCreditEligibility && !oxsteedCreditEligibility.eligible
      ? (oxsteedCreditEligibility.message || 'Not eligible for this order')
      : oxsteedCreditExceedsTransactionLimit
    ? `Restaurant limit ${formatFoodMoney(oxsteedCreditMaxTransactionCents, oxsteedCreditAccount?.currencyCode || currency)}`
    : !oxsteedCreditCoversOrder
      ? `Insufficient credit · ${formatFoodMoney(oxsteedCreditAvailableCents, oxsteedCreditAccount?.currencyCode || currency)}`
      : null;
  useEffect(() => {
    if (paymentMethod === 'oxsteed_credit' && oxsteedCreditPaymentIssue) {
      setPaymentMethod('pay_at_restaurant');
      // The flip is silent by default; tell the customer why it happened.
      const reason = String(oxsteedCreditPaymentIssue);
      if (paymentFlipNoticeRef.current !== reason) {
        paymentFlipNoticeRef.current = reason;
        toast(t('food.restaurant.paymentMethodSwitched', { reason }), { icon: '⚠️' });
      }
    }
  }, [paymentMethod, oxsteedCreditPaymentIssue]);
  // ── Loading / not found ─────────────────────────────────────────────────
  if (loading) {
    return (
      <>
        <Navbar />
        <div className="rp-root">
          <div className="rp-loading-screen">
            <div className="rp-loading-spinner" />
            <p>{t('food.restaurant.loadingMenu')}</p>
          </div>
        </div>
        <Footer />
      </>
    );
  }

  if (!restaurant) {
    return (
      <>
        <PageMeta
          title={t('food.restaurant.notFoundTitle')}
          description={t('food.restaurant.notFoundTitle')}
          url={`${getPublicSiteUrl()}/restaurants/r/${restaurantId}`}
          noIndex
        />
        <Navbar />
        <div className="rp-root">
          <div className="rp-not-found">
            <div style={{ fontSize: 48 }}>🍽️</div>
            <p style={{ fontWeight: 600 }}>{t('food.restaurant.notFoundTitle')}</p>
            <Link
              to="/restaurants"
              style={{ textDecoration: 'none', padding: '12px 28px', background: '#ff8c00', color: '#fff', borderRadius: 12, fontWeight: 600 }}
            >
              {t('food.restaurant.browseRestaurants')}
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
    ? cap(restaurant.cuisine_tags[0]) : t('food.home.restaurant');
  const fulfillmentLabels = {
    pickup: t('food.restaurant.takeout'),
    dine_in: t('food.order.dineIn'),
    delivery: t('food.fulfillment.delivery'),
    kiosk: t('food.fulfillment.kiosk'),
  };
  const modeLabels = (restaurant.fulfillment_modes || [])
    .map((m) => fulfillmentLabels[m]).filter(Boolean);
  const meta = [cuisineLabel, ...modeLabels].filter(Boolean).join(' · ');
  const publicUrl = `${getPublicSiteUrl()}/restaurants/r/${restaurantId}`;
  const seoDescription = String(
    restaurant.description
      || `${restaurant.display_name} serves ${cuisineLabel.toLowerCase()} food${restaurant.address_city ? ` in ${restaurant.address_city}` : ''} through Local Food Directory.`,
  ).replace(/\s+/g, ' ').trim().slice(0, 320);

  const rating = parseFloat(restaurant.avg_rating || 0) || 0;
  const ratingDisplay = rating > 0 ? rating.toFixed(1) : t('food.restaurant.new');
  const reviewCount = Number(restaurant.review_count || 0) || 0;
  const isOpen = restaurant.is_open !== false;
  const openStatus = restaurant.hours_message || (isOpen ? t('food.restaurant.openNow') : t('food.home.closed'));
  const todayHours = restaurant.hours_message || (isOpen ? t('food.restaurant.openNow') : t('food.home.closed'));
  const priceRange = settings.priceRange || settings.price_range || '$$';
  const prepMin = Number(restaurant.prep_time_min || 20) || 20;
  const delivTime = t('food.restaurant.minuteRange', { start: prepMin, end: prepMin + 10 });
  const isPickup = deliveryMode !== 'delivery';
  const delivFee = isPickup
    ? t('food.restaurant.freePickup')
    : (deliveryFeeCents === 0 ? t('food.restaurant.freeDelivery') : t('food.restaurant.deliveryPrice', { price: formatFoodMoney(deliveryFeeCents, currency) }));
  const delivMin = minimumOrderCents > 0
    ? t('food.restaurant.minimumOrder', { price: formatFoodMoney(minimumOrderCents, currency) })
    : t('food.restaurant.noMinimum');
  const website = restaurant.website || '';
  const address = [restaurant.address_street, restaurant.address_city, restaurant.address_state, restaurant.address_country]
    .filter(Boolean).join(', ');

  // Operating hours → list
  const weekly = restaurant.operating_hours && typeof restaurant.operating_hours === 'object'
    ? (restaurant.operating_hours.weekly || restaurant.operating_hours) : null;
  const DAY_KEYS = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];
  const fmtRange = (v) => {
    if (!v) return t('food.home.closed');
    if (typeof v === 'string') return v;
    if (v.closed) return t('food.home.closed');
    if (v.open && v.close) return `${v.open} – ${v.close}`;
    if (Array.isArray(v) && v.length) return v.map((r) => `${r.open}–${r.close}`).join(', ');
    return t('food.home.closed');
  };
  const hours = weekly
    ? DAY_KEYS.filter((d) => weekly[d] !== undefined).map((d) => ({ day: t(`food.restaurant.days.${d}`), time: fmtRange(weekly[d]) }))
    : [];

  // Menu sections
  const { menu = [], uncategorizedItems = [] } = data;
  const sections = [
    ...menu,
    ...(uncategorizedItems.length ? [{ id: 'other', name: t('food.restaurant.otherItems'), items: uncategorizedItems }] : []),
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

  const decorate = (item, section) => {
    const tags = (item.tags || item.dietary_tags || []).map((x) => String(x).toLowerCase());
    const firstTag = tags[0];
    return {
      ...item,
      sectionName: section.name,
      sectionId: section.id,
      priceStr: formatFoodMoney(item.price_cents, currency),
      photoGrad: gradFor(section.name),
      hasTag: !!firstTag,
      tagLabel: firstTag ? t(`food.restaurant.tags.${firstTag}`, { defaultValue: cap(firstTag) }) : '',
      canOrder: item.is_available !== false && restaurant.accepts_online_orders !== false,
    };
  };

  const allItemsFlat = sections.flatMap((s) => (s.items || []).map((it) => decorate(it, s)));

  // Typeahead items for the menu search: every dish across sections,
  // prefix-ranked by the shared SuggestDropdown. Keep this a plain derivation:
  // hooks cannot run below the loading/not-found returns, and allItemsFlat is
  // rebuilt each render anyway, so memoizing on it would not avoid any work.
  const seenDishNames = new Set();
  const dishSuggestItems = [];
  for (const it of allItemsFlat) {
    const title = it.name || '';
    const key = title.toLowerCase();
    if (!title || seenDishNames.has(key)) continue;
    seenDishNames.add(key);
    dishSuggestItems.push({
      id: `dish:${it.id}`,
      title,
      meta: it.sectionName || '',
    });
  }
  const currentSection = sections.find((s) => String(s.id) === String(validCatId));
  const catItems = (currentSection?.items || []).map((it) => decorate(it, currentSection));

  const filteredMenu = hasSearch
    ? allItemsFlat.filter(searchOk).filter(dietOk)
    : catItems.filter(dietOk);

  const showGrid = !hasSearch && isFirstCat && filteredMenu.length > 0;
  const showList = !showGrid;
  const isEmpty = showList && filteredMenu.length === 0;
  const gridLabel = dietaryFilter !== 'all'
    ? t('food.restaurant.filteredBy', { filter: t(`food.restaurant.filters.${dietaryFilter}`) })
    : t('food.restaurant.popularItems');

  // Reviews
  const reviewsRaw = restaurant.recent_reviews || restaurant.reviews || [];
  const reviewsList = reviewsRaw.map((r) => {
    const name = r.reviewer_name || r.customer_name || r.author || t('food.restaurant.guest');
    const stars = Math.round(r.rating || 5);
    return {
      name,
      initial: name.charAt(0).toUpperCase(),
      stars: '★'.repeat(stars) + '☆'.repeat(5 - stars),
      text: r.comment || r.body || r.text || '',
      time: r.created_at ? new Date(r.created_at).toLocaleDateString(i18n.resolvedLanguage) : (r.time || ''),
    };
  });
  const ratingBars = [5, 4, 3, 2, 1].map((star) => {
    const cnt = reviewsRaw.filter((r) => Math.round(r.rating || 0) === star).length;
    const pct = reviewsRaw.length ? `${Math.round((cnt / reviewsRaw.length) * 100)}%` : '0%';
    return { label: String(star), pct };
  });

  // Promotions → deal cards
  const promos = promotions.map((p) => ({
    title: p.title || p.name || t('food.restaurant.specialOffer'),
    badge: p.code || (p.discount_percent ? t('food.restaurant.percentOff', { percent: p.discount_percent }) : t('food.restaurant.deal')),
    desc: p.description || p.summary || '',
    sub: p.fine_print || p.terms || (p.ends_at ? t('food.restaurant.endsOn', { date: new Date(p.ends_at).toLocaleDateString(i18n.resolvedLanguage) }) : ''),
  }));

  // Past orders for this restaurant
  const pastOrders = pastOrdersRaw
    .filter((o) => String(o.restaurant_id ?? o.restaurantId) === String(restaurant.id))
    .slice(0, 2)
    .map((o) => {
      const items = Array.isArray(o.items) ? o.items : [];
      const first = items[0];
      const firstName = first?.item_name || first?.name || t('food.order.yourOrder');
      const more = items.length > 1 ? t('food.restaurant.moreItems', { count: items.length - 1 }) : '';
      return {
        summary: `${firstName}${more}`,
        date: o.created_at ? new Date(o.created_at).toLocaleDateString(i18n.resolvedLanguage) : '',
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
      creditCategory: item.sectionName || item.category_name || item.category || null,
      unitCents: Number(item.price_cents) || 0,
      qty: 1,
      photoGrad: item.photoGrad,
      image: item.image_url || null,
      notes: '',
      modifierIds: [],
      modifierNames: [],
    });
    toast.success(t('food.restaurant.itemAdded', { item: item.name }));
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
      creditCategory: modalItem.sectionName || modalItem.category_name || modalItem.category || null,
      unitCents: modalUnitCents,
      qty: modalQty,
      photoGrad: modalItem.photoGrad || gradFor(modalItem.sectionName),
      image: modalItem.image_url || null,
      notes: modalInstructions.trim(),
      modifierIds: ids,
      modifierNames: names,
    });
    toast.success(t('food.restaurant.itemAdded', { item: modalItem.name }));
    setModalItem(null);
  };

  // RB1 — One-tap reorder: rebuild the cart from a past order using the
  // CURRENT menu (current prices; unavailable items are skipped with a note).
  const reorder = (po) => {
    const menuById = new Map(allItemsFlat.map((it) => [String(it.id), it]));
    const pastItems = Array.isArray(po?.items) ? po.items : [];
    let skipped = 0;
    const lines = [];
    for (const it of pastItems) {
      const mid = it.menuItemId ?? it.menu_item_id;
      const menuItem = mid != null ? menuById.get(String(mid)) : null;
      if (!menuItem || menuItem.canOrder === false) { skipped += 1; continue; }
      lines.push({
        id: `${menuItem.id}::reorder`,
        menuItemId: menuItem.id,
        name: menuItem.name,
        creditCategory: menuItem.sectionName || menuItem.category_name || menuItem.category || null,
        unitCents: Number(menuItem.price_cents) || 0,
        qty: Number(it.quantity || 1) || 1,
        photoGrad: menuItem.photoGrad || gradFor(menuItem.name),
        image: menuItem.image_url || null,
        notes: '', modifierIds: [], modifierNames: [],
      });
    }
    if (!lines.length) { toast.error(t('food.restaurant.reorderError')); return; }
    setCartItems(lines);
    setCartOpen(true);
    setCartStep('cart');
    if (skipped > 0) toast(t('food.restaurant.reorderSkipped', { count: skipped }), { icon: '⚠️' });
  };

  const onShare = () => {
    if (navigator.share) {
      navigator.share({ title: restaurant.display_name, url: window.location.href }).catch(() => {});
    } else if (navigator.clipboard) {
      navigator.clipboard.writeText(window.location.href);
      toast.success(t('food.restaurant.linkCopied'));
    }
  };

  // Shared inline styles
  const sectionLabel = { fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.07em', color: 'var(--color-text-muted)', marginBottom: 10 };
  const closeBtn = { width: 32, height: 32, borderRadius: '50%', background: 'var(--color-surface-2)', border: 'none', fontSize: 18, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--color-text-muted)', lineHeight: 1 };

  const tabs = [
    { key: 'menu', label: t('food.restaurant.tabs.menu') },
    { key: 'info', label: t('food.restaurant.tabs.info') },
    { key: 'reviews', label: t('food.restaurant.tabs.reviews') },
    { key: 'deals', label: t('food.restaurant.tabs.deals') },
    { key: 'media', label: t('food.restaurant.tabs.media') },
  ];

  const dietaryChips = [
    { key: 'all', label: t('food.restaurant.filters.all') },
    { key: 'vegetarian', label: `🌿 ${t('food.restaurant.filters.vegetarian')}` },
    { key: 'vegan', label: `🌱 ${t('food.restaurant.filters.vegan')}` },
    { key: 'gf', label: 'GF' },
    { key: 'spicy', label: `🌶 ${t('food.restaurant.filters.spicy')}` },
  ];

  const timeSlots = [
    { id: 'asap', label: t('food.restaurant.timeSlots.asap'), sub: t('food.restaurant.estimated', { time: delivTime }) },
    { id: '+15', label: t('food.restaurant.timeSlots.in15'), sub: t('food.restaurant.timeSlots.adds15') },
    { id: '+30', label: t('food.restaurant.timeSlots.in30'), sub: t('food.restaurant.timeSlots.scheduled') },
    { id: 'later', label: t('food.restaurant.timeSlots.later'), sub: t('food.restaurant.timeSlots.chooseTime') },
  ];
  const paymentMethods = [
    {
      id: 'pay_at_restaurant',
      icon: '🏪',
      label: isPickup ? t('food.restaurant.payAtRestaurant') : t('food.restaurant.payOnDelivery'),
      sub: t('food.restaurant.cardOrCash'),
    },
    ...(wallet ? [{
      id: 'restaurant_credit',
      icon: '💠',
      label: t('food.restaurant.restaurantCredit'),
      sub: walletCoversOrder
        ? t('food.restaurant.creditAvailable', { amount: formatFoodMoney(walletAvailableCents, wallet.currencyCode || currency) })
        : t('food.restaurant.insufficientCredit', { amount: formatFoodMoney(walletAvailableCents, wallet.currencyCode || currency) }),
      disabled: !walletCoversOrder,
    }] : []),
    ...(oxsteedCreditPartner && oxsteedCreditAccount ? [{
      id: 'oxsteed_credit',
      icon: '◎',
      label: 'OxSteed Credit',
      sub: oxsteedCreditPaymentIssue
        || `Available ${formatFoodMoney(oxsteedCreditAvailableCents, oxsteedCreditAccount.currencyCode || currency)}`,
      disabled: Boolean(oxsteedCreditPaymentIssue),
    }] : []),
    ...(cardPaymentsReady ? [{
      id: 'card',
      icon: '💳',
      label: t('food.restaurant.payByCard'),
      sub: t('food.restaurant.payByCardSub'),
    }] : []),
    ...(externalPaymentEnabled ? [{
      id: 'direct_payment',
      icon: '📲',
      label: externalPaymentLabel || t('food.restaurant.payWithApp'),
      sub: externalPaymentHandle
        ? t('food.restaurant.sendTo', { handle: externalPaymentHandle })
        : t('food.restaurant.usePaymentInstructions'),
    }] : []),
  ];

  const detailsTitle = isPickup ? t('food.restaurant.pickupDetails') : t('food.restaurant.deliveryDetails');
  const delivFeeLabel = isPickup ? t('food.order.pickup') : t('food.restaurant.deliveryFee');
  const delivFeeStr = isPickup || feeCents === 0 ? t('food.restaurant.free') : formatFoodMoney(feeCents, currency);
  // Full price breakdown for the payment step: server quote lines first,
  // client estimates only for lines the quote does not provide.
  // Keep this as a plain derived value. This section is below the loading and
  // not-found returns, so a hook here would change hook order between the
  // initial loading render and the loaded restaurant render.
  const summaryRows = (() => {
    const quoted = (cents) => (quote && Number.isFinite(Number(cents)) ? Number(cents) : null);
    const deliveryFee = quoted(quote?.deliveryFeeCents) ?? feeCents;
    const rows = [
      { key: 'subtotal', label: t('food.restaurant.subtotal'), amount: quoted(quote?.subtotalCents) ?? subtotalCents },
    ];
    const discount = quoted(quote?.discountCents);
    if (discount > 0) rows.push({ key: 'discount', label: t('food.restaurant.quoteDiscount'), amount: -discount, tone: 'green' });
    const tax = quoted(quote?.taxCents);
    if (tax > 0) rows.push({ key: 'tax', label: t('food.restaurant.quoteTax'), amount: tax });
    const serviceFee = quoted(quote?.serviceFeeCents);
    if (serviceFee > 0) rows.push({ key: 'serviceFee', label: t('food.restaurant.quoteServiceFee'), amount: serviceFee });
    rows.push({ key: 'delivery', label: delivFeeLabel, amount: deliveryFee, free: deliveryFee === 0 });
    if (tipCents > 0) rows.push({ key: 'tip', label: t('food.restaurant.tip'), amount: tipCents });
    return rows;
  })();

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <>
      {!customerSnapshot && <PageMeta
        title={`${restaurant.display_name} | Local Food Directory`}
        description={seoDescription}
        image={restaurant.cover_photo_url || restaurant.logo_url}
        url={publicUrl}
        type="restaurant"
      />}
      <Navbar />
      <div className="rp-root" style={rootStyle}>
        <div className="rp-page-wrap">

          {/* ── Active order recovery banner ── */}
          {recoveredOrder && cartStep !== 'confirmed' && (() => {
            const status = recoveredLiveOrder?.status || 'received';
            const isReady = status === 'ready';
            const queueNumber = recoveredLiveOrder?.queue_number ?? recoveredOrder.queueNumber;
            return (
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 16px', borderRadius: 12, marginBottom: 12, background: isReady ? 'var(--color-success-bg)' : accentBg, border: `1.5px solid ${isReady ? 'var(--color-success)' : accent}` }}>
                <span style={{ width: 9, height: 9, borderRadius: '50%', background: isReady ? '#16a34a' : accent, flexShrink: 0 }} />
                <span style={{ flex: 1, fontSize: 14, fontWeight: 600, color: isReady ? 'var(--color-success)' : 'var(--color-text)' }}>
                  {queueNumber != null ? t('food.restaurant.orderNumber', { number: queueNumber }) : t('food.order.yourOrder')}
                  {': '}
                  {isReady ? t('food.restaurant.readyForPickupShort') : t(FOOD_STATUS_KEYS[status] || FOOD_STATUS_KEYS.received)}
                </span>
                <Link to={`/restaurants/queue/${restaurantId}`} style={{ fontSize: 13, fontWeight: 600, color: isReady ? 'var(--color-success)' : accent, textDecoration: 'none', whiteSpace: 'nowrap' }}>{t('food.order.watchQueue')}</Link>
                <button
                  type="button"
                  aria-label={t('food.restaurant.dismissOrderStatus')}
                  onClick={() => { clearActiveOrder(restaurantId); setRecoveredOrder(null); }}
                  style={{ width: 28, height: 28, borderRadius: '50%', border: 'none', background: 'var(--color-surface-2)', color: 'var(--color-text-muted)', fontSize: 15, cursor: 'pointer', lineHeight: 1, flexShrink: 0 }}
                >
                  ×
                </button>
              </div>
            );
          })()}

          {/* ── Cuisine pills row (decorative quick filters) ── */}
          <div className="rp-type-row">
              <span className="rp-type-pill" style={{ borderColor: accent, background: accent, color: 'var(--color-primary-text)' }}>{emoji} {cuisineLabel}</span>
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
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <button onClick={handleMessageClick} aria-label={t('food.restaurant.messageAria')} style={{ height: 36, padding: '0 14px', borderRadius: 9999, border: '1.5px solid #e2e8f0', background: '#fff', color: '#0f172a', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>
                  {`✉ ${t('food.restaurant.message')}`}
                </button>
                <button onClick={() => setSaved((s) => !s)} style={{ height: 36, padding: '0 14px', borderRadius: 9999, border: '1.5px solid #e2e8f0', background: '#fff', color: saved ? accent : '#94a3b8', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>
                  {saved ? `♥ ${t('food.common.saved')}` : `♡ ${t('food.common.save')}`}
                </button>
                <button onClick={onShare} aria-label={t('food.restaurant.share')} style={{ height: 36, padding: '0 14px', borderRadius: 9999, border: '1.5px solid #e2e8f0', background: '#fff', fontSize: 13, fontWeight: 600, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#64748b' }}>{`↗ ${t('food.restaurant.share')}`}</button>
                {user && (
                  <button onClick={() => navigate(`/restaurant-credit?restaurantId=${encodeURIComponent(restaurantId)}`)} aria-label={t('food.restaurant.requestCredit')} style={{ height: 36, padding: '0 14px', borderRadius: 9999, border: '1.5px solid #e2e8f0', background: '#fff', fontSize: 13, fontWeight: 600, cursor: 'pointer', color: '#0f172a' }}>{t('food.restaurant.requestCredit')}</button>
                )}
              </div>
            </div>
            <div style={{ display: 'inline-flex', background: accentBg, color: accent, padding: '2px 9px', borderRadius: 4, fontSize: 11, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', marginBottom: 5 }}>{cuisineLabel}</div>
            <h1 style={{ fontFamily: SERIF, fontSize: 28, fontWeight: 400, color: 'var(--color-text)', lineHeight: 1.15, letterSpacing: '-0.01em', marginBottom: 4 }}>{restaurant.display_name}</h1>
            <p style={{ fontSize: 14, color: 'var(--color-text-muted)', marginBottom: 10 }}>{meta}</p>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 14 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 3 }}>
                <span style={{ color: '#fbbf24', fontSize: 13 }}>★</span>
                <span style={{ fontSize: 14, fontWeight: 700, color: 'var(--color-text)' }}>{ratingDisplay}</span>
                <span style={{ fontSize: 13, color: 'var(--color-text-muted)' }}>({reviewCount})</span>
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
                <button onClick={() => setDeliveryMode('delivery')} style={{ flex: 1, height: 36, borderRadius: 8, border: 'none', fontSize: 13, fontWeight: 600, cursor: 'pointer', transition: 'all 0.15s', background: !isPickup ? '#fff' : 'transparent', color: !isPickup ? '#0f172a' : '#94a3b8', boxShadow: !isPickup ? '0 1px 4px rgba(0,0,0,0.1)' : 'none' }}>🛵 {t('food.fulfillment.delivery')}</button>
              )}
              <button onClick={() => setDeliveryMode('pickup')} style={{ flex: 1, height: 36, borderRadius: 8, border: 'none', fontSize: 13, fontWeight: 600, cursor: 'pointer', transition: 'all 0.15s', background: isPickup ? '#fff' : 'transparent', color: isPickup ? '#0f172a' : '#94a3b8', boxShadow: isPickup ? '0 1px 4px rgba(0,0,0,0.1)' : 'none' }}>🏪 {t('food.order.pickup')}</button>
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
                <button onClick={handleStartOrder} style={{ width: '100%', height: 48, background: accent, color: '#fff', border: 'none', borderRadius: 10, fontSize: 15, fontWeight: 700, cursor: 'pointer', marginBottom: 8 }}>
                  {hasCart ? t('food.restaurant.orderItems', { count: cartCount }) : t('food.restaurant.startOrder')}
                </button>
                <div style={{ display: 'flex', gap: 8 }}>
                  <button onClick={handleMessageClick} aria-label={t('food.restaurant.messageAria')} style={{ flex: 1, height: 40, borderRadius: 8, border: '1.5px solid #e2e8f0', background: '#fff', color: '#0f172a', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>{`✉ ${t('food.restaurant.message')}`}</button>
                  <button onClick={() => setSaved((s) => !s)} style={{ flex: 1, height: 40, borderRadius: 8, border: '1.5px solid #e2e8f0', background: '#fff', color: saved ? accent : '#94a3b8', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>{saved ? `♥ ${t('food.common.saved')}` : `♡ ${t('food.common.save')}`}</button>
                  <button onClick={onShare} aria-label={t('food.restaurant.share')} style={{ flex: 1, height: 40, borderRadius: 8, border: '1.5px solid #e2e8f0', background: '#fff', color: '#64748b', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>{`↗ ${t('food.restaurant.share')}`}</button>
                </div>
                {user && (
                  <button onClick={() => navigate(`/restaurant-credit?restaurantId=${encodeURIComponent(restaurantId)}`)} aria-label={t('food.restaurant.requestCredit')} style={{ width: '100%', height: 40, marginTop: 8, borderRadius: 8, border: '1.5px solid #e2e8f0', background: '#fff', color: '#0f172a', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>{t('food.restaurant.requestCredit')}</button>
                )}
              </div>
              {hours.length > 0 && (
                <div style={{ background: '#fff', borderRadius: 12, border: '1px solid #e2e8f0', overflow: 'hidden', marginBottom: 14 }}>
                  <div style={{ padding: '14px 16px' }}>
                    <p style={sectionLabel}>{t('food.restaurant.hours')}</p>
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
                    <p style={sectionLabel}>{t('food.restaurant.location')}</p>
                    <MapMini accent={accent} accentFade={accentFade} />
                    <p style={{ fontSize: 13, color: '#475569', lineHeight: 1.5, marginTop: 8 }}>{address}</p>
                  </div>
                </div>
              )}
              {(restaurant.phone || website) && (
                <div style={{ background: '#fff', borderRadius: 12, border: '1px solid #e2e8f0', padding: '14px 16px' }}>
                  <p style={sectionLabel}>{t('food.restaurant.contact')}</p>
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
                <div className="rp-menu-search-row">
                  <SuggestDropdown
                    id={`rp-dish-search-${restaurant.id}`}
                    items={dishSuggestItems}
                    value={searchQuery}
                    onQueryChange={(q) => { setSearchQuery(q); setActiveCategory(null); }}
                    onSelect={(item) => { setSearchQuery(item.title || ''); setActiveCategory(null); }}
                    recentsKey={`oxsteed_dish_recent_${restaurant.id}`}
                    placeholder={t('food.restaurant.searchMenu', { restaurant: restaurant.display_name })}
                    ariaLabel={t('food.restaurant.searchMenu', { restaurant: restaurant.display_name })}
                    className="rp-dish-suggest"
                  />
                  {hasSearch && (
                    <button
                      onClick={() => setSearchQuery('')}
                      aria-label={t('food.restaurant.clearSearch')}
                      className="rp-menu-search-clear"
                    >
                      ×
                    </button>
                  )}
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
                <div className="rp-panel rp-panel-wrap" ref={menuSectionRef}>
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
                      <p style={{ ...sectionLabel, marginBottom: 10 }}>{t('food.home.orderAgainTitle')}</p>
                      {pastOrders.map((po, i) => (
                        <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 0', borderBottom: '1px solid #f8fafc' }}>
                          <div style={{ width: 44, height: 44, borderRadius: 10, background: po.thumbGrad, flexShrink: 0 }} />
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <p style={{ fontSize: 14, fontWeight: 600, color: '#0f172a', marginBottom: 2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{po.summary}</p>
                            <p style={{ fontSize: 13, color: '#94a3b8' }}>{po.date} · {po.total}</p>
                          </div>
                          <button onClick={() => reorder(po)} style={{ height: 36, padding: '0 16px', borderRadius: 9999, background: accentBg, border: `1.5px solid ${accent}`, color: accent, fontSize: 13, fontWeight: 700, cursor: 'pointer', whiteSpace: 'nowrap', flexShrink: 0 }}>{t('food.restaurant.reorder')}</button>
                        </div>
                      ))}
                    </div>
                  )}

                  {sections.length === 0 && (
                    <div style={{ textAlign: 'center', padding: '48px 16px' }}>
                      <div style={{ fontSize: 36, marginBottom: 10 }}>🍽️</div>
                      <p style={{ fontSize: 15, fontWeight: 600, color: '#0f172a' }}>{t('food.restaurant.noMenuItems')}</p>
                    </div>
                  )}

                  {/* Featured grid */}
                  {showGrid && (
                    <div style={{ padding: '14px 16px 4px' }}>
                      <p style={{ ...sectionLabel, marginBottom: 10 }}>{gridLabel}</p>
                      <div className="rp-menu-grid">
                        {filteredMenu.map((item) => (
                          <div key={item.id} id={`menu-item-${item.id}`} style={{ borderRadius: 12, overflow: 'hidden', border: '1px solid #f1f5f9', background: '#fff', boxShadow: highlightItemId === String(item.id) ? '0 0 0 3px #f97316, 0 1px 3px rgba(0,0,0,0.06)' : '0 1px 3px rgba(0,0,0,0.06)', transition: 'box-shadow 0.3s ease' }}>
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
                        <p style={{ ...sectionLabel, fontSize: 12, margin: '10px 0' }}>{t('food.restaurant.searchResults', { count: filteredMenu.length, query: searchQuery })}</p>
                      )}
                      {filteredMenu.map((item) => (
                        <div key={item.id} id={`menu-item-${item.id}`} style={{ display: 'grid', gridTemplateColumns: '1fr 68px', gap: 12, padding: '13px 0', borderBottom: '1px solid #f8fafc', alignItems: 'start', opacity: item.is_available === false ? 0.55 : 1, borderRadius: 8, boxShadow: highlightItemId === String(item.id) ? '0 0 0 3px #f97316' : 'none', transition: 'box-shadow 0.3s ease' }}>
                          <div onClick={() => item.canOrder && openModal(item)} style={{ minWidth: 0, cursor: item.canOrder ? 'pointer' : 'default' }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 8, marginBottom: 3 }}>
                              <span style={{ fontSize: 15, fontWeight: 600, color: '#0f172a', lineHeight: 1.3 }}>{item.name}</span>
                              <span style={{ fontSize: 14, fontWeight: 700, color: accent, whiteSpace: 'nowrap', flexShrink: 0 }}>{item.priceStr}</span>
                            </div>
                            {item.description && <p style={{ fontSize: 13, color: '#64748b', lineHeight: 1.45 }}>{item.description}</p>}
                            {item.is_available === false && <p style={{ fontSize: 12, color: '#ef4444', fontWeight: 600, marginTop: 4 }}>{t('food.restaurant.soldOut')}</p>}
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
                          <p style={{ fontSize: 15, fontWeight: 600, color: '#0f172a', marginBottom: 4 }}>{hasSearch ? t('food.restaurant.noResults', { query: searchQuery }) : t('food.restaurant.noItemsHere')}</p>
                          <p style={{ fontSize: 14, color: '#64748b' }}>{hasSearch ? t('food.restaurant.tryDifferentSearch') : t('food.restaurant.tryDifferentCategory')}</p>
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
                    <p style={sectionLabel}>{t('food.restaurant.hours')}</p>
                    {hours.length ? hours.map((h) => (
                      <div key={h.day} style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0', fontSize: 14, borderBottom: '1px solid #f8fafc' }}>
                        <span style={{ color: '#64748b' }}>{h.day}</span><span style={{ fontWeight: 500, color: '#0f172a' }}>{h.time}</span>
                      </div>
                    )) : <p style={{ fontSize: 13, color: '#94a3b8' }}>{t('food.restaurant.hoursUnavailable')}</p>}
                  </div>
                  {address && (
                    <div style={{ padding: 16, borderBottom: '1px solid #f1f5f9' }}>
                      <p style={sectionLabel}>{t('food.restaurant.location')}</p>
                      <MapMini accent={accent} accentFade={accentFade} big />
                      <p style={{ fontSize: 14, color: '#475569', lineHeight: 1.5, marginTop: 10 }}>{address}</p>
                    </div>
                  )}
                  <div style={{ padding: 16 }}>
                    <p style={sectionLabel}>{t('food.restaurant.contact')}</p>
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
                      {!restaurant.phone && !website && <p style={{ fontSize: 13, color: '#94a3b8' }}>{t('food.restaurant.noContact')}</p>}
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
                          <div style={{ fontSize: 12, color: '#94a3b8' }}>{t('food.restaurant.reviewCount', { count: reviewCount })}</div>
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
                      <p style={{ fontSize: 15, fontWeight: 600, color: '#0f172a' }}>{t('food.restaurant.noReviews')}</p>
                      <p style={{ fontSize: 14, color: '#64748b', marginTop: 4 }}>{t('food.restaurant.firstReview')}</p>
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
                      <p style={{ fontSize: 15, fontWeight: 600, color: '#0f172a' }}>{t('food.restaurant.noDeals')}</p>
                      <p style={{ fontSize: 14, color: '#64748b', marginTop: 4 }}>{t('food.restaurant.checkDealsLater')}</p>
                    </div>
                  )}
                </div>
              )}

              {/* ── MEDIA (TikTok-style video feed) ── */}
              {activeTab === 'media' && (
                <div className="rp-panel rp-panel-wrap" style={{ padding: 12 }}>
                  <RestaurantMediaFeed
                    restaurantId={restaurantId}
                    user={user}
                    isAdmin={['admin', 'super_admin'].includes(user?.role)}
                    menuItems={allItemsFlat}
                    onDishTap={jumpToMenuItem}
                    onRequireLogin={openLoginGate}
                  />
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
              <span>{t('food.restaurant.viewCart')}</span>
              <span>{formatFoodMoney(subtotalCents, currency)}</span>
            </button>
          </div>
        )}

        {/* ── Cart / checkout drawer ── */}
        {cartOpen && (
          <>
            <div className="rp-sheet-backdrop" onClick={() => { setCartOpen(false); setCartStep('cart'); }} />
            <div className="rp-sheet" role="dialog" aria-modal="true" aria-label={t('food.order.yourOrder')}>
              <div style={{ display: 'flex', justifyContent: 'center', padding: '12px 0 4px', flexShrink: 0 }}>
                <div style={{ width: 36, height: 4, borderRadius: 2, background: '#e2e8f0' }} />
              </div>

              {/* Headers */}
              {cartStep === 'cart' && (
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '4px 20px 12px', borderBottom: '1px solid #f1f5f9', flexShrink: 0 }}>
                  <div><h2 style={{ fontSize: 18, fontWeight: 700, color: '#0f172a', lineHeight: 1.2 }}>{t('food.order.yourOrder')}</h2><p style={{ fontSize: 13, color: '#64748b', marginTop: 2 }}>{restaurant.display_name}</p></div>
                  <button onClick={() => setCartOpen(false)} aria-label={t('food.common.close')} style={closeBtn}>×</button>
                </div>
              )}
              {(cartStep === 'details' || cartStep === 'payment') && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '4px 20px 12px', borderBottom: '1px solid #f1f5f9', flexShrink: 0 }}>
                  <button onClick={() => setCartStep(cartStep === 'payment' ? 'details' : 'cart')} aria-label={t('food.common.back')} style={{ width: 36, height: 36, borderRadius: '50%', background: '#f1f5f9', border: 'none', fontSize: 18, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#0f172a', flexShrink: 0 }}>←</button>
                  <div style={{ flex: 1 }}>
                    <h2 style={{ fontSize: 16, fontWeight: 700, color: '#0f172a', lineHeight: 1.2 }}>{cartStep === 'payment' ? t('food.restaurant.payment') : detailsTitle}</h2>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginTop: 4 }}>
                      <div style={{ width: 20, height: 3, borderRadius: 2, background: accent }} />
                      <div style={{ width: 20, height: 3, borderRadius: 2, background: cartStep === 'payment' ? accent : '#e2e8f0' }} />
                    </div>
                  </div>
                  <button onClick={() => setCartOpen(false)} aria-label={t('food.common.close')} style={closeBtn}>×</button>
                </div>
              )}

              {/* ① empty */}
              {cartStep === 'cart' && cartItems.length === 0 && (
                <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '40px 20px' }}>
                  <div style={{ width: 64, height: 64, borderRadius: '50%', background: '#f1f5f9', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 28, marginBottom: 14 }}>🛒</div>
                  <p style={{ fontSize: 16, fontWeight: 600, color: '#0f172a', marginBottom: 6 }}>{t('food.restaurant.emptyCart')}</p>
                  <p style={{ fontSize: 14, color: '#64748b', textAlign: 'center', lineHeight: 1.5 }}>{t('food.restaurant.emptyCartHelp')}</p>
                  <button onClick={() => setCartOpen(false)} style={{ marginTop: 20, height: 44, padding: '0 28px', background: accent, color: '#fff', border: 'none', borderRadius: 10, fontSize: 14, fontWeight: 700, cursor: 'pointer' }}>{t('food.restaurant.browseMenu')}</button>
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
                    {summaryRows.map((row, i) => (
                      <div key={row.key} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 14, color: '#64748b', marginBottom: i === summaryRows.length - 1 ? 14 : 6 }}>
                        <span>{row.label}</span>
                        <span style={{ fontWeight: 600, color: row.tone === 'green' ? '#15803d' : '#0f172a' }}>
                          {row.free ? t('food.restaurant.free') : formatFoodMoney(row.amount, currency)}
                        </span>
                      </div>
                    ))}
                      <button onClick={() => { setCartOpen(true); setCartStep('details'); }} style={{ width: '100%', height: 52, background: accent, color: '#fff', border: 'none', borderRadius: 12, fontSize: 16, fontWeight: 700, cursor: 'pointer' }}>{t('food.restaurant.checkoutTotal', { total: formatFoodMoney(displayTotalCents, currency) })}</button>
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
                          {t('food.restaurant.signInRequired')}
                        </p>
                        <h3 style={{ fontSize: 22, fontWeight: 700, color: '#0f172a', marginBottom: 10 }}>
                          {t('food.restaurant.signInCheckoutTitle')}
                        </h3>
                        <p style={{ fontSize: 14, lineHeight: 1.7, color: '#64748b' }}>
                          {t('food.restaurant.signInCheckoutBody')}
                        </p>
                      </div>
                    ) : (
                      <>
                        {!isPickup && (
                          <>
                            <p style={{ ...sectionLabel, color: '#64748b', marginBottom: 6 }}>{t('food.restaurant.streetAddress')}</p>
                            <AddressAutocomplete
                              value={addressLine1}
                              onChange={(value) => { setAddressLine1(value); if (addressError) setAddressError(''); }}
                              onSelect={(place) => {
                                setAddressLine1(place.addressLine1 || place.display);
                                if (place.addressLine2) setAddressLine2(place.addressLine2);
                                if (addressError) setAddressError('');
                              }}
                              placeholder={t('food.restaurant.streetPlaceholder')}
                              autoComplete="shipping street-address"
                              ariaLabel={t('food.restaurant.streetAddress')}
                              inputStyle={inputStyle}
                              inputClassName="food-address-autocomplete-input"
                            />
                            <p style={{ ...sectionLabel, color: '#64748b', marginBottom: 6 }}>{t('food.restaurant.aptSuite')} <span style={{ textTransform: 'none', fontWeight: 400, color: '#94a3b8' }}>({t('food.restaurant.optional')})</span></p>
                            <input value={addressLine2} onChange={(e) => setAddressLine2(e.target.value)} placeholder={t('food.restaurant.aptPlaceholder')} style={{ ...inputStyle, marginBottom: 20 }} />
                            {addressError && (
                              <p role="alert" style={{ fontSize: 13, fontWeight: 600, color: '#dc2626', margin: '-8px 0 16px' }}>{addressError}</p>
                            )}
                          </>
                        )}
                        <p style={{ ...sectionLabel, color: '#64748b' }}>{isPickup ? t('food.restaurant.pickupTime') : t('food.restaurant.deliveryTime')}</p>
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
                        {/* CC3: real time picker for 'Schedule for later'. */}
                        {deliverySlot === 'later' && (
                          <div style={{ margin: '-8px 0 20px' }}>
                            <p style={{ ...sectionLabel, color: '#64748b', marginBottom: 6 }}>{t('food.restaurant.scheduleDayLabel')}</p>
                            <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
                              {['today', 'tomorrow'].map((day) => {
                                const on = scheduleDay === day;
                                return (
                                  <button
                                    key={day}
                                    type="button"
                                    onClick={() => { setScheduleDay(day); setScheduleTime(''); }}
                                    style={{ flex: 1, height: 44, borderRadius: 10, border: `1.5px solid ${on ? accent : '#e2e8f0'}`, background: on ? accentBg : '#fff', color: on ? accent : '#475569', fontSize: 14, fontWeight: 700, cursor: 'pointer' }}
                                  >
                                    {day === 'today' ? t('food.restaurant.scheduleToday') : t('food.restaurant.scheduleTomorrow')}
                                  </button>
                                );
                              })}
                            </div>
                            <p style={{ ...sectionLabel, color: '#64748b', marginBottom: 6 }}>{t('food.restaurant.scheduleTimeLabel')}</p>
                            <select
                              value={scheduleTime}
                              onChange={(e) => setScheduleTime(e.target.value)}
                              aria-label={t('food.restaurant.scheduleTimeLabel')}
                              style={{ ...inputStyle, marginBottom: 0 }}
                            >
                              <option value="">{t('food.restaurant.scheduleTimePlaceholder')}</option>
                              {scheduleOptions.map((o) => (
                                <option key={o.value} value={o.value}>{o.label}</option>
                              ))}
                            </select>
                          </div>
                        )}
                        {/* CC6: optional pickup contact for pickup orders. */}
                        {isPickup && (
                          <>
                            <p style={{ ...sectionLabel, color: '#64748b', marginBottom: 6 }}>{t('food.restaurant.pickupContactName')} <span style={{ textTransform: 'none', fontWeight: 400, color: '#94a3b8' }}>({t('food.restaurant.optional')})</span></p>
                            <input
                              value={pickupContactName}
                              onChange={(e) => setPickupContactName(e.target.value)}
                              placeholder={t('food.restaurant.pickupContactNamePlaceholder')}
                              maxLength={140}
                              autoComplete="name"
                              style={{ ...inputStyle }}
                            />
                            <p style={{ ...sectionLabel, color: '#64748b', marginBottom: 6 }}>{t('food.restaurant.pickupContactPhone')} <span style={{ textTransform: 'none', fontWeight: 400, color: '#94a3b8' }}>({t('food.restaurant.optional')})</span></p>
                            <input
                              value={pickupContactPhone}
                              onChange={(e) => setPickupContactPhone(e.target.value)}
                              placeholder={t('food.restaurant.pickupContactPhonePlaceholder')}
                              maxLength={40}
                              inputMode="tel"
                              autoComplete="tel"
                              style={{ ...inputStyle, marginBottom: 20 }}
                            />
                          </>
                        )}
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
                        {t('food.restaurant.signInToCheckout')}
                      </button>
                    ) : (
                      <button
                        onClick={() => {
                          // Never let a blank delivery address fall back to the
                          // restaurant's own address at submit time.
                          if (!isPickup && !addressLine1.trim()) {
                            setAddressError(t('food.restaurant.deliveryAddressRequired'));
                            return;
                          }
                          setAddressError('');
                          setCartStep('payment');
                        }}
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
                        {t('food.restaurant.continueToPayment')}
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
                        {t('food.restaurant.signInRequired')}
                      </p>
                      <h3 style={{ fontSize: 22, fontWeight: 700, color: '#0f172a', marginBottom: 10 }}>
                        {t('food.restaurant.signInOrderTitle')}
                      </h3>
                      <p style={{ fontSize: 14, lineHeight: 1.7, color: '#64748b' }}>
                        {t('food.restaurant.signInOrderBody')}
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
                      {t('food.restaurant.signInContinue')}
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
                      {t('food.restaurant.backToCart')}
                    </button>
                  </div>
                </>
              )}

              {/* ④ payment step */}
              {cartStep === 'payment' && !checkoutRequiresLogin && (
                <>
                  <div style={{ flex: 1, overflowY: 'auto', padding: '16px 20px 0' }}>
                    <p style={{ ...sectionLabel, color: '#64748b' }}>{t('food.restaurant.paymentMethod')}</p>
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
                          <strong style={{ display: 'block', color: '#9a4b0c', fontSize: 12 }}>{paymentMethod === 'oxsteed_credit' ? 'OxSteed Credit' : t('food.restaurant.restaurantCredit')}</strong>
                          <span style={{ color: '#9a6a3c', fontSize: 11 }}>
                            {paymentMethod === 'oxsteed_credit'
                              ? `Available ${formatFoodMoney(oxsteedCreditAvailableCents, oxsteedCreditAccount?.currencyCode || currency)} at participating restaurants`
                              : wallet
                              ? t('food.restaurant.creditSummary', {
                                available: formatFoodMoney(walletAvailableCents, wallet.currencyCode || currency),
                                reserved: walletReservedCents > 0 ? t('food.restaurant.creditReserved', { amount: formatFoodMoney(walletReservedCents, wallet.currencyCode || currency) }) : '',
                              })
                              : t('food.restaurant.addCredit')}
                          </span>
                        </div>
                        {/* CC1: opens the in-checkout credit sheet instead of
                            navigating away; closing it returns to this step
                            with all checkout state intact. */}
                        <button
                          type="button"
                          onClick={() => setCreditSheetOpen(true)}
                          style={{ flexShrink: 0, color: accent, fontSize: 12, fontWeight: 800, background: 'none', border: 'none', padding: 0, cursor: 'pointer' }}
                        >
                          {t('food.restaurant.manageCredit')}
                        </button>
                      </div>
                    )}
                    {/* CC7: Stripe Elements card form for in-checkout card payments. */}
                    {paymentMethod === 'card' && (
                      <div style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 16, padding: 16, marginBottom: 20 }}>
                        <p style={{ ...sectionLabel, color: '#64748b', marginBottom: 10 }}>{t('food.restaurant.cardDetails')}</p>
                        {stripeClient ? (
                          <Elements stripe={stripeClient}>
                            <CheckoutCardForm ref={cardFormRef} onExpressConfirm={handleExpressConfirm} />
                          </Elements>
                        ) : (
                          <p role="alert" style={{ fontSize: 13, color: '#b45309' }}>{t('food.restaurant.creditSheetStripeUnavailable')}</p>
                        )}
                        {cardError && (
                          <p role="alert" style={{ fontSize: 13, fontWeight: 600, color: '#b91c1c', marginTop: 10, lineHeight: 1.5 }}>{cardError}</p>
                        )}
                      </div>
                    )}
                    {paymentMethod === 'direct_payment' && (
                      <div style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 16, padding: 16, marginBottom: 20 }}>
                        <p style={{ fontSize: 12, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: accent, marginBottom: 8 }}>
                          {t('food.restaurant.payDirectly')}
                        </p>
                        <h4 style={{ fontSize: 18, fontWeight: 700, color: '#0f172a', marginBottom: 8 }}>
                          {externalPaymentLabel || defaultExternalPaymentLabel}
                        </h4>
                        {externalPaymentHandle && (
                          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, padding: '10px 12px', borderRadius: 12, background: '#fff', border: '1px solid #e2e8f0', marginBottom: 10 }}>
                            <p style={{ fontSize: 14, color: '#475569', margin: 0 }}>
                              {t('food.restaurant.sendPaymentTo')} <strong style={{ color: '#0f172a' }}>{externalPaymentHandle}</strong>
                            </p>
                            <button
                              type="button"
                              onClick={async () => {
                                try {
                                  await navigator.clipboard.writeText(externalPaymentHandle);
                                  toast.success(t('food.restaurant.paymentAccountCopied'));
                                } catch {
                                  toast.error(t('food.restaurant.paymentAccountCopyError'));
                                }
                              }}
                              style={{ border: 0, borderRadius: 9, padding: '7px 10px', color: accent, background: accentBg, fontSize: 12, fontWeight: 800, cursor: 'pointer' }}
                            >
                              {t('food.restaurant.copy')}
                            </button>
                          </div>
                        )}
                        {externalPaymentInstructions && (
                          <p style={{ fontSize: 14, color: '#475569', lineHeight: 1.6, marginBottom: 10 }}>
                            {externalPaymentInstructions}
                          </p>
                        )}
                        {oxsteedPayUrl ? (
                          <div style={{ marginBottom: 12 }}>
                            <a
                              href={oxsteedPayUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              style={{ display: 'block', textAlign: 'center', padding: '13px 16px', borderRadius: 12, background: accent, color: '#fff', fontSize: 15, fontWeight: 800, textDecoration: 'none' }}
                            >
                              {t('food.restaurant.payWithOxsteed')}
                            </a>
                            <p style={{ fontSize: 12, color: '#64748b', margin: '8px 2px 0', lineHeight: 1.5 }}>
                              {t('food.restaurant.oxsteedPayHint')}
                            </p>
                          </div>
                        ) : externalPaymentQrUrl ? (
                          <img
                            src={externalPaymentQrUrl}
                            alt={t('food.restaurant.paymentQrAlt')}
                            style={{ width: 156, height: 156, objectFit: 'cover', borderRadius: 14, border: '1px solid #e2e8f0', background: '#fff', marginBottom: 12 }}
                          />
                        ) : null}
                        <p style={{ fontSize: 13, fontWeight: 700, color: '#0f172a', margin: '4px 0 8px' }}>
                          {t('food.restaurant.confirmPaymentQuestion')}
                        </p>
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 12 }}>
                          <button
                            type="button"
                            onClick={() => { setProofMethod('upload'); setPaymentReference(''); }}
                            style={{ minHeight: 42, border: `1.5px solid ${proofMethod === 'upload' ? accent : '#dbe2e8'}`, borderRadius: 11, color: proofMethod === 'upload' ? accent : '#475569', background: proofMethod === 'upload' ? accentBg : '#fff', fontWeight: 800, cursor: 'pointer' }}
                          >
                            {t('food.restaurant.uploadReceipt')}
                          </button>
                          <button
                            type="button"
                            onClick={() => { setProofMethod('reference'); setPaymentProof(null); }}
                            style={{ minHeight: 42, border: `1.5px solid ${proofMethod === 'reference' ? accent : '#dbe2e8'}`, borderRadius: 11, color: proofMethod === 'reference' ? accent : '#475569', background: proofMethod === 'reference' ? accentBg : '#fff', fontWeight: 800, cursor: 'pointer' }}
                          >
                            {t('food.restaurant.enterConfirmation')}
                          </button>
                        </div>
                        {proofMethod === 'upload' ? (
                          paymentProof?.url ? (
                            <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px', borderRadius: 12, border: '1px solid #bbf7d0', background: '#f0fdf4' }}>
                              <span style={{ fontSize: 18 }}>✓</span>
                              <div style={{ minWidth: 0, flex: 1 }}>
                                <strong style={{ display: 'block', fontSize: 13, color: '#166534' }}>{paymentProof.name || t('food.restaurant.receiptAttached')}</strong>
                                <a href={paymentProof.url} target="_blank" rel="noreferrer" style={{ fontSize: 12, color: '#15803d', textDecoration: 'none' }}>{t('food.restaurant.viewReceipt')}</a>
                              </div>
                              <button type="button" onClick={() => setPaymentProof(null)} style={{ border: 0, background: 'transparent', color: '#b91c1c', fontSize: 12, fontWeight: 800, cursor: 'pointer' }}>{t('food.common.remove')}</button>
                            </div>
                          ) : (
                            <label style={{ display: 'grid', placeItems: 'center', minHeight: 82, border: '1.5px dashed #cbd5e1', borderRadius: 12, background: '#fff', color: '#475569', fontSize: 13, fontWeight: 800, cursor: proofUploading ? 'wait' : 'pointer' }}>
                              <input type="file" accept="image/*,application/pdf" onChange={handlePaymentProofUpload} disabled={proofUploading} style={{ display: 'none' }} />
                              {proofUploading ? t('food.restaurant.uploadingReceipt') : t('food.restaurant.chooseReceipt')}
                            </label>
                          )
                        ) : (
                          <input
                            value={paymentReference}
                            onChange={(e) => setPaymentReference(e.target.value)}
                            placeholder={externalPaymentReferenceHint || t('food.restaurant.confirmationPlaceholder')}
                            maxLength={120}
                            style={inputStyle}
                          />
                        )}
                        <details style={{ marginTop: 12 }}>
                          <summary style={{ color: '#64748b', fontSize: 12, fontWeight: 800, cursor: 'pointer' }}>{t('food.restaurant.addNote')}</summary>
                          <textarea
                            value={paymentNote}
                            onChange={(e) => setPaymentNote(e.target.value)}
                            placeholder={t('food.restaurant.paymentNotePlaceholder')}
                            maxLength={1000}
                            rows={3}
                            style={{ ...inputStyle, minHeight: 80, resize: 'vertical', marginTop: 8 }}
                          />
                        </details>
                        <p style={{ fontSize: 12, color: requireExternalPaymentProof ? '#b45309' : '#64748b', marginTop: 10, lineHeight: 1.5 }}>
                          {requireExternalPaymentProof
                            ? t('food.restaurant.proofRequiredHelp')
                            : t('food.restaurant.proofOptionalHelp')}
                        </p>
                      </div>
                    )}
                    {/* CC4: promo codes are validated server-side for every
                        payment mode, so the input is no longer gated to
                        restaurant_credit. */}
                    <>
                      <p style={{ ...sectionLabel, color: '#64748b' }}>{t('food.restaurant.promoCode')} <span style={{ textTransform: 'none', fontWeight: 400, color: '#94a3b8' }}>({t('food.restaurant.optional')})</span></p>
                      <input
                        value={promoCode}
                        onChange={(e) => setPromoCode(e.target.value.toUpperCase())}
                        placeholder={t('food.restaurant.promoPlaceholder')}
                        maxLength={40}
                        style={{ ...inputStyle, marginBottom: 20, textTransform: 'uppercase' }}
                      />
                    </>
                    <p style={{ ...sectionLabel, color: '#64748b' }}>{t('food.restaurant.tip')}</p>
                    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: tipPreset === 'custom' ? 8 : 20 }}>
                      {[
                        { id: 'none', label: t('food.restaurant.tipNone') },
                        { id: 10, label: '10%' },
                        { id: 15, label: '15%' },
                        { id: 20, label: '20%' },
                        { id: 'custom', label: t('food.restaurant.tipCustom') },
                      ].map((opt) => {
                        const on = tipPreset === opt.id;
                        return (
                          <button
                            key={String(opt.id)}
                            type="button"
                            onClick={() => setTipPreset(opt.id)}
                            style={{ height: 40, padding: '0 16px', borderRadius: 9999, border: `1.5px solid ${on ? accent : '#e2e8f0'}`, background: on ? accentBg : '#fff', color: on ? accent : '#475569', fontSize: 13, fontWeight: 700, cursor: 'pointer' }}
                          >
                            {opt.label}
                          </button>
                        );
                      })}
                    </div>
                    {tipPreset === 'custom' && (
                      <input
                        value={customTipText}
                        onChange={(e) => setCustomTipText(e.target.value.replace(/[^0-9.]/g, ''))}
                        placeholder={t('food.restaurant.tipCustomPlaceholder')}
                        inputMode="decimal"
                        aria-label={t('food.restaurant.tipCustomPlaceholder')}
                        style={{ ...inputStyle, marginBottom: 20 }}
                      />
                    )}
                    {/* CC2: order-level notes for the kitchen. */}
                    <p style={{ ...sectionLabel, color: '#64748b' }}>{t('food.restaurant.kitchenNotesLabel')} <span style={{ textTransform: 'none', fontWeight: 400, color: '#94a3b8' }}>({t('food.restaurant.optional')})</span></p>
                    <textarea
                      value={kitchenNotes}
                      onChange={(e) => setKitchenNotes(e.target.value)}
                      placeholder={t('food.restaurant.kitchenNotesPlaceholder')}
                      maxLength={500}
                      rows={2}
                      style={{ ...inputStyle, minHeight: 64, resize: 'vertical', marginBottom: 20, paddingTop: 12, paddingBottom: 12, height: 'auto' }}
                    />
                    <p style={{ ...sectionLabel, color: '#64748b' }}>{t('food.restaurant.orderSummary')}</p>
                    <div style={{ background: '#f8fafc', borderRadius: 12, padding: '14px 16px', marginBottom: 20, border: '1px solid #f1f5f9' }}>
                      {/* CC5: collapsible item recap above the money rows. */}
                      <button
                        type="button"
                        onClick={() => setItemsExpanded((v) => !v)}
                        aria-expanded={itemsExpanded}
                        style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', width: '100%', background: 'none', border: 'none', padding: 0, marginBottom: itemsExpanded ? 8 : 10, cursor: 'pointer', fontSize: 14, color: '#64748b' }}
                      >
                        <span style={{ fontWeight: 600 }}>{t('food.restaurant.itemsRecap', { count: cartCount })}</span>
                        <span style={{ fontSize: 11, color: '#94a3b8' }}>{itemsExpanded ? '▲' : '▼'}</span>
                      </button>
                      {itemsExpanded && (
                        <div style={{ marginBottom: 10 }}>
                          {cartItems.map((ci) => (
                            <div key={ci.id} style={{ display: 'flex', justifyContent: 'space-between', gap: 8, fontSize: 13, color: '#475569', marginBottom: 6 }}>
                              <span style={{ flex: 1, minWidth: 0 }}>
                                {ci.qty}× {ci.name}
                                {(ci.modifierNames?.length > 0 || ci.notes) && (
                                  <span style={{ color: '#94a3b8' }}> · {[...(ci.modifierNames || []), ci.notes].filter(Boolean).join(' · ')}</span>
                                )}
                              </span>
                              <span style={{ fontWeight: 600, flexShrink: 0 }}>{formatFoodMoney(ci.unitCents * ci.qty, currency)}</span>
                            </div>
                          ))}
                        </div>
                      )}
                      {summaryRows.map((row, i) => (
                        <div key={row.key} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 14, color: '#64748b', marginBottom: i === summaryRows.length - 1 ? 10 : 6 }}>
                          <span>{row.label}</span>
                          <span style={{ fontWeight: 600, color: row.tone === 'green' ? '#15803d' : '#0f172a' }}>
                            {row.free ? t('food.restaurant.free') : formatFoodMoney(row.amount, currency)}
                          </span>
                        </div>
                      ))}
                      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 16, fontWeight: 700, paddingTop: 10, borderTop: '1px solid #e2e8f0' }}><span style={{ color: '#0f172a' }}>{t('food.order.total')}</span><span style={{ color: '#0f172a' }}>{formatFoodMoney(displayTotalCents, currency)}{quoteLoading ? ' …' : ''}</span></div>
                    </div>
                    <p style={{ fontSize: 12, color: '#94a3b8', textAlign: 'center', marginBottom: 4 }}>
                      {['restaurant_credit', 'oxsteed_credit'].includes(paymentMethod)
                        ? t('food.restaurant.creditChargeNote')
                        : paymentMethod === 'direct_payment'
                          ? t('food.restaurant.directPaymentNote')
                          : paymentMethod === 'card'
                            ? t('food.restaurant.cardChargeNote')
                            : t(isPickup ? 'food.restaurant.counterPaymentNote' : 'food.restaurant.deliveryPaymentNote')}
                    </p>
                  </div>
                  <div style={{ padding: '14px 20px 20px', borderTop: '1px solid #f1f5f9', flexShrink: 0 }}>
                    <button
                      onClick={submitOrder}
                      disabled={placing || proofUploading || (paymentMethod === 'direct_payment' && requireExternalPaymentProof && !externalPaymentHasSubmission)}
                      style={{ width: '100%', height: 52, background: accent, color: '#fff', border: 'none', borderRadius: 12, fontSize: 16, fontWeight: 700, cursor: placing || proofUploading ? 'wait' : 'pointer', opacity: placing || proofUploading || (paymentMethod === 'direct_payment' && requireExternalPaymentProof && !externalPaymentHasSubmission) ? 0.7 : 1 }}
                    >
                      {placing ? t('food.restaurant.placingOrder') : t('food.restaurant.placeOrderTotal', { total: formatFoodMoney(displayTotalCents, currency) })}
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
                // The confirmation estimate must honor the chosen time slot:
                // delivTime is the ASAP baseline, so offset the range for +15/+30.
                const slotOffsetMin = deliverySlot === '+15' ? 15 : deliverySlot === '+30' ? 30 : 0;
                const confirmedEstimate = slotOffsetMin > 0
                  ? t('food.restaurant.minuteRange', { start: prepMin + slotOffsetMin, end: prepMin + 10 + slotOffsetMin })
                  : delivTime;
                return (
                  <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '40px 24px' }}>
                    <div style={{ width: 72, height: 72, borderRadius: '50%', background: accentBg, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 32, marginBottom: 16, color: accent }}>✓</div>
                    <h2 style={{ fontFamily: SERIF, fontSize: 26, fontWeight: 400, color: '#0f172a', marginBottom: 8, textAlign: 'center' }}>{t('food.order.confirmedTitle')}</h2>
                    <p style={{ fontSize: 14, color: '#64748b', textAlign: 'center', lineHeight: 1.65, marginBottom: 12 }}>
                      {shownOrder?.queue_number != null
                        ? <>{t('food.restaurant.confirmedNumber', { number: shownOrder.queue_number })}<br />{t('food.restaurant.readyShortly')}</>
                        : <>{t('food.restaurant.confirmedPreparing')}<br />{t('food.restaurant.readyNotification')}</>}
                    </p>
                    {/* Live status (socket + poll via the public tracking token) */}
                    {placedTrackingToken && (
                      <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8, padding: '6px 14px', borderRadius: 9999, background: isReady ? '#dcfce7' : '#f1f5f9', border: `1px solid ${isReady ? '#86efac' : '#e2e8f0'}`, marginBottom: 18 }}>
                        <span style={{ width: 8, height: 8, borderRadius: '50%', background: isReady ? '#16a34a' : accent, flexShrink: 0 }} />
                        <span style={{ fontSize: 13, fontWeight: 600, color: isReady ? '#166534' : '#334155' }}>
                          {isReady ? t('food.restaurant.readyForPickupShort') : t('food.restaurant.liveStatus', { status: statusLabel })}
                        </span>
                      </div>
                    )}
                    <div style={{ background: '#f8fafc', borderRadius: 14, padding: '18px 24px', width: '100%', textAlign: 'center', border: '1px solid #e2e8f0', marginBottom: 16 }}>
                      <p style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.07em', color: '#94a3b8', marginBottom: 4 }}>{t('food.restaurant.estimatedTime')}</p>
                      <p style={{ fontFamily: SERIF, fontSize: 28, color: '#0f172a' }}>{confirmedEstimate}</p>
                    </div>
                    <div style={{ display: 'flex', gap: 10, width: '100%' }}>
                      <Link to={`/restaurants/queue/${restaurant.id}`} style={{ flex: 1, textAlign: 'center', height: 44, lineHeight: '44px', background: '#f1f5f9', color: '#0f172a', borderRadius: 10, fontSize: 14, fontWeight: 600, textDecoration: 'none' }}>{t('food.order.watchQueue')}</Link>
                      <button onClick={() => { setCartOpen(false); setCartStep('cart'); setPlacedOrder(null); setPlacedTrackingToken(null); setRecoveredOrder(loadActiveOrder(restaurantId)); setPaymentReference(''); setPaymentNote(''); setKitchenNotes(''); setScheduledFor(null); setScheduleDay('today'); setScheduleTime(''); setItemsExpanded(false); setCardError(''); setPaymentProof(null); setProofMethod('upload'); setPaymentMethod('pay_at_restaurant'); }} style={{ flex: 1, height: 44, background: accent, color: '#fff', border: 'none', borderRadius: 10, fontSize: 14, fontWeight: 600, cursor: 'pointer' }}>{t('food.restaurant.backToMenu')}</button>
                    </div>
                  </div>
                );
              })()}
            </div>
          </>
        )}

        {/* ── CC1: in-checkout credit sheet ── */}
        {creditSheetOpen && (
          <CreditTopupSheet
            restaurantId={restaurantId}
            restaurantName={restaurant.display_name}
            currency={currency}
            wallet={wallet}
            onClose={() => setCreditSheetOpen(false)}
            onWalletRefresh={async () => {
              try {
                const w = await getMyFoodRestaurantWallet(restaurantId);
                setWallet(w && w.status === 'active' ? w : null);
              } catch {
                // The top-up succeeded; the next load shows the balance.
              }
            }}
          />
        )}

        {/* ── Message the restaurant ── */}
        {messageOpen && (
          <>
            <div className="rp-sheet-backdrop" onClick={() => !sendingMessage && setMessageOpen(false)} />
            <div className="rp-sheet" role="dialog" aria-modal="true" aria-label={t('food.restaurant.messageTitle', { name: restaurant.display_name })}>
              <div style={{ padding: '18px 20px 14px', borderBottom: '1px solid #f1f5f9', position: 'relative', flexShrink: 0 }}>
                <div style={{ position: 'absolute', top: 10, left: '50%', transform: 'translateX(-50%)', width: 36, height: 4, borderRadius: 2, background: '#e2e8f0' }} />
                <button onClick={() => !sendingMessage && setMessageOpen(false)} aria-label={t('food.common.close')} style={{ position: 'absolute', top: 14, right: 14, width: 36, height: 36, borderRadius: '50%', background: '#f1f5f9', color: '#64748b', border: 'none', fontSize: 20, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', lineHeight: 1 }}>×</button>
                <h2 style={{ fontSize: 20, fontWeight: 700, color: '#0f172a', marginBottom: 4, paddingRight: 44 }}>{t('food.restaurant.messageTitle', { name: restaurant.display_name })}</h2>
                <p style={{ fontSize: 13, color: '#64748b', lineHeight: 1.5 }}>{t('food.restaurant.messageInboxNote')}</p>
              </div>
              <div style={{ flex: 1, overflowY: 'auto', padding: '16px 20px' }}>
                <p style={{ ...sectionLabel, marginBottom: 8 }}>{t('food.restaurant.messageSubjectLabel')}</p>
                <input
                  value={messageSubject}
                  onChange={(e) => setMessageSubject(e.target.value)}
                  maxLength={160}
                  placeholder={t('food.restaurant.messageSubjectPlaceholder')}
                  disabled={sendingMessage}
                  style={{ width: '100%', height: 48, border: '1.5px solid #e2e8f0', borderRadius: 10, padding: '0 14px', fontSize: 14, color: '#0f172a', outline: 'none', background: '#f8fafc', marginBottom: 16 }}
                />
                <p style={{ ...sectionLabel, marginBottom: 8 }}>{t('food.restaurant.messageBodyLabel')}</p>
                <textarea
                  value={messageBody}
                  onChange={(e) => setMessageBody(e.target.value)}
                  maxLength={2500}
                  placeholder={t('food.restaurant.messageBodyPlaceholder')}
                  disabled={sendingMessage}
                  rows={5}
                  style={{ width: '100%', minHeight: 120, border: '1.5px solid #e2e8f0', borderRadius: 10, padding: 12, fontSize: 14, color: '#0f172a', resize: 'vertical', outline: 'none', background: '#f8fafc', lineHeight: 1.5 }}
                />
              </div>
              <div style={{ padding: '12px 20px 20px', borderTop: '1px solid #f1f5f9', flexShrink: 0, background: '#fff' }}>
                <div style={{ display: 'flex', gap: 10 }}>
                  <button onClick={() => setMessageOpen(false)} disabled={sendingMessage} style={{ flex: 1, height: 50, background: '#fff', color: '#0f172a', border: '1.5px solid #e2e8f0', borderRadius: 12, fontSize: 15, fontWeight: 700, cursor: sendingMessage ? 'not-allowed' : 'pointer', opacity: sendingMessage ? 0.5 : 1 }}>{t('food.common.cancel')}</button>
                  <button onClick={handleSendMessage} disabled={sendingMessage} style={{ flex: 2, height: 50, background: accent, color: '#fff', border: 'none', borderRadius: 12, fontSize: 15, fontWeight: 700, cursor: sendingMessage ? 'not-allowed' : 'pointer', opacity: sendingMessage ? 0.6 : 1 }}>{sendingMessage ? t('food.restaurant.sendingMessage') : t('food.restaurant.sendMessage')}</button>
                </div>
              </div>
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
                <button onClick={() => setModalItem(null)} aria-label={t('food.common.close')} style={{ position: 'absolute', top: 14, right: 14, width: 36, height: 36, borderRadius: '50%', background: 'rgba(0,0,0,0.35)', color: '#fff', border: 'none', fontSize: 20, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', lineHeight: 1, backdropFilter: 'blur(8px)' }}>×</button>
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
                    <p style={{ ...sectionLabel, color: '#64748b', marginBottom: 10 }}>{group.name}{group.isRequired && <span style={{ color: accent, marginLeft: 6, textTransform: 'none', letterSpacing: 0 }}>{t('food.restaurant.required')}</span>}</p>
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
                  <p style={{ ...sectionLabel, color: '#64748b', marginBottom: 8 }}>{t('food.restaurant.specialInstructions')} <span style={{ textTransform: 'none', fontWeight: 400, color: '#94a3b8' }}>({t('food.restaurant.optional')})</span></p>
                  <textarea value={modalInstructions} onChange={(e) => setModalInstructions(e.target.value)} maxLength={500} placeholder={t('food.restaurant.specialInstructionsPlaceholder')} style={{ width: '100%', height: 80, border: '1.5px solid #e2e8f0', borderRadius: 10, padding: 12, fontSize: 14, color: '#0f172a', resize: 'none', outline: 'none', background: '#f8fafc', lineHeight: 1.5 }} />
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
                  <button onClick={modalAddToCart} disabled={modalMissingRequired} style={{ flex: 1, height: 50, background: accent, color: '#fff', border: 'none', borderRadius: 12, fontSize: 15, fontWeight: 700, cursor: modalMissingRequired ? 'not-allowed' : 'pointer', opacity: modalMissingRequired ? 0.5 : 1, whiteSpace: 'nowrap' }}>{t('food.restaurant.addQuantity', { count: modalQty, total: modalLineTotal })}</button>
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

// CC7: Stripe Elements card form for in-checkout card payments. Exposes an
// imperative confirmCardPayment(clientSecret) so the parent can run the
// intent → confirm → place-order flow when Place order is tapped.
const CheckoutCardForm = React.forwardRef(function CheckoutCardForm({ onExpressConfirm }, ref) {
  const { t } = useTranslation();
  const stripe = useStripe();
  const elements = useElements();
  const [savedMethods, setSavedMethods] = React.useState([]);
  const [selectedMethod, setSelectedMethod] = React.useState('new');
  React.useEffect(() => {
    let cancelled = false;
    listSavedPaymentMethods()
      .then((methods) => { if (!cancelled) setSavedMethods(methods); })
      .catch(() => { /* saved cards are a progressive enhancement */ });
    return () => { cancelled = true; };
  }, []);
  useImperativeHandle(ref, () => ({
    async confirmCardPayment(clientSecret) {
      if (!stripe || !elements) {
        return { error: { message: 'Stripe is not ready yet' }, paymentIntent: null };
      }
      // One-tap: confirm with a saved payment method id.
      if (selectedMethod !== 'new') {
        return stripe.confirmCardPayment(clientSecret, {
          payment_method: selectedMethod,
        });
      }
      return stripe.confirmCardPayment(clientSecret, {
        payment_method: { card: elements.getElement(CardElement) },
      });
    },
    getStripeInstances() {
      return { stripe, elements };
    },
  }), [stripe, elements, selectedMethod]);
  return (
    <div style={{ display: 'grid', gap: 10 }}>
      {onExpressConfirm && (
        <ExpressCheckoutElement
          options={{
            paymentMethods: { applePay: 'auto', googlePay: 'auto', link: 'auto' },
          }}
          onConfirm={onExpressConfirm}
        />
      )}
      {savedMethods.length > 0 && (
        <div style={{ display: 'grid', gap: 8 }}>
          {savedMethods.map((pm) => (
            <label
              key={pm.id}
              style={{
                display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px',
                border: `1.5px solid ${selectedMethod === pm.id ? '#f97316' : '#e2e8f0'}`,
                borderRadius: 10, background: '#fff', cursor: 'pointer', fontSize: 14,
              }}
            >
              <input
                type="radio"
                name="saved-card"
                checked={selectedMethod === pm.id}
                onChange={() => setSelectedMethod(pm.id)}
              />
              <span style={{ fontWeight: 700, textTransform: 'capitalize' }}>{pm.brand}</span>
              <span style={{ color: '#64748b' }}>•••• {pm.last4}</span>
              {pm.expMonth && pm.expYear && (
                <span style={{ color: '#94a3b8', fontSize: 12 }}>
                  {String(pm.expMonth).padStart(2, '0')}/{String(pm.expYear).slice(-2)}
                </span>
              )}
            </label>
          ))}
          <label
            style={{
              display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px',
              border: `1.5px solid ${selectedMethod === 'new' ? '#f97316' : '#e2e8f0'}`,
              borderRadius: 10, background: '#fff', cursor: 'pointer', fontSize: 14,
            }}
          >
            <input
              type="radio"
              name="saved-card"
              checked={selectedMethod === 'new'}
              onChange={() => setSelectedMethod('new')}
            />
            <span style={{ fontWeight: 600 }}>{t('food.restaurant.useNewCard')}</span>
          </label>
        </div>
      )}
      {selectedMethod === 'new' && (
        <div style={{ border: '1.5px solid #e2e8f0', borderRadius: 10, padding: '12px 14px', background: '#fff' }}>
          <CardElement options={{ style: { base: { fontSize: '16px', color: '#0f172a' } } }} />
        </div>
      )}
    </div>
  );
});

// CC1: in-checkout restaurant-credit bottom sheet. Shows the wallet balance
// and quick top-up amounts, reusing the same credit API calls as the
// /restaurant-credit page (eligibility, intent, step-up challenge, card
// confirm, status polling). Closing the sheet returns to the payment step
// with all checkout state intact.
function CreditTopupSheet({ restaurantId, restaurantName, currency, wallet, onClose, onWalletRefresh }) {
  const { t } = useTranslation();
  const { t: tCredit } = useTranslation('credit');
  const [eligible, setEligible] = useState(null); // null = checking
  const [step, setStep] = useState('main'); // main | stepup | card | processing
  const [amountText, setAmountText] = useState('');
  const [amountCents, setAmountCents] = useState(0);
  const [amountError, setAmountError] = useState('');
  const [challenge, setChallenge] = useState(null);
  const [code, setCode] = useState('');
  const [intent, setIntent] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [sheetCardError, setSheetCardError] = useState('');
  const [terminal, setTerminal] = useState(null);
  const pollTimerRef = useRef(null);
  const pollCountRef = useRef(0);
  const sheetCardFormRef = useRef(null);

  const availableCents = Number(
    wallet?.availableBalanceCents
      ?? Math.max(0, Number(wallet?.balanceCents || 0) - Number(wallet?.reservedCents || 0))
  );

  useEffect(() => {
    let alive = true;
    getRestaurantTopupEligibility(restaurantId)
      .then((data) => { if (alive) setEligible(data?.eligibility?.status === 'approved'); })
      .catch(() => { if (alive) setEligible(false); });
    return () => { alive = false; };
  }, [restaurantId]);

  const stopPolling = () => {
    if (pollTimerRef.current) {
      clearTimeout(pollTimerRef.current);
      pollTimerRef.current = null;
    }
  };
  useEffect(() => stopPolling, []);

  const startPolling = (topupId, cents) => {
    stopPolling();
    pollCountRef.current = 0;
    setStep('processing');
    const tick = async () => {
      pollCountRef.current += 1;
      let status = null;
      try {
        const data = await getRestaurantTopup(restaurantId, topupId);
        status = data?.topup?.status || null;
      } catch {
        status = null;
      }
      if (status === 'succeeded') {
        stopPolling();
        toast.success(t('food.restaurant.creditSheetTopupSuccess'));
        try {
          await onWalletRefresh();
        } catch {
          // The wallet refresh failing does not undo the credit; the next
          // render shows the updated balance.
        }
        onClose();
        return;
      }
      if (status === 'failed' || status === 'canceled') {
        stopPolling();
        setTerminal({ tone: 'error', message: t('food.restaurant.creditSheetTopupError') });
        return;
      }
      if (pollCountRef.current >= CREDIT_TOPUP_POLL_MAX_ATTEMPTS) {
        stopPolling();
        setTerminal({ tone: 'info', message: tCredit('restaurantTopups.timeout') });
        return;
      }
      pollTimerRef.current = setTimeout(tick, CREDIT_TOPUP_POLL_INTERVAL_MS);
    };
    pollTimerRef.current = setTimeout(tick, CREDIT_TOPUP_POLL_INTERVAL_MS);
  };

  const beginIntent = async (cents, stepup) => {
    setSubmitting(true);
    try {
      const idempotencyKey = globalThis.crypto?.randomUUID?.()
        || `${Date.now()}-${Math.random().toString(36).slice(2)}`;
      const payload = { amountCents: cents };
      if (stepup) {
        payload.stepupChallengeId = stepup.challengeId;
        payload.stepupCode = stepup.code;
      }
      const result = await createRestaurantTopupIntent(restaurantId, payload, idempotencyKey);
      const topupId = result?.topup?.id;
      if (!topupId) throw new Error('topup-intent-missing');
      if (result?.replayed || !result?.clientSecret) {
        // Replayed idempotency key (or nothing to confirm): skip the card
        // form and go straight to status polling.
        startPolling(topupId, cents);
      } else {
        setIntent({ topupId, clientSecret: result.clientSecret });
        setStep('card');
      }
    } catch (error) {
      toast.error(safeCreditErrorMessage(error, t('food.restaurant.creditSheetTopupError')));
    } finally {
      setSubmitting(false);
    }
  };

  const submitAmount = async (event) => {
    if (event?.preventDefault) event.preventDefault();
    const cents = parseCreditMajorAmount(amountText, currency) || 0;
    if (!cents || cents < CREDIT_TOPUP_MIN_CENTS || cents > CREDIT_TOPUP_MAX_CENTS) {
      setAmountError(tCredit('restaurantTopups.invalidAmount', {
        min: formatFoodMoney(CREDIT_TOPUP_MIN_CENTS, currency),
        max: formatFoodMoney(CREDIT_TOPUP_MAX_CENTS, currency),
      }));
      return;
    }
    setAmountError('');
    setAmountCents(cents);
    if (cents >= CREDIT_TOPUP_STEPUP_CENTS) {
      setSubmitting(true);
      try {
        const issued = await issueRestaurantTopupStepupChallenge(restaurantId, { amountCents: cents });
        if (!issued?.challenge?.id) throw new Error('challenge-missing');
        setChallenge({ id: issued.challenge.id });
        setCode('');
        setStep('stepup');
        toast.success(tCredit('restaurantTopups.challengeSent'));
      } catch (error) {
        toast.error(safeCreditErrorMessage(error, tCredit('restaurantTopups.challengeFailed')));
      } finally {
        setSubmitting(false);
      }
      return;
    }
    await beginIntent(cents, null);
  };

  const submitStepup = async (event) => {
    event.preventDefault();
    if (!challenge?.id || !code.trim()) {
      toast.error(tCredit('restaurantTopups.invalidCode'));
      return;
    }
    await beginIntent(amountCents, { challengeId: challenge.id, code: code.trim() });
  };

  const confirmTopupCard = async (event) => {
    event.preventDefault();
    if (!sheetCardFormRef.current || !intent?.clientSecret) return;
    setSubmitting(true);
    setSheetCardError('');
    try {
      const { error, paymentIntent } = await sheetCardFormRef.current.confirmCardPayment(intent.clientSecret);
      if (error) {
        setSheetCardError(error.message || tCredit('restaurantTopups.cardFailed'));
        return;
      }
      if (paymentIntent && ['succeeded', 'processing', 'requires_capture'].includes(paymentIntent.status)) {
        startPolling(intent.topupId, amountCents);
      } else {
        setSheetCardError(tCredit('restaurantTopups.cardFailed'));
      }
    } finally {
      setSubmitting(false);
    }
  };

  const close = () => {
    stopPolling();
    onClose();
  };

  return (
    <>
      <div className="rp-sheet-backdrop" onClick={close} />
      <div className="rp-sheet" role="dialog" aria-modal="true" aria-label={t('food.restaurant.creditSheetTitle')}>
        <div style={{ padding: '18px 20px 14px', borderBottom: '1px solid #f1f5f9', position: 'relative', flexShrink: 0 }}>
          <div style={{ position: 'absolute', top: 10, left: '50%', transform: 'translateX(-50%)', width: 36, height: 4, borderRadius: 2, background: '#e2e8f0' }} />
          <button onClick={close} aria-label={t('food.common.close')} style={{ position: 'absolute', top: 14, right: 14, width: 36, height: 36, borderRadius: '50%', background: '#f1f5f9', color: '#64748b', border: 'none', fontSize: 20, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', lineHeight: 1 }}>×</button>
          <h2 style={{ fontSize: 20, fontWeight: 700, color: '#0f172a', marginBottom: 4, paddingRight: 44 }}>{t('food.restaurant.creditSheetTitle')}</h2>
          <p style={{ fontSize: 13, color: '#64748b' }}>{restaurantName}</p>
        </div>
        <div style={{ flex: 1, overflowY: 'auto', padding: '16px 20px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 12, padding: '12px 16px', marginBottom: 16 }}>
            <span style={{ fontSize: 13, color: '#64748b', fontWeight: 600 }}>{t('food.restaurant.creditSheetBalance')}</span>
            <span style={{ fontSize: 18, fontWeight: 800, color: '#0f172a' }}>{formatFoodMoney(availableCents, wallet?.currencyCode || currency)}</span>
          </div>
          {terminal ? (
            <div>
              <p role={terminal.tone === 'error' ? 'alert' : 'status'} style={{ fontSize: 14, color: terminal.tone === 'error' ? '#b91c1c' : '#475569', lineHeight: 1.6, marginBottom: 12 }}>{terminal.message}</p>
              <button type="button" onClick={close} style={{ width: '100%', height: 48, background: '#f1f5f9', color: '#0f172a', border: 'none', borderRadius: 12, fontSize: 15, fontWeight: 700, cursor: 'pointer' }}>{t('food.common.close')}</button>
            </div>
          ) : step === 'main' ? (
            <>
              <p style={{ fontSize: 13, fontWeight: 700, color: '#0f172a', marginBottom: 10 }}>{t('food.restaurant.creditSheetTopup')}</p>
              {eligible === false && (
                <p role="note" style={{ fontSize: 13, color: '#b45309', background: '#fffbeb', border: '1px solid #fde68a', borderRadius: 10, padding: '10px 12px', marginBottom: 12, lineHeight: 1.5 }}>
                  {t('food.restaurant.creditSheetNotEligible')}
                </p>
              )}
              {!stripePromise && (
                <p role="alert" style={{ fontSize: 13, color: '#b45309', background: '#fffbeb', border: '1px solid #fde68a', borderRadius: 10, padding: '10px 12px', marginBottom: 12, lineHeight: 1.5 }}>
                  {t('food.restaurant.creditSheetStripeUnavailable')}
                </p>
              )}
              <form onSubmit={submitAmount}>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
                  {CREDIT_TOPUP_QUICK_AMOUNTS.map((quick) => (
                    <button
                      key={quick}
                      type="button"
                      onClick={() => { setAmountText(String(quick)); setAmountError(''); }}
                      style={{ height: 40, padding: '0 16px', borderRadius: 9999, border: `1.5px solid ${amountText === String(quick) ? '#ff8c00' : '#e2e8f0'}`, background: amountText === String(quick) ? 'rgba(255,140,0,0.12)' : '#fff', color: amountText === String(quick) ? '#ff8c00' : '#475569', fontSize: 13, fontWeight: 700, cursor: 'pointer' }}
                    >
                      {formatFoodMoney(quick * 100, currency)}
                    </button>
                  ))}
                </div>
                <input
                  value={amountText}
                  onChange={(e) => { setAmountText(e.target.value); setAmountError(''); }}
                  placeholder="0.00"
                  inputMode="decimal"
                  aria-label={t('food.restaurant.creditSheetTopup')}
                  style={{ width: '100%', height: 48, border: '1.5px solid #e2e8f0', borderRadius: 10, padding: '0 14px', fontSize: 16, color: '#0f172a', outline: 'none', background: '#f8fafc', marginBottom: 8 }}
                />
                {amountError && <p role="alert" style={{ fontSize: 13, color: '#b91c1c', marginBottom: 8 }}>{amountError}</p>}
                <p style={{ fontSize: 12, color: '#94a3b8', marginBottom: 12 }}>
                  {t('food.restaurant.creditSheetTopupHint', {
                    min: formatFoodMoney(CREDIT_TOPUP_MIN_CENTS, currency),
                    max: formatFoodMoney(CREDIT_TOPUP_MAX_CENTS, currency),
                  })}
                </p>
                <button
                  type="submit"
                  disabled={submitting || eligible === false || !stripePromise}
                  style={{ width: '100%', height: 50, background: '#ff8c00', color: '#fff', border: 'none', borderRadius: 12, fontSize: 15, fontWeight: 700, cursor: submitting ? 'wait' : 'pointer', opacity: submitting || eligible === false || !stripePromise ? 0.6 : 1 }}
                >
                  {submitting ? tCredit('restaurantTopups.processing') : t('food.restaurant.creditSheetTopup')}
                </button>
              </form>
            </>
          ) : step === 'stepup' ? (
            <form onSubmit={submitStepup}>
              <p style={{ fontSize: 14, color: '#475569', lineHeight: 1.6, marginBottom: 12 }}>
                <strong style={{ color: '#0f172a' }}>{tCredit('restaurantTopups.stepupTitle')}</strong><br />
                {tCredit('restaurantTopups.stepupCopy')}
              </p>
              <input
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 12))}
                placeholder={tCredit('restaurantTopups.stepupCodePlaceholder')}
                inputMode="numeric"
                aria-label={tCredit('restaurantTopups.stepupCode')}
                style={{ width: '100%', height: 48, border: '1.5px solid #e2e8f0', borderRadius: 10, padding: '0 14px', fontSize: 16, color: '#0f172a', outline: 'none', background: '#f8fafc', marginBottom: 12 }}
              />
              <button
                type="submit"
                disabled={submitting}
                style={{ width: '100%', height: 50, background: '#ff8c00', color: '#fff', border: 'none', borderRadius: 12, fontSize: 15, fontWeight: 700, cursor: submitting ? 'wait' : 'pointer', opacity: submitting ? 0.6 : 1 }}
              >
                {submitting ? tCredit('restaurantTopups.processing') : tCredit('restaurantTopups.verifyAndContinue')}
              </button>
            </form>
          ) : step === 'card' && intent?.clientSecret ? (
            <form onSubmit={confirmTopupCard}>
              <p style={{ fontSize: 14, color: '#475569', lineHeight: 1.6, marginBottom: 12 }}>
                {tCredit('restaurantTopups.cardCopy', { amount: formatFoodMoney(amountCents, currency) })}
              </p>
              <p style={{ fontSize: 13, fontWeight: 700, color: '#0f172a', marginBottom: 8 }}>{tCredit('restaurantTopups.cardDetails')}</p>
              <Elements stripe={stripePromise}>
                <CheckoutCardForm ref={sheetCardFormRef} />
              </Elements>
              {sheetCardError && <p role="alert" style={{ fontSize: 13, fontWeight: 600, color: '#b91c1c', marginTop: 10 }}>{sheetCardError}</p>}
              <button
                type="submit"
                disabled={submitting}
                style={{ width: '100%', height: 50, background: '#ff8c00', color: '#fff', border: 'none', borderRadius: 12, fontSize: 15, fontWeight: 700, cursor: submitting ? 'wait' : 'pointer', opacity: submitting ? 0.6 : 1, marginTop: 12 }}
              >
                {submitting ? tCredit('restaurantTopups.processing') : tCredit('restaurantTopups.pay', { amount: formatFoodMoney(amountCents, currency) })}
              </button>
            </form>
          ) : (
            <div>
              <p role="status" style={{ fontSize: 14, color: '#475569', marginBottom: 12 }}>⏳ {tCredit('restaurantTopups.confirming')}</p>
              <button type="button" onClick={close} style={{ width: '100%', height: 48, background: '#f1f5f9', color: '#0f172a', border: 'none', borderRadius: 12, fontSize: 15, fontWeight: 700, cursor: 'pointer' }}>{t('food.common.close')}</button>
            </div>
          )}
        </div>
      </div>
    </>
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
          <button onClick={onClose} aria-label={tr('food.common.close', { defaultValue: 'Close' })} style={{ position: 'absolute', top: 14, right: 14, width: 36, height: 36, borderRadius: '50%', background: 'rgba(0,0,0,0.35)', color: '#fff', border: 'none', fontSize: 20, cursor: 'pointer', lineHeight: 1 }}>×</button>
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
              <p style={label}>{group.name}{group.isRequired && <span style={{ color: accent, marginLeft: 6, textTransform: 'none', letterSpacing: 0 }}>{tr('food.restaurant.required', { defaultValue: 'Required' })}</span>}</p>
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
            <p style={label}>{tr('food.restaurant.specialInstructions', { defaultValue: 'Special instructions' })} <span style={{ textTransform: 'none', fontWeight: 400, color: '#94a3b8' }}>({tr('food.restaurant.optional', { defaultValue: 'optional' })})</span></p>
            <textarea value={instructions} onChange={(e) => setInstructions(e.target.value)} maxLength={500} rows={2} placeholder={tr('food.restaurant.allergyPlaceholder', { defaultValue: 'Allergies, substitutions…' })} style={{ width: '100%', minHeight: 70, border: '1.5px solid #e2e8f0', borderRadius: 10, padding: 12, fontSize: 14, color: '#0f172a', resize: 'none', outline: 'none', background: '#f8fafc', lineHeight: 1.5 }} />
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
