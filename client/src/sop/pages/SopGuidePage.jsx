import { useTranslation } from 'react-i18next';
import { Link, useParams } from 'react-router-dom';
import PageMeta from '../../components/PageMeta';
import { getGuide } from '../guideRegistry.js';
import SopGuideContent from '../components/SopGuideContent.jsx';
import '../sop.css';
export default function SopGuidePage() {
 const { t } = useTranslation();
 const { area, guideSlug } = useParams();
 const guide = getGuide(area, guideSlug);
 return <div className="sop-page"><div className="sop-container">
  <PageMeta title={guide?.title || t('sop.guide.notFound')} description={guide?.goal}/>
  <Link className="sop-back-link" to="/how-it-works/guides">{t('sop.guide.backToLibrary')}</Link>
  {guide ? <SopGuideContent guide={guide}/> : <><h1>{t('sop.guide.notFound')}</h1><p>{t('sop.guide.notFoundBody')}</p></>}
 </div></div>;
}
