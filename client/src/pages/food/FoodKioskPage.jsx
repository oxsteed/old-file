// OxSteed Food - in-store self-order kiosk. Fullscreen tablet experience,
// McDonald's style: touch to start -> eat in / take out -> build order ->
// confirm -> big queue number, then auto-reset for the next guest.
// Guests order without an account; payment happens at the counter.
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import {
  getFoodRestaurant,
  placeFoodOrder,
  formatFoodMoney,
  quoteFoodOrder,
} from "../../api/food";
import { isFoodNetworkFailure } from "../../api/foodOfflineQueue";
import { getDeviceCreditReceipt, placeDeviceCreditOrder, placeDeviceOrder } from "../../restaurantScreens/api";
import {
  getCache,
  putCache,
  stageTicket,
  setTicketState,
  enqueueOperation,
} from "../../restaurantScreens/storage";
import { subscribeRestaurantDisplay } from "../../api/restaurantDisplaySocket";
import DisplayFullscreenToggle from "../../components/DisplayFullscreenToggle";
import DisplayOfflineBanner from "../../components/DisplayOfflineBanner";
import DisplayInstallPrompt from "../../components/DisplayInstallPrompt";
import DisplayPairingCode from "../../components/DisplayPairingCode";
import { useFullscreen } from "../../hooks/useFullscreen";
import { useWakeLock } from "../../hooks/useWakeLock";
import { useDisplayPoller } from "../../hooks/useDisplayPoller";
import { detectDisplayStandalone } from "../../utils/displayInstall";
import { FoodBrand } from "./foodShared";
import { ItemModal } from "./FoodRestaurantPage";
import FoodOrderConfirmation from "./FoodOrderConfirmation";
import { kioskIdleResetMs } from "../../utils/kioskIdle";
import "../../styles/FoodPages.css";

const CREDIT_DECLINES = new Set([
  "credit_kiosk_disabled", "credit_kiosk_card_required", "credit_kiosk_quote_required",
  "credit_kiosk_currency_unsupported", "credit_card_not_found", "credit_card_pin_incorrect",
  "credit_card_pin_locked", "credit_card_frozen", "credit_card_inactive", "credit_card_expired",
  "credit_card_customer_inactive", "credit_card_pin_not_set",
  "credit_insufficient_funds", "insufficient_credit_balance", "screen_price_conflict",
  "credit_rail_suspended", "credit_rail_frozen", "credit_surface_not_allowed",
  "credit_partner_not_eligible", "validation_failed",
]);

// Fixed-position overlays shared by every kiosk step screen.
function KioskOverlays({ rootRef, offline }) {
  return (
    <>
      <DisplayOfflineBanner offline={offline} />
      <DisplayFullscreenToggle targetRef={rootRef} />
      <DisplayInstallPrompt />
      <DisplayPairingCode />
    </>
  );
}

