import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  ArrowRight,
  Briefcase,
  DollarSign,
  Eye,
  FileText,
  Store,
  UtensilsCrossed,
  WalletCards,
} from 'lucide-react';
import Navbar from '../../components/Navbar';
import Footer from '../../components/Footer';
import PageMeta from '../../components/PageMeta';
import StatementPreviewModal from '../../components/statements/StatementPreviewModal';
import StatementSearch from '../../components/statements/StatementSearch';
import api from '../../api/axios';
import { formatStatementMoney } from '../../lib/creditStatementFormat';
import './StatementCenterPage.css';

// Product cards in display order. `product` is the statement API product key;
// `to` is the full-page statements route used by "Open statements" and the
// preview modal's "Open full page" action.
const PRODUCT_CARDS = [
  { key: 'oxsteedCredit', product: 'oxsteed', to: '/oxsteed-credit/statements', archive: '/oxsteed-credit/statements/archive', Icon: WalletCards },
  { key: 'restaurantCredit', product: 'restaurant', to: '/restaurant-credit/statements', archive: '/restaurant-credit/statements/archive', Icon: UtensilsCrossed },
  { key: 'restaurantSettlement', product: 'restaurant_settlement', to: '/restaurant-settlement/statements', archive: null, Icon: Store },
  { key: 'helperEarnings', product: 'helper_earnings', to: '/helper-earnings/statements', archive: null, Icon: DollarSign },
  { key: 'business', product: 'business', to: '/business/statements', archive: null, Icon: Briefcase },
];

// Summary row order per product, in each product's own accounting vocabulary.
const SUMMARY_ROWS = {
  oxsteedCredit: ['balance', 'lastPeriodCredits', 'lastPeriodDebits'],
  restaurantCredit: ['balance', 'lastPeriodCredits', 'lastPeriodDebits'],
  restaurantSettlement: ['outstanding', 'invoiced', 'collected', 'adjusted'],
  helperEarnings: ['payable', 'earned', 'settled'],
  business: ['outstanding', 'invoiced', 'collected', 'adjusted'],
};

// Setup prompts for products the user could hold but does not.
const SETUP_PROMPTS = {
  oxsteedCredit: { body: 'setupOxsteedCredit', action: 'setupOxsteedCreditAction', to: '/oxsteed-credit' },
  restaurantCredit: { body: 'setupRestaurantCredit', action: 'setupRestaurantCreditAction', to: '/restaurants' },
};

function monthLabel(period, language) {
  if (!period) return null;
  const match = /^(\d{4})-(\d{2})$/.exec(String(period));
  if (!match) return String(period);
  try {
    return new Intl.DateTimeFormat(language, { month: 'long', year: 'numeric', timeZone: 'UTC' })
      .format(new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, 1)));
  } catch {
    return String(period);
  }
}

function SummaryLines({ productKey, summary, language, text }) {
  const rows = SUMMARY_ROWS[productKey] || [];
  return <dl className="statement-center-summary">
    {rows.map((rowKey) => {
      const value = summary?.[rowKey];
      // Missing data is explicit, never a reassuring zero: Number(null) is 0,
      // so null amounts must short-circuit before formatting.
      const display = value && value.currency && value.amountCents != null && Number.isSafeInteger(Number(value.amountCents))
        ? formatStatementMoney(Number(value.amountCents), value.currency, language)
        : text('unavailable');
      return <div key={rowKey} className="statement-center-summary-row">
        <dt>{text(rowKey)}</dt>
        <dd><bdi>{display}</bdi></dd>
      </div>;
    })}
  </dl>;
}

function StatusPill({ status, text }) {
  const label = status === 'ready' ? text('statusReady')
    : status === 'preparing' ? text('statusPreparing') : text('statusNone');
  return <span className={`statement-center-pill statement-center-pill-${status || 'none'}`}>{label}</span>;
}

