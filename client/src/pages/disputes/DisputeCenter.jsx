import { useEffect, useState }  from 'react';
import { Link }                 from 'react-router-dom';
import { useTranslation }       from 'react-i18next';
import { AlertTriangle }        from 'lucide-react';
import api                      from '../../api/axios';
import Navbar                   from '../../components/Navbar';
import Footer                   from '../../components/Footer';

export default function DisputeCenter() {
  const { t } = useTranslation();
  const [disputes, setDisputes] = useState([]);
  const [loading,  setLoading]  = useState(true);

  useEffect(() => {
    const fetch = async () => {
      try {
        const { data } = await api.get('/disputes/my');
        setDisputes(data.disputes);
      } catch (err) {
        console.error(err);
      } finally {
        setLoading(false);
      }
    };
    fetch();
  }, []);

  const STATUS_COLORS = {
    open:         'bg-yellow-100 text-yellow-700',
    under_review: 'bg-blue-100   text-blue-700',
    resolved:     'bg-green-100  text-green-700',
    closed:       'bg-gray-100   text-gray-500'
  };

  const RESOLUTION_LABELS = {
    full_refund:       t('disputes.detail.resolutionTitle') + ': ' + '✓ Full refund issued',
    partial_refund:    '◑ Partial refund issued',
    release_to_helper: '→ Payment released to helper',
    dismissed:         '✕ Dismissed'
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-950 flex flex-col">
        <Navbar />
        <div className="flex-1 flex items-center justify-center text-gray-400">
          {t('disputes.center.loading')}
        </div>
        <Footer />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-950 flex flex-col">
      <Navbar />
      <main className="flex-1">
      <div className="max-w-3xl mx-auto px-4 py-8">
      <div className="flex items-center gap-3 mb-6">
        <AlertTriangle size={22} className="text-orange-500" />
        <div>
          <h1 className="text-2xl font-bold text-gray-900">{t('disputes.center.title')}</h1>
          <p className="text-sm text-gray-500 mt-0.5">
            {t('disputes.center.subtitle')}
          </p>
        </div>
      </div>

      {disputes.length === 0 ? (
        <div className="text-center py-16 bg-gray-50 rounded-2xl border border-gray-200">
          <AlertTriangle size={36} className="mx-auto text-gray-300 mb-3" />
          <p className="text-gray-500 font-medium">{t('disputes.center.noDisputes')}</p>
          <p className="text-gray-400 text-sm mt-1">
            {t('disputes.center.noDisputesSub')}
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          {disputes.map(dispute => (
            <Link
              key={dispute.id}
              to={`/disputes/${dispute.id}`}
              className="block bg-white border border-gray-200 rounded-2xl p-5 hover:shadow-md transition"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="flex-1 min-w-0">
                  <p className="font-semibold text-gray-900 truncate">{dispute.job_title}</p>
                  <p className="text-sm text-gray-500 mt-0.5 capitalize">
                    {dispute.reason?.replace(/_/g, ' ')}
                  </p>
                </div>
                <span className={`inline-flex px-3 py-1 rounded-full text-xs font-semibold capitalize flex-shrink-0 ${
                  STATUS_COLORS[dispute.status] || 'bg-gray-100 text-gray-500'
                }`}>
                  {dispute.status?.replace('_', ' ')}
                </span>
              </div>
              {dispute.resolution && (
                <p className="mt-2 text-xs text-green-600 font-medium">
                  {RESOLUTION_LABELS[dispute.resolution] || dispute.resolution}
                </p>
              )}
              <p className="text-xs text-gray-400 mt-2">
                {new Date(dispute.created_at).toLocaleDateString()}
              </p>
            </Link>
          ))}
        </div>
      )}
      </div>
      </main>
      <Footer />
    </div>
  );
}
