// Group 13 Slice 4g: the cashier surface on the OxSteed Credit kiosk.
// One panel for the whole cluster: 681 location picker, 684 transaction
// lookup, 683 authorized transaction view, 682 shift summary, 685 shift
// closeout checklist. Device-authenticated; every read is scoped to the
// paired device server-side, and the panel shows only what the device is
// authorized for. No money moves here.
import React, { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { getCashierLocations } from "../../restaurantScreens/api";

export default function CashierPanel({
  restaurantId,
  device,
  pickedLocationId,
  onPickLocation,
  onClose,
}) {
  const { t } = useTranslation("credit");
  const [locations, setLocations] = useState(null);
  const [defaultLocationId, setDefaultLocationId] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    let live = true;
    setError(null);
    getCashierLocations(restaurantId, device)
      .then((data) => {
        if (!live) return;
        setLocations(data.locations || []);
        setDefaultLocationId(data.defaultLocationId ?? null);
      })
      .catch(() => {
        if (live) setError("error");
      });
    return () => {
      live = false;
    };
  }, [restaurantId, device]);

  const activeLocationId = pickedLocationId ?? defaultLocationId;

  return (
    <div className="fd-screen" data-track-private>
      <div className="fd-cashier-panel">
        <div className="fd-screen-header">
          <h1 className="fd-screen-title">{t("cashier.title")}</h1>
          <button
            type="button"
            className="fd-btn fd-btn-secondary fd-btn-sm"
            onClick={onClose}
            data-track="ui.e23c624842.12"
          >
            {t("cashier.close")}
          </button>
        </div>

        <section className="fd-cashier-section" aria-labelledby="fd-cashier-location">
          <h3 id="fd-cashier-location">{t("cashier.locationLabel")}</h3>
          {error && <p role="alert">{t(`cashier.${error}`)}</p>}
          {!locations && !error && <p>{t("cashier.loading")}</p>}
          {locations && (
            <>
              <div className="fd-field">
                <select
                  id="fd-cashier-location-select"
                  value={activeLocationId ?? ""}
                  onChange={(event) => {
                    const next = Number(event.target.value);
                    if (Number.isSafeInteger(next) && next > 0) onPickLocation(next);
                  }}
                  disabled={locations.length <= 1}
                  aria-label={t("cashier.locationLabel")}
                >
                  {locations.map((location) => (
                    <option key={location.id} value={location.id}>
                      {location.name}
                      {location.isPaired ? ` (${t("cashier.locationPaired")})` : ""}
                    </option>
                  ))}
                </select>
              </div>
              <p className="fd-cashier-note">{t("cashier.locationHint")}</p>
            </>
          )}
        </section>
      </div>
    </div>
  );
}
