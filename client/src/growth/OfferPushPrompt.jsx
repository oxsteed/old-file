import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import api from "../api/auth";

// Explicit offer-push opt-in prompt (spec 16.2/17.1). Offer push is opt-in
// everywhere, so this prompt is the front door. Rules:
//  * shown only when tracking is live and the user has not opted in;
//  * never on first launch: it renders only inside signed-in app surfaces
//    (the offers card area, or Settings), never in onboarding;
//  * "Not now" silences it for 90 days (stored locally per account);
//  * accepting records the offer_push consent in the server ledger, which
//    is what the delivery worker checks at send time.
const DISMISS_KEY = "growth.offerPushPromptDismissedAt";
const NINETY_DAYS_MS = 90 * 24 * 60 * 60 * 1000;

export function offerPushPromptEligible(config, now = Date.now()) {
  if (!config?.enabled) return false;
  if (config.choices?.offer_push === true) return false;
  if (config.preferences?.offer_push === true) return false;
  try {
    const dismissed = Number(localStorage.getItem(DISMISS_KEY) || 0);
    if (dismissed && now - dismissed < NINETY_DAYS_MS) return false;
  } catch {
    /* storage unavailable: the prompt may show, consent still governs */
  }
  return true;
}

export default function OfferPushPrompt({ config: providedConfig }) {
  const { t } = useTranslation();
  const [config, setConfig] = useState(providedConfig || null),
    [gone, setGone] = useState(false),
    [busy, setBusy] = useState(false);
  useEffect(() => {
    if (providedConfig) {
      setConfig(providedConfig);
      return;
    }
    let active = true;
    api
      .get("/activity/config")
      .then((r) => {
        if (active) setConfig(r.data);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [providedConfig]);
  const dismiss = useCallback(() => {
    try {
      localStorage.setItem(DISMISS_KEY, String(Date.now()));
    } catch {
      /* ignore */
    }
    setGone(true);
  }, []);
  const accept = async () => {
    setBusy(true);
    try {
      await api.post("/consent/tracking", {
        purpose: "offer_push",
        granted: true,
        source: "banner",
        consent_text_version: config.policy_version,
      });
      window.dispatchEvent(new Event("growth-consent-changed"));
      setGone(true);
    } catch {
      setBusy(false);
    }
  };
  if (gone || !offerPushPromptEligible(config)) return null;
  const locale = (config?.locale || "en").split("-")[0];
  return (
    <section
      className="mx-auto w-full max-w-2xl rounded-2xl border border-gray-200 bg-white p-5 text-gray-900 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100"
      dir={locale === "ar" ? "rtl" : undefined}
      aria-label={t("growthInsights.pushPromptTitle")}
      data-track-private
    >
      <h2 className="text-lg font-semibold">
        {t("growthInsights.pushPromptTitle")}
      </h2>
      <p className="mt-1 text-sm">{t("growthInsights.pushPromptBody")}</p>
      <div className="mt-4 flex gap-3">
        <button
          type="button"
          className="rounded bg-orange-700 px-4 py-2 text-white disabled:opacity-50"
          disabled={busy}
          onClick={() => accept().catch(() => {})}
        >
          {t("growthInsights.pushPromptAccept")}
        </button>
        <button
          type="button"
          className="rounded px-4 py-2 underline"
          disabled={busy}
          onClick={dismiss}
        >
          {t("growthInsights.pushPromptDecline")}
        </button>
      </div>
    </section>
  );
}
