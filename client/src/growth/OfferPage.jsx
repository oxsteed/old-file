import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import api from "../api/auth";
export default function OfferPage() {
  const { id } = useParams(),
    { t, i18n } = useTranslation();
  const [offer, setOffer] = useState(null),
    [ended, setEnded] = useState(false);
  useEffect(() => {
    let active = true;
    if (id === "ended") {
      setEnded(true);
      return;
    }
    api
      .get(`/activity/offers/${id}`)
      .then((r) => {
        if (active) setOffer(r.data);
      })
      .catch(() => {
        if (active) setEnded(true);
      });
    return () => {
      active = false;
    };
  }, [id]);
  const locale = (i18n.resolvedLanguage || "en").split("-")[0],
    copy = offer?.copy?.[locale] || offer?.copy?.en;
  const dismiss = async () => {
    await api.post(`/activity/offers/${id}/dismiss`);
    setEnded(true);
  };
  return (
    <main
      className="mx-auto max-w-xl space-y-5 p-6 text-gray-900 dark:text-gray-100"
      dir={locale === "ar" ? "rtl" : undefined}
      data-track-private
    >
      <h1 className="text-2xl font-semibold">
        {ended
          ? t("growthInsights.ended")
          : copy?.title || t("growthInsights.loading")}
      </h1>
      {!ended && copy && (
        <>
          <p className="whitespace-pre-line">{copy.body}</p>
          {copy.disclosure && <p className="text-sm">{copy.disclosure}</p>}
          {offer.link && (
            <a
              href={offer.link}
              rel="sponsored noopener noreferrer"
              className="inline-block rounded bg-orange-700 px-4 py-3 text-white"
            >
              {copy.button}
            </a>
          )}
          <button
            type="button"
            className="block underline"
            onClick={() => dismiss().catch(() => {})}
          >
            {t("growthInsights.notRelevant")}
          </button>
        </>
      )}
      <Link to="/settings/privacy" className="block underline">
        {t("growthInsights.manageOffers")}
      </Link>
    </main>
  );
}