function ProductCard({ config, entry, language, text, onPreview }) {
  const { key, to, archive, Icon } = config;
  const latestPeriod = entry?.latestPeriod ? monthLabel(entry.latestPeriod, language) : text('noPeriod');
  const setup = SETUP_PROMPTS[key];
  const showSetup = entry && entry.setupState === 'setup_needed' && setup;
  const multiScope = entry && entry.summary == null && Array.isArray(entry.scopes) && entry.scopes.length > 1;

  return <article className="statement-center-card" aria-labelledby={`sc-card-${key}`}>
    <div className="statement-center-card-top">
      <div className="statement-center-card-icon" aria-hidden="true"><Icon size={24} /></div>
      <StatusPill status={entry?.statementStatus} text={text} />
    </div>
    <h3 id={`sc-card-${key}`}>{text(key)}</h3>
    <p>{text(`${key}Description`)}</p>

    {entry ? <>
      <p className="statement-center-period">
        <strong>{text('latestPeriod')}:</strong> {latestPeriod}
      </p>
      {entry.loadError && <p className="statement-center-note" role="alert">{text('loadErrorNote')}</p>}
      {entry.hasAccount && entry.summary && <SummaryLines productKey={key} summary={entry.summary} language={language} text={text} />}
      {entry.hasAccount && multiScope && <ul className="statement-center-scopes">
        {entry.scopes.map((scope) => <li key={scope.scopeKey} className="statement-center-scope-row">
          <div className="statement-center-scope-main">
            <strong><bdi>{scope.label}</bdi></strong>
            {scope.currency && <span className="statement-center-scope-currency"><bdi>{scope.currency}</bdi></span>}
            <span className="statement-center-scope-period">{scope.latestPeriod ? monthLabel(scope.latestPeriod, language) : text('noPeriod')}</span>
          </div>
          <button type="button" className="statement-center-preview-btn" onClick={() => onPreview(scope)}>
            <Eye size={15} aria-hidden="true" />{text('preview')}
          </button>
        </li>)}
      </ul>}
      {entry.hasAccount && !multiScope && entry.scopes.length > 0 && (
        <div>
          <button type="button" className="statement-center-preview-btn" onClick={() => onPreview(entry.scopes[0])}>
            <Eye size={15} aria-hidden="true" />{text('preview')}
          </button>
        </div>
      )}
      {showSetup && <div className="statement-center-setup" role="note">
        <p>{text(setup.body)}</p>
        <Link to={setup.to} className="statement-center-secondary">{text(setup.action)}</Link>
      </div>}
      {!entry.hasAccount && !showSetup && <p className="statement-center-note">{text('notAvailableForAccount')}</p>}
    </> : <p className="statement-center-note">{text('notAvailableForAccount')}</p>}

    <div className="statement-center-card-actions">
      <Link className="statement-center-primary" to={to}>
        {text('open')} <ArrowRight size={16} aria-hidden="true" />
      </Link>
      {archive && <Link className="statement-center-secondary" to={archive}>{text('archive')}</Link>}
    </div>
  </article>;
}

export default function StatementCenterPage() {
  const { t, i18n } = useTranslation('credit');
  const language = (i18n.resolvedLanguage || i18n.language || 'en').split(/[-_]/)[0];
  const text = (key, options = {}) => t(`statements.center.${key}`, options);
  const [center, setCenter] = useState({ status: 'loading', products: null });
  const [preview, setPreview] = useState(null);

  useEffect(() => {
    let active = true;
    setCenter({ status: 'loading', products: null });
    api.get('/statements/center')
      .then((response) => {
        if (!active) return;
        setCenter({ status: 'ready', products: response.data?.products || null });
      })
      .catch(() => {
        if (active) setCenter({ status: 'error', products: null });
      });
    return () => { active = false; };
  }, []);

  const openPreview = (config) => (scope) => {
    setPreview({
      product: config.product,
      productLabel: text(config.key),
      scope,
      fullPageUrl: config.to,
    });
  };

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

        <StatementSearch />

        <section aria-labelledby="statement-center-products-heading">
          <h2 id="statement-center-products-heading">{text('title')}</h2>
          {center.status === 'loading' && <div className="statement-center-state" role="status">{text('loading')}</div>}
          {center.status === 'error' && <div className="statement-center-state" role="alert">
            <p>{text('loadError')}</p>
            <button
              type="button"
              className="statement-center-preview-btn"
              onClick={() => {
                setCenter({ status: 'loading', products: null });
                api.get('/statements/center')
                  .then((response) => setCenter({ status: 'ready', products: response.data?.products || null }))
                  .catch(() => setCenter({ status: 'error', products: null }));
              }}
            >
              {text('retry')}
            </button>
          </div>}
          {center.status === 'ready' && <div className="statement-center-grid">
            {PRODUCT_CARDS.map((config) => (
              <ProductCard
                key={config.key}
                config={config}
                entry={center.products?.[config.key] || null}
                language={language}
                text={text}
                onPreview={openPreview(config)}
              />
            ))}
          </div>}
        </section>
      </main>
      <Footer />
      <StatementPreviewModal
        open={preview != null}
        onClose={() => setPreview(null)}
        product={preview?.product}
        productLabel={preview?.productLabel}
        scope={preview?.scope || null}
        fullPageUrl={preview?.fullPageUrl}
      />
    </div>
  );
}
