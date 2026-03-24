import { useEffect, useState }  from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import adminApi                 from '../../lib/adminApi';

const RESOLUTION_OPTIONS = [
  {
    value: 'full_refund',
    label: 'Full Refund to Client',
    description: 'Client receives 100% refund. Helper receives nothing.',
    color: 'border-green-500 bg-green-950'
  },
  {
    value: 'partial_refund',
    label: 'Partial Refund',
    description: 'Split the payment. Enter refund amount below.',
    color: 'border-yellow-500 bg-yellow-950',
    needsAmount: true
  },
  {
    value: 'release_to_helper',
    label: 'Release to Helper',
    description: 'Helper wins dispute. Full payment released.',
    color: 'border-blue-500 bg-blue-950'
  },
  {
    value: 'dismissed',
    label: 'Dismiss Dispute',
    description: 'No financial action. Dispute closed.',
    color: 'border-gray-500 bg-gray-800'
  }
];

export default function DisputeResolve() {
  const { disputeId }            = useParams();
  const navigate                 = useNavigate();
  const [data,        setData]   = useState(null);
  const [resolution,  setResolution] = useState('');
  const [notes,       setNotes]  = useState('');
  const [refundAmt,   setRefundAmt] = useState('');
  const [submitting,  setSubmitting] = useState(false);
  const [error,       setError]  = useState(null);
  const [loading,     setLoading] = useState(true);

  useEffect(() => {
    const fetch = async () => {
      try {
        const { data: res } = await adminApi.get(
          `/disputes/${disputeId}`
        );
        setData(res);
      } catch (err) {
        setError('Failed to load dispute.');
      } finally {
        setLoading(false);
      }
    };
    fetch();
  }, [disputeId]);

  const handleResolve = async (e) => {
    e.preventDefault();
    if (!resolution) {
      setError('Please select a resolution type.');
      return;
    }
    if (!notes.trim()) {
      setError('Resolution notes are required.');
      return;
    }
    if (resolution === 'partial_refund' && !refundAmt) {
      setError('Enter the refund amount for partial refund.');
      return;
    }

    if (!window.confirm(
      `Resolve this dispute as "${resolution}"? This action is irreversible.`
    )) return;

    setSubmitting(true);
    setError(null);
    try {
      await adminApi.post(`/admin/disputes/${disputeId}/resolve`, {
        resolution,
        resolution_notes: notes,
        ...(resolution === 'partial_refund' && {
          refund_amount: parseFloat(refundAmt)
        })
      });
      navigate('/admin/disputes?resolved=true');
    } catch (err) {
      setError(err.response?.data?.error || 'Resolution failed.');
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) return (
    <div className="p-8 text-center text-gray-500">Loading dispute...</div>
  );

  if (!data) return (
    <div className="p-8 text-center text-gray-500">
      {error || 'Dispute not found.'}
    </div>
  );

  const { dispute, evidence } = data;

  return (
    <div className="p-8 max-w-4xl">
      <h1 className="text-2xl font-bold text-white mb-2">
        Resolve Dispute
      </h1>
      <p className="text-gray-400 text-sm mb-8">
        Job: <span className="text-white">{dispute.job_title}</span>
        {' '}· Amount at stake:{' '}
        <span className="text-orange-400 font-bold">
          ${parseFloat(dispute.job_amount || 0).toFixed(2)}
        </span>
      </p>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">

        {/* Evidence summary */}
        <div className="bg-gray-800 border border-gray-700 rounded-2xl p-5">
          <h2 className="font-semibold text-white mb-4">
            Evidence ({evidence.length})
          </h2>
          {evidence.length === 0 ? (
            <p className="text-gray-500 text-sm text-center py-6">
              No evidence submitted.
            </p>
          ) : (
            <div className="space-y-4 max-h-80 overflow-y-auto pr-1">
              {evidence.map(item => (
                <div key={item.id}
                     className={`rounded-xl p-3 text-sm ${
                  item.submitter_role === 'client'
                    ? 'bg-blue-900/40 border border-blue-800'
                    : item.submitter_role === 'admin'
                    ? 'bg-purple-900/40 border border-purple-800'
                    : 'bg-green-900/40 border border-green-800'
                }`}>
                  <div className="flex items-center gap-2 mb-2">
                    <span className={`text-xs font-semibold capitalize
                                      px-2 py-0.5 rounded-full ${
                      item.submitter_role === 'client'
                        ? 'bg-blue-900 text-blue-300'
                        : item.submitter_role === 'admin'
                        ? 'bg-purple-900 text-purple-300'
                        : 'bg-green-900 text-green-300'
                    }`}>
                      {item.submitter_role}
                    </span>
                    <span className="text-xs text-gray-400">
                      {item.submitted_by_name}
                    </span>
                    <span className="text-xs text-gray-600 ml-auto">
                      {new Date(item.created_at).toLocaleDateString()}
                    </span>
                  </div>

                  {item.type === 'text' && (
                    <p className="text-gray-200 leading-relaxed">
                      {item.content}
                    </p>
                  )}

                  {item.file_url && (
                    <a href={item.file_url}
                       target="_blank"
                       rel="noopener noreferrer"
                       className="flex items-center gap-2 text-xs
                                  text-orange-400 hover:text-orange-300
                                  transition mt-1">
                      {item.type === 'image' ? '🖼' :
                       item.type === 'video' ? '🎥' : '📄'}{' '}
                      {item.file_name || 'View file'}
                    </a>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Resolution form */}
        <div>
          <form onSubmit={handleResolve} className="space-y-4">
            <h2 className="font-semibold text-white mb-4">
              Select Resolution
            </h2>

            {RESOLUTION_OPTIONS.map(opt => (
              <label key={opt.value}
                     className={`block border-2 rounded-xl p-4 cursor-pointer
                                 transition ${
                resolution === opt.value
                  ? opt.color
                  : 'border-gray-700 bg-gray-800 hover:border-gray-500'
              }`}>
                <input
                  type="radio"
                  name="resolution"
                  value={opt.value}
                  checked={resolution === opt.value}
                  onChange={() => setResolution(opt.value)}
                                    className="sr-only"
                />
                <p className="font-semibold text-white text-sm">
                  {opt.label}
                </p>
                <p className="text-xs text-gray-400 mt-0.5">
                  {opt.description}
                </p>
              </label>
            ))}

            {/* Partial refund amount */}
            {resolution === 'partial_refund' && (
              <div>
                <label className="block text-sm font-medium
                                  text-gray-300 mb-1">
                  Refund Amount ($)
                </label>
                <div className="relative">
                  <span className="absolute left-3 top-1/2
                                   -translate-y-1/2 text-gray-400">
                    $
                  </span>
                  <input
                    type="number"
                    min="0.01"
                    step="0.01"
                    max={parseFloat(dispute.job_amount || 0)}
                    value={refundAmt}
                    onChange={e => setRefundAmt(e.target.value)}
                    placeholder="0.00"
                    className="w-full pl-8 pr-4 py-2.5 bg-gray-700
                               border border-gray-600 rounded-lg text-sm
                               text-white focus:outline-none
                               focus:border-orange-500"
                  />
                </div>
                <p className="text-xs text-gray-500 mt-1">
                  Max: ${parseFloat(dispute.job_amount || 0).toFixed(2)}
                </p>
              </div>
            )}

            {/* Resolution notes */}
            <div>
              <label className="block text-sm font-medium
                                text-gray-300 mb-1">
                Resolution Notes
                <span className="text-red-400 ml-1">*</span>
              </label>
              <textarea
                value={notes}
                onChange={e => setNotes(e.target.value)}
                rows={4}
                maxLength={1000}
                placeholder="Explain your decision. This will be shown to both parties..."
                className="w-full px-3 py-2.5 bg-gray-700 border
                           border-gray-600 rounded-lg text-sm text-white
                           placeholder-gray-500 focus:outline-none
                           focus:border-orange-500 resize-none"
              />
              <p className="text-xs text-gray-500 text-right mt-1">
                {notes.length}/1000
              </p>
            </div>

            {error && (
              <div className="bg-red-900 border border-red-700
                              text-red-300 text-sm rounded-xl px-4 py-3">
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={submitting || !resolution || !notes.trim()}
              className="w-full py-3 bg-orange-500 text-white font-bold
                         rounded-xl hover:bg-orange-600 disabled:opacity-50
                         disabled:cursor-not-allowed transition text-sm"
            >
              {submitting
                ? 'Processing resolution...'
                : 'Confirm Resolution — Irreversible'
              }
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
