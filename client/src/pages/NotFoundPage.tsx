import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import PageShell from '../components/PageShell';

export default function NotFoundPage() {
  const { t } = useTranslation();
  return (
    <PageShell>
      <div style={{
        flex: 1,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 'var(--space-8)',
        minHeight: '60vh',
      }}>
        <div style={{ maxWidth: 480, width: '100%', textAlign: 'center' }}>
          <div style={{
            fontSize: 120,
            fontWeight: 800,
            color: 'var(--color-primary)',
            lineHeight: 1,
            marginBottom: 'var(--space-2)',
          }}>
            404
          </div>

          <h1 style={{
            color: 'var(--color-text)',
            fontSize: 'var(--text-2xl)',
            fontWeight: 600,
            marginBottom: 'var(--space-3)',
          }}>
            {t('notFound.pageNotFound')}
          </h1>

          <p style={{
            color: 'var(--color-text-muted)',
            fontSize: 'var(--text-base)',
            lineHeight: 1.6,
            marginBottom: 'var(--space-8)',
          }}>
            {t('notFound.description')}
          </p>

          <div style={{
            display: 'flex',
            gap: 'var(--space-3)',
            justifyContent: 'center',
            marginBottom: 'var(--space-6)',
          }}>
            <Link to="/" className="ox-btn ox-btn-primary ox-btn-lg">
              {t('notFound.goHome')}
            </Link>
            <button
              onClick={() => window.history.back()}
              className="ox-btn ox-btn-outline ox-btn-lg"
            >
              {t('notFound.goBack')}
            </button>
          </div>

          <p style={{
            color: 'var(--color-text-faint)',
            fontSize: 'var(--text-xs)',
          }}>
            {t('notFound.needHelp')}{' '}
            <a
              href="mailto:support@oxsteed.com"
              style={{ color: 'var(--color-primary)', textDecoration: 'underline' }}
            >
              support@oxsteed.com
            </a>
          </p>
        </div>
      </div>
    </PageShell>
  );
}
