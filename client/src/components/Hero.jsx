import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

export default function Hero({ search }) {
  const { t } = useTranslation();
  const { user } = useAuth();

  return (
    <div className="hp-hero-inner">
      <div className="hp-hero-eyebrow">Local trades marketplace</div>
      <h1 className="hp-hero-title">
        {t('hero.title').split('\n').map((line, i, arr) => (
          i < arr.length - 1
            ? <span key={i}>{line}<br /></span>
            : <em key={i}>{line}</em>
        ))}
      </h1>
      <p className="hp-hero-sub">{t('hero.subtitle')}</p>

      {search}

      <div className="hp-hero-ctas">
        {user ? (
          <>
            <Link
              to={user.role === 'helper' ? '/jobs' : '/post-job'}
              className="hp-btn hp-btn-primary hp-btn-lg"
            >
              {user.role === 'helper' ? t('nav.browseJobs') : t('hero.postJob')}
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden="true">
                <polyline points="9 18 15 12 9 6" />
              </svg>
            </Link>
            <Link to="/dashboard" className="hp-btn hp-btn-outline hp-btn-lg">
              {t('nav.dashboard')}
            </Link>
          </>
        ) : (
          <>
            <Link to="/register/customer" className="hp-btn hp-btn-primary hp-btn-lg">
              {t('hero.postJob')}
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden="true">
                <polyline points="9 18 15 12 9 6" />
              </svg>
            </Link>
            <Link to="/jobs" className="hp-btn hp-btn-outline hp-btn-lg">
              {t('hero.browseHelpers')}
            </Link>
          </>
        )}
      </div>

      <div className="hp-hero-trust">
        <span className="hp-trust-pill">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden="true">
            <polyline points="20 6 9 17 4 12" />
          </svg>
          {t('hero.trustFree')}
        </span>
        <span className="hp-trust-pill">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden="true">
            <polyline points="20 6 9 17 4 12" />
          </svg>
          {t('hero.trustPrivate')}
        </span>
        <span className="hp-trust-pill">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden="true">
            <polyline points="20 6 9 17 4 12" />
          </svg>
          {t('hero.trustNoObligation')}
        </span>
      </div>
    </div>
  );
}
