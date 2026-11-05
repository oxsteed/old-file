// RestaurantEmployeePortalPage — Phase 3 (Track A): the restaurant-branded
// employee portal shell.
//
// Own route per restaurant (/restaurants/:restaurantId/portal). The
// restaurant's name, logo, and accent color are the primary brand on every
// screen; OxSteed appears exactly once, small, as "Powered by OxSteed" in
// the footer. Membership is enforced by the data source itself:
// GET /food/my/restaurants returns only restaurants the signed-in user
// owns or is an active member of, so a non-member sees the not-a-member
// state and no portal content. Every data call the portal makes (the time
// clock included) is additionally gated server-side by
// requireBusinessAccess minRole 'any'.
//
// Extension points for the later Phase 3 tracks (all inside this file
// unless noted):
// - PORTAL_TAB_IDS: add a tab id here and a label under
//   food.employeePortal.tabs in all five locales.
// - renderTabContent: replace a tab's EmployeePortalEmptyState with the
//   real panel. Track B owns 'mytips' and 'mypay'; Track C owns
//   'availability' and 'swaps'.
// - EmployeePortalEmptyState: the shared placeholder for tabs whose track
//   has not landed yet. It promises nothing about timing.
// - EmployedByRestaurant (./EmployedByRestaurant.jsx): render on every
//   pay surface Track B builds.
// - Tab state lives in ?tab= so any tab is deep-linkable; unknown values
//   fall back to 'myshift'.
//
// The dashboard "My shift" tab (FoodMerchantPage) is intentionally left in
// place; removing it is Emile's later decision.
import { useEffect, useMemo, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { listMyFoodRestaurants } from '../../api/food';
import RestaurantTimeClockCard from './RestaurantTimeClockCard';
import EmployedByRestaurant from './EmployedByRestaurant';
import '../../styles/FoodPages.css';
import './RestaurantEmployeePortalPage.css';

export const PORTAL_TAB_IDS = ['myshift', 'mytips', 'mypay', 'availability', 'swaps'];
const DEFAULT_TAB = 'myshift';

// Same validation as the public restaurant page: a stored accent must be a
// 3- or 6-digit hex value; anything else falls back to the house orange.
function resolveAccent(hex) {
  if (typeof hex === 'string' && /^#?[0-9a-f]{3,6}$/i.test(hex)) {
    return hex.startsWith('#') ? hex : `#${hex}`;
  }
  return '#ff8c00';
}

export function EmployeePortalEmptyState() {
  const { t } = useTranslation();
  return <p className="ep-empty">{t('food.employeePortal.notAvailable')}</p>;
}

function renderTabContent(tab, restaurant) {
  if (tab === 'myshift') {
    return <RestaurantTimeClockCard restaurant={restaurant} />;
  }
  if (tab === 'mypay') {
    // Pay surface placeholder: the Employed by line already applies here,
    // and Track B keeps it when the real pay surface replaces this.
    return (
      <>
        <EmployeePortalEmptyState />
        <EmployedByRestaurant restaurantName={restaurant.display_name} />
      </>
    );
  }
  return <EmployeePortalEmptyState />;
}

export default function RestaurantEmployeePortalPage() {
  const { t } = useTranslation();
  const { restaurantId } = useParams();
  const [searchParams, setSearchParams] = useSearchParams();
  const [restaurants, setRestaurants] = useState(null);
  const [loadError, setLoadError] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    listMyFoodRestaurants()
      .then((rows) => {
        if (cancelled) return;
        setRestaurants(Array.isArray(rows) ? rows : []);
        setLoadError(false);
      })
      .catch(() => {
        if (!cancelled) setLoadError(true);
      });
    return () => { cancelled = true; };
  }, [reloadKey]);

  const restaurant = useMemo(() => {
    if (!restaurants) return null;
    return restaurants.find((row) => String(row.id) === String(restaurantId)) || null;
  }, [restaurants, restaurantId]);

  const requestedTab = searchParams.get('tab');
  const tab = PORTAL_TAB_IDS.includes(requestedTab) ? requestedTab : DEFAULT_TAB;
  const goToTab = (next) => {
    const nextParams = new URLSearchParams(searchParams);
    nextParams.set('tab', next);
    setSearchParams(nextParams, { replace: true });
  };

  const accent = resolveAccent(restaurant?.brand_accent_hex);
  const initial = restaurant?.display_name
    ? Array.from(String(restaurant.display_name).trim())[0] || ''
    : '';

  return (
    <div className="ep-root" style={{ '--portal-accent': accent }}>
      {loadError ? (
        <main className="ep-content">
          <p className="ep-empty" role="alert">{t('food.common.loadError')}</p>
          <button
            type="button"
            className="fd-btn fd-btn-secondary"
            onClick={() => { setLoadError(false); setReloadKey((key) => key + 1); }}
          >
            {t('food.common.retry')}
          </button>
        </main>
      ) : !restaurants ? (
        <main className="ep-content">
          <p className="ep-empty">{t('food.common.loading')}</p>
        </main>
      ) : !restaurant ? (
        <main className="ep-content">
          <p className="ep-empty" role="alert">{t('food.employeePortal.notMember')}</p>
          <Link className="fd-btn fd-btn-secondary ep-back-link" to="/food/merchant">
            {t('food.employeePortal.backToMyRestaurants')}
          </Link>
        </main>
      ) : (
        <>
          <header className="ep-header">
            {restaurant.logo_url ? (
              <img className="ep-logo" src={restaurant.logo_url} alt="" />
            ) : (
              <span className="ep-logo-fallback" aria-hidden="true">{initial}</span>
            )}
            <div className="ep-header-text">
              <h1>{restaurant.display_name}</h1>
              <p>{t('food.employeePortal.title')}</p>
            </div>
          </header>
          <div className="ep-tabs" role="tablist" aria-label={t('food.employeePortal.title')}>
            {PORTAL_TAB_IDS.map((tabId) => (
              <button
                key={tabId}
                type="button"
                role="tab"
                aria-selected={tab === tabId}
                className={`ep-tab${tab === tabId ? ' ep-tab-active' : ''}`}
                onClick={() => goToTab(tabId)}
              >
                {t(`food.employeePortal.tabs.${tabId}`)}
              </button>
            ))}
          </div>
          <main className="ep-content">
            {renderTabContent(tab, restaurant)}
          </main>
        </>
      )}
      <footer className="ep-footer">
        <span>{t('food.employeePortal.poweredBy')}</span>
      </footer>
    </div>
  );
}
