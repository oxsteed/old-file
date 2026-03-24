import { useEffect, useState }  from 'react';
import { Link }                 from 'react-router-dom';
import { AlertTriangle }        from 'lucide-react';
import api                      from '../../api/api';

const STATUS_COLORS = {
  open:         'bg-yellow-100 text-yellow-700',
  under_review: 'bg-blue-100   text-blue-700',
  resolved:     'bg-green-100  text-green-700',
  closed:       'bg-gray-100   text-gray-500'
};

const RESOLUTION_LABELS = {
  full_refund:       '✓ Full refund issued',
  partial_refund:    '◑ Partial refund issued',
  release_to_helper: '→ Payment released to helper',
  dismissed:         '✕ Dismissed'
};

export default function DisputeCenter() {
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

  if (loading) {
    return (
      <div className="max-w-3xl mx-auto px-4 py-16 text-center
                      text-gray-400">
        Loading...
      </div>
    );
  }

  return (
    <div className="max-w-3xl mx-auto px-4 py-8">
      <div className="flex items-center gap-3 mb-6">
        <AlertTriangle size={22} className="text-orange-500" />
        <div>
          <h1 className="text-2xl font-bold text-gray-900">My Disputes</h1>
          <p className="text-sm text-gray-500 mt-0.5">
            View and manage your active disputes
          </p>
        </div>
      </div>

      {disputes.length === 0 ? (
        <div className="text-center py-16 bg-gray-50 rounded-2xl
                        border border-gray-200">
          <AlertTriangle size={36} className="mx-auto text-gray-300 mb-3" />
          <p className="text-gray-500 font-medium">No disputes found.</p>
          <p className="text-gray-400 text-sm mt-1">
            Disputes can be opened on completed jobs within the review period.
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          {disputes.map(dispute => (
            <Link
              key={dispute.id}
              to={`/disputes/${dispute.id}`}
              className="block bg-white border border-gray-200 rounded-xl
                         p-5 hover:shadow-md hover:border-orange-200
                         transition-all"
            >
              <div className="flex items-start justify-between gap-4">
                <div className="flex-1">
                  <p className="font-semibold text-gray-800">
                    {dispute.job_title}
                  </p>
                  <p className="text-xs text-gray-400 mt-1 capitalize">
                    {dispute.reason.replace(/_/g, ' ')} ·{' '}
                    Opened{' '}
                    {new Date(dispute.created_at).toLocaleDateString('en-US', {
                      month: 'short', day: 'numeric', year: 'numeric'
                    })}
                  </p>
                  <p className="text-xs text-gray-500 mt-1">
                    vs. {dispute.against_user_name}
                  </p>
                </div>
                <div className="flex flex-col items-end gap-2 shrink-0">
                  <span className={`text-xs font-semibold px-2.5 py-1
                                    rounded-full capitalize ${
                    STATUS_COLORS[dispute.status] || STATUS_COLORS.closed
                  }`}>
                    {dispute.status.replace('_', ' ')}
                  </span>
                  {dispute.job_amount && (
                    <p className="text-sm font-bold text-gray-700">
                      ${parseFloat(dispute.job_amount).toFixed(2)}
                    </p>
                  )}
                </div>
              </div>

              {/* Resolution */}
              {dispute.resolution && (
                <div className="mt-3 pt-3 border-t border-gray-100">
                  <p className={`text-xs font-medium ${
                    dispute.resolution === 'full_refund' ||
                    dispute.resolution === 'partial_refund'
                      ? 'text-green-600'
                      : dispute.resolution === 'release_to_helper'
                      ? 'text-blue-600'
                      : 'text-gray-500'
                  }`}>
                    {RESOLUTION_LABELS[dispute.resolution]}
                  </p>
                </div>
              )}

              {/* Evidence deadline warning */}
              {dispute.status === 'open' &&
               new Date(dispute.evidence_deadline) > new Date() && (
                <div className="mt-3 bg-yellow-50 border border-yellow-200
                                rounded-lg px-3 py-2 flex items-center gap-2">
                  <AlertTriangle size={13}
                                 className="text-yellow-600 shrink-0" />
                  <p className="text-xs text-yellow-700">
                    Evidence deadline:{' '}
                    <strong>
                      {new Date(dispute.evidence_deadline)
                        .toLocaleString('en-US', {
                          month:  'short', day:    'numeric',
                          hour:   '2-digit', minute: '2-digit'
                        })}
                    </strong>
                  </p>
                </div>
              )}
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
