import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import api from "../api/auth";
import OfferPushPrompt from "./OfferPushPrompt";

// "Offers for you" card (spec 16.1): at most one card, on the role's home
// or dashboard. An impression is recorded only after the card has been
// visible for at least one second. The menu writes offer.feedback events:
// "Not relevant" also dismisses the intent for 30 days server-side, and
// "Too many offers" is recorded as feedback. When the offer ends or becomes
// unavailable the server stops returning it and the card disappears; the
// push opt-in prompt takes the slot when there is no card to show.
export default function OfferCard() {
  const { t, i18n } = useTranslation();
  const [offer, setOffer] = useState(null),
    [loaded, setLoaded] = useState(false),
    [hidden, setHidden] = useState(false),
    [menuOpen, setMenuOpen] = useState(false),
    [thanks, setThanks] = useState(false);
  const cardRef = useRef(null),
    impressionSent = useRef(false);
  useEffect(() => {
    let active = true;
    api
      .get("/activity/offers")
      .then((r) => {
        if (active) {
          setOffer(r.data.rows?.[0] || null);
          setLoaded(true);
        }
      })
      .catch(() => {
        if (active) setLoaded(true);
      });
    return () => {
      active = false;
    };
  }, []);
  useEffect(() => {
    if (!offer || hidden || impressionSent.current) return;
    const node = cardRef.current;
    if (!node || typeof IntersectionObserver !== "function") return;
    let timer = null;
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting && entry.intersectionRatio >= 0.5) {
            if (!timer)
              timer = setTimeout(() => {
                impressionSent.current = true;
                api
                  .post(`/activity/offers/${offer.id}/impression`)
                  .catch(() => {});
              }, 1000);
          } else if (timer) {
            clearTimeout(timer);
            timer = null;
          }
        }
      },
      { threshold: [0.5] },
    );
    observer.observe(node);
    return () => {
      observer.disconnect();
      if (timer) clearTimeout(timer);
    };
  }, [offer, hidden]);
  if (!loaded) return null;
  if (!offer) return <OfferPushPrompt />;
  if (hidden)
    return thanks ? (
      <p className="mx-auto w-full max-w-2xl p-4 text-sm text-gray-600 dark:text-gray-300">
        {t("growthInsights.feedbackRecorded")}
      </p>
    ) : null;
  const locale = (i18n.resolvedLanguage || "en").split("-")[0],
    copy = offer.copy?.[locale] || offer.copy?.en;
  if (!copy) return <OfferPushPrompt />;
  const feedback = async (reason) => {
    setMenuOpen(false);
    try {
      await api.post(`/activity/offers/${offer.id}/feedback`, { reason });
    } catch {
      /* feedback is best-effort; the card still hides */
    }
    setThanks(true);
    setHidden(true);
  };
  return (
    <section
      ref={cardRef}
      className="relative mx-auto w-full max-w-2xl rounded-2xl border border-gray-200 bg-white p-5 text-gray-900 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100"
      dir={locale === "ar" ? "rtl" : undefined}
      aria-label={t("growthInsights.offersForYou")}
      data-track-private
    >
      <div className="flex items-start justify-between gap-3">
        <h2 className="text-sm font-medium uppercase tracking-wide text-gray-500 dark:text-gray-400">
          {t("growthInsights.offersForYou")}
        </h2>
        <button
          type="button"
          className="rounded px-2 py-1 text-sm underline"
          aria-haspopup="menu"
          aria-expanded={menuOpen}
          aria-label={t("growthInsights.offerOptions")}
          onClick={() => setMenuOpen((v) => !v)} data-track-private
        >
          ⋯
        </button>
      </div>
      {menuOpen && (
        <div
          role="menu"
          className="absolute end-4 top-10 z-10 rounded border border-gray-200 bg-white p-2 shadow dark:border-gray-700 dark:bg-gray-900"
        >
          <button
            type="button"
            role="menuitem"
            className="block w-full rounded px-3 py-2 text-start text-sm hover:bg-gray-100 dark:hover:bg-gray-800"
            onClick={() => feedback("not_relevant")} data-track-private
          >
            {t("growthInsights.notRelevant")}
          </button>
          <button
            type="button"
            role="menuitem"
            className="block w-full rounded px-3 py-2 text-start text-sm hover:bg-gray-100 dark:hover:bg-gray-800"
            onClick={() => feedback("too_many")} data-track-private
          >
            {t("growthInsights.tooManyOffers")}
          </button>
        </div>
      )}
      <h3 className="mt-1 text-lg font-semibold">{copy.title}</h3>
      <p className="mt-1 whitespace-pre-line text-sm">{copy.body}</p>
      {copy.disclosure && (
        <p className="mt-2 text-xs text-gray-500 dark:text-gray-400">
          {copy.disclosure}
        </p>
      )}
      <Link
        to={`/offers/${offer.id}`}
        className="mt-4 inline-block rounded bg-orange-700 px-4 py-2 text-white"
      >
        {copy.button}
      </Link>
    </section>
  );
}
