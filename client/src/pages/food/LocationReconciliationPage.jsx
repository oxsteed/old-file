// Group 13 Slice 4h (686-690): the HQ/participant door of the location
// reconciliation surface. The participant reads every location of their
// own restaurant and no other restaurant's — the server enforces that
// behind requireRestaurantAccess on every call. No money moves here, and
// the period-close review never approves a settlement: the two-admin
// settlement approval stays exactly as it is.
import React, { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { formatFoodMoney } from "../../api/food";
import {
  listLocationReconciliationLocations,
  getLocationReconciliationSummary,
  listLocationReconciliationExceptions,
  addLocationReconciliationAnnotation,
  getLocationReconciliationPeriodClose,
  recordLocationReconciliationPeriodClose,
  downloadLocationReconciliationExport,
} from "../../api/oxsteedCredit";
import LocationReconciliationSection from "../../components/credit/LocationReconciliationSection";
import "./OxsteedCreditPage.css";

export default function LocationReconciliationPage() {
  const { t } = useTranslation("credit");
  const { restaurantId } = useParams();
  const [locations, setLocations] = useState(null);
  const [locationId, setLocationId] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    let live = true;
    setError(null);
    listLocationReconciliationLocations(restaurantId)
      .then((data) => {
        if (!live) return;
        setLocations(data);
        setLocationId(data[0]?.id ?? null);
      })
      .catch(() => {
        if (live) setError("error");
      });
    return () => {
      live = false;
    };
  }, [restaurantId]);

  return (
    <div className="ox-credit-page">
      <Link className="ox-credit-back" to="/oxsteed-credit">
        {t("reconciliation.backToCredit")}
      </Link>
      <h1>{t("reconciliation.title")}</h1>
      {error && <p role="alert">{t("reconciliation.error")}</p>}
      {!locations && !error && <p>{t("reconciliation.loading")}</p>}
      {locations && locations.length === 0 && <p>{t("reconciliation.noLocations")}</p>}
      {locations && locations.length > 0 && (
        <LocationReconciliationSection
          t={t}
          formatMoney={formatFoodMoney}
          locationId={locationId}
          locations={locations}
          onPickLocation={setLocationId}
          fetchers={{
            getSummary: (params) => getLocationReconciliationSummary(restaurantId, params),
            listExceptions: (params) => listLocationReconciliationExceptions(restaurantId, params),
            addAnnotation: (exceptionId, body) => addLocationReconciliationAnnotation(restaurantId, exceptionId, body),
            getPeriodClose: (params) => getLocationReconciliationPeriodClose(restaurantId, params),
            recordPeriodClose: (params) => recordLocationReconciliationPeriodClose(restaurantId, params),
            downloadExport: (params) => downloadLocationReconciliationExport(restaurantId, params),
          }}
          track={{}}
        />
      )}
    </div>
  );
}
