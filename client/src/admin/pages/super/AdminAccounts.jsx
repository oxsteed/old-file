import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../../../hooks/useAuth';
import { UserPlus, Power, PowerOff, Activity, X } from 'lucide-react';
import adminApi from '../../../lib/adminApi';
import { useAbortableFetch } from '../../lib/useAbortableFetch';
import AdminErrorState from '../../lib/AdminErrorState';

// ─── Create Admin Modal ──────────────────────────────────────
function CreateAdminModal({ onCreated, onClose }) {
  const { t } = useTranslation();
  const { user: me } = useAuth();
  const [form, setForm] = useState({
    email: '', first_name: '', last_name: '',
    role: 'admin', temporary_password: '',
  });
  const [saving, setSaving]   = useState(false);
  const [err, setErr]         = useState('');
  const [created, setCreated] = useState(null);

  function setF(k, v) { setForm(f => ({ ...f, [k]: v })); }

  async function handleSubmit(e) {
    e.preventDefault();
    if (form.temporary_password.length < 12) {
      setErr(t('adminAdminAccounts.tempPasswordTooShort'));
      return;
    }
    setSaving(true); setErr('');
    try {
      const { data } = await adminApi.post('/admin/super/admin-accounts', form);
      setCreated(data?.admin ?? null);
      onCreated();
    } catch (e) {
      setErr(e?.response?.data?.error || t('adminAdminAccounts.createFailed'));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
      <div className="bg-gray-900 border border-gray-700 rounded-xl p-6 w-full max-w-md shadow-2xl">
        <div className="flex items-center justify-between mb-5">
          <h2 className="text-white font-semibold text-lg">{t('adminAdminAccounts.modalTitle')}</h2>
          <button onClick={onClose} aria-label={t('adminAdminAccounts.closeAriaLabel')} className="text-gray-500 hover:text-gray-300"><X size={18} /></button>
        </div>

        {created ? (
          <div className="text-center py-4">
            <div className="text-green-400 text-4xl mb-3">✓</div>
            <p className="text-white font-medium mb-1">{t('adminAdminAccounts.accountCreatedTitle')}</p>
            <p className="text-gray-400 text-sm mb-4">{created.email}</p>
            <p className="text-yellow-400 text-xs bg-yellow-500/10 border border-yellow-500/30 rounded-lg px-3 py-2">
              {t('adminAdminAccounts.tempPasswordWarning')}
            </p>
            <button onClick={onClose}
              className="mt-4 w-full bg-gray-700 hover:bg-gray-600 text-white py-2 rounded-lg text-sm">
              {t('adminAdminAccounts.closeButton')}
            </button>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs text-gray-400 mb-1">{t('adminAdminAccounts.fieldFirstName')}</label>
                <input value={form.first_name} onChange={e => setF('first_name', e.target.value)} required
                  className="w-full bg-gray-800 border border-gray-700 text-white rounded-lg px-3 py-2 text-sm focus:border-orange-500 focus:outline-none" />
              </div>
              <div>
                <label className="block text-xs text-gray-400 mb-1">{t('adminAdminAccounts.fieldLastName')}</label>
                <input value={form.last_name} onChange={e => setF('last_name', e.target.value)} required
                  className="w-full bg-gray-800 border border-gray-700 text-white rounded-lg px-3 py-2 text-sm focus:border-orange-500 focus:outline-none" />
              </div>
            </div>
            <div>
              <label className="block text-xs text-gray-400 mb-1">{t('adminAdminAccounts.fieldEmail')}</label>
              <input type="email" value={form.email} onChange={e => setF('email', e.target.value)} required
                className="w-full bg-gray-800 border border-gray-700 text-white rounded-lg px-3 py-2 text-sm focus:border-orange-500 focus:outline-none" />
            </div>
            <div>
              <label className="block text-xs text-gray-400 mb-1">{t('adminAdminAccounts.fieldRole')}</label>
              <select value={form.role} onChange={e => setF('role', e.target.value)}
                className="w-full bg-gray-800 border border-gray-700 text-white rounded-lg px-3 py-2 text-sm focus:border-orange-500 focus:outline-none">
                <option value="admin">{t('adminAdminAccounts.roleAdminOption')}</option>
                {me?.role === 'super_admin' && (
                  <option value="super_admin">{t('adminAdminAccounts.roleSuperAdminOption')}</option>
                )}
              </select>
            </div>
            <div>
              <label className="block text-xs text-gray-400 mb-1">
                {t('adminAdminAccounts.fieldTempPassword')} <span className="text-gray-500">({t('adminAdminAccounts.minCharsHint')})</span>
              </label>
              <input type="password" value={form.temporary_password}
                onChange={e => setF('temporary_password', e.target.value)} required minLength={12}
                className="w-full bg-gray-800 border border-gray-700 text-white rounded-lg px-3 py-2 text-sm focus:border-orange-500 focus:outline-none" />
            </div>
            {err && <p className="text-red-400 text-sm">{err}</p>}
            <div className="flex gap-3 pt-1">
              <button type="submit" disabled={saving}
                className="flex-1 bg-orange-500 hover:bg-orange-600 disabled:opacity-50 text-white py-2 rounded-lg text-sm font-medium">
                {saving ? t('adminAdminAccounts.creatingButton') : t('adminAdminAccounts.createAccountButton')}
              </button>
              <button type="button" onClick={onClose}
                className="flex-1 bg-gray-700 hover:bg-gray-600 text-white py-2 rounded-lg text-sm font-medium">
                {t('adminAdminAccounts.cancelButton')}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}

// ─── Activity Drawer ─────────────────────────────────────────
function ActivityDrawer({ admin, onClose }) {
  const { t } = useTranslation();
  const { data, loading, error, reload } = useAbortableFetch(async (signal) => {
    const { data } = await adminApi.get(`/admin/super/admin-activity/${admin.id}`, { signal });
    return { log: data.log || [], total: data.total || 0 };
  }, [admin.id]);
  const log = data?.log || [];
  const total = data?.total || 0;

  const ACTION_COLOR = {
    bid_removed:             'text-red-400',
    review_removed:          'text-red-400',
    review_restored:         'text-blue-400',
    job_remove:              'text-red-400',
    job_cancel:              'text-orange-400',
    job_flag:                'text-yellow-400',
    user_banned:             'text-red-400',
    user_unbanned:           'text-green-400',
    user_name_changed:       'text-blue-400',
    admin_account_created:   'text-purple-400',
    admin_account_disabled:  'text-red-400',
    admin_account_enabled:   'text-green-400',
    force_logout:            'text-orange-400',
  };

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/60">
      <div className="bg-gray-900 border-l border-gray-700 w-full max-w-lg h-full overflow-y-auto flex flex-col shadow-2xl">
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-700 sticky top-0 bg-gray-900">
          <div>
            <h2 className="text-white font-semibold">{admin.first_name} {admin.last_name}</h2>
            <p className="text-gray-400 text-xs">{t('adminAdminAccounts.loggedActionsCount', { count: total })}</p>
          </div>
          <button onClick={onClose} aria-label={t('adminAdminAccounts.closeAriaLabel')} className="text-gray-500 hover:text-gray-300"><X size={18} /></button>
        </div>

        <div className="flex-1 p-5">
          {loading && <p className="text-gray-400 text-sm">{t('adminAdminAccounts.loadingText')}</p>}
          {!loading && error && <AdminErrorState onRetry={reload} />}
          {!loading && !error && log.length === 0 && (
            <p className="text-gray-500 text-sm">{t('adminAdminAccounts.emptyActivity')}</p>
          )}
          {!error && (
          <div className="space-y-2">
            {log.map(entry => (
              <div key={entry.id} className="bg-gray-800/60 border border-gray-700/50 rounded-lg px-4 py-3">
                <div className="flex items-center justify-between mb-1">
                  <span className={`text-xs font-mono font-medium ${ACTION_COLOR[entry.action] || 'text-gray-300'}`}>
                    {entry.action}
                  </span>
                  <span className="text-gray-500 text-xs">
                    {new Date(entry.created_at).toLocaleString()}
                  </span>
                </div>
                {entry.description && (
                  <p className="text-gray-400 text-xs">{entry.description}</p>
                )}
                {entry.target_type && (
                  <p className="text-gray-600 text-xs mt-0.5">
                    {entry.target_type} · {String(entry.target_id).slice(0, 8)}…
                  </p>
                )}
              </div>
            ))}
          </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────
export default function AdminAccounts() {
  const { t } = useTranslation();
  const { user: me }          = useAuth();
  const [showCreate, setShowCreate] = useState(false);
  const [activity, setActivity]     = useState(null);
  const [toast, setToast]     = useState('');

  const { data: admins = [], loading, error, reload } = useAbortableFetch(async (signal) => {
    const { data } = await adminApi.get('/admin/super/admin-accounts', { signal });
    return data.admins || [];
  }, []);

  function showToast(msg) { setToast(msg); setTimeout(() => setToast(''), 3500); }

  async function toggleStatus(admin) {
    const reason = admin.is_active
      ? window.prompt(t('adminAdminAccounts.disableReasonPrompt', { email: admin.email }))
      : null;
    if (admin.is_active && reason === null) return; // cancelled
    try {
      await adminApi.put(`/admin/super/admin-accounts/${admin.id}/status`, { reason: reason || undefined });
      const actionLabel = admin.is_active
        ? t('adminAdminAccounts.disabledLabel')
        : t('adminAdminAccounts.enabledLabel');
      showToast(t('adminAdminAccounts.accountToggled', { action: actionLabel }));
      reload();
    } catch (e) {
      showToast(e?.response?.data?.error || t('adminAdminAccounts.updateStatusFailed'));
    }
  }

  async function forceLogout(admin) {
    if (!window.confirm(t('adminAdminAccounts.forceLogoutConfirm', { email: admin.email }))) return;
    try {
      await adminApi.post(`/admin/super/force-logout/${admin.id}`, { reason: 'Force logout by super admin' });
      showToast(t('admin.sessionsInvalidated'));
    } catch {
      showToast(t('admin.forceLogoutFailed'));
    }
  }

  return (
    <div className="p-6">
      {toast && (
        <div className="fixed top-6 right-6 z-50 bg-green-600 text-white px-4 py-2 rounded-lg shadow-lg text-sm">
          {toast}
        </div>
      )}

      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-white">{t('adminAdminAccounts.title')}</h1>
          <p className="text-gray-400 text-sm mt-1">{t('adminAdminAccounts.subtitle')}</p>
        </div>
        <button onClick={() => setShowCreate(true)}
          className="flex items-center gap-2 bg-orange-500 hover:bg-orange-600 text-white px-4 py-2 rounded-lg text-sm font-medium">
          <UserPlus size={16} /> {t('adminAdminAccounts.newAdminButton')}
        </button>
      </div>

      <div className="bg-gray-800/50 border border-gray-700 rounded-xl overflow-hidden">
        {!loading && error && (
          <div className="p-4"><AdminErrorState onRetry={reload} /></div>
        )}
        {!error && (
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-700">
              <th className="text-left text-gray-400 font-medium px-4 py-3">{t('adminAdminAccounts.tableAdmin')}</th>
              <th className="text-left text-gray-400 font-medium px-4 py-3">{t('adminAdminAccounts.tableRole')}</th>
              <th className="text-left text-gray-400 font-medium px-4 py-3">{t('adminAdminAccounts.tableStatus')}</th>
              <th className="text-left text-gray-400 font-medium px-4 py-3">{t('adminAdminAccounts.tableActionsLogged')}</th>
              <th className="text-left text-gray-400 font-medium px-4 py-3">{t('adminAdminAccounts.tableLastAction')}</th>
              <th className="text-left text-gray-400 font-medium px-4 py-3">{t('adminAdminAccounts.tableControls')}</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={6} className="text-center text-gray-400 py-12">{t('adminAdminAccounts.loadingText')}</td></tr>
            ) : admins.length === 0 ? (
              <tr><td colSpan={6} className="text-center text-gray-400 py-12">{t('adminAdminAccounts.emptyState')}</td></tr>
            ) : admins.map(admin => {
              const isMe = admin.id === me?.id;
              return (
                <tr key={admin.id} className="border-b border-gray-700/50 hover:bg-gray-700/20">
                  <td className="px-4 py-3">
                    <p className="text-white font-medium">
                      {admin.first_name} {admin.last_name}
                      {isMe && <span className="ml-2 text-xs text-orange-400">{t('adminAdminAccounts.youLabel')}</span>}
                    </p>
                    <p className="text-gray-500 text-xs">{admin.email}</p>
                  </td>
                  <td className="px-4 py-3">
                    <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${
                      admin.role === 'super_admin'
                        ? 'bg-purple-500/20 text-purple-400'
                        : 'bg-blue-500/20 text-blue-400'
                    }`}>
                      {admin.role === 'super_admin' ? t('adminAdminAccounts.roleSuperAdmin') : t('adminAdminAccounts.roleAdmin')}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <span className={`px-2 py-0.5 rounded-full text-xs ${
                      admin.is_active ? 'bg-green-500/20 text-green-400' : 'bg-red-500/20 text-red-400'
                    }`}>
                      {admin.is_active ? t('adminAdminAccounts.statusActive') : t('adminAdminAccounts.statusDisabled')}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-gray-300">{admin.action_count || 0}</td>
                  <td className="px-4 py-3 text-gray-400 text-xs">
                    {admin.last_action_at ? new Date(admin.last_action_at).toLocaleDateString() : '-'}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <button onClick={() => setActivity(admin)}
                        className="flex items-center gap-1 text-blue-400 hover:text-blue-300 text-xs font-medium">
                        <Activity size={13} /> {t('adminAdminAccounts.activityButton')}
                      </button>
                      {!isMe && (
                        <>
                          <span className="text-gray-700">|</span>
                          <button onClick={() => toggleStatus(admin)}
                            className={`flex items-center gap-1 text-xs font-medium ${
                              admin.is_active
                                ? 'text-red-400 hover:text-red-300'
                                : 'text-green-400 hover:text-green-300'
                            }`}>
                            {admin.is_active
                              ? <><PowerOff size={13} /> {t('adminAdminAccounts.disableButton')}</>
                              : <><Power size={13} /> {t('adminAdminAccounts.enableButton')}</>
                            }
                          </button>
                          {admin.is_active && (
                            <>
                              <span className="text-gray-700">|</span>
                              <button onClick={() => forceLogout(admin)}
                                className="text-yellow-400 hover:text-yellow-300 text-xs font-medium">
                                {t('adminAdminAccounts.forceLogoutButton')}
                              </button>
                            </>
                          )}
                        </>
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        )}
      </div>

      {showCreate && (
        <CreateAdminModal
          onCreated={() => { reload(); }}
          onClose={() => setShowCreate(false)}
        />
      )}

      {activity && (
        <ActivityDrawer admin={activity} onClose={() => setActivity(null)} />
      )}
    </div>
  );
}
