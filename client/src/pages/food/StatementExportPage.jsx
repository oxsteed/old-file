import { useTranslation } from 'react-i18next';
import Navbar from '../../components/Navbar';
import Footer from '../../components/Footer';
import PageMeta from '../../components/PageMeta';
import StatementExportPanel from './StatementExportPanel';
import './StatementArchivePage.css';

export default function StatementExportPage() {
  const { t, i18n } = useTranslation('credit');
  return <div className="statement-archive-shell" dir={i18n.dir()}>
    <PageMeta title={t('statementCenter.export')} noIndex /><Navbar />
    <main className="statement-archive-page"><StatementExportPanel /></main><Footer />
  </div>;
}
