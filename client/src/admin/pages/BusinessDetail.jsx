import { useState, useEffect } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import {
  ArrowLeft, Building2, User, MapPin, Mail, Phone, Calendar, DollarSign,
  ToggleLeft, ToggleRight, Trash2, Flag, Edit2, ExternalLink, AlertCircle
} from 'lucide-react';
import toast from 'react-hot-toast';
import { useTranslation } from 'react-i18next';
import adminApi from '../../lib/adminApi';
import { useAbortableFetch } from '../lib/useAbortableFetch';
import AdminErrorState from '../lib/AdminErrorState';

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
  const { t } = useTranslation();
  const { id } = useParams();
  const navigate = useNavigate();
  const [modal, setModal] = useState(null);
  const [actionBusy, setActionBusy] = useState(false);
  const [adminNotes, setAdminNotes] = useState('');
  const [editingNotes, setEditingNotes] = useState(false);

  // Abortable detail load. A fetch failure is an error state, never
  // "Business not found": only a successful response with no business means
  // the business is actually gone.
  const { data, error, loading, reload } = useAbortableFetch(async (signal) => {
    const { data } = await adminApi.get(`/admin/businesses/${id}`, { signal });
    return data.business ?? null;
  }, [id]);

  const business = data;

  // Seed the editable admin-notes draft whenever a (new) business loads.
  useEffect(() => {
    setAdminNotes(business?.admin_notes || '');
  }, [business?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleAction = async (actionType, reason = '') => {
    setActionBusy(true);
    try {
      const endpoint = actionType === 'toggle'
        ? `/admin/businesses/${id}/toggle`
        : `/admin/businesses/${id}/${actionType}`;

      await adminApi.put(endpoint, { reason });

      reload();
      setModal(null);
    } catch (err) {
      toast.error(err?.response?.data?.error || t('adminBusinessDetail.actionFailed'));
    } finally {
      setActionBusy(false);
    }
  };

  const handleSaveNotes = async () => {
    try {
      await adminApi.put(`/admin/businesses/${id}/admin-notes`, { notes: adminNotes });
      setEditingNotes(false);
      toast.success(t('adminBusinessDetail.notesSaved'));
    } catch (err) {
      toast.error(t('adminBusinessDetail.notesSaveFailed'));
    }
  };

  if (loading) {
    return (
      <div className="p-6 lg:p-8">
        <button
          onClick={() => navigate('/admin/businesses')}
          className="flex items-center gap-2 text-gray-400 hover:text-white mb-6 transition"
        >
          <ArrowLeft size={18} /> {t('adminBusinessDetail.backToBusinesses')}
        </button>
        <div className="text-center text-gray-400 py-12">{t('adminBusinessDetail.loading')}</div>
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
          <ArrowLeft size={18} /> {t('adminBusinessDetail.backToBusinesses')}
        </button>
        {error ? (
          <AdminErrorState onRetry={reload} />
        ) : (
          <div className="text-center text-gray-400 py-12">{t('adminBusinessDetail.notFound')}</div>
        )}
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
        <ArrowLeft size={18} /> {t('adminBusinessDetail.backToBusinesses')}
      </button>

      {/* Header */}
      <div className="flex items-start justify-between mb-8 bg-gray-800 border border-gray-700 rounded-xl p-6">
        <div className="flex items-start gap-6">
          <BusinessAvatar business={business} />
          <div>
            <h1 className="text-3xl font-bold text-white">{business.business_name}</h1>
            <p className="text-gray-400 text-sm mt-1">{business.category || t('adminBusinessDetail.uncategorized')}</p>
            <p className="text-gray-500 text-sm mt-2">
              {t('adminBusinessDetail.idLabel')} <code className="bg-gray-900 px-2 py-1 rounded text-xs">{business.id}</code>
            </p>
            <div className="flex items-center gap-2 mt-3">
              <span className={`px-3 py-1 rounded-full text-xs font-semibold ${
                business.is_active
                  ? 'bg-green-500/20 text-green-400'
                  : 'bg-red-500/20 text-red-400'
              }`}>
                {business.is_active ? t('adminBusinessDetail.statusActive') : t('adminBusinessDetail.statusInactive')}
              </span>
              {business.is_primary && (
                <span className="px-3 py-1 rounded-full text-xs font-semibold bg-orange-500/20 text-orange-400">
                  {t('adminBusinessDetail.primaryBadge')}
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
            <ExternalLink size={14} /> {t('adminBusinessDetail.viewPublicProfile')}
          </button>
          <Link
            to={`/admin/businesses/${id}/360`}
            className="flex items-center gap-2 px-4 py-2 bg-sky-600 hover:bg-sky-700 text-white rounded-lg transition text-sm font-medium"
          >
            <ExternalLink size={14} /> {t('adminBusiness360.open360')}
          </Link>
        </div>
      </div>

      {/* Main Grid */}
      <div className="grid lg:grid-cols-3 gap-6">
        {/* Left Column: Business Info */}
        <div className="lg:col-span-2 space-y-6">
          {/* Business Information */}
          <div className="bg-gray-800 border border-gray-700 rounded-xl p-6">
            <h2 className="text-lg font-bold text-white mb-4 flex items-center gap-2">
              <Building2 size={18} /> {t('adminBusinessDetail.businessInfoTitle')}
            </h2>
            <div className="space-y-4">
              <div>
                <p className="text-gray-400 text-sm mb-1">{t('adminBusinessDetail.descriptionLabel')}</p>
                <p className="text-gray-200">{business.description || '-'}</p>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <p className="text-gray-400 text-sm mb-1">{t('adminBusinessDetail.businessTypeLabel')}</p>
                  <p className="text-gray-200 capitalize">{business.business_type || '-'}</p>
                </div>
                <div>
                  <p className="text-gray-400 text-sm mb-1">{t('adminBusinessDetail.websiteLabel')}</p>
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
              <MapPin size={18} /> {t('adminBusinessDetail.locationTitle')}
            </h2>
            <div className="space-y-3">
              <div>
                <p className="text-gray-400 text-sm mb-1">{t('adminBusinessDetail.addressLabel')}</p>
                <p className="text-gray-200">
                  {business.address_street || '-'}
                </p>
              </div>
              <div className="grid grid-cols-3 gap-4">
                <div>
                  <p className="text-gray-400 text-sm mb-1">{t('adminBusinessDetail.cityLabel')}</p>
                  <p className="text-gray-200">{business.address_city || '-'}</p>
                </div>
                <div>
                  <p className="text-gray-400 text-sm mb-1">{t('adminBusinessDetail.stateLabel')}</p>
                  <p className="text-gray-200">{business.address_state || '-'}</p>
                </div>
                <div>
                  <p className="text-gray-400 text-sm mb-1">{t('adminBusinessDetail.zipLabel')}</p>
                  <p className="text-gray-200">{business.address_zip || '-'}</p>
                </div>
              </div>
            </div>
          </div>

          {/* Jobs */}
          <div className="bg-gray-800 border border-gray-700 rounded-xl p-6">
            <h2 className="text-lg font-bold text-white mb-4">{t('adminBusinessDetail.jobsPosted', { count: business.job_count || 0 })}</h2>
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
                      aria-label={t('businessDetail.viewJob')}
                      className="text-blue-400 hover:text-blue-300 transition"
                    >
                      <ExternalLink size={16} />
                    </a>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-gray-500 text-sm">{t('adminBusinessDetail.noJobs')}</p>
            )}
          </div>
        </div>

        {/* Right Column: Owner & Admin Info */}
        <div className="space-y-6">
          {/* Owner Information */}
          <div className="bg-gray-800 border border-gray-700 rounded-xl p-6">
            <h2 className="text-lg font-bold text-white mb-4 flex items-center gap-2">
              <User size={18} /> {t('adminBusinessDetail.ownerInfoTitle')}
            </h2>
            <div className="space-y-3">
              <div>
                <p className="text-gray-400 text-sm mb-1">{t('adminBusinessDetail.nameLabel')}</p>
                <p className="text-gray-200">{business.owner_name || '-'}</p>
              </div>
              <div>
                <p className="text-gray-400 text-sm mb-1">{t('adminBusinessDetail.emailLabel')}</p>
                <p className="text-blue-400 text-sm">
                  <a href={`mailto:${business.owner_email}`}>{business.owner_email}</a>
                </p>
              </div>
              <div>
                <p className="text-gray-400 text-sm mb-1">{t('adminBusinessDetail.phoneLabel')}</p>
                <p className="text-gray-200">{business.owner_phone || '-'}</p>
              </div>
              <Link
                to={`/admin/users/${business.owner_id}`}
                className="flex items-center gap-2 text-blue-400 hover:text-blue-300 transition mt-3"
              >
                {t('adminBusinessDetail.viewOwnerProfile')} <ExternalLink size={14} />
              </Link>
            </div>
          </div>

          {/* Statistics */}
          <div className="bg-gray-800 border border-gray-700 rounded-xl p-6">
            <h2 className="text-lg font-bold text-white mb-4">{t('adminBusinessDetail.statsTitle')}</h2>
            <div className="space-y-3">
              <div>
                <p className="text-gray-400 text-sm mb-1">{t('adminBusinessDetail.membersLabel')}</p>
                <p className="text-2xl font-bold text-white">{business.member_count || 0}</p>
              </div>
              <div>
                <p className="text-gray-400 text-sm mb-1">{t('adminBusinessDetail.earningsLabel')}</p>
                <p className="text-2xl font-bold text-green-400">${(business.total_earnings_cents || 0) / 100}</p>
              </div>
              <div>
                <p className="text-gray-400 text-sm mb-1">{t('adminBusinessDetail.profileCompleteLabel')}</p>
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
            <h2 className="text-lg font-bold text-white mb-4">{t('adminBusinessDetail.timelineTitle')}</h2>
            <div className="space-y-3 text-sm">
              <div>
                <p className="text-gray-400 mb-1">{t('adminBusinessDetail.createdLabel')}</p>
                <p className="text-gray-300">{new Date(business.created_at).toLocaleString()}</p>
              </div>
              <div>
                <p className="text-gray-400 mb-1">{t('adminBusinessDetail.updatedLabel')}</p>
                <p className="text-gray-300">{new Date(business.updated_at).toLocaleString()}</p>
              </div>
            </div>
          </div>

          {/* Admin Actions */}
          <div className="bg-gray-800 border border-gray-700 rounded-xl p-6">
            <h2 className="text-lg font-bold text-white mb-4">{t('adminBusinessDetail.actionsTitle')}</h2>
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
                {business.is_active ? t('adminBusinessDetail.deactivate') : t('adminBusinessDetail.reactivate')}
              </button>
              <button
                onClick={() => setModal({ type: 'flag' })}
                className="w-full flex items-center justify-center gap-2 px-4 py-2 bg-yellow-600 hover:bg-yellow-700 text-white rounded-lg transition font-medium"
              >
                <Flag size={16} /> {t('adminBusinessDetail.flagReview')}
              </button>
              <button
                onClick={() => setModal({ type: 'delete' })}
                className="w-full flex items-center justify-center gap-2 px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-lg transition font-medium"
              >
                <Trash2 size={16} /> {t('adminBusinessDetail.delete')}
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Admin Notes */}
      <div className="mt-6 bg-gray-800 border border-gray-700 rounded-xl p-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-bold text-white flex items-center gap-2">
            <AlertCircle size={18} /> {t('adminBusinessDetail.notesTitle')}
          </h2>
          {!editingNotes && (
            <button
              onClick={() => setEditingNotes(true)}
              className="flex items-center gap-1 text-blue-400 hover:text-blue-300 transition text-sm"
            >
              <Edit2 size={14} /> {t('adminBusinessDetail.edit')}
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
              placeholder={t('adminBusinessDetail.notesPlaceholder')}
            />
            <div className="flex gap-2 mt-3">
              <button
                onClick={handleSaveNotes}
                className="px-4 py-2 bg-green-600 hover:bg-green-700 text-white rounded-lg transition font-medium text-sm"
              >
                {t('adminBusinessDetail.save')}
              </button>
              <button
                onClick={() => {
                  setAdminNotes(business.admin_notes || '');
                  setEditingNotes(false);
                }}
                className="px-4 py-2 bg-gray-700 hover:bg-gray-600 text-gray-200 rounded-lg transition font-medium text-sm"
              >
                {t('adminBusinessDetail.cancel')}
              </button>
            </div>
          </div>
        ) : (
          <p className="text-gray-300 text-sm whitespace-pre-wrap">{adminNotes || t('adminBusinessDetail.noNotes')}</p>
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
  const { t } = useTranslation();
  const [reason, setReason] = useState('');
  const [error, setError] = useState('');

  const labels = {
    toggle: business.is_active ? t('adminBusinessDetail.deactivate') : t('adminBusinessDetail.reactivate'),
    flag: t('adminBusinessDetail.flagReview'),
    delete: t('adminBusinessDetail.delete'),
  };
  const verbKeys = {
    toggle: business.is_active ? 'adminBusinessDetail.reasonVerbDeactivate' : 'adminBusinessDetail.reasonVerbReactivate',
    flag: 'adminBusinessDetail.reasonVerbFlag',
    delete: 'adminBusinessDetail.reasonVerbDelete',
  };

  const handle = () => {
    if (!reason.trim()) { setError(t('adminBusinessDetail.reasonRequired')); return; }
    onConfirm(reason.trim());
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4" onClick={() => !loading && onClose()}>
      <div className="bg-gray-900 border border-gray-700 rounded-2xl p-6 w-full max-w-md shadow-2xl" onClick={e => e.stopPropagation()}>
        <h3 className="font-bold text-white text-lg mb-4">{t('adminBusinessDetail.actionTitle', { action: labels[actionType] })}</h3>
        <div className="mb-4">
          <label className="block text-sm font-medium text-gray-300 mb-2">{t('adminBusinessDetail.reasonLabel')}</label>
          <textarea
            rows={3}
            value={reason}
            onChange={e => { setReason(e.target.value); setError(''); }}
            placeholder={t('adminBusinessDetail.reasonPlaceholder', { verb: t(verbKeys[actionType]) })}
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
            {t('adminBusinessDetail.cancel')}
          </button>
          <button
            onClick={handle}
            disabled={loading || !reason.trim()}
            className={`flex-1 px-4 py-2 rounded-lg text-white font-medium transition disabled:opacity-50 ${
              actionType === 'delete' ? 'bg-red-600 hover:bg-red-700' : 'bg-blue-600 hover:bg-blue-700'
            }`}
          >
            {loading ? t('adminBusinessDetail.saving') : labels[actionType]}
          </button>
        </div>
      </div>
    </div>
  );
}
