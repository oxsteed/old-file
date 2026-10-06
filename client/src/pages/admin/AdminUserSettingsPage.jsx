// Admin: My Settings - self-service page for the logged-in admin.
// Tabs: Profile, Sessions, Notifications, API Keys.

import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { User, Shield, Bell, Key, Trash2, Plus, Copy, Check } from 'lucide-react';
import api from '../../api/axios';
import logger from '../../utils/logger';
import './AdminUserSettingsPage.css';

const TABS = [
  { id: 'profile', label: 'Profile', icon: User },
  { id: 'sessions', label: 'Sessions', icon: Shield },
  { id: 'notifications', label: 'Notifications', icon: Bell },
  { id: 'api-keys', label: 'API Keys', icon: Key },
];

export default function AdminUserSettingsPage() {
  const { t } = useTranslation();
  const [activeTab, setActiveTab] = useState('profile');
  const [loading, setLoading] = useState(true);

  // Profile
  const [profile, setProfile] = useState(null);
  const [profileForm, setProfileForm] = useState({});
  const [profileSaving, setProfileSaving] = useState(false);

  // Sessions
  const [sessions, setSessions] = useState([]);

  // Notifications
  const [notifPrefs, setNotifPrefs] = useState(null);
  const [notifSaving, setNotifSaving] = useState(false);

  // API keys
  const [apiKeys, setApiKeys] = useState([]);
  const [newKeyName, setNewKeyName] = useState('');
  const [newKeyValue, setNewKeyValue] = useState(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => { loadAll(); }, []);

  const loadAll = async () => {
    setLoading(true);
    try {
      const [p, s, n, k] = await Promise.all([
        api.get('/admin/settings/me'),
        api.get('/admin/settings/me/sessions'),
        api.get('/admin/settings/me/notifications'),
        api.get('/admin/settings/me/api-keys'),
      ]);
      setProfile(p.data);
      setProfileForm({
        first_name: p.data.first_name || '',
        last_name: p.data.last_name || '',
        phone: p.data.phone || '',
        preferred_language: p.data.preferred_language || 'en',
      });
      setSessions(s.data.sessions || []);
      setNotifPrefs(n.data);
      setApiKeys(k.data.keys || []);
    } catch (err) {
      logger.error('Failed to load admin settings', err);
    } finally {
      setLoading(false);
    }
  };

  const saveProfile = async () => {
    setProfileSaving(true);
    try {
      const { data } = await api.put('/admin/settings/me', profileForm);
      setProfile(data);
    } catch (err) {
      logger.error('Failed to save profile', err);
    } finally {
      setProfileSaving(false);
    }
  };

  const revokeSession = async (sessionId) => {
    if (!window.confirm(t('adminSettings.sessions.confirmRevoke', 'Revoke this session?'))) return;
    try {
      await api.delete(`/admin/settings/me/sessions/${sessionId}`);
      setSessions(sessions.filter(s => s.id !== sessionId));
    } catch (err) {
      logger.error('Failed to revoke session', err);
    }
  };

  const saveNotifPrefs = async () => {
    setNotifSaving(true);
    try {
      const { data } = await api.put('/admin/settings/me/notifications', notifPrefs);
      setNotifPrefs(data);
    } catch (err) {
      logger.error('Failed to save notification prefs', err);
    } finally {
      setNotifSaving(false);
    }
  };

  const createApiKey = async () => {
    if (!newKeyName.trim()) return;
    try {
      const { data } = await api.post('/admin/settings/me/api-keys', { name: newKeyName.trim() });
      setNewKeyValue(data.key);
      setApiKeys([{ ...data, key: undefined }, ...apiKeys]);
      setNewKeyName('');
    } catch (err) {
      logger.error('Failed to create API key', err);
    }
  };

  const revokeApiKey = async (keyId) => {
    if (!window.confirm(t('adminSettings.apiKeys.confirmRevoke', 'Revoke this API key?'))) return;
    try {
      await api.delete(`/admin/settings/me/api-keys/${keyId}`);
      setApiKeys(apiKeys.map(k => k.id === keyId ? { ...k, revoked_at: new Date().toISOString() } : k));
    } catch (err) {
      logger.error('Failed to revoke API key', err);
    }
  };

  const copyKey = async () => {
    if (!newKeyValue) return;
    await navigator.clipboard.writeText(newKeyValue);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  if (loading) {
    return <div className="admin-settings-loading">{t('common.loading', 'Loading...')}</div>;
  }

  return (
    <div className="admin-settings-page">
      <h1>{t('adminSettings.title', 'My Settings')}</h1>

      <div className="admin-settings-tabs">
        {TABS.map(tab => {
          const Icon = tab.icon;
          return (
            <button
              key={tab.id}
              className={`admin-settings-tab ${activeTab === tab.id ? 'active' : ''}`}
              onClick={() => setActiveTab(tab.id)}
            >
              <Icon size={16} />
              {t(`adminSettings.tabs.${tab.id}`, tab.label)}
            </button>
          );
        })}
      </div>

      <div className="admin-settings-content">
        {activeTab === 'profile' && (
          <div className="admin-settings-section">
            <h2>{t('adminSettings.profile.title', 'Profile')}</h2>
            <div className="admin-settings-field">
              <label>{t('adminSettings.profile.email', 'Email')}</label>
              <input type="text" value={profile?.email || ''} disabled />
            </div>
            <div className="admin-settings-field">
              <label>{t('adminSettings.profile.role', 'Role')}</label>
              <input type="text" value={profile?.role || ''} disabled />
            </div>
            <div className="admin-settings-row">
              <div className="admin-settings-field">
                <label>{t('adminSettings.profile.firstName', 'First name')}</label>
                <input
                  type="text"
                  value={profileForm.first_name}
                  onChange={e => setProfileForm({ ...profileForm, first_name: e.target.value })}
                />
              </div>
              <div className="admin-settings-field">
                <label>{t('adminSettings.profile.lastName', 'Last name')}</label>
                <input
                  type="text"
                  value={profileForm.last_name}
                  onChange={e => setProfileForm({ ...profileForm, last_name: e.target.value })}
                />
              </div>
            </div>
            <div className="admin-settings-field">
              <label>{t('adminSettings.profile.phone', 'Phone')}</label>
              <input
                type="tel"
                value={profileForm.phone}
                onChange={e => setProfileForm({ ...profileForm, phone: e.target.value })}
              />
            </div>
            <button className="admin-settings-save" onClick={saveProfile} disabled={profileSaving}>
              {profileSaving ? t('common.saving', 'Saving...') : t('common.save', 'Save')}
            </button>
          </div>
        )}

        {activeTab === 'sessions' && (
          <div className="admin-settings-section">
            <h2>{t('adminSettings.sessions.title', 'Active Sessions')}</h2>
            <p className="admin-settings-hint">
              {t('adminSettings.sessions.hint', 'Revoke any session you do not recognize.')}
            </p>
            {sessions.map(s => (
              <div key={s.id} className="admin-settings-session">
                <div>
                  <div className="admin-settings-session-device">
                    {s.user_agent?.slice(0, 60) || t('adminSettings.sessions.unknown', 'Unknown device')}
                    {s.is_current && <span className="admin-settings-badge">{t('adminSettings.sessions.current', 'Current')}</span>}
                  </div>
                  <div className="admin-settings-session-meta">
                    {s.ip_address} · {s.last_used_at ? new Date(s.last_used_at).toLocaleString() : t('adminSettings.sessions.never', 'Never used')}
                  </div>
                </div>
                {!s.is_current && (
                  <button className="admin-settings-danger" onClick={() => revokeSession(s.id)}>
                    <Trash2 size={14} />
                  </button>
                )}
              </div>
            ))}
            {sessions.length === 0 && <p>{t('adminSettings.sessions.none', 'No active sessions.')}</p>}
          </div>
        )}

        {activeTab === 'notifications' && notifPrefs && (
          <div className="admin-settings-section">
            <h2>{t('adminSettings.notifications.title', 'Notification Preferences')}</h2>
            {[
              ['notify_payout_failures', 'Payout failures'],
              ['notify_incidents', 'Incidents'],
              ['notify_new_admins', 'New admin signups'],
              ['notify_disputes', 'Disputes'],
              ['email_notifications', 'Email notifications'],
              ['sms_notifications', 'SMS notifications'],
            ].map(([key, label]) => (
              <label key={key} className="admin-settings-toggle">
                <input
                  type="checkbox"
                  checked={!!notifPrefs[key]}
                  onChange={e => setNotifPrefs({ ...notifPrefs, [key]: e.target.checked })}
                />
                {t(`adminSettings.notifications.${key}`, label)}
              </label>
            ))}
            <button className="admin-settings-save" onClick={saveNotifPrefs} disabled={notifSaving}>
              {notifSaving ? t('common.saving', 'Saving...') : t('common.save', 'Save')}
            </button>
          </div>
        )}

        {activeTab === 'api-keys' && (
          <div className="admin-settings-section">
            <h2>{t('adminSettings.apiKeys.title', 'API Keys')}</h2>
            <p className="admin-settings-hint">
              {t('adminSettings.apiKeys.hint', 'Keys grant API access as you. Keep them secret.')}
            </p>
            {newKeyValue && (
              <div className="admin-settings-new-key">
                <code>{newKeyValue}</code>
                <button onClick={copyKey}>{copied ? <Check size={14} /> : <Copy size={14} />}</button>
                <p>{t('adminSettings.apiKeys.copyWarning', 'Copy this now. It will not be shown again.')}</p>
              </div>
            )}
            <div className="admin-settings-row">
              <input
                type="text"
                placeholder={t('adminSettings.apiKeys.namePlaceholder', 'Key name (e.g. CI deploy)')}
                value={newKeyName}
                onChange={e => setNewKeyName(e.target.value)}
              />
              <button className="admin-settings-save" onClick={createApiKey}>
                <Plus size={14} /> {t('adminSettings.apiKeys.create', 'Create')}
              </button>
            </div>
            {apiKeys.map(k => (
              <div key={k.id} className="admin-settings-session">
                <div>
                  <div className="admin-settings-session-device">
                    {k.name} <code>{k.prefix}...</code>
                    {k.revoked_at && <span className="admin-settings-badge revoked">{t('adminSettings.apiKeys.revoked', 'Revoked')}</span>}
                  </div>
                  <div className="admin-settings-session-meta">
                    {t('adminSettings.apiKeys.created', 'Created')} {new Date(k.created_at).toLocaleDateString()}
                    {k.last_used_at && ` · ${t('adminSettings.apiKeys.lastUsed', 'Last used')} ${new Date(k.last_used_at).toLocaleDateString()}`}
                  </div>
                </div>
                {!k.revoked_at && (
                  <button className="admin-settings-danger" onClick={() => revokeApiKey(k.id)}>
                    <Trash2 size={14} />
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
