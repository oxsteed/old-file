import { useState, useEffect, useCallback } from 'react';
import { useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import adminApi from '../../lib/adminApi';
import AdminErrorState from '../lib/AdminErrorState';
import {
  Settings, Bell, Zap, Clock, Mail, MessageSquare, Link2, Save, RefreshCw, CheckCircle, AlertCircle,
} from 'lucide-react';
import SupportSubNav from '../components/SupportSubNav';

// Settings Tab Navigation
function SettingsTabs({ activeTab, setActiveTab }) {
  const { t } = useTranslation();
  const tabs = [
    { id: 'general', label: t('adminSupportSettings.tabGeneral'), icon: Settings },
    { id: 'notifications', label: t('adminSupportSettings.tabNotifications'), icon: Bell },
    { id: 'integrations', label: t('adminSupportSettings.tabIntegrations'), icon: Link2 },
    { id: 'automation', label: t('adminSupportSettings.tabAutomation'), icon: Zap },
    { id: 'working-hours', label: t('adminSupportSettings.tabWorkingHours'), icon: Clock },
  ];

  return (
    <div className="flex gap-4 mb-8 border-b border-gray-700 overflow-x-auto">
      {tabs.map(tab => {
        const Icon = tab.icon;
        return (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`flex items-center gap-2 px-4 py-3 border-b-2 transition ${
              activeTab === tab.id
                ? 'border-orange-500 text-orange-400'
                : 'border-transparent text-gray-400 hover:text-gray-300'
            }`}
          >
            <Icon size={18} />
            {tab.label}
          </button>
        );
      })}
    </div>
  );
}

// General Settings
function GeneralSettings({ settings, onUpdate }) {
  const { t } = useTranslation();
  const [formData, setFormData] = useState(settings.general || {
    company_name: '',
    support_email: '',
    support_phone: '',
    timezone: 'UTC',
    language: 'en',
  });

  const handleSave = () => {
    onUpdate('general', formData);
  };

  return (
    <div className="space-y-6">
      <div>
        <label className="block text-gray-400 text-sm mb-2">{t('adminSupportSettings.companyName')}</label>
        <input
          type="text"
          value={formData.company_name}
          onChange={e => setFormData({ ...formData, company_name: e.target.value })}
          className="w-full px-4 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white
                     focus:outline-none focus:border-orange-500"
        />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div>
          <label className="block text-gray-400 text-sm mb-2">{t('adminSupportSettings.supportEmail')}</label>
          <input
            type="email"
            value={formData.support_email}
            onChange={e => setFormData({ ...formData, support_email: e.target.value })}
            className="w-full px-4 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white
                       focus:outline-none focus:border-orange-500"
          />
        </div>

        <div>
          <label className="block text-gray-400 text-sm mb-2">{t('adminSupportSettings.supportPhone')}</label>
          <input
            type="tel"
            value={formData.support_phone}
            onChange={e => setFormData({ ...formData, support_phone: e.target.value })}
            className="w-full px-4 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white
                       focus:outline-none focus:border-orange-500"
          />
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div>
          <label className="block text-gray-400 text-sm mb-2">{t('adminSupportSettings.timezone')}</label>
          <select
            value={formData.timezone}
            onChange={e => setFormData({ ...formData, timezone: e.target.value })}
            className="w-full px-4 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white
                       focus:outline-none focus:border-orange-500"
          >
            <option value="UTC">UTC</option>
            <option value="EST">{t('adminSupportSettings.timezoneEastern')}</option>
            <option value="CST">{t('adminSupportSettings.timezoneCentral')}</option>
            <option value="MST">{t('adminSupportSettings.timezoneMountain')}</option>
            <option value="PST">{t('adminSupportSettings.timezonePacific')}</option>
          </select>
        </div>

        <div>
          <label className="block text-gray-400 text-sm mb-2">{t('adminSupportSettings.defaultLanguage')}</label>
          <select
            value={formData.language}
            onChange={e => setFormData({ ...formData, language: e.target.value })}
            className="w-full px-4 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white
                       focus:outline-none focus:border-orange-500"
          >
            <option value="en">{t('adminSupportSettings.languageEnglish')}</option>
            <option value="es">{t('adminSupportSettings.languageSpanish')}</option>
            <option value="fr">{t('adminSupportSettings.languageFrench')}</option>
            <option value="de">{t('adminSupportSettings.languageGerman')}</option>
          </select>
        </div>
      </div>

      <button
        onClick={handleSave}
        className="flex items-center gap-2 px-4 py-2 bg-orange-600 hover:bg-orange-700
                   text-white rounded-lg transition font-medium"
      >
        <Save size={16} />
        {t('adminSupportSettings.saveChanges')}
      </button>
    </div>
  );
}

