// Admin: My Settings - self-service page for the logged-in admin.
// Tabs: Profile, Sessions, Notifications, API Keys.

import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { User, Shield, Bell, Key, Trash2, Plus, Copy, Check, LayoutGrid, AlertTriangle, Pencil } from 'lucide-react';
import api from '../../api/axios';
import logger from '../../utils/logger';
import { moneyMinor } from '../../lib/moneyExact';
import './AdminUserSettingsPage.css';
import './AdminQueryBuilderPage.css';

const TABS = [
  { id: 'profile', label: 'Profile', icon: User },
  { id: 'sessions', label: 'Sessions', icon: Shield },
  { id: 'notifications', label: 'Notifications', icon: Bell },
  { id: 'metric-alerts', label: 'Metric alerts', icon: AlertTriangle },
  { id: 'api-keys', label: 'API Keys', icon: Key },
  { id: 'tabs', label: 'Tabs', icon: LayoutGrid },
];

const VALID_TAB_IDS = new Set(TABS.map(tab => tab.id));

function initialTabFromUrl() {
  try {
    const tab = new URLSearchParams(window.location.search).get('tab');
    if (tab && VALID_TAB_IDS.has(tab)) return tab;
  } catch (err) { /* ignore: default tab */ }
  return 'profile';
}

const EMPTY_RULE_FORM = {
  metric_name: '',
  operator: '>',
  threshold: '',
  period: '30d',
  days: '30',
  currencyCode: 'USD',
  comparison: 'absolute',
  cooldown_minutes: '60',
  is_active: true,
  channel_in_app: true,
  channel_email: true,
  channel_sms: false,
};

// Tab keys matching the admin route manifest (adminRouteManifest.js).
// These are the tabs an admin can mark as essential or hide.
const MANAGEABLE_TABS = [
  'dashboard', 'operations', 'users', 'jobs', 'reports', 'moderation',
  'enforcement', 'contentRemovals', 'skills', 'support', 'supportChat',
  'quoteRequests', 'directOps', 'directServiceAreas', 'directCatalog',
  'messages', 'search', 'businesses', 'toolRentals', 'plannedNeeds',
  'payments', 'orders', 'templates', 'consulting', 'consultingPayments',
  'scheduling', 'businessLaunch', 'consultingSessions', 'orgChart',
  'corporateAssignments', 'logistics', 'learnSubmissions', 'learnProductLinks',
  'learnAiSuggestions',
];

