// KitchenPairingPage — public setup entry for fresh kitchen tablets.
//
// A tablet with no staff login and no pairing token cannot reach the kitchen
// display (DeviceOrStaffRoute sends it to /login), so it needs a standalone
// entry point: this page renders the restaurant name/header, the
// DisplayPairingCode widget, and a "back to kitchen display" link. Public:
// no auth, no token required. The pairing code still must be claimed by the
// owner in the dashboard before the tablet can load tickets.
import React, { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import DisplayPairingCode from '../../components/DisplayPairingCode';
import { getFoodRestaurant } from '../../api/food';
import '../../styles/FoodPages.css';

export default function KitchenPairingPage() {
  const { restaurantId } = useParams();
  const { t } = useTranslation();
  const [name, setName] = useState(null);

  useEffect(() => {
    let alive = true;
    getFoodRestaurant(restaurantId)
      .then((restaurant) => {
        if (alive) setName(restaurant?.name || null);
      })
      .catch(() => {
        // The header falls back to the generic title; pairing still works.
      });
    return () => { alive = false; };
  }, [restaurantId]);

  return (
    <div className="fd-screen">
      <div className="fd-screen-header">
        <h1 className="fd-screen-title">
          {t('kitchenPairing.title')}
          {name ? ` · ${name}` : ''}
        </h1>
      </div>
      <p className="fd-kds-meta" style={{ maxWidth: '36rem' }}>
        {t('kitchenPairing.intro')}
      </p>
      <p style={{ marginTop: '1rem' }}>
        <Link className="fd-btn fd-btn-secondary" to={`/restaurants/kitchen/${restaurantId}`}>
          {t('kitchenPairing.backToKitchen')}
        </Link>
      </p>
      <DisplayPairingCode />
    </div>
  );
}