// Notification Settings
function NotificationSettings({ settings, onUpdate }) {
  const { t } = useTranslation();
  const [formData, setFormData] = useState(settings.notifications || {
    email_notifications: true,
    sms_notifications: false,
    in_app_notifications: true,
    daily_digest: true,
    notify_on_escalation: true,
    notify_on_assignment: true,
  });

  const handleSave = () => {
    onUpdate('notifications', formData);
  };

  return (
    <div className="space-y-4">
      <div className="bg-gray-700 rounded-lg p-4 space-y-3">
        <h3 className="text-white font-semibold">{t('adminSupportSettings.notificationChannels')}</h3>

        <label className="flex items-center gap-3 cursor-pointer">
          <input
            type="checkbox"
            checked={formData.email_notifications}
            onChange={e => setFormData({ ...formData, email_notifications: e.target.checked })}
            className="w-4 h-4 accent-orange-500"
          />
          <span className="text-gray-300">{t('adminSupportSettings.emailNotifications')}</span>
        </label>

        <label className="flex items-center gap-3 cursor-pointer">
          <input
            type="checkbox"
            checked={formData.sms_notifications}
            onChange={e => setFormData({ ...formData, sms_notifications: e.target.checked })}
            className="w-4 h-4 accent-orange-500"
          />
          <span className="text-gray-300">{t('adminSupportSettings.smsNotifications')}</span>
        </label>

        <label className="flex items-center gap-3 cursor-pointer">
          <input
            type="checkbox"
            checked={formData.in_app_notifications}
            onChange={e => setFormData({ ...formData, in_app_notifications: e.target.checked })}
            className="w-4 h-4 accent-orange-500"
          />
          <span className="text-gray-300">{t('adminSupportSettings.inAppNotifications')}</span>
        </label>
      </div>

      <div className="bg-gray-700 rounded-lg p-4 space-y-3">
        <h3 className="text-white font-semibold">{t('adminSupportSettings.eventNotifications')}</h3>

        <label className="flex items-center gap-3 cursor-pointer">
          <input
            type="checkbox"
            checked={formData.notify_on_escalation}
            onChange={e => setFormData({ ...formData, notify_on_escalation: e.target.checked })}
            className="w-4 h-4 accent-orange-500"
          />
          <span className="text-gray-300">{t('adminSupportSettings.notifyOnEscalation')}</span>
        </label>

        <label className="flex items-center gap-3 cursor-pointer">
          <input
            type="checkbox"
            checked={formData.notify_on_assignment}
            onChange={e => setFormData({ ...formData, notify_on_assignment: e.target.checked })}
            className="w-4 h-4 accent-orange-500"
          />
          <span className="text-gray-300">{t('adminSupportSettings.notifyOnAssignment')}</span>
        </label>

        <label className="flex items-center gap-3 cursor-pointer">
          <input
            type="checkbox"
            checked={formData.daily_digest}
            onChange={e => setFormData({ ...formData, daily_digest: e.target.checked })}
            className="w-4 h-4 accent-orange-500"
          />
          <span className="text-gray-300">{t('adminSupportSettings.dailyDigestEmail')}</span>
        </label>
      </div>

      <button
        onClick={handleSave}
        className="flex items-center gap-2 px-4 py-2 bg-orange-600 hover:bg-orange-700
                   text-white rounded-lg transition font-medium"
      >
        <Save size={16} />
        {t('adminSupportSettings.saveChanges')}
      </button>
    </div>
  );
}

