import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import toast from 'react-hot-toast';
import PageMeta from '../components/PageMeta';
import PageShell from '../components/PageShell';
import { decideCareerOffer, listMyCareerApplications, withdrawCareerApplication } from '../api/careers';
import '../styles/CareerSystem.css';

export default function MyCareerApplicationsPage() {
  const { t } = useTranslation();
  const [rows, setRows] = useState([]);

  async function load() {
    try {
      setRows(await listMyCareerApplications());
    } catch (err) {
      toast.error(err?.response?.data?.error || t('careers.loadError'));
    }
  }

  useEffect(() => { load(); }, []);

  return (
    <PageShell>
      <PageMeta title={t('careers.myApplications')} description={t('careers.metaDesc')} />
      <div className="ox-careers">
        <Link to="/careers">{t('careers.back')}</Link>
        <h1>{t('careers.myApplications')}</h1>
        {rows.length === 0 ? (
          <p>{t('careers.noApplications')}</p>
        ) : (
        <div className="ox-careers-grid">
          {rows.map((row) => (
            <div key={row.id} className="ox-careers-panel">
              <p className="ox-careers-kicker">{row.employer_name}</p>
              <h2 style={{ fontSize: '1.1rem' }}>{row.title}</h2>
              <p>{t(`careers.stage.${row.stage}`)}</p>
              <div className="ox-careers-actions">
                <Link className="ox-careers-btn" to={`/careers/${row.opening_id}`}>{t('careers.viewRole')}</Link>
                {row.stage === 'offer' && (
                  <>
                    <button type="button" className="ox-careers-btn primary" onClick={async () => {
                      const offerId = row.offers?.[0]?.id;
                      if (!offerId) return toast.error(t('careers.apply.error'));
                      await decideCareerOffer(offerId, 'accepted');
                      toast.success(t('careers.apply.offerAccepted'));
                      load();
                    }}>{t('careers.apply.acceptOffer')}</button>
                    <button type="button" className="ox-careers-btn" onClick={async () => {
                      const offerId = row.offers?.[0]?.id;
                      if (!offerId) return;
                      await decideCareerOffer(offerId, 'declined');
                      load();
                    }}>{t('careers.apply.declineOffer')}</button>
                  </>
                )}
                {!['hired', 'withdrawn', 'rejected'].includes(row.stage) && (
                  <button type="button" className="ox-careers-btn" onClick={async () => {
                    await withdrawCareerApplication(row.id);
                    load();
                  }}>{t('careers.apply.withdraw')}</button>
                )}
              </div>
            </div>
          ))}
        </div>
        )}
      </div>
    </PageShell>
  );
}
