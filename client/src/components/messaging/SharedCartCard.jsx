import React from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { ShoppingCart } from 'lucide-react';
import { sharedCartCardData } from './sharedCartCard.js';

/**
 * Rich shared-cart card rendered inside chat timelines / inbox threads.
 * Reuses the messenger quote card styling so shared carts look native in chat.
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

      <div className="messenger-quote-card__actions">
        <Link
          to={card.href}
          className="messenger-quote-card__btn messenger-quote-card__btn--primary"
        >
          <ShoppingCart className="w-3.5 h-3.5" aria-hidden />
          {t('partsList.cardOpen')}
        </Link>
      </div>
    </div>
  );
}
