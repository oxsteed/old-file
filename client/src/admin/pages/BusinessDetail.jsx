import { useEffect, useState } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import {
  ArrowLeft, Building2, User, MapPin, Mail, Phone, Calendar, DollarSign,
  ToggleLeft, ToggleRight, Trash2, Flag, Edit2, ExternalLink, AlertCircle
} from 'lucide-react';
import toast from 'react-hot-toast';
import adminApi from '../../lib/adminApi';

function BusinessAvatar({ business }) {
  const bgColor = ['bg-blue-500', 'bg-purple-500', 'bg-pink-500', 'bg-green-500', 'bg-orange-500'];
  const hash = (business.id?.toString() || '').charCodeAt(0) || 0;
  const bg = bgColor[hash % bgColor.length];
  const initials = (business.business_name || '')
    .split(' ')
    .slice(0, 2)
    .map(w => w[0])
    .join('')
    .toUpperCase();

  return (
    <div className={`w-20 h-20 rounded-xl ${bg} flex items-center justify-center text-white text-lg font-bold`}>
      {initials || 'B'}
    </div>
  );
}

export default function BusinessDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [business, setBusiness] = useState(null);
  const [loading, setLoading] = useState(true);
  const [modal, setModal] = useState(null);
  const [actionBusy, setActionBusy] = useState(false);
  const [adminNotes, setAdminNotes] = useState('');
  const [editingNotes, setEditingNotes] = useState(false);

  useEffect(() => {
    const fetchBusiness = async () => {
      setLoading(true);
      try {
        const { data } = await adminApi.get(`/admin/businesses/${id}`);
        setBusiness(data.business);
        setAdminNotes(data.business?.admin_notes || '');
      } catch (err) {
        console.error('Failed to fetch business:', err);
      } finally {
        setLoading(false);
      }
    };
    fetchBusiness();
  }, [id]);

  const handleAction = async (actionType, reason = '') => {
    setActionBusy(true);
    try {
      const endpoint = actionType === 'toggle'
        ? `/admin/businesses/${id}/toggle`
        : `/admin/businesses/${id}/${actionType}`;

      await adminApi.put(endpoint, { reason });

      // Refetch business
      const { data } = await adminApi.get(`/admin/businesses/${id}`);
      setBusiness(data.business);
      setModal(null);
    } catch (err) {
      toast.error(err?.response?.data?.error || 'Action failed.');
    } finally {
      setActionBusy(false);
    }
  };

  const handleSaveNotes = async () => {
    try {
      await adminApi.put(`/admin/businesses/${id}/admin-notes`, { notes: adminNotes });
      setEditingNotes(false);
      toast.success('Notes saved.');
    } catch (err) {
      toast.error('Failed to save notes.');
    }
  };

  if (loading) {
    return (
      <div className="p-6 lg:p-8">
        <button
          onClick={() => navigate('/admin/businesses')}
          className="flex items-center gap-2 text-gray-400 hover:text-white mb-6 transition"
        >
          <ArrowLeft size={18} /> Back to Businesses
        </button>
        <div className="text-center text-gray-400 py-12">Loading…</div>
      </div>
    );
  }

  if (!business) {
    return (
      <div className="p-6 lg:p-8">
        <button
          onClick={() => navigate('/admin/businesses')}
          className="flex items-center gap-2 text-gray-400 hover:text-white mb-6 transition"
        >
          <ArrowLeft size={18} /> Back to Businesses
        </button>
        <div className="text-center text-gray-400 py-12">Business not found.</div>
      </div>
    );
  }

  return (
    <div className="p-6 lg:p-8">
      {/* Back Button */}
      <button
        onClick={() => navigate('/admin/businesses')}
        className="flex items-center gap-2 text-gray-400 hover:text-white mb-6 transition"
      >
        <ArrowLeft size={18} /> Back to Businesses
      </button>

      {/* Header */}
      <div className="flex items-start justify-between mb-8 bg-gray-800 border border-gray-700 rounded-xl p-6">
        <div className="flex items-start gap-6">
          <BusinessAvatar business={business} />
          <div>
            <h1 className="text-3xl font-bold text-white">{business.business_name}</h1>
            <p className="text-gray-400 text-sm mt-1">{business.category || 'Uncategorized'}</p>
            <p className="text-gray-500 text-sm mt-2">
              ID: <code className="bg-gray-900 px-2 py-1 rounded text-xs">{business.id}</code>
            </p>
            <div className="flex items-center gap-2 mt-3">
              <span className={`px-3 py-1 rounded-full text-xs font-semibold ${
                business.is_active
                  ? 'bg-green-500/20 text-green-400'
                  : 'bg-red-500/20 text-red-400'
              }`}>
                {business.is_active ? 'Active' : 'Inactive'}
              </span>
              {business.is_primary && (
                <span className="px-3 py-1 rounded-full text-xs font-semibold bg-orange-500/20 text-orange-400">
                  Primary
                </span>
              )}
            </div>
          </div>
        </div>

        {/* Quick Actions */}
        <div className="flex gap-2">
          <button
            onClick={() => window.open(`/business/${business.id}`, '_blank', 'noopener,noreferrer')}
            className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition text-sm font-medium"
          >
            <ExternalLink size={14} /> View Public Profile
          </button>
        </div>
      </div>

      {/* Main Grid */}
      <div className="grid lg:grid-cols-3 gap-6">
        {/* Left Column: Business Info */}
        <div className="lg:col-span-2 space-y-6">
          {/* Business Information */}
          <div className="bg-gray-800 border border-gray-700 rounded-xl p-6">
            <h2 className="text-lg font-bold text-white mb-4 flex items-center gap-2">
              <Building2 size={18} /> Business Information
            </h2>
            <div className="space-y-4">
              <div>
                <p className="text-gray-400 text-sm mb-1">Description</p>
                <p className="text-gray-200">{business.description || '-'}</p>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <p className="text-gray-400 text-sm mb-1">Business Type</p>
                  <p className="text-gray-200 capitalize">{business.business_type || '-'}</p>
                </div>
                <div>
                  <p className="text-gray-400 text-sm mb-1">Website</p>
                  <p className="text-gray-200">
                    {business.website ? (
                      <a href={business.website} target="_blank" rel="noopener noreferrer" className="text-blue-400 hover:underline">
                        {business.website}
                      </a>
                    ) : '-'}
                  </p>
                </div>
              </div>
            </div>
          </div>

          {/* Location Information */}
          <div className="bg-gray-800 border border-gray-700 rounded-xl p-6">
            <h2 className="text-lg font-bold text-white mb-4 flex items-center gap-2">
              <MapPin size={18} /> Location
            </h2>
            <div className="space-y-3">
              <div>
                <p className="text-gray-400 text-sm mb-1">Address</p>
                <p className="text-gray-200">
                  {business.address_street || '-'}
                </p>
              </div>
              <div className="grid grid-cols-3 gap-4">
                <div>
                  <p className="text-gray-400 text-sm mb-1">City</p>
                  <p className="text-gray-200">{business.address_city || '-'}</p>
                </div>
                <div>
                  <p className="text-gray-400 text-sm mb-1">State</p>
                  <p className="text-gray-200">{business.address_state || '-'}</p>
                </div>
                <div>
                  <p className="text-gray-400 text-sm mb-1">ZIP</p>
                  <p className="text-gray-200">{business.address_zip || '-'}</p>
                </div>
              </div>
            </div>
          </div>

          {/* Jobs */}
          <div className="bg-gray-800 border border-gray-700 rounded-xl p-6">
            <h2 className="text-lg font-bold text-white mb-4">Jobs Posted ({business.job_count || 0})</h2>
            {business.jobs && business.jobs.length > 0 ? (
              <div className="space-y-2">
                {business.jobs.map(job => (
                  <div key={job.id} className="flex items-center justify-between p-3 bg-gray-700/30 rounded-lg">
                    <div>
                      <p className="text-white font-medium">{job.title}</p>
                      <p className="text-gray-400 text-xs">{new Date(job.created_at).toLocaleDateString()}</p>
                    </div>
                    <a
                      href={`/admin/jobs/${job.id}`}
                      className="text-blue-400 hover:text-blue-300 transition"
                    >
                      <ExternalLink size={16} />
                    </a>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-gray-500 text-sm">No jobs posted</p>
            )}
          </div>
        </div>

        {/* Right Column: Owner & Admin Info */}
        <div className="space-y-6">
          {/* Owner Information */}
          <div className="bg-gray-800 border border-gray-700 rounded-xl p-6">
            <h2 className="text-lg font-bold text-white mb-4 flex items-center gap-2">
              <User size={18} /> Owner Information
            </h2>
            <div className="space-y-3">
              <div>
                <p className="text-gray-400 text-sm mb-1">Name</p>
                <p className="text-gray-200">{business.owner_name || '-'}</p>
              </div>
              <div>
                <p className="text-gray-400 text-sm mb-1">Email</p>
                <p className="text-blue-400 text-sm">
                  <a href={`mailto:${business.owner_email}`}>{business.owner_email}</a>
                </p>
              </div>
              <div>
                <p className="text-gray-400 text-sm mb-1">Phone</p>
                <p className="text-gray-200">{business.owner_phone || '-'}</p>
              </div>
              <Link
                to={`/admin/users/${business.owner_id}`}
                className="flex items-center gap-2 text-blue-400 hover:text-blue-300 transition mt-3"
              >
                View Owner Profile <ExternalLink size={14} />
              </Link>
            </div>
          </div>

          {/* Statistics */}
          <div className="bg-gray-800 border border-gray-700 rounded-xl p-6">
            <h2 className="text-lg font-bold text-white mb-4">Statistics</h2>
            <div className="space-y-3">
              <div>
                <p className="text-gray-400 text-sm mb-1">Members</p>
                <p className="text-2xl font-bold text-white">{business.member_count || 0}</p>
              </div>
              <div>
                <p className="text-gray-400 text-sm mb-1">Total Earnings</p>
                <p className="text-2xl font-bold text-green-400">${(business.total_earnings_cents || 0) / 100}</p>
              </div>
              <div>
                <p className="text-gray-400 text-sm mb-1">Profile Complete</p>
                <div className="w-full bg-gray-700 rounded-full h-2 mt-2">
                  <div
                    className="bg-blue-500 h-2 rounded-full transition"
                    style={{ width: `${(business.profile_completeness || 0)}%` }}
                  />
                </div>
                <p className="text-gray-300 text-xs mt-1">{business.profile_completeness || 0}%</p>
              </div>
            </div>
          </div>

          {/* Dates */}
          <div className="bg-gray-800 border border-gray-700 rounded-xl p-6">
            <h2 className="text-lg font-bold text-white mb-4">Timeline</h2>
            <div className="space-y-3 text-sm">
              <div>
                <p className="text-gray-400 mb-1">Created</p>
                <p className="text-gray-300">{new Date(business.created_at).toLocaleString()}</p>
              </div>
              <div>
                <p className="text-gray-400 mb-1">Last Updated</p>
                <p className="text-gray-300">{new Date(business.updated_at).toLocaleString()}</p>
              </div>
            </div>
          </div>

          {/* Admin Actions */}
          <div className="bg-gray-800 border border-gray-700 rounded-xl p-6">
            <h2 className="text-lg font-bold text-white mb-4">Admin Actions</h2>
            <div className="space-y-2">
              <button
                onClick={() => setModal({ type: 'toggle' })}
                className={`w-full flex items-center justify-center gap-2 px-4 py-2 rounded-lg transition font-medium ${
                  business.is_active
                    ? 'bg-red-600 hover:bg-red-700 text-white'
                    : 'bg-green-600 hover:bg-green-700 text-white'
                }`}
              >
                {business.is_active ? <ToggleLeft size={16} /> : <ToggleRight size={16} />}
                {business.is_active ? 'Deactivate' : 'Reactivate'}
              </button>
              <button
                onClick={() => setModal({ type: 'flag' })}
                className="w-full flex items-center justify-center gap-2 px-4 py-2 bg-yellow-600 hover:bg-yellow-700 text-white rounded-lg transition font-medium"
              >
                <Flag size={16} /> Flag for Review
              </button>
              <button
                onClick={() => setModal({ type: 'delete' })}
                className="w-full flex items-center justify-center gap-2 px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-lg transition font-medium"
              >
                <Trash2 size={16} /> Delete
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Admin Notes */}
      <div className="mt-6 bg-gray-800 border border-gray-700 rounded-xl p-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-bold text-white flex items-center gap-2">
            <AlertCircle size={18} /> Admin Notes (Internal)
          </h2>
          {!editingNotes && (
            <button
              onClick={() => setEditingNotes(true)}
              className="flex items-center gap-1 text-blue-400 hover:text-blue-300 transition text-sm"
            >
              <Edit2 size={14} /> Edit
            </button>
          )}
        </div>
        {editingNotes ? (
          <div>
            <textarea
              value={adminNotes}
              onChange={e => setAdminNotes(e.target.value)}
              rows={4}
              className="w-full bg-gray-900 border border-gray-700 rounded-lg text-white p-3 text-sm
                         focus:border-orange-500 focus:outline-none resize-none"
              placeholder="Add internal notes about this business…"
            />
            <div className="flex gap-2 mt-3">
              <button
                onClick={handleSaveNotes}
                className="px-4 py-2 bg-green-600 hover:bg-green-700 text-white rounded-lg transition font-medium text-sm"
              >
                Save
              </button>
              <button
                onClick={() => {
                  setAdminNotes(business.admin_notes || '');
                  setEditingNotes(false);
                }}
                className="px-4 py-2 bg-gray-700 hover:bg-gray-600 text-gray-200 rounded-lg transition font-medium text-sm"
              >
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <p className="text-gray-300 text-sm whitespace-pre-wrap">{adminNotes || '(No notes)'}</p>
        )}
      </div>

      {/* Action Modal */}
      {modal && (
        <ActionModal
          business={business}
          actionType={modal.type}
          onConfirm={(reason) => handleAction(modal.type, reason)}
          onClose={() => setModal(null)}
          loading={actionBusy}
        />
      )}
    </div>
  );
}

function ActionModal({ business, actionType, onConfirm, onClose, loading }) {
  const [reason, setReason] = useState('');
  const [error, setError] = useState('');

  const labels = {
    toggle: business.is_active ? 'Deactivate' : 'Reactivate',
    flag: 'Flag for Review',
    delete: 'Delete',
  };

  const handle = () => {
    if (!reason.trim()) { setError('A reason is required.'); return; }
    onConfirm(reason.trim());
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4" onClick={() => !loading && onClose()}>
      <div className="bg-gray-900 border border-gray-700 rounded-2xl p-6 w-full max-w-md shadow-2xl" onClick={e => e.stopPropagation()}>
        <h3 className="font-bold text-white text-lg mb-4">{labels[actionType]} Business?</h3>
        <div className="mb-4">
          <label className="block text-sm font-medium text-gray-300 mb-2">Reason *</label>
          <textarea
            rows={3}
            value={reason}
            onChange={e => { setReason(e.target.value); setError(''); }}
            placeholder={`Explain why you're ${labels[actionType].toLowerCase()}ing…`}
            className="w-full bg-gray-800 border border-gray-700 rounded-lg text-white p-3 text-sm focus:border-orange-500 focus:outline-none resize-none"
          />
          {error && <p className="text-red-400 text-xs mt-1">{error}</p>}
        </div>
        <div className="flex gap-3">
          <button
            onClick={onClose}
            disabled={loading}
            className="flex-1 px-4 py-2 bg-gray-800 hover:bg-gray-700 text-gray-300 rounded-lg transition disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            onClick={handle}
            disabled={loading || !reason.trim()}
            className={`flex-1 px-4 py-2 rounded-lg text-white font-medium transition disabled:opacity-50 ${
              actionType === 'delete' ? 'bg-red-600 hover:bg-red-700' : 'bg-blue-600 hover:bg-blue-700'
            }`}
          >
            {loading ? 'Saving…' : labels[actionType]}
          </button>
        </div>
      </div>
    </div>
  );
}
