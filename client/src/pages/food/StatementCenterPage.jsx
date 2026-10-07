import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  ArrowRight,
  Briefcase,
  DollarSign,
  FileText,
  Store,
  UtensilsCrossed,
  WalletCards,
} from 'lucide-react';
import Navbar from '../../components/Navbar';
import Footer from '../../components/Footer';
import PageMeta from '../../components/PageMeta';
import './StatementCenterPage.css';

export const STATEMENT_CENTER_STRINGS = Object.freeze({
  title: 'Statement center',
  description: 'Review your credit, settlement, earnings, and business statements in one place.',
  eyebrow: 'Financial records',
  scope: 'You will only be able to open statement areas and records available to your account.',
  open: 'Open statements',
  archive: 'View statement archive',
  oxsteedCredit: 'OxSteed Credit statements',
  oxsteedCreditDescription: 'Review your OxSteed Credit balance, posted activity, and downloads.',
  restaurantCredit: 'Restaurant Credit statements',
  restaurantCreditDescription: 'Review restaurant wallet balances, activity, and statement downloads.',
  restaurantSettlement: 'Restaurant settlement statements',
  restaurantSettlementDescription: 'Review recorded restaurant earnings, receivables, and settlements.',
  helperEarnings: 'Helper earnings statements',
  helperEarningsDescription: 'Review your recorded helper earnings and settlement history.',
  business: 'Business statements',
  businessDescription: 'Review business receivables, earnings, and settlement records.',
});

const STATEMENT_CENTER_LINKS = [
  { key: 'oxsteedCredit', to: '/oxsteed-credit/statements', archive: '/oxsteed-credit/statements/archive', Icon: WalletCards },
  { key: 'restaurantCredit', to: '/restaurant-credit/statements', archive: '/restaurant-credit/statements/archive', Icon: UtensilsCrossed },
  { key: 'restaurantSettlement', to: '/restaurant-settlement/statements', Icon: Store },
  { key: 'helperEarnings', to: '/helper-earnings/statements', Icon: DollarSign },
  { key: 'business', to: '/business/statements', Icon: Briefcase },
];

export default function StatementCenterPage() {
  const { t, i18n } = useTranslation('credit');
  const text = (key, options = {}) => t(`statementCenter.${key}`, {
    defaultValue: STATEMENT_CENTER_STRINGS[key],
    ...options,
  });

  return (
    <div className="statement-center-shell" dir={i18n.dir()}>
      <PageMeta title={text('title')} description={text('description')} noIndex />
      <Navbar />
      <main className="statement-center-page">
        <header className="statement-center-header">
          <FileText size={34} aria-hidden="true" />
          <div>
            <p className="statement-center-eyebrow">{text('eyebrow')}</p>
            <h1>{text('title')}</h1>
            <p>{text('description')}</p>
          </div>
        </header>

        <p className="statement-center-scope" role="note">{text('scope')}</p>

        <section aria-labelledby="statement-center-products-heading">
          <h2 id="statement-center-products-heading">{text('title')}</h2>
          <div className="statement-center-grid">
            {STATEMENT_CENTER_LINKS.map(({ key, to, archive, Icon }) => (
              <article className="statement-center-card" key={key}>
                <div className="statement-center-card-icon" aria-hidden="true"><Icon size={24} /></div>
                <h3>{text(key)}</h3>
                <p>{text(`${key}Description`)}</p>
                <div className="statement-center-card-actions">
                  <Link className="statement-center-primary" to={to}>
                    {text('open')} <ArrowRight size={16} aria-hidden="true" />
                  </Link>
                  {archive && <Link className="statement-center-secondary" to={archive}>{text('archive')}</Link>}
                </div>
              </article>
            ))}
          </div>
        </section>
      </main>
      <Footer />
    </div>
  );
}