// Integration Settings
function IntegrationSettings({ settings, onUpdate }) {
  const { t } = useTranslation();
  const [formData, setFormData] = useState(settings.integrations || {
    slack_webhook_url: '',
    zapier_webhook_url: '',
    email_provider: 'resend',
    sms_provider: 'twilio',
  });

  const handleSave = () => {
    onUpdate('integrations', formData);
  };

  return (
    <div className="space-y-6">
      <div className="bg-gray-700 rounded-lg p-4">
        <div className="flex items-center gap-2 mb-3">
          <MessageSquare size={16} className="text-blue-400" />
          <h3 className="text-white font-semibold">{t('adminSupportSettings.slackIntegration')}</h3>
        </div>
        <input
          type="url"
          value={formData.slack_webhook_url}
          onChange={e => setFormData({ ...formData, slack_webhook_url: e.target.value })}
          placeholder="https://hooks.slack.com/services/..."
          className="w-full px-4 py-2 bg-gray-600 border border-gray-500 rounded-lg text-white
                     focus:outline-none focus:border-orange-500 text-sm"
        />
        <p className="text-gray-400 text-xs mt-2">{t('adminSupportSettings.slackWebhookHint')}</p>
      </div>

      <div className="bg-gray-700 rounded-lg p-4">
        <div className="flex items-center gap-2 mb-3">
          <Link2 size={16} className="text-purple-400" />
          <h3 className="text-white font-semibold">{t('adminSupportSettings.zapierIntegration')}</h3>
        </div>
        <input
          type="url"
          value={formData.zapier_webhook_url}
          onChange={e => setFormData({ ...formData, zapier_webhook_url: e.target.value })}
          placeholder="https://hooks.zapier.com/..."
          className="w-full px-4 py-2 bg-gray-600 border border-gray-500 rounded-lg text-white
                     focus:outline-none focus:border-orange-500 text-sm"
        />
        <p className="text-gray-400 text-xs mt-2">{t('adminSupportSettings.zapierWebhookHint')}</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="bg-gray-700 rounded-lg p-4">
          <label className="block text-gray-300 text-sm font-semibold mb-2">
            <Mail size={14} className="inline mr-2" />
            {t('adminSupportSettings.emailProvider')}
          </label>
          <select
            value={formData.email_provider}
            onChange={e => setFormData({ ...formData, email_provider: e.target.value })}
            className="w-full px-4 py-2 bg-gray-600 border border-gray-500 rounded-lg text-white
                       focus:outline-none focus:border-orange-500 text-sm"
          >
            <option value="resend">Resend</option>
            <option value="sendgrid">SendGrid</option>
            <option value="mailgun">Mailgun</option>
          </select>
        </div>

        <div className="bg-gray-700 rounded-lg p-4">
          <label className="block text-gray-300 text-sm font-semibold mb-2">
            <MessageSquare size={14} className="inline mr-2" />
            {t('adminSupportSettings.smsProvider')}
          </label>
          <select
            value={formData.sms_provider}
            onChange={e => setFormData({ ...formData, sms_provider: e.target.value })}
            className="w-full px-4 py-2 bg-gray-600 border border-gray-500 rounded-lg text-white
                       focus:outline-none focus:border-orange-500 text-sm"
          >
            <option value="twilio">Twilio</option>
            <option value="aws-sns">AWS SNS</option>
          </select>
        </div>
      </div>

      <button
        onClick={handleSave}
        className="flex items-center gap-2 px-4 py-2 bg-orange-600 hover:bg-orange-700
                   text-white rounded-lg transition font-medium"
      >
        <Save size={16} />
        {t('adminSupportSettings.saveChanges')}
      </button>
    </div>
  );
}

