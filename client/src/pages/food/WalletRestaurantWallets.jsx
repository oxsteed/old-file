import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { AlertCircle, Store } from 'lucide-react';
import { listMyFoodRestaurantWallets, formatFoodMoney } from '../../api/food';
import './OxsteedCreditPage.css';

function availableCents(wallet) {
  const balance = Number(wallet?.balanceCents || 0);
  const reserved = Number(wallet?.reservedCents || 0);
  return Number(wallet?.availableBalanceCents ?? Math.max(0, balance - reserved));
}

// Restaurant credit section of the unified Wallet page.
//
// Independent by design: it fetches its own data, keeps its own loading,
// error, and empty states, and renders outside the OxSteed Credit loading
// branch. A failure here never blanks the OxSteed Credit section, and a
// failure there never blanks this one.
//
// Presentation only: balances are shown per restaurant exactly as the
// restaurant ledger reports them. Nothing is summed, merged, or converted
// across restaurants or across credit systems.
export default function WalletRestaurantWallets({ onWalletsLoaded }) {
  const { t } = useTranslation('credit');
  const [wallets, setWallets] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);
  const requestRef = useRef(0);

  const load = useCallback(async () => {
    const requestId = ++requestRef.current;
    setLoading(true);
    setError(null);
    try {
      const result = await listMyFoodRestaurantWallets();
      if (requestId !== requestRef.current) return;
      const next = Array.isArray(result) ? result : [];
      setWallets(next);
      if (typeof onWalletsLoaded === 'function') onWalletsLoaded(next.length);
    } catch (err) {
      if (requestId !== requestRef.current) return;
      setError(err?.response?.data?.message || err?.message || t('restaurantWalletsError'));
      setWallets([]);
    } finally {
      if (requestId === requestRef.current) setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    load();
    return () => { requestRef.current += 1; };
  }, [load]);

  return (
    <section className="ox-credit-panel" aria-labelledby="wallet-restaurant-wallets-heading" id="restaurant-credit">
      <div className="ox-credit-panel-heading">
        <div>
          <p className="ox-credit-eyebrow">{t('walletTitle')}</p>
          <h2 id="wallet-restaurant-wallets-heading">{t('restaurantWalletsTitle')}</h2>
        </div>
        {Array.isArray(wallets) && wallets.length > 0 && (
          <span className="ox-credit-count">{wallets.length}</span>
        )}
      </div>
      <p className="ox-credit-panel-copy">{t('restaurantWalletsCopy')}</p>

      {loading ? (
        <div className="ox-credit-loading" role="status" aria-live="polite">
          {t('restaurantWalletsLoading')}
        </div>
      ) : error ? (
        <div className="ox-credit-error-panel" role="alert">
          <AlertCircle size={24} />
          <strong>{t('restaurantWalletsError')}</strong>
          <span>{error}</span>
          <button type="button" className="ox-credit-refresh" onClick={load}>
            {t('retry')}
          </button>
        </div>
      ) : wallets.length === 0 ? (
        <div className="ox-credit-empty">
          <Store size={27} />
          <strong>{t('restaurantWalletsEmpty')}</strong>
          <span>{t('restaurantWalletsEmptyCopy')}</span>
        </div>
      ) : (
        <div className="ox-credit-hold-list">
          {wallets.map((wallet) => {
            const restaurantId = wallet?.restaurantId;
            const currency = wallet?.currencyCode || 'USD';
            return (
              <article key={restaurantId || wallet?.id || wallet?.restaurantName}>
                <div>
                  <strong>{wallet?.restaurantName || t('restaurantWallet.restaurant')}</strong>
                  <span>
                    {t('restaurantWallet.available')}: {formatFoodMoney(availableCents(wallet), currency)}
                  </span>
                </div>
                <div className="ox-credit-hold-end">
                  {restaurantId ? (
                    <Link
                      to={`/restaurant-credit?restaurantId=${encodeURIComponent(restaurantId)}`}
                      className="ox-credit-detail-link"
                    >
                      {t('viewRestaurantWallet')}
                    </Link>
                  ) : null}
                </div>
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
}
