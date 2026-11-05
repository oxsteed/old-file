import React from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { LAUNCH_VISIBILITY } from '../../utils/launchScope.js';
import { sharedCartCardData } from './sharedCartCard.js';

/**
 * Rich shared-cart card rendered inside chat timelines / inbox threads.
 * Reuses the messenger quote card styling so shared carts look native in chat.
 *
 * The open action was removed in the Nov 3 audit because the launch gate
 * bounced /shared-cart/:token to /restaurants. Since the 2026-11-04
 * marketplace flip, the link renders again, gated on productMarketplace so
 * it never points at a bounce while the flag is off.
 */
export default function SharedCartCard({ att }) {
  const { t } = useTranslation();
  const card = sharedCartCardData(att, t('partsList.cardItems'));

  return (
    <div className="messenger-quote-card" role="article" aria-label={card.name || t('partsList.title')}>
      <header className="messenger-quote-card__head">
        <div>
          <p className="messenger-quote-card__eyebrow">{t('partsList.toolbarLabel')}</p>
          <h3 className="messenger-quote-card__title">{card.name || t('partsList.title')}</h3>
        </div>
      </header>

      <div className="messenger-quote-card__total">
        <span>{card.items}</span>
        <strong>{card.total}</strong>
      </div>

      {LAUNCH_VISIBILITY.productMarketplace && card.href ? (
        <Link to={card.href} className="messenger-quote-card__open">
          {t('partsList.openSharedCart')}
        </Link>
      ) : null}
    </div>
  );
}