export default function AdminUserSettingsPage() {
  const { t, i18n } = useTranslation();
  const [activeTab, setActiveTab] = useState(initialTabFromUrl);
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

  // Tab preferences
  const [tabPrefs, setTabPrefs] = useState({});
  const [tabSaving, setTabSaving] = useState(false);

  // Metric threshold alert rules
  const [alertRules, setAlertRules] = useState([]);
  const [alertMetrics, setAlertMetrics] = useState([]);
  const [editingRule, setEditingRule] = useState(null); // 'new' | rule object | null
  const [ruleForm, setRuleForm] = useState(EMPTY_RULE_FORM);
  const [ruleSaving, setRuleSaving] = useState(false);
  const [alertHistory,setAlertHistory]=useState(null);
  const loadAlertHistory=async(rule,offset=0)=>{
    setAlertHistory({rule,loading:true});
    try{const response=await api.get(`/admin/settings/me/metric-alert-rules/${rule.id}/history`,{params:{offset}});
      setAlertHistory({rule,...response.data,loading:false});}
    catch{setAlertHistory({rule,loading:false,error:true});}
  };

  useEffect(() => { loadAll(); }, []);

  const loadAll = async () => {
    setLoading(true);
    try {
      const [p, s, n, k, tb, ar] = await Promise.all([
        api.get('/admin/settings/me'),
        api.get('/admin/settings/me/sessions'),
        api.get('/admin/settings/me/notifications'),
        api.get('/admin/settings/me/api-keys'),
        api.get('/admin/settings/me/tabs'),
        api.get('/admin/settings/me/metric-alert-rules'),
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
      setTabPrefs(tb.data.prefs || {});
      setAlertRules(ar.data.rules || []);
      setAlertMetrics(ar.data.metrics || []);
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

  const saveTabPrefs = async () => {
    setTabSaving(true);
    try {
      await api.put('/admin/settings/me/tabs', { prefs: tabPrefs });
    } catch (err) {
      logger.error('Failed to save tab preferences', err);
    } finally {
      setTabSaving(false);
    }
  };

  const toggleTab = (tabKey) => {
    // Default is essential (visible). Toggling sets it to non-essential (hidden).
    const current = tabPrefs[tabKey];
    setTabPrefs({ ...tabPrefs, [tabKey]: current === false ? true : false });
  };

  // ── Metric threshold alert rules ─────────────────────────────────────────
  const metricMeta = (name) => alertMetrics.find(m => m.name === name) || null;
  const metricUnit = (name) => metricMeta(name)?.unit || 'count';

  const formatRuleValue = (metricName, raw, params = {}) => {
    if (raw == null) return '—';
    const v = Number(raw);
    if (!Number.isFinite(v)) return t('adminSettings.metricAlerts.noValue');
    if (params.comparison === 'previous_period_pct') return `${v.toFixed(2)}%`;
    const unit = metricUnit(metricName);
    if (unit === 'cents') return moneyMinor(raw, params.currencyCode || 'USD', i18n.language);
    if (unit === 'pct' || unit === 'index') return v.toFixed(2);
    return String(Math.round(v));
  };

  const startNewRule = () => {
    setRuleForm({ ...EMPTY_RULE_FORM, metric_name: alertMetrics[0]?.name || '' });
    setEditingRule('new');
  };

  const startEditRule = (rule) => {
    setRuleForm({
      metric_name: rule.metric_name,
      operator: rule.operator,
      threshold: String(rule.threshold),
      period: rule.params?.period || '30d',
      days: rule.params?.days != null ? String(rule.params.days) : '30',
      currencyCode: rule.params?.currencyCode || 'USD',
      comparison: rule.params?.comparison || 'absolute',
      cooldown_minutes: String(rule.cooldown_minutes),
      is_active: !!rule.is_active,
      channel_in_app: !!rule.channel_in_app,
      channel_email: !!rule.channel_email,
      channel_sms: !!rule.channel_sms,
    });
    setEditingRule(rule);
  };

  const saveRule = async () => {
    const meta = metricMeta(ruleForm.metric_name);
    if (!meta) return;
    setRuleSaving(true);
    try {
      const params = {};
      if (meta.params.includes('period')) params.period = ruleForm.period;
      if (meta.params.includes('days')) params.days = parseInt(ruleForm.days, 10);
      if (meta.params.includes('currencyCode')) params.currencyCode = ruleForm.currencyCode;
      if (meta.params.includes('comparison')) params.comparison = ruleForm.comparison;
      const payload = {
        metric_name: ruleForm.metric_name,
        operator: ruleForm.operator,
        threshold: Number(ruleForm.threshold),
        params,
        cooldown_minutes: parseInt(ruleForm.cooldown_minutes, 10),
        is_active: ruleForm.is_active,
        channel_in_app: ruleForm.channel_in_app,
        channel_email: ruleForm.channel_email,
        channel_sms: ruleForm.channel_sms,
      };
      let saved;
      if (editingRule === 'new') {
        ({ data: { rule: saved } } = await api.post('/admin/settings/me/metric-alert-rules', payload));
        setAlertRules([saved, ...alertRules]);
      } else {
        ({ data: { rule: saved } } = await api.put(`/admin/settings/me/metric-alert-rules/${editingRule.id}`, payload));
        setAlertRules(alertRules.map(r => (r.id === saved.id ? saved : r)));
      }
      setEditingRule(null);
    } catch (err) {
      logger.error('Failed to save metric alert rule', err);
      window.alert(err.response?.data?.message || t('adminSettings.metricAlerts.saveFailed'));
    } finally {
      setRuleSaving(false);
    }
  };

  const deleteRule = async (rule) => {
    if (!window.confirm(t('adminSettings.metricAlerts.confirmDelete'))) return;
    try {
      await api.delete(`/admin/settings/me/metric-alert-rules/${rule.id}`);
      setAlertRules(alertRules.filter(r => r.id !== rule.id));
      if (editingRule && editingRule !== 'new' && editingRule.id === rule.id) setEditingRule(null);
    } catch (err) {
      logger.error('Failed to delete metric alert rule', err);
    }
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
              {tab.id === 'metric-alerts'
                ? t('adminSettings.tabs.metric-alerts')
                : t(`adminSettings.tabs.${tab.id}`, tab.label)}
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
              // New keys use t('key') with no defaultValue (i18n gate).
              ['notify_metric_alerts', null],
              ['email_notifications', 'Email notifications'],
              ['sms_notifications', 'SMS notifications'],
            ].map(([key, label]) => (
              <label key={key} className="admin-settings-toggle">
                <input
                  type="checkbox"
                  checked={!!notifPrefs[key]}
                  onChange={e => setNotifPrefs({ ...notifPrefs, [key]: e.target.checked })}
                />
                {label == null
                  ? t(`adminSettings.notifications.${key}`)
                  : t(`adminSettings.notifications.${key}`, label)}
              </label>
            ))}
            <button className="admin-settings-save" onClick={saveNotifPrefs} disabled={notifSaving}>
              {notifSaving ? t('common.saving', 'Saving...') : t('common.save', 'Save')}
            </button>
          </div>
        )}

        {activeTab === 'metric-alerts' && (
          <div className="admin-settings-section">
            <h2>{t('adminSettings.metricAlerts.title')}</h2>
            <p className="admin-settings-hint">
              {t('adminSettings.metricAlerts.hint')}
            </p>
            {alertRules.length === 0 && editingRule !== 'new' && (
              <p>{t('adminSettings.metricAlerts.empty')}</p>
            )}
            {alertRules.map(rule => (
              <div key={rule.id} className="admin-settings-session">
                <div>
                  <div className="admin-settings-session-device">
                    {t(`adminSettings.metricAlerts.metrics.${rule.metric_name}`)}{' '}
                    {rule.operator} {formatRuleValue(rule.metric_name, rule.threshold, rule.params)}
                    {!rule.is_active && (
                      <span className="admin-settings-badge revoked">{t('adminSettings.metricAlerts.paused')}</span>
                    )}
                  </div>
                  <div className="admin-settings-session-meta">
                    {t('adminSettings.metricAlerts.lastFired')}:{' '}
                    {rule.last_fired_at
                      ? new Date(rule.last_fired_at).toLocaleString()
                      : t('adminSettings.metricAlerts.never')}
                    {' · '}
                    {t('adminSettings.metricAlerts.currentValue')}: {formatRuleValue(rule.metric_name, rule.last_value, rule.params)}
                  </div>
                </div>
                <div className="admin-settings-row" style={{ gap: 8 }}>
                  <button className="admin-settings-save" onClick={() => loadAlertHistory(rule)}>{t('analyticsCompletion.alertHistory')}</button>
                  <button className="admin-settings-save" onClick={() => startEditRule(rule)}>
                    <Pencil size={14} /> {t('adminSettings.metricAlerts.edit')}
                  </button>
                  <button className="admin-settings-danger" onClick={() => deleteRule(rule)}>
                    <Trash2 size={14} />
                  </button>
                </div>
              </div>
            ))}
            {alertHistory&&<section aria-busy={alertHistory.loading}>
              <h3>{t('analyticsCompletion.alertHistory')}</h3>
              {alertHistory.error&&<p role="alert">{t('queryBuilder.loadFailed')}</p>}
              <div className="qb-table-wrap"><table className="qb-table"><thead><tr>
                <th>{t('analyticsCompletion.when')}</th><th>{t('analyticsCompletion.metric')}</th>
                <th>{t('analyticsCompletion.columns.value')}</th><th>{t('analyticsCompletion.previousValue')}</th><th>{t('analyticsCompletion.comparedValue')}</th>
              </tr></thead><tbody>{alertHistory.rows?.map(row=><tr key={row.id}>
                <td>{new Date(row.observed_at).toLocaleString(i18n.language)}</td>
                <td>{t(`adminSettings.metricAlerts.metrics.${row.metric_name}`)}</td>
                <td>{formatRuleValue(row.metric_name,row.value,{...row.params,comparison:'absolute'})}</td>
                <td>{formatRuleValue(row.metric_name,row.previous_value,{...row.params,comparison:'absolute'})}</td>
                <td>{formatRuleValue(row.metric_name,row.compared_value,row.params)}</td>
              </tr>)}</tbody></table></div>
              <nav aria-label={t('analyticsCompletion.alertHistory')}>
                <button disabled={!alertHistory.offset||alertHistory.loading} onClick={()=>loadAlertHistory(alertHistory.rule,Math.max(0,alertHistory.offset-50))}>{t('helperEarningsV2.previous')}</button>
                <button disabled={!alertHistory.hasMore||alertHistory.loading} onClick={()=>loadAlertHistory(alertHistory.rule,alertHistory.offset+50)}>{t('helperEarningsV2.next')}</button>
              </nav>
              {!!alertHistory.sms?.length&&<><h4>{t('analyticsCompletion.smsDelivery')}</h4><p>{t('analyticsCompletion.smsUncertainNote')}</p>
                <ul>{alertHistory.sms.map((row,index)=><li key={index}>{new Date(row.created_at).toLocaleString(i18n.language)} · {t(`analyticsCompletion.smsStatus.${row.status}`)}</li>)}</ul></>}
            </section>}
            {editingRule === null && (
              <div className="admin-settings-row">
                <button className="admin-settings-save" onClick={startNewRule}>
                  <Plus size={14} /> {t('adminSettings.metricAlerts.newRule')}
                </button>
              </div>
            )}
            {editingRule !== null && (
              <div className="admin-settings-section" style={{ marginTop: 16 }}>
                <h2>{editingRule === 'new' ? t('adminSettings.metricAlerts.newRule') : t('adminSettings.metricAlerts.editRule')}</h2>
                <div className="admin-settings-field">
                  <label>{t('adminSettings.metricAlerts.metric')}</label>
                  <select
                    value={ruleForm.metric_name}
                    onChange={e => setRuleForm({ ...ruleForm, metric_name: e.target.value })}
                  >
                    {alertMetrics.map(m => (
                      <option key={m.name} value={m.name}>
                        {t(`adminSettings.metricAlerts.metrics.${m.name}`)}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="admin-settings-row">
                  <div className="admin-settings-field">
                    <label>{t('adminSettings.metricAlerts.operator')}</label>
                    <select
                      value={ruleForm.operator}
                      onChange={e => setRuleForm({ ...ruleForm, operator: e.target.value })}
                    >
                      <option value=">">{t('adminSettings.metricAlerts.operators.gt')}</option>
                      <option value="<">{t('adminSettings.metricAlerts.operators.lt')}</option>
                      <option value="==">{t('adminSettings.metricAlerts.operators.eq')}</option>
                    </select>
                  </div>
                  <div className="admin-settings-field">
                    <label>{t('adminSettings.metricAlerts.threshold')}</label>
                    <input
                      type="number"
                      step="any"
                      value={ruleForm.threshold}
                      onChange={e => setRuleForm({ ...ruleForm, threshold: e.target.value })}
                    />
                  </div>
                </div>
                <p className="admin-settings-hint">
                  {t(`adminSettings.metricAlerts.thresholdHint.${metricUnit(ruleForm.metric_name)}`)}
                </p>
                {metricMeta(ruleForm.metric_name)?.params.includes('currencyCode') && (
                  <div className="admin-settings-field">
                    <label htmlFor="metric-rule-currency">{t('helperEarningsV2.currency')}</label>
                    <input id="metric-rule-currency" maxLength={3} pattern="[A-Za-z]{3}" value={ruleForm.currencyCode}
                      onChange={event => setRuleForm({ ...ruleForm, currencyCode: event.target.value.toUpperCase() })} />
                  </div>
                )}
                {metricMeta(ruleForm.metric_name)?.params.includes('period') && (
                  <div className="admin-settings-field">
                    <label>{t('adminSettings.metricAlerts.period')}</label>
                    <select
                      value={ruleForm.period}
                      onChange={e => setRuleForm({ ...ruleForm, period: e.target.value })}
                    >
                      {['1d', '7d', '30d', '90d', '1y'].map(p => (
                        <option key={p} value={p}>{t(`adminSettings.metricAlerts.periods.${p}`)}</option>
                      ))}
                    </select>
                  </div>
                )}
                {metricMeta(ruleForm.metric_name)?.params.includes('comparison') && <div className="admin-settings-field">
                  <label htmlFor="metric-comparison">{t('analyticsCompletion.comparison')}</label>
                  <select id="metric-comparison" value={ruleForm.comparison} onChange={event => setRuleForm({ ...ruleForm, comparison: event.target.value })}>
                    <option value="absolute">{t('analyticsCompletion.absolute')}</option>
                    <option value="previous_period_pct">{t('analyticsCompletion.previousPeriod')}</option>
                  </select>
                  <p>{t('analyticsCompletion.baselineNote')}</p>
                </div>}
                {metricMeta(ruleForm.metric_name)?.params.includes('days') && (
                  <div className="admin-settings-field">
                    <label>{t('adminSettings.metricAlerts.days')}</label>
                    <input
                      type="number"
                      min="1"
                      max="365"
                      value={ruleForm.days}
                      onChange={e => setRuleForm({ ...ruleForm, days: e.target.value })}
                    />
                  </div>
                )}
                <div className="admin-settings-field">
                  <label>{t('adminSettings.metricAlerts.cooldownMinutes')}</label>
                  <input
                    type="number"
                    min="5"
                    max="43200"
                    value={ruleForm.cooldown_minutes}
                    onChange={e => setRuleForm({ ...ruleForm, cooldown_minutes: e.target.value })}
                  />
                  <p className="admin-settings-hint">{t('adminSettings.metricAlerts.cooldownHint')}</p>
                </div>
                <div className="admin-settings-field">
                  <label>{t('adminSettings.metricAlerts.channels')}</label>
                  {[
                    ['channel_in_app', t('adminSettings.metricAlerts.channelInApp')],
                    ['channel_email', t('adminSettings.metricAlerts.channelEmail')],
                    ['channel_sms', t('adminSettings.metricAlerts.channelSms')],
                  ].map(([key, label]) => (
                    <label key={key} className="admin-settings-toggle">
                      <input
                        type="checkbox"
                        checked={!!ruleForm[key]}
                        onChange={e => setRuleForm({ ...ruleForm, [key]: e.target.checked })}
                      />
                      {label}
                    </label>
                  ))}
                </div>
                <label className="admin-settings-toggle">
                  <input
                    type="checkbox"
                    checked={!!ruleForm.is_active}
                    onChange={e => setRuleForm({ ...ruleForm, is_active: e.target.checked })}
                  />
                  {t('adminSettings.metricAlerts.active')}
                </label>
                <div className="admin-settings-row" style={{ marginTop: 12, gap: 8 }}>
                  <button className="admin-settings-save" onClick={saveRule} disabled={ruleSaving}>
                    {ruleSaving ? t('common.saving', 'Saving...') : t('common.save', 'Save')}
                  </button>
                  <button className="admin-settings-save" onClick={() => setEditingRule(null)}>
                    {t('adminSettings.metricAlerts.cancel')}
                  </button>
                </div>
              </div>
            )}
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

        {activeTab === 'tabs' && (
          <div className="admin-settings-section">
            <h2>{t('adminSettings.tabs.title', 'Essential Tabs')}</h2>
            <p className="admin-settings-hint">
              {t('adminSettings.tabs.hint', 'Uncheck tabs you do not need. They will be hidden from your sidebar.')}
            </p>
            {MANAGEABLE_TABS.map(tabKey => {
              const isEssential = tabPrefs[tabKey] !== false;
              return (
                <label key={tabKey} className="admin-settings-toggle">
                  <input
                    type="checkbox"
                    checked={isEssential}
                    onChange={() => toggleTab(tabKey)}
                  />
                  {tabKey}
                </label>
              );
            })}
            <button className="admin-settings-save" onClick={saveTabPrefs} disabled={tabSaving}>
              {tabSaving ? t('common.saving', 'Saving...') : t('common.save', 'Save')}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
