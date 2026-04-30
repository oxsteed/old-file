import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { FileText, AlertCircle } from 'lucide-react';
import api from '../api/axios';
import './TermsOfServicePage.css';

export default function LegalHubPage() {
  const { t } = useTranslation();
  const [documents, setDocuments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    (async () => {
      try {
        const { data } = await api.get('/legal/hub');
        setDocuments(data.documents || []);
      } catch {
        setError(t('legal.hubLoadError', 'Could not load legal documents.'));
      } finally {
        setLoading(false);
      }
    })();
  }, [t]);

  if (loading) {
    return (
      <div className="terms-page terms-page-loading">
        <div className="terms-spinner">{t('common.loading', 'Loading…')}</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="terms-page terms-page-error">
        <div className="terms-error-box">
          <AlertCircle size={24} />
          <p>{error}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="terms-page terms-visual legal-hub-page">
      <header className="terms-header terms-header-span legal-hub-header">
        <h1>{t('legal.hubTitle', 'Legal documents')}</h1>
        <p className="legal-hub-intro">
          {t(
            'legal.hubIntro',
            'Policies and agreements for using OxSteed. Open any document to search sections or copy a link to a specific clause.'
          )}
        </p>
      </header>

      <main className="legal-hub-main">
        {documents.length === 0 ? (
          <p className="legal-hub-empty">{t('legal.hubEmpty', 'No published legal documents yet.')}</p>
        ) : (
          <ul className="legal-hub-list">
            {documents.map((d) => (
              <li key={d.category} className="legal-hub-card">
                <FileText size={22} className="legal-hub-card-icon" aria-hidden />
                <div className="legal-hub-card-body">
                  <Link to={d.path} className="legal-hub-card-title">
                    {d.title}
                  </Link>
                  {d.description && <p className="legal-hub-card-desc">{d.description}</p>}
                  <div className="legal-hub-card-meta">
                    {d.publishedAt && (
                      <span>
                        {t('terms.lastUpdated', 'Last updated')}{' '}
                        {new Date(d.publishedAt).toLocaleDateString()}
                      </span>
                    )}
                    {d.version != null && (
                      <span>
                        {' '}
                        · {t('terms.version', 'Version')} {d.version}
                      </span>
                    )}
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </main>
    </div>
  );
}