// Automation Settings
function AutomationSettings({ settings, onUpdate }) {
  const { t } = useTranslation();
  const [formData, setFormData] = useState(settings.automation || {
    auto_response_enabled: true,
    auto_response_message: 'Thank you for contacting us. We will respond shortly.',
    auto_close_after_days: 7,
    auto_assign_enabled: true,
    skill_based_routing: true,
  });

  const handleSave = () => {
    onUpdate('automation', formData);
  };

  return (
    <div className="space-y-6">
      <div className="bg-gray-700 rounded-lg p-4">
        <label className="flex items-center gap-3 cursor-pointer mb-4">
          <input
            type="checkbox"
            checked={formData.auto_response_enabled}
            onChange={e => setFormData({ ...formData, auto_response_enabled: e.target.checked })}
            className="w-4 h-4 accent-orange-500"
          />
          <span className="text-gray-300 font-semibold">{t('adminSupportSettings.enableAutoResponse')}</span>
        </label>

        {formData.auto_response_enabled && (
          <div>
            <label className="block text-gray-400 text-sm mb-2">{t('adminSupportSettings.autoResponseMessage')}</label>
            <textarea
              value={formData.auto_response_message}
              onChange={e => setFormData({ ...formData, auto_response_message: e.target.value })}
              className="w-full px-4 py-2 bg-gray-600 border border-gray-500 rounded-lg text-white
                         focus:outline-none focus:border-orange-500 resize-none"
              rows="3"
            />
          </div>
        )}
      </div>

      <div className="bg-gray-700 rounded-lg p-4 space-y-3">
        <label className="flex items-center gap-3 cursor-pointer">
          <input
            type="checkbox"
            checked={formData.auto_assign_enabled}
            onChange={e => setFormData({ ...formData, auto_assign_enabled: e.target.checked })}
            className="w-4 h-4 accent-orange-500"
          />
          <span className="text-gray-300">{t('adminSupportSettings.enableAutoAssignment')}</span>
        </label>

        <label className="flex items-center gap-3 cursor-pointer">
          <input
            type="checkbox"
            checked={formData.skill_based_routing}
            onChange={e => setFormData({ ...formData, skill_based_routing: e.target.checked })}
            className="w-4 h-4 accent-orange-500"
          />
          <span className="text-gray-300">{t('adminSupportSettings.skillBasedRouting')}</span>
        </label>
      </div>

      <div className="bg-gray-700 rounded-lg p-4">
        <label className="block text-gray-400 text-sm mb-2">{t('adminSupportSettings.autoCloseAfterDays')}</label>
        <input
          type="number"
          value={formData.auto_close_after_days}
          onChange={e => {
            // Guard: clearing or typing non-numeric text must never store NaN.
            const parsed = parseInt(e.target.value, 10);
            setFormData({
              ...formData,
              auto_close_after_days: Number.isNaN(parsed) ? 1 : Math.max(1, parsed),
            });
          }}
          className="w-full px-4 py-2 bg-gray-600 border border-gray-500 rounded-lg text-white
                     focus:outline-none focus:border-orange-500"
          min="1"
        />
      </div>

      <button
        onClick={handleSave}
        className="flex items-center gap-2 px-4 py-2 bg-orange-600 hover:bg-orange-700
                   text-white rounded-lg transition font-medium"
      >
        <Save size={16} />
        {t('adminSupportSettings.saveChanges')}
      </button>
    </div>
  );
}

// Working Hours Settings
const DAY_LABEL_KEYS = {
  monday: 'adminSupportSettings.dayMonday',
  tuesday: 'adminSupportSettings.dayTuesday',
  wednesday: 'adminSupportSettings.dayWednesday',
  thursday: 'adminSupportSettings.dayThursday',
  friday: 'adminSupportSettings.dayFriday',
  saturday: 'adminSupportSettings.daySaturday',
  sunday: 'adminSupportSettings.daySunday',
};

function WorkingHoursSettings({ settings, onUpdate }) {
  const { t } = useTranslation();
  const [formData, setFormData] = useState(settings.working_hours || {
    monday_start: '09:00',
    monday_end: '17:00',
    tuesday_start: '09:00',
    tuesday_end: '17:00',
    wednesday_start: '09:00',
    wednesday_end: '17:00',
    thursday_start: '09:00',
    thursday_end: '17:00',
    friday_start: '09:00',
    friday_end: '17:00',
    saturday_start: '',
    saturday_end: '',
    sunday_start: '',
    sunday_end: '',
  });

  const days = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];

  const handleSave = () => {
    onUpdate('working_hours', formData);
  };

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {days.map(day => {
          const start = formData[`${day}_start`] || '';
          const end = formData[`${day}_end`] || '';
          const isOpen = !!(start || end);
          const toggleDay = () => {
            if (isOpen) {
              setFormData({ ...formData, [`${day}_start`]: '', [`${day}_end`]: '' });
            } else {
              setFormData({
                ...formData,
                [`${day}_start`]: start || '09:00',
                [`${day}_end`]: end || '17:00',
              });
            }
          };
          return (
            <div key={day} className="bg-gray-700 rounded-lg p-4">
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-white font-semibold capitalize">{t(DAY_LABEL_KEYS[day])}</h3>
                <label className="flex items-center gap-2 text-xs text-gray-400 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={isOpen}
                    onChange={toggleDay}
                    className="w-4 h-4 accent-orange-500"
                  />
                  {t('adminSupportSettings.dayOpen')}
                </label>
              </div>
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <input
                    type="time"
                    value={start}
                    onChange={e => setFormData({ ...formData, [`${day}_start`]: e.target.value })}
                    className="flex-1 px-3 py-2 bg-gray-600 border border-gray-500 rounded text-white text-sm
                               focus:outline-none focus:border-orange-500 disabled:opacity-40"
                    disabled={!isOpen}
                  />
                  <span className="text-gray-400">{t('adminSupportSettings.dayTo')}</span>
                  <input
                    type="time"
                    value={end}
                    onChange={e => setFormData({ ...formData, [`${day}_end`]: e.target.value })}
                    className="flex-1 px-3 py-2 bg-gray-600 border border-gray-500 rounded text-white text-sm
                               focus:outline-none focus:border-orange-500 disabled:opacity-40"
                    disabled={!isOpen}
                  />
                </div>
              </div>
            </div>
          );
        })}
      </div>

      <button
        onClick={handleSave}
        className="flex items-center gap-2 px-4 py-2 bg-orange-600 hover:bg-orange-700
                   text-white rounded-lg transition font-medium"
      >
        <Save size={16} />
        {t('adminSupportSettings.saveChanges')}
      </button>
    </div>
  );
}

