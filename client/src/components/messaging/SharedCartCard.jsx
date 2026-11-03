import React from 'react';
import { useTranslation } from 'react-i18next';
import { sharedCartCardData } from './sharedCartCard.js';

/**
 * Rich shared-cart card rendered inside chat timelines / inbox threads.
 * Reuses the messenger quote card styling so shared carts look native in chat.
 *
 * Gated dead link (Nov 3 audit): the card used to link to /shared-cart/:token,
 * which the launch gate redirects to /restaurants, losing the cart. The open
 * action is removed until shared carts launch; the card still shows the cart
 * summary. sharedCartCardData still computes href for the (future) launch.
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
    </div>
  );
}
