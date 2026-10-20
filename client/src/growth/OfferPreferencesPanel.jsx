import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import api from "../api/auth";

// Settings > Notifications > Offers (spec 17.1): the offer_push opt-in and
// the offer_in_app display toggle. These write through the growth consent
// and preference endpoints, not the notification-preference store, because
// the delivery worker reads the consent ledger and offer_preferences.
// Turning offer_push off takes effect for the next send, including pushes
// already queued or held for quiet hours (checked again at send time).
export default function OfferPreferencesPanel() {
  const { t } = useTranslation();
  const [config, setConfig] = useState(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(false);
  useEffect(() => {
    let active = true;
    api
      .get("/activity/config")
      .then((r) => {
        if (active) setConfig(r.data);
      })
      .catch(() => {
        if (active) setError(true);
      });
    return () => {
      active = false;
    };
  }, []);
  if (error || !config) return null;
  const pushChange = async (granted) => {
    setBusy(true);
    try {
      await api.post("/consent/tracking", {
        purpose: "offer_push",
        granted,
        source: "settings",
        consent_text_version: config.policy_version,
      });
      setConfig((await api.get("/activity/config")).data);
      window.dispatchEvent(new Event("growth-consent-changed"));
    } catch {
      setError(true);
    } finally {
      setBusy(false);
    }
  };
  const inAppChange = async (value) => {
    setBusy(true);
    try {
      await api.put("/activity/preferences", {
        offer_in_app: value,
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      });
      setConfig({
        ...config,
        preferences: { ...config.preferences, offer_in_app: value },
      });
    } catch {
      setError(true);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div
      className="notification-settings__preference-list rounded-2xl mb-6"
      data-track-private
    >
      <div
        className="px-6 py-4 border-b"
        style={{ borderBottomColor: "var(--color-border)" }}
      >
        <h2 className="notification-settings__section-title">
          {t("growthInsights.offersForYou")}
        </h2>
        <p className="notification-settings__muted text-xs mt-0.5">
          {t("growthInsights.offersSettingsDescription")}
        </p>
      </div>
      <fieldset disabled={busy}>
        <div className="notification-settings__preference-row has-border">
          <label
            htmlFor="offer-push-toggle"
            className="notification-settings__row-title cursor-pointer select-none"
          >
            {t("growthInsights.pushConsent")}
          </label>
          <input
            id="offer-push-toggle"
            type="checkbox"
            checked={config.choices?.offer_push === true}
            onChange={(e) => pushChange(e.target.checked)}
          />
        </div>
        <div className="notification-settings__preference-row">
          <label
            htmlFor="offer-in-app-toggle"
            className="notification-settings__row-title cursor-pointer select-none"
          >
            {t("growthInsights.inApp")}
          </label>
          <input
            id="offer-in-app-toggle"
            type="checkbox"
            checked={config.preferences?.offer_in_app !== false}
            onChange={(e) => inAppChange(e.target.checked)}
          />
        </div>
      </fieldset>
    </div>
  );
}