// Main Settings Page
export default function SupportSettingsPage() {
  const { t } = useTranslation();
  const { businessId } = useParams();
  const [activeTab, setActiveTab] = useState('general');
  const [settings, setSettings] = useState({});
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(null);
  const [saveStatus, setSaveStatus] = useState(null);
  // Bump after every successful save so the tab form remounts from the
  // freshly reloaded settings instead of showing stale pre-save values.
  const [settingsEpoch, setSettingsEpoch] = useState(0);

  const loadSettings = useCallback(async () => {
    setLoading(true);
    try {
      const res = await adminApi.get('/support/settings', {
        params: { business_id: businessId },
      });
      setSettings(res.data);
      setLoadError(null);
    } catch (err) {
      // Never fall back to editable defaults after a failed fetch: saving
      // from defaults would silently overwrite the real settings.
      console.error('Failed to load settings:', err);
      setLoadError(err);
    }
    setLoading(false);
  }, [businessId]);

  useEffect(() => {
    loadSettings();
  }, [loadSettings]);

  const handleUpdate = async (section, data) => {
    try {
      await adminApi.post(`/support/settings/${section}`, {
        ...data,
        business_id: businessId,
      });
      setSaveStatus('success');
      setTimeout(() => setSaveStatus(null), 3000);
      await loadSettings();
      setSettingsEpoch((epoch) => epoch + 1);
    } catch (err) {
      console.error('Failed to save settings:', err);
      setSaveStatus('error');
      setTimeout(() => setSaveStatus(null), 3000);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-screen">
        <div className="animate-spin w-8 h-8 border-4 border-orange-500 border-t-transparent rounded-full" />
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="p-6 max-w-5xl mx-auto">
        <AdminErrorState
          title={t('adminSupportSettings.loadErrorTitle')}
          message={loadError?.response?.data?.error || t('adminSupportSettings.loadErrorMessage')}
          onRetry={loadSettings}
        />
      </div>
    );
  }

  return (
    <div className="p-6 max-w-5xl mx-auto">
      <SupportSubNav />
      {/* Header */}
      <div className="flex items-start justify-between mb-8">
        <div>
          <h1 className="text-white font-bold text-3xl mb-2 flex items-center gap-2">
            <Settings size={28} className="text-orange-400" />
            {t('adminSupportSettings.pageTitle')}
          </h1>
          <p className="text-gray-400 text-sm">{t('adminSupportSettings.pageSubtitle')}</p>
        </div>
        {saveStatus && (
          <div className={`flex items-center gap-2 px-4 py-2 rounded-lg ${
            saveStatus === 'success'
              ? 'bg-green-900/30 text-green-400'
              : 'bg-red-900/30 text-red-400'
          }`}>
            {saveStatus === 'success' ? <CheckCircle size={18} /> : <AlertCircle size={18} />}
            {saveStatus === 'success' ? t('adminSupportSettings.savedSuccessfully') : t('adminSupportSettings.saveError')}
          </div>
        )}
      </div>

      {/* Settings Content */}
      <div className="bg-gray-800 border border-gray-700 rounded-xl p-6">
        <SettingsTabs activeTab={activeTab} setActiveTab={setActiveTab} />

        <div key={`${activeTab}-${settingsEpoch}`}>
          {activeTab === 'general' && <GeneralSettings settings={settings} onUpdate={handleUpdate} />}
          {activeTab === 'notifications' && <NotificationSettings settings={settings} onUpdate={handleUpdate} />}
          {activeTab === 'integrations' && <IntegrationSettings settings={settings} onUpdate={handleUpdate} />}
          {activeTab === 'automation' && <AutomationSettings settings={settings} onUpdate={handleUpdate} />}
          {activeTab === 'working-hours' && <WorkingHoursSettings settings={settings} onUpdate={handleUpdate} />}
        </div>
      </div>
    </div>
  );
}
