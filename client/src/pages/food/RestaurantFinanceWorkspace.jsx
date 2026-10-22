import React, { useId } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { ArrowDown, CreditCard, Landmark, Receipt, WalletCards } from 'lucide-react';
import RestaurantPayoutsPanel, { RestaurantWalletPayoutsPanel } from './RestaurantPayoutsPanel';
import RestaurantTopupEligibilityPanel from './RestaurantTopupEligibilityPanel';
import RestaurantCreditManager from './RestaurantCreditManager';
import OxsteedCreditPartnerManager from './OxsteedCreditPartnerManager';
import './RestaurantFinanceWorkspace.css';

export default function RestaurantFinanceWorkspace({ restaurant, canManagePayouts, canManageCredit }) {
  const { t } = useTranslation('common');
  const id = useId();
  const sections = [
    ...(canManagePayouts ? [{ key: 'bank', icon: Landmark }, { key: 'topups', icon: CreditCard }] : []),
    ...(canManageCredit ? [{ key: 'credit', icon: WalletCards }, { key: 'activity', icon: Receipt }] : []),
  ];
  return (
    <div className="fd-finance">
      <header className="fd-finance-heading">
        <div><p className="fd-finance-eyebrow">{t('merchantFinance.eyebrow')}</p><h2>{t('merchantFinance.title')}</h2><p>{t('merchantFinance.description')}</p></div>
        <Link className="fd-btn fd-btn-secondary" to="/statements"><Receipt size={18} aria-hidden="true" />{t('merchantFinance.statements')}</Link>
      </header>
      <nav className="fd-finance-shortcuts" aria-label={t('merchantFinance.navigation')}>
        {sections.map(({ key, icon: Icon }) => <a key={key} href={`#${id}-${key}`} onClick={() => document.getElementById(`${id}-${key}`)?.focus()} data-track="ui.ac20c86b33.1">
          <Icon size={20} aria-hidden="true" /><span><strong>{t(`merchantFinance.${key}`)}</strong><small>{t(`merchantFinance.${key}Hint`)}</small></span><ArrowDown size={16} aria-hidden="true" />
        </a>)}
      </nav>
      {canManagePayouts && <div className="fd-finance-setup">
        <section id={`${id}-bank`} tabIndex={-1} className="fd-finance-card" aria-label={t('merchantFinance.bank')}><RestaurantPayoutsPanel restaurant={restaurant} /></section>
        <section id={`${id}-topups`} tabIndex={-1} className="fd-finance-card" aria-label={t('merchantFinance.topups')}><RestaurantTopupEligibilityPanel restaurant={restaurant} onGoToPayouts={() => { const target = document.getElementById(`${id}-bank`); target?.focus(); target?.scrollIntoView({ block: 'start', behavior: 'smooth' }); }} /></section>
      </div>}
      {canManagePayouts && <div className="fd-finance-card fd-finance-wallet-card"><RestaurantWalletPayoutsPanel restaurantId={restaurant.id} /></div>}
      {canManageCredit && <>
        <section id={`${id}-credit`} tabIndex={-1} className="fd-finance-card" aria-label={t('merchantFinance.credit')}><RestaurantCreditManager restaurant={restaurant} /></section>
        <section id={`${id}-activity`} tabIndex={-1} className="fd-finance-card" aria-label={t('merchantFinance.activity')}><OxsteedCreditPartnerManager restaurant={restaurant} /></section>
      </>}
    </div>
  );
}
