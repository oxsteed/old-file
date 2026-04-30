import { Navigate, useParams } from 'react-router-dom';
import LegalDocumentPage from './LegalDocumentPage';
import { LEGAL_SLUG_TO_CATEGORY } from '../constants/legalPublicRoutes';

export default function LegalDocumentPageWrapper() {
  const { slug } = useParams();
  const categoryKey = LEGAL_SLUG_TO_CATEGORY[slug];
  if (!categoryKey) return <Navigate to="/legal" replace />;
  return <LegalDocumentPage categoryKey={categoryKey} />;
}
