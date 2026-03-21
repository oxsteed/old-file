import { useEffect, useState } from 'react';
import { Link }                from 'react-router-dom';
import { AlertTriangle }       from 'lucide-react';
import adminApi                from '../../lib/adminApi';

const STATUS_TABS = ['open','under_review','resolved'];

export default function AdminDisputes() {
  const [disputes, setDisputes] = useState([]);
  const [tab,      setTab]      = useState('open');
  const [total,    setTotal]    = useState(0);
  const [loading,  setLoading]  = useState(true);
  const [acting,   setActing]   = useState(null);

  useEffect(() => {
    const fetch = async () => {
      setLoading(true);
      try {
        const { data } = await adminApi.get('/admin/disputes/all', {
          params: { status: tab }        });
        setDisputes(data.disputes);
        setTotal(data.total);
      } catch (err) {
        console.error(err);
      } finally {
        setLoading(false);
      }
    };
    fetch();
  }, [tab]);

  const handleStartReview = async (disputeId) => {
    setActing(disputeId);
    try {
      await adminApi.post(`/admin/disputes/${disputeId}/review`);
      setDisputes(prev =>
        prev.map(d =>
          d.id === disputeId ? { ...d, status: 'under_review' } : d
        )
      );
    } catch (err) {
      console.error(err);
    } finally {
      setActing(null);
    }
  };

  return (
    <div className="p-8">
      <div className="flex items-center gap-3 mb-6">
        <AlertTriangle size={22} className="text-orange-400" />
        <div>
          <h1 className="text-2xl font-bold text-white">Disputes</h1>
          <p className="text-gray-400 text-sm mt-0.5">
            {total} {tab.replace('_',' ')} dispute{total !== 1 ? 's' : ''}
          </p>
        </div>
      </div>

      {/* Status tabs */}
      <div className="flex gap-2 mb-6">
        {STATUS_TABS.map(t => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-4 py-1.5 rounded-full text-xs font-semibold
                        capitalize transition ${
              tab === t
                ? 'bg-orange-500 text-white'
                : 'bg-gray-800 text-gray-400 hover:text-white'
            }`}
          >
            {t.replace('_', ' ')}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="text-center py-16 text-gray-500">Loading...</div>
      ) : disputes.length === 0 ? (
        <div className="text-center py-16">
          <p className="text-4xl mb-3">✓</p>
          <p className="text-gray-400 font-medium">
            No {tab.replace('_',' ')} disputes.
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          {disputes.map(dispute => (
            <div key={dispute.id}
                 className="bg-gray-800 border border-gray-700 rounded-2xl p-5">
              <div className="flex items-start justify-between gap-4 flex-wrap">
                <div className="flex-1">
                  <div className="flex items-center gap-2 flex-wrap mb-2">
                    <span className="text-xs font-mono text-gray-500">
                      #{dispute.id.split('-')[0]}
                    </span>
                    <span className={`text-xs font-medium px-2 py-0.5
                                      rounded-full capitalize ${
                      dispute.status === 'open'
                        ? 'bg-yellow-900 text-yellow-400'
                        : dispute.status === 'under_review'
                        ? 'bg-blue-900 text-blue-400'
                        : 'bg-green-900 text-green-400'
                    }`}>
                      {dispute.status.replace('_',' ')}
                    </span>
                    <span className="text-xs px-2 py-0.5 bg-gray-700
                                     text-gray-400 rounded-full capitalize">
                      {dispute.reason.replace(/_/g,' ')}
                    </span>
                  </div>

                  <p className="font-semibold text-white">
                    {dispute.job_title}
                  </p>

                  <div className="flex items-center gap-4 mt-2
                                  text-xs text-gray-400 flex-wrap">
                    <span>
                      By: <span className="text-gray-300">
                        {dispute.opened_by_name}
                      </span>
                      {' '}({dispute.opened_by_role})
                    </span>
                    <span>
                      vs: <span className="text-gray-300">
                        {dispute.against_user_name}
                      </span>
                    </span>
                    {dispute.job_amount && (
                      <span className="text-white font-bold">
                        ${parseFloat(dispute.job_amount).toFixed(2)}
                      </span>
                    )}
                    <span>
                      {new Date(dispute.created_at).toLocaleDateString()}
                    </span>
                  </div>
                </div>

                {/* Actions */}
                <div className="flex flex-col gap-2 items-end shrink-0">
                  <div className="flex gap-2 flex-wrap justify-end">
                    <div className="flex gap-1.5 text-xs text-gray-500">
                      <span title="Evidence">
                        📎 {dispute.evidence_count}
                      </span>
                      <span title="Messages">
                        💬 {dispute.message_count}
                      </span>
                    </div>
                  </div>

                  <div className="flex gap-2">
                    {dispute.status === 'open' && (
                      <button
                        onClick={() => handleStartReview(dispute.id)}
                        disabled={acting === dispute.id}
                        className="px-3 py-1.5 bg-blue-900 text-blue-300
                                   text-xs font-semibold rounded-lg
                                   hover:bg-blue-800 disabled:opacity-50
                                   transition"
                      >
                        {acting === dispute.id ? '...' : 'Start Review'}
                      </button>
                    )}
                    <Link
                      to={`/admin/disputes/${dispute.id}`}
                      className="px-3 py-1.5 bg-orange-900 text-orange-300
                                 text-xs font-semibold rounded-lg
                                 hover:bg-orange-800 transition"
                    >
                      View →
                    </Link>
                  </div>
                </div>
              </div>

              {/* Evidence deadline indicator */}
              {dispute.status === 'open' && dispute.evidence_deadline && (
                <div className="mt-3 pt-3 border-t border-gray-700
                                flex items-center gap-2">
                  <AlertTriangle size={12} className="text-yellow-400" />
                  <p className="text-xs text-yellow-400">
                    Evidence deadline:{' '}
                    {new Date(dispute.evidence_deadline).toLocaleString()}
                    {new Date(dispute.evidence_deadline) < new Date() &&
                      ' — EXPIRED'
                    }
                  </p>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