export default function FoodKioskPage({ managed = null, preview = false }) {
  const { restaurantId } = useParams();
  const { t } = useTranslation();
  const { t: screenT } = useTranslation("common");
  const f = (key, args) => screenT(`screens.${key}`, args);
  const storageScope = managed?.scope || `public-kiosk:${restaurantId}`;
  const storeLocationId = managed?.device?.locationId || null;
  const creditStorageKey = managed?.device && !managed.captureOnly && !preview
    ? `${storageScope}:credit-attempt`
    : null;
  const [creditAttempt, setCreditAttempt] = useState(() => {
    try { return creditStorageKey ? sessionStorage.getItem(creditStorageKey) : null; }
    catch { return null; }
  });
  const [creditReceipt, setCreditReceipt] = useState(null);
  const [creditError, setCreditError] = useState(null);
  const creditBusy = useRef(false);
  const counterBusy = useRef(false);
  const clientIdRef = useRef(null);
  const sessionRef = useRef(0);
  const [quoted, setQuoted] = useState(null);
  const [data, setData] = useState(null);
  const [step, setStep] = useState("start"); // start | mode | menu | review | done
  const [fulfillment, setFulfillment] = useState("dine_in");
  const [cart, setCart] = useState([]);
  const [activeItem, setActiveItem] = useState(null);
  const [guestName, setGuestName] = useState("");
  const [placing, setPlacing] = useState(false);
  const [placedOrder, setPlacedOrder] = useState(null);
  const [trackingToken, setTrackingToken] = useState(null);
  const [orderError, setOrderError] = useState(false);
  const [offlineSaved, setOfflineSaved] = useState(false);
  const resetTimer = useRef(null);
  const rootRef = useRef(null);
  const { isFullscreen } = useFullscreen(rootRef);
  // Installed standalone apps (Add to Home Screen) never enter the
  // Fullscreen API state, so wake lock keys off that too.
  const [isStandalone] = useState(() =>
    detectDisplayStandalone({
      matchMedia: typeof window !== "undefined" ? window.matchMedia?.bind(window) : undefined,
      standalone: typeof window !== "undefined" ? window.navigator?.standalone : undefined,
    }),
  );
  useWakeLock(isFullscreen || isStandalone);
  const orderingPaused =
    (managed?.acceptingOrders ?? data?.restaurant?.accepts_in_store_orders) ===
    false;

  useEffect(() => {
    if (step !== "start") return;
    let live = true;
    getFoodRestaurant(restaurantId, storeLocationId ? { locationId: storeLocationId } : {})
      .then((next) => {
        if (live) setData(next);
        putCache(`${storageScope}:menu`, next).catch(() => {});
      })
      .catch(async () => {
        const cached = await getCache(`${storageScope}:menu`).catch(() => null);
        if (live) setData(cached);
      });
    return () => {
      live = false;
    };
  }, [restaurantId, storeLocationId, managed?.cursor, step === "start"]);
  useEffect(() => {
    managed?.sessionIdle?.(step === "start" && !creditAttempt && !creditReceipt);
  }, [step, managed?.sessionIdle, creditAttempt, creditReceipt]);
  // Menu refresh: steady poll while healthy, exponential backoff while
  // failing. The kiosk keeps showing its cached menu (last-known state) and
  // the offline banner appears when the feed is unreachable.
  const pollMenu = useCallback(
    () =>
      getFoodRestaurant(restaurantId, storeLocationId ? { locationId: storeLocationId } : {}).then((next) => {
        setData(next);
      }),
    [restaurantId, storeLocationId],
  );
  const { offline } = useDisplayPoller(pollMenu, {
    intervalMs: 5000,
    enabled: !managed,
  });
  useEffect(() => {
    if (managed) return undefined;
    // Live updates (instant) layered over the poll (fallback).
    return subscribeRestaurantDisplay(restaurantId, () =>
      pollMenu().catch(() => {}),
    );
  }, [restaurantId, !!managed, pollMenu]);

  const resetAll = () => {
    clearTimeout(resetTimer.current);
    sessionRef.current++;
    clientIdRef.current = null;
    setQuoted(null);
    setPlacing(false);
    setStep("start");
    setCart([]);
    setGuestName("");
    setPlacedOrder(null);
    setTrackingToken(null);
    setOrderError(false);
    setOfflineSaved(false);
    setActiveItem(null);
    setCreditReceipt(null);
    setCreditError(null);
  };

  useEffect(
    () => () => {
      sessionRef.current++;
      clearTimeout(resetTimer.current);
    },
    [],
  );
  useEffect(() => {
    // The payment/confirm step gets a longer window: a guest reading the
    // quoted total or typing card + PIN must not lose the cart after 60s
    // of stillness. creditAttempt only exists once the credit form is
    // submitted, so it cannot exempt entry/review on its own (M17).
    const timeoutMs = kioskIdleResetMs({ step, quoted, placing, creditAttempt, creditReceipt });
    if (timeoutMs === null) return;
    const reset = () => {
      clearTimeout(resetTimer.current);
      resetTimer.current = setTimeout(resetAll, timeoutMs);
    };
    reset();
    window.addEventListener("pointerdown", reset);
    window.addEventListener("keydown", reset);
    return () => {
      clearTimeout(resetTimer.current);
      window.removeEventListener("pointerdown", reset);
      window.removeEventListener("keydown", reset);
    };
  }, [step, placing, creditAttempt, creditReceipt, quoted]);

  const currency = data?.restaurant?.currency_code || "USD";
  const total = useMemo(
    () => cart.reduce((s, l) => s + l.unitTotalCents * l.quantity, 0),
    [cart],
  );
  const sections = useMemo(() => {
    if (!data) return [];
    return [
      ...(data.menu || []),
      ...((data.uncategorizedItems || []).length
        ? [
            {
              id: "other",
              name: t("food.restaurant.otherItems"),
              items: data.uncategorizedItems,
            },
          ]
        : []),
    ];
  }, [data, t]);

  useEffect(() => {
    if (step !== "review") return;
    let live = true;
    setQuoted(null);
    const payload = {
      orderSource: "kiosk",
      ...(storeLocationId ? { locationId: storeLocationId } : {}),
      fulfillmentType: fulfillment,
      paymentMode: "pay_at_counter",
      items: cart.map((line) => ({
        menuItemId: line.menuItemId,
        quantity: line.quantity,
        modifierIds: line.modifierIds,
        specialInstructions: line.specialInstructions,
      })),
    };
    quoteFoodOrder(restaurantId, payload)
      .then((result) => {
        if (live) setQuoted(result.quote || result);
      })
      .catch((error) => {
        if (live) {
          if (isFoodNetworkFailure(error) || !navigator.onLine)
            setQuoted({ totalCents: total, estimated: true });
          else setOrderError(true);
        }
      });
    return () => {
      live = false;
    };
  }, [!!managed, step, cart, fulfillment, restaurantId, storeLocationId, total]);

  const clearCreditAttempt = () => {
    try { sessionStorage.removeItem(creditStorageKey); } catch { /* A reload can look up the same receipt again. */ }
    setCreditAttempt(null);
  };

  const showCreditReceipt = (receipt) => {
    if (!receipt?.orderId || !Number.isSafeInteger(receipt.amountCents)) throw new Error("Invalid Credit receipt");
    clearCreditAttempt();
    setCreditReceipt(receipt);
  };

  const payWithCredit = async (event) => {
    event.preventDefault();
    if (creditBusy.current || counterBusy.current || creditAttempt || placing || orderingPaused || managed?.enabled === false
      || !creditStorageKey || !managed?.creditCheckoutEnabled || quoted?.estimated
      || !Number.isSafeInteger(quoted?.totalCents) || quoted.totalCents <= 0
      || !Array.isArray(quoted.menuFingerprint) || !navigator.onLine) return;
    const fields = new FormData(event.currentTarget);
    event.currentTarget.reset();
    const attemptId = crypto.randomUUID();
    try { sessionStorage.setItem(creditStorageKey, attemptId); }
    catch { setCreditError("creditStorageUnavailable"); return; }
    creditBusy.current = true;
    setPlacing(true);
    setCreditAttempt(attemptId);
    setCreditError(null);
    try {
      const receipt = await placeDeviceCreditOrder(restaurantId, managed.device, attemptId, {
        credential: fields.get("credential"),
        pin: fields.get("pin"),
        expectedTotalCents: quoted.totalCents,
        menuFingerprint: quoted.menuFingerprint,
        fulfillmentType: fulfillment,
        items: cart.map(({ menuItemId, quantity, modifierIds, specialInstructions }) => ({
          menuItemId, quantity, modifierIds, specialInstructions,
        })),
      });
      showCreditReceipt(receipt);
    } catch (error) {
      const code = error.response?.data?.code;
      if (CREDIT_DECLINES.has(code)) {
        clearCreditAttempt();
        if (code === "screen_price_conflict") {
          setQuoted(null);
          setStep("menu");
        }
        setCreditError(code === "screen_price_conflict" ? "priceConflict" : "creditDeclined");
      }
    } finally {
      creditBusy.current = false;
      setPlacing(false);
    }
  };

  const recoverCreditReceipt = async () => {
    if (creditBusy.current || !creditAttempt || !creditStorageKey) return;
    creditBusy.current = true;
    setPlacing(true);
    setCreditError(null);
    try {
      showCreditReceipt(await getDeviceCreditReceipt(restaurantId, managed.device, creditAttempt));
    } catch {
      setCreditError("creditReceiptPending");
    } finally {
      creditBusy.current = false;
      setPlacing(false);
    }
  };

  const submit = async () => {
    if (preview || placing || creditBusy.current || counterBusy.current || creditAttempt
        || orderingPaused || managed?.enabled === false)
      return;
    counterBusy.current = true;
    const session = sessionRef.current;
    setPlacing(true);
    setOrderError(false);
    setOfflineSaved(false);
    const clientOrderId =
      clientIdRef.current || (clientIdRef.current = crypto.randomUUID());
    const payload = {
      expectedTotalCents: Number(
        quoted?.totalCents ?? quoted?.total_cents ?? total,
      ),
      menuFingerprint: quoted?.menuFingerprint,
      orderSource: "kiosk",
      paymentMode: "pay_at_counter",
      fulfillmentType: fulfillment,
      guestName: guestName.trim() || undefined,
      client_order_id: clientOrderId,
      items: cart.map((line) => ({
        menuItemId: line.menuItemId,
        quantity: line.quantity,
        modifierIds: line.modifierIds,
        specialInstructions: line.specialInstructions,
      })),
    };
    const durableTicket = {
      id: clientOrderId,
      type: "unpaid_ticket",
      restaurantId: String(restaurantId),
      locationId: managed?.device?.locationId || null,
      expectedTotalCents: Number(
        quoted?.totalCents ?? quoted?.total_cents ?? total,
      ),
      payload: {
        ...payload,
        items: payload.items.map((item, index) => ({
          ...item,
          itemName: cart[index]?.name || cart[index]?.itemName || "",
        })),
      },
    };
    const saveTicket = async () => {
      if (managed) {
        await setTicketState(managed.scope, clientOrderId, "pending");
        await managed.enqueue(durableTicket);
      } else {
        await setTicketState(storageScope, clientOrderId, "pending");
        await enqueueOperation(storageScope, durableTicket);
      }

      if (session !== sessionRef.current) return;
      setCart([]);
      setOfflineSaved(true);
      setStep("offline");
    };
    try {
      if (managed?.captureOnly) {
        await saveTicket();
        return;
      }
      await stageTicket(storageScope, durableTicket);
      const { order, trackingToken: token } = managed
        ? await placeDeviceOrder(restaurantId, managed.device, {
            ...payload,
            expectedTotalCents: Number(
              quoted?.totalCents ?? quoted?.total_cents ?? total,
            ),
          })
        : await placeFoodOrder(restaurantId, payload);
      await setTicketState(storageScope, clientOrderId, "sent");
      if (session !== sessionRef.current) return;
      setPlacedOrder(order);
      setTrackingToken(token || null);
      setStep("done");
      resetTimer.current = setTimeout(resetAll, 60000);
    } catch (error) {
      if (isFoodNetworkFailure(error) || !navigator.onLine) {
        try {
          await saveTicket();
        } catch {
          setOrderError(true);
        }
      } else {
        await setTicketState(storageScope, clientOrderId, "review").catch(
          () => {},
        );
        if (session === sessionRef.current) setOrderError(true);
      }
    } finally {
      counterBusy.current = false;
      if (session === sessionRef.current) setPlacing(false);
    }
  };

  if (creditAttempt || creditReceipt) {
    return (
      <div className="fd-screen" ref={rootRef}>
        <KioskOverlays rootRef={rootRef} offline={offline} />
        <section className="fd-kiosk-start" aria-live="polite" data-track-private>
          <h1>{f(creditReceipt ? "creditReceipt" : "creditChecking")}</h1>
          {creditReceipt ? (
            <>
              <p>{t("food.order.yourNumber")}</p>
              <div className="fd-queue-big">#{creditReceipt.queueNumber}</div>
              <p>{f(creditReceipt.paymentStatus === "paid" ? "creditPaid" : "creditPaymentChanged")}</p>
              <p>{t("food.order.total")}: <strong>{formatFoodMoney(creditReceipt.amountCents, creditReceipt.currencyCode)}</strong></p>
              <p>{f("creditOrderReference", { id: creditReceipt.orderId })}</p>
              <button className="fd-btn" type="button" onClick={resetAll}>{t("food.kiosk.startOver")}</button>
            </>
          ) : (
            <>
              <p>{f("creditReceiptPending")}</p>
              <p>{f("creditOrderReference", { id: creditAttempt })}</p>
              <button className="fd-btn" type="button" disabled={placing} onClick={recoverCreditReceipt}>
                {f("creditCheckReceipt")}
              </button>
              {creditError && <p role="status">{f(creditError)}</p>}
            </>
          )}
        </section>
      </div>
    );
  }

  if (step === "offline") {
    return (
      <div className="fd-kiosk-start" ref={rootRef}>
        <FoodBrand size={84} />
        <h1>{data?.restaurant?.display_name}</h1>
        <p>{f("offlineSaved")}</p>
        {
          <p>
            {f("provisional", { reference: clientIdRef.current?.slice(0, 8) })}
          </p>
        }
        <button
          type="button"
          className="fd-btn fd-btn-secondary fd-btn-sm"
          onClick={resetAll} data-track="ui.e23c624842.1"
        >
          {t("food.kiosk.startOver")}
        </button>
        <KioskOverlays rootRef={rootRef} offline={offline} />
      </div>
    );
  }

  if (!data?.restaurant) {
    return (
      <div className="fd-kiosk-start" ref={rootRef}>
        <FoodBrand size={64} />
        <p>{t("food.common.loading")}</p>
        <KioskOverlays rootRef={rootRef} offline={offline} />
      </div>
    );
  }

  if (orderingPaused && step !== "done")
    return (
      <div className="fd-kiosk-start" ref={rootRef}>
        <FoodBrand size={84} />
        <h1>{data?.restaurant?.display_name}</h1>
        <p role="status">{t("food.ownerHome.paused")}</p>
        <KioskOverlays rootRef={rootRef} offline={offline} />
      </div>
    );

  if (step === "start") {
    return (
      <div
        className="fd-kiosk-start"
        ref={rootRef}
        onClick={() => setStep("mode")}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => {
          if (["Enter", " "].includes(e.key)) {
            e.preventDefault();
            setStep("mode");
          }
        }} data-track="ui.e23c624842.2"
      >
        <FoodBrand size={84} />
        <h1>{data.restaurant.display_name}</h1>
        <p>{t("food.kiosk.touchToStart")}</p>
        <KioskOverlays rootRef={rootRef} offline={offline} />
      </div>
    );
  }

  if (step === "mode") {
    return (
      <div className="fd-screen" ref={rootRef}>
        <KioskOverlays rootRef={rootRef} offline={offline} />
        <div className="fd-screen-header">
          <FoodBrand size={36} />
          <h1 className="fd-screen-title">{t("food.kiosk.whereEating")}</h1>
          <button
            type="button"
            className="fd-btn fd-btn-secondary fd-btn-sm"
            onClick={resetAll} data-track="ui.e23c624842.3"
          >
            {t("food.kiosk.startOver")}
          </button>
        </div>
        <div className="fd-row" style={{ gap: "1rem", marginTop: "4rem" }}>
          <button
            type="button"
            className={`fd-kiosk-choice${fulfillment === "dine_in" ? " fd-selected" : ""}`}
            onClick={() => {
              setFulfillment("dine_in");
              setStep("menu");
            }} data-track="ui.e23c624842.4"
          >
            🍽️ {t("food.kiosk.eatIn")}
          </button>
          <button
            type="button"
            className={`fd-kiosk-choice${fulfillment === "pickup" ? " fd-selected" : ""}`}
            onClick={() => {
              setFulfillment("pickup");
              setStep("menu");
            }} data-track="ui.e23c624842.5"
          >
            🥡 {t("food.kiosk.takeOut")}
          </button>
        </div>
      </div>
    );
  }

  if (step === "done" && placedOrder) {
    return (
      <>
        <FoodOrderConfirmation
          restaurantId={restaurantId}
          order={placedOrder}
          trackingToken={trackingToken}
          currency={currency}
          variant="kiosk"
          onDismiss={resetAll}
          dismissLabel={t("food.kiosk.startOver")}
        />
        <KioskOverlays rootRef={rootRef} offline={offline} />
      </>
    );
  }

  return (
    <div className="fd-screen" ref={rootRef}>
      <KioskOverlays rootRef={rootRef} offline={offline} />
      <div className="fd-screen-header">
        <FoodBrand size={36} />
        <h1 className="fd-screen-title">{data.restaurant.display_name}</h1>
        <button
          type="button"
          className="fd-btn fd-btn-secondary fd-btn-sm"
          onClick={resetAll} data-track="ui.e23c624842.6"
        >
          {t("food.kiosk.startOver")}
        </button>
      </div>

      <div className="fd-kiosk-body">
        {creditError && <p role="alert">{f(creditError)}</p>}
        {step === "menu" && (
          <>
            {sections.map((section) => (
              <section key={section.id}>
                <h2
                  className="fd-kds-col-title"
                  style={{ marginTop: "1.2rem" }}
                >
                  {section.name}
                </h2>
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
                        onKeyDown={(e) => {
                          if (["Enter", " "].includes(e.key)) {
                            e.preventDefault();
                            setActiveItem(item);
                          }
                        }} data-track="ui.e23c624842.7"
                      >
                        <h4>{item.name}</h4>
                        <strong style={{ color: "var(--primary-color)" }}>
                          {formatFoodMoney(item.price_cents, currency)}
                        </strong>
                      </div>
                    ))}
                </div>
              </section>
            ))}
            {sections.length === 0 && (
              <p className="fd-kds-meta">{t("food.restaurant.noMenu")}</p>
            )}
          </>
        )}

        {step === "review" && (
          <div style={{ maxWidth: 560, margin: "0 auto" }}>
            <h2>{t("food.order.yourOrder")}</h2>
            {cart.map((line, index) => (
              <div
                key={index}
                className="fd-cart-line"
                style={{ borderColor: "var(--border-color)" }}
              >
                <span>
                  {line.quantity}× {line.name}
                  {line.modifierNames?.length > 0 && (
                    <em
                      style={{
                        display: "block",
                        fontSize: "0.78rem",
                        color: "var(--muted-text)",
                      }}
                    >
                      {line.modifierNames.join(", ")}
                    </em>
                  )}
                </span>
                <span className="fd-row" style={{ gap: "0.5rem" }}>
                  {formatFoodMoney(
                    line.unitTotalCents * line.quantity,
                    currency,
                  )}
                  <button
                    type="button"
                    className="fd-btn fd-btn-danger fd-btn-sm"
                    aria-label={t("food.common.remove")}
                    onClick={() =>
                      setCart((prev) => prev.filter((_, i) => i !== index))
                    } data-track="ui.e23c624842.8"
                  >
                    ×
                  </button>
                </span>
              </div>
            ))}
            <div className="fd-total-row">
              <span>{t("food.order.total")}</span>
              <span>
                {formatFoodMoney(
                  step === "review"
                    ? (quoted?.totalCents ?? quoted?.total_cents ?? total)
                    : total,
                  currency,
                )}
              </span>
            </div>
            <div className="fd-field" style={{ marginTop: "1rem" }}>
              <label
                htmlFor="fd-kiosk-name"
                style={{ color: "var(--app-text)" }}
              >
                {t("food.kiosk.nameForOrder")}
              </label>
              <input
                id="fd-kiosk-name"
                value={guestName}
                onChange={(e) => setGuestName(e.target.value)}
                maxLength={140}
                style={{
                  background: "var(--card-bg)",
                  borderColor: "var(--border-color)",
                  color: "var(--app-text)",
                }}
              />
            </div>
            <p className="fd-pay-note">{t("food.order.payInStoreNote")}</p>
            {orderError && (
              <p style={{ color: "#f87171" }}>{t("food.order.placeError")}</p>
            )}
            <div
              className="fd-row"
              style={{ justifyContent: "space-between", marginTop: "1rem" }}
            >
              <button
                type="button"
                className="fd-btn fd-btn-secondary"
                onClick={() => setStep("menu")} data-track="ui.e23c624842.9"
              >
                {t("food.kiosk.addMore")}
              </button>
              <button
                type="button"
                className="fd-btn"
                disabled={
                  preview ||
                  managed?.enabled === false ||
                  placing ||
                  cart.length === 0 ||
                  !quoted
                }
                onClick={submit} data-track="ui.e23c624842.10"
              >
                {placing ? t("food.order.placing") : t("food.order.placeOrder")}
              </button>
            </div>
            {creditStorageKey && managed.creditCheckoutEnabled && quoted?.totalCents > 0 && !quoted.estimated && (
              <form className="fd-field" onSubmit={payWithCredit} autoComplete="off" data-track-private>
                <label htmlFor="fd-kiosk-credit-card">{f("creditScanCard")}</label>
                <input id="fd-kiosk-credit-card" name="credential" type="password" maxLength={200} required autoComplete="off"
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      event.preventDefault();
                      event.currentTarget.form.elements.namedItem("pin").focus();
                    }
                  }} />
                <label htmlFor="fd-kiosk-credit-pin">{f("creditPin")}</label>
                <input id="fd-kiosk-credit-pin" name="pin" type="password" inputMode="numeric"
                  pattern="[0-9]{4,8}" maxLength={8} required autoComplete="off" />
                <button className="fd-btn" type="submit" disabled={placing || orderingPaused}>
                  {f("creditPay")}
                </button>
              </form>
            )}
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

      {step === "menu" && cart.length > 0 && (
        <div className="fd-cartbar">
          <span>
            {t("food.order.itemsInCart", {
              n: cart.reduce((s, l) => s + l.quantity, 0),
            })}
            {" · "}
            <strong>
              {formatFoodMoney(
                step === "review"
                  ? (quoted?.totalCents ?? quoted?.total_cents ?? total)
                  : total,
                currency,
              )}
            </strong>
          </span>
          <button
            type="button"
            className="fd-btn"
            onClick={() => setStep("review")} data-track="ui.e23c624842.11"
          >
            {t("food.order.reviewOrder")}
          </button>
        </div>
      )}
    </div>
  );
}
