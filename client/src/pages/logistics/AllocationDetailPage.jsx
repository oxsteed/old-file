import { useParams, Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import PageShell from '../../components/PageShell';
import LogisticsLayout from '../../components/logistics/LogisticsLayout';
import AllocationPreview from '../../components/logistics/AllocationPreview';
export default function AllocationDetailPage() {
    const { id } = useParams();
    const { t } = useTranslation();
    return <PageShell>
    <LogisticsLayout title={t('logistics.modal.allocationPreviewTitle')}><Link className="lx-link" to="/logistics/distribution">{t('logistics.nav.distributor')}</Link>
    <AllocationPreview key={id} id={id} open embedded/></LogisticsLayout></PageShell>;
}
