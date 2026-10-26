import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import api from "../api/auth";
export default function PrivacyControls() {
  const { t } = useTranslation();
  const [config, setConfig] = useState(null),
    [error, setError] = useState(false),
    [busy, setBusy] = useState(false);
  useEffect(() => {
    let active = true;
    api
      .get("/activity/config")
      .then((r) => {
        if (active) setConfig(r.data);
      })
      .catch(() => setError(true));
    return () => {
      active = false;
    };
  }, []);
  const change = async (purpose, granted) => {
    setBusy(true);
    setError(false);
    try {
      await api.post("/consent/tracking", {
        purpose,
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
  const [ageChecked, setAgeChecked] = useState(false);
  // D-ENG-06: age confirmation. Only rendered when the server has enabled a
  // method (self-attestation "on" or a configured provider).
  const age = config?.age_verification;
  const ageAction = async (path, body) => {
    setBusy(true);
    setError(false);
    try {
      const { data } = await api.post(path, body);
      if (data?.redirect_url) {
        window.location.assign(data.redirect_url);
        return;
      }
      setConfig((await api.get("/activity/config")).data);
      window.dispatchEvent(new Event("growth-consent-changed"));
    } catch {
      setError(true);
    } finally {
      setBusy(false);
    }
  };
  const channel = async (value) => {
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
    <section
      className="mx-auto max-w-2xl space-y-5 p-6 text-gray-900 dark:text-gray-100"
      data-track-private
    >
      <h1 className="text-2xl font-semibold">{t("growthInsights.privacy")}</h1>
      <p>{t("growthInsights.privacyDescription")}</p>
      {error && <p role="alert">{t("growthInsights.error")}</p>}
      {!config && !error && <p role="status">{t("growthInsights.loading")}</p>}
      {config && (
        <fieldset disabled={busy} className="space-y-4">
          {config.basis === "consent" && (
            <label className="flex gap-3">
              <input
                type="checkbox"
                checked={config.choices.activity === true}
                onChange={(e) => change("activity", e.target.checked)}
              />
              {t("growthInsights.activityConsent")}
            </label>
          )}
          {config.offers_basis === "consent" && (
            <label className="flex gap-3">
              <input
                type="checkbox"
                checked={config.choices.activity_offers === true}
                onChange={(e) => change("activity_offers", e.target.checked)}
              />
              {t("growthInsights.offersConsent")}
            </label>
          )}
          {config.sale_share_control && (
            <label className="flex gap-3">
              <input
                type="checkbox"
                checked={config.choices.sale_share_optout === true}
                onChange={(e) => change("sale_share_optout", e.target.checked)}
              />
              {t("growthInsights.saleShare")}
            </label>
          )}
          <label className="flex gap-3">
            <input
              type="checkbox"
              checked={config.choices.offer_push === true}
              onChange={(e) => change("offer_push", e.target.checked)}
            />
            {t("growthInsights.pushConsent")}
          </label>
          <label className="flex gap-3">
            <input
              type="checkbox"
              checked={config.preferences.offer_in_app !== false}
              onChange={(e) => channel(e.target.checked)}
            />
            {t("growthInsights.inApp")}
          </label>
        </fieldset>
      )}
      {age && (age.self_attestation || age.provider_available || age.adult_confirmed) && "adult_confirmed" in age && (
        <fieldset disabled={busy} className="space-y-3 rounded border border-gray-200 p-4 dark:border-gray-700">
          <legend className="px-1 font-medium">{t("growthInsights.age.title")}</legend>
          {age.adult_confirmed ? (
            <>
              <p role="status">{t("growthInsights.age.confirmed")}</p>
              <button
                type="button"
                className="underline"
                data-track="growth_age_withdraw"
                onClick={() => ageAction("/activity/age-verification/withdraw", {})}
              >
                {t("growthInsights.age.withdraw")}
              </button>
            </>
          ) : (
            <>
              <p>{t("growthInsights.age.why")}</p>
              {age.self_attestation && (
                <>
                  <label className="flex gap-3">
                    <input
                      type="checkbox"
                      data-track="growth_age_attest_check"
                      checked={ageChecked}
                      onChange={(e) => setAgeChecked(e.target.checked)}
                    />
                    {t("growthInsights.age.attest")}
                  </label>
                  <button
                    type="button"
                    className="rounded bg-gray-900 px-3 py-1 text-white disabled:opacity-50 dark:bg-gray-100 dark:text-gray-900"
                    data-track="growth_age_attest_submit"
                    disabled={!ageChecked}
                    onClick={() => ageAction("/activity/age-verification/attest", { adult: true, version: age.attestation_version })}
                  >
                    {t("growthInsights.age.confirm")}
                  </button>
                </>
              )}
              {age.provider_available && (
                <button
                  type="button"
                  className="underline"
                  data-track="growth_age_verify_start"
                  onClick={() => ageAction("/activity/age-verification/start", {})}
                >
                  {t("growthInsights.age.verify")}
                </button>
              )}
            </>
          )}
        </fieldset>
      )}
      <Link className="underline" to="/privacy">
        {t("growthInsights.policy")}
      </Link>
    </section>
  );
}
