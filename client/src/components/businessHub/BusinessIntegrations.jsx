import React, { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import api from '../../api/axios';
import toast from 'react-hot-toast';
import { Settings, Copy, RefreshCw, Trash2, Plus, Check, X } from 'lucide-react';
import '../../styles/BusinessIntegrations.css';

const INTEGRATIONS = [
  {
    id: 'webhooks',
    nameKey: 'webhooks',
    description: 'Receive real-time notifications for events',
    icon: '🔗',
    status_field: 'webhooks_enabled'
  },
  {
    id: 'sms',
    nameKey: 'sms',
    description: 'Send appointment reminders via SMS',
    icon: '📱',
    status_field: 'sms_enabled'
  },
  {
    id: 'calendar',
    nameKey: 'calendar',
    description: 'Sync appointments to Google Calendar or Outlook',
    icon: '📅',
    status_field: 'calendar_sync_enabled'
  }
];

const WEBHOOK_EVENTS = [
  { id: 'appointment.created', nameKey: 'appointmentCreated', descriptionKey: 'appointmentCreatedDesc' },
  { id: 'appointment.confirmed', nameKey: 'appointmentConfirmed', descriptionKey: 'appointmentConfirmedDesc' },
  { id: 'appointment.completed', nameKey: 'appointmentCompleted', descriptionKey: 'appointmentCompletedDesc' },
  { id: 'appointment.cancelled', nameKey: 'appointmentCancelled', descriptionKey: 'appointmentCancelledDesc' },
  { id: 'payment.received', nameKey: 'paymentReceived', descriptionKey: 'paymentReceivedDesc' },
  { id: 'customer.joined', nameKey: 'newCustomer', descriptionKey: 'newCustomerDesc' },
  { id: 'review.received', nameKey: 'reviewReceived', descriptionKey: 'reviewReceivedDesc' }
];

export function BusinessIntegrations({ businessId }) {
  const { t } = useTranslation();
  const [integrations, setIntegrations] = useState({});
  const [loading, setLoading] = useState(false);
  const [webhooks, setWebhooks] = useState([]);
  const [showWebhookForm, setShowWebhookForm] = useState(false);
  const [webhookForm, setWebhookForm] = useState({
    url: '',
    events: []
  });
  const [savingIntegration, setSavingIntegration] = useState(null);
  const [newApiKey, setNewApiKey] = useState('');

  useEffect(() => {
    loadIntegrations();
  }, [businessId]);

  const loadIntegrations = async () => {
    try {
      setLoading(true);
      const [intRes, webhookRes] = await Promise.all([
        api.get(`/businesses/${businessId}/integrations`),
        api.get(`/businesses/${businessId}/webhooks`)
      ]);
      setIntegrations(intRes.data);
      setWebhooks(webhookRes.data || []);
    } catch (error) {
      toast.error(t('businessHub.integrations.toastLoadFail'));
    } finally {
      setLoading(false);
    }
  };

  const handleAddWebhook = async () => {
    if (!webhookForm.url || webhookForm.events.length === 0) {
      toast.error(t('businessHub.integrations.toastWebhookFieldsRequired'));
      return;
    }

    try {
      await api.post(
        `/businesses/${businessId}/webhooks`,
        webhookForm
      );
      toast.success(t('businessHub.integrations.toastWebhookCreated'));
      setShowWebhookForm(false);
      setWebhookForm({ url: '', events: [] });
      loadIntegrations();
    } catch (error) {
      toast.error(t('businessHub.integrations.toastWebhookCreateFail'));
    }
  };

  const handleDeleteWebhook = async (webhookId) => {
    if (!window.confirm(t('businessHub.integrations.confirmDeleteWebhook'))) return;

    try {
      await api.delete(
        `/businesses/${businessId}/webhooks/${webhookId}`
      );
      toast.success(t('businessHub.integrations.toastWebhookDeleted'));
      loadIntegrations();
    } catch (error) {
      toast.error(t('businessHub.integrations.toastWebhookDeleteFail'));
    }
  };

  const handleToggleSms = async () => {
    const nextEnabled = !integrations.sms_enabled;

    try {
      setSavingIntegration('sms');
      await api.patch(
        `/businesses/${businessId}/integrations/sms_notifications`,
        { enabled: nextEnabled }
      );
      toast.success(nextEnabled ? t('businessHub.integrations.smsEnabled') : t('businessHub.integrations.smsDisabled'));
      await loadIntegrations();
    } catch (error) {
      toast.error(error.response?.data?.error || t('businessHub.integrations.smsUpdateFailed'));
    } finally {
      setSavingIntegration(null);
    }
  };

  const handleRequestCalendarSetup = async () => {
    try {
      setSavingIntegration('calendar');
      await api.patch(
        `/businesses/${businessId}/integrations/google_calendar`,
        { enabled: true, setup_requested: true }
      );
      toast.success(t('businessHub.integrations.calendarSetupSaved'));
      await loadIntegrations();
    } catch (error) {
      toast.error(error.response?.data?.error || t('businessHub.integrations.calendarSetupFailed'));
    } finally {
      setSavingIntegration(null);
    }
  };

  const handleRegenerateApiKey = async () => {
    if (!window.confirm(t('businessHub.integrations.regenerateConfirm'))) return;

    try {
      setSavingIntegration('api-key');
      const response = await api.post(
        `/businesses/${businessId}/integrations/api-key/regenerate`
      );
      const apiKey = response.data?.api_key || '';
      setNewApiKey(apiKey);
      // The full key is shown once (newApiKey). The persistent record only
      // ever carries the masked form, so refresh it from a re-fetch instead
      // of storing the secret in component state.
      setIntegrations((current) => ({ ...current, api_key: undefined, api_key_masked: undefined }));
      toast.success(t('businessHub.integrations.apiKeyRegenerated'));
    } catch (error) {
      toast.error(error.response?.data?.error || t('businessHub.integrations.apiKeyRegenerateFailed'));
    } finally {
      setSavingIntegration(null);
    }
  };

  const toggleWebhookEvent = (eventId) => {
    setWebhookForm({
      ...webhookForm,
      events: webhookForm.events.includes(eventId)
        ? webhookForm.events.filter(e => e !== eventId)
        : [...webhookForm.events, eventId]
    });
  };

  const copyToClipboard = (text) => {
    navigator.clipboard.writeText(text);
    toast.success(t('common.copied'));
  };

  const handleFinishStripeSetup = async () => {
    try {
      setSavingIntegration('stripe');
      const response = await api.post(`/businesses/${businessId}/integrations/stripe/continue-setup`);
      if (response.data?.already_ready) {
        toast.success(t('businessHub.integrations.stripeReady', { defaultValue: 'Ready for card pay' }));
        await loadIntegrations();
        return;
      }
      const url = response.data?.url;
      if (!url) {
        throw new Error('missing_setup_url');
      }
      window.location.href = url;
    } catch (error) {
      toast.error(error.response?.data?.error || t('businessHub.integrations.toastStripeStartFail'));
    } finally {
      setSavingIntegration(null);
    }
  };

  const handleConnectStripe = async () => {
    try {
      setSavingIntegration('stripe');
      const response = await api.post(`/businesses/${businessId}/integrations/stripe/auth`);
      const url = response.data?.auth_url;
      if (!url) {
        throw new Error('missing_auth_url');
      }
      window.location.href = url;
    } catch (error) {
      toast.error(error.response?.data?.error || t('businessHub.integrations.toastStripeStartFail'));
    } finally {
      setSavingIntegration(null);
    }
  };

  const handleDisconnectStripe = async () => {
    if (!window.confirm(t('businessHub.integrations.confirmDisconnectStripe'))) return;
    try {
      setSavingIntegration('stripe');
      await api.post(`/businesses/${businessId}/integrations/stripe/disconnect`);
      toast.success(t('businessHub.integrations.toastStripeDisconnected'));
      await loadIntegrations();
    } catch (error) {
      toast.error(error.response?.data?.error || t('businessHub.integrations.toastStripeDisconnectFail'));
    } finally {
      setSavingIntegration(null);
    }
  };

  if (loading) {
    return <div className="bi-loading">{t('businessHub.integrations.loading')}</div>;
  }

  return (
    <div className="bi-container">
      <div className="bi-header">
        <h3>{t('businessHub.integrations.title')}</h3>
      </div>

      <div className={`bi-integration-card bi-stripe-connect-card ${integrations.stripe_ready_for_checkout ? 'enabled' : integrations.stripe_connected ? 'pending' : 'disabled'}`}>
        <div className="bi-integration-header">
          <span className="bi-integration-icon">💳</span>
          <h4>{t('businessHub.integrations.stripeTitle', { defaultValue: 'Stripe Connect' })}</h4>
          <span className={`bi-status-badge ${integrations.stripe_ready_for_checkout ? 'active' : 'inactive'}`}>
            {integrations.stripe_ready_for_checkout ? <Check size={14} /> : <X size={14} />}
            {integrations.stripe_ready_for_checkout
              ? t('businessHub.integrations.stripeReady', { defaultValue: 'Ready for card pay' })
              : integrations.stripe_connected
                ? t('businessHub.integrations.stripeIncomplete', { defaultValue: 'Onboarding incomplete' })
                : t('businessHub.integrations.notConnected')}
          </span>
        </div>
        <p className="bi-integration-desc">
          {t('businessHub.integrations.stripeDescription', {
            defaultValue: 'Connect Stripe so customers can pay invoices by card. Funds settle to your connected account.',
          })}
        </p>
        <div className="bi-integration-actions">
          {integrations.stripe_account_id && (
            <p className="bi-status-text">
              {t('businessHub.integrations.account')}: {integrations.stripe_account_id}
            </p>
          )}
          {integrations.stripe_connected && !integrations.stripe_ready_for_checkout && (
            <p className="bi-status-text bi-stripe-warning">
              {t('businessHub.integrations.stripeChargesDisabled', {
                defaultValue: 'Stripe is connected but card charges are not enabled yet. Finish requirements in Stripe to accept invoice card payments.',
              })}
            </p>
          )}
          {integrations.stripe_ready_for_checkout ? (
            <button
              type="button"
              className="bi-btn-danger"
              onClick={handleDisconnectStripe}
              disabled={savingIntegration === 'stripe'}
            >
              {savingIntegration === 'stripe' ? t('businessHub.integrations.saving') : t('businessHub.integrations.disconnectStripe')}
            </button>
          ) : integrations.stripe_connected ? (
            <button
              type="button"
              className="bi-btn-primary"
              onClick={handleFinishStripeSetup}
              disabled={savingIntegration === 'stripe'}
            >
              {savingIntegration === 'stripe' ? t('businessHub.integrations.saving') : t('businessHub.integrations.stripeFinishInStripe', { defaultValue: 'Open Stripe to finish requirements' })}
            </button>
          ) : (
            <button
              type="button"
              className="bi-btn-primary"
              onClick={handleConnectStripe}
              disabled={savingIntegration === 'stripe'}
            >
              {savingIntegration === 'stripe' ? t('businessHub.integrations.saving') : t('businessHub.integrations.connectStripe')}
            </button>
          )}
        </div>
      </div>

      <div className="bi-integrations-grid">
        {INTEGRATIONS.map(integration => {
          const isEnabled = integrations[integration.status_field];
          return (
            <div key={integration.id} className={`bi-integration-card ${isEnabled ? 'enabled' : 'disabled'}`}>
              <div className="bi-integration-header">
                <span className="bi-integration-icon">{integration.icon}</span>
                <h4>{t(`businessHub.integrations.cardNames.${integration.nameKey}`)}</h4>
                <span className={`bi-status-badge ${isEnabled ? 'active' : 'inactive'}`}>
                  {isEnabled ? <Check size={14} /> : <X size={14} />}
                  {isEnabled ? t('businessHub.integrations.connected') : t('businessHub.integrations.notConnected')}
                </span>
              </div>
              <p className="bi-integration-desc">{t(`businessHub.integrations.cards.${integration.id}.description`, { defaultValue: integration.description })}</p>

              {integration.id === 'webhooks' && (
                <div className="bi-integration-actions">
                  <p className="bi-status-text">
                    {t('businessHub.integrations.webhooksConfigured', { count: webhooks.length })}
                  </p>
                  <button
                    onClick={() => setShowWebhookForm(!showWebhookForm)}
                    className="bi-btn-secondary"
                  >
                    <Plus size={16} /> {t('businessHub.integrations.addWebhook')}
                  </button>
                </div>
              )}

              {integration.id === 'sms' && (
                <div className="bi-integration-actions">
                  <p className="bi-status-text">
                    {isEnabled ? t('businessHub.integrations.smsEnabled') : t('businessHub.integrations.smsPrompt')}
                  </p>
                  <button
                    className={isEnabled ? 'bi-btn-danger' : 'bi-btn-primary'}
                    onClick={handleToggleSms}
                    disabled={savingIntegration === 'sms'}
                  >
                    {savingIntegration === 'sms' ? t('businessHub.integrations.saving') : (isEnabled ? t('businessHub.integrations.disableSms') : t('businessHub.integrations.enableSms'))}
                  </button>
                </div>
              )}

              {integration.id === 'calendar' && (
                <div className="bi-integration-actions">
                  <p className="bi-status-text">
                    {integrations.calendar_setup_status === 'setup_requested'
                      ? t('businessHub.integrations.calendarSetupRequested')
                      : isEnabled ? t('businessHub.integrations.calendarSyncRequested') : t('businessHub.integrations.calendarSetupPrompt')}
                  </p>
                  <button
                    className="bi-btn-primary"
                    onClick={handleRequestCalendarSetup}
                    disabled={savingIntegration === 'calendar'}
                  >
                    <Settings size={16} /> {savingIntegration === 'calendar' ? t('businessHub.integrations.saving') : t('businessHub.integrations.requestSetup')}
                  </button>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {showWebhookForm && (
        <div className="bi-webhook-form-container">
          <h4>{t('businessHub.integrations.addWebhook')}</h4>
          
          <div className="bi-form-group">
            <label>{t('businessHub.integrations.webhookUrlRequired')}</label>
            <input
              type="url"
              value={webhookForm.url}
              onChange={(e) => setWebhookForm({ ...webhookForm, url: e.target.value })}
              placeholder={t('businessHub.integrations.webhookUrlPlaceholder')}
              required
            />
            <small>{t('businessHub.integrations.webhookUrlHint')}</small>
          </div>

          <div className="bi-form-group">
            <label>{t('businessHub.integrations.eventsRequired')}</label>
            <div className="bi-event-checkboxes">
              {WEBHOOK_EVENTS.map(event => (
                <label key={event.id} className="bi-checkbox-label">
                  <input
                    type="checkbox"
                    checked={webhookForm.events.includes(event.id)}
                    onChange={() => toggleWebhookEvent(event.id)}
                  />
                  <span className="bi-checkbox-text">
                    <strong>{t(`businessHub.integrations.events.${event.nameKey}`)}</strong>
                    <span className="bi-event-desc">{t(`businessHub.integrations.events.${event.descriptionKey}`)}</span>
                  </span>
                </label>
              ))}
            </div>
          </div>

          <div className="bi-form-buttons">
            <button onClick={() => setShowWebhookForm(false)} className="bi-btn-cancel">
              {t('common.cancel')}
            </button>
            <button onClick={handleAddWebhook} className="bi-btn-save">
              {t('businessHub.integrations.createWebhook')}
            </button>
          </div>
        </div>
      )}

      {webhooks.length > 0 && (
        <div className="bi-webhooks-list">
          <h4>{t('businessHub.integrations.activeWebhooks')}</h4>
          {webhooks.map(webhook => (
            <div key={webhook.id} className="bi-webhook-item">
              <div className="bi-webhook-info">
                <p className="bi-webhook-url">
                  {webhook.url}
                  <button
                    onClick={() => copyToClipboard(webhook.url)}
                    className="bi-btn-copy"
                    aria-label={t('businessHub.integrations.copyUrl')}
                  >
                    <Copy size={14} />
                  </button>
                </p>
                <p className="bi-webhook-events">
                  <strong>{t('businessHub.integrations.eventsLabel')}:</strong> {t('businessHub.integrations.subscribed', { count: webhook.events.length })}
                </p>
                <p className="bi-webhook-status">
                  {t('businessHub.integrations.lastDelivery')}: {webhook.last_delivery_at ? new Date(webhook.last_delivery_at).toLocaleDateString() : t('businessHub.integrations.never')}
                </p>
              </div>
              <button
                onClick={() => handleDeleteWebhook(webhook.id)}
                className="bi-btn-delete"
                aria-label={t('businessHub.integrations.deleteWebhook')}
              >
                <Trash2 size={16} />
              </button>
            </div>
          ))}
        </div>
      )}

      <div className="bi-settings-section">
        <h4>{t('businessHub.integrations.apiSettings')}</h4>
        
        <div className="bi-setting-item">
          <div className="bi-setting-info">
            <h5>{t('businessHub.integrations.apiKey')}</h5>
            <p>{newApiKey ? t('businessHub.integrations.copyKeyHint') : t('businessHub.integrations.apiKeyHint')}</p>
          </div>
          <div className="bi-setting-value">
            <code>{newApiKey || integrations.api_key_masked || t('businessHub.integrations.noApiKey')}</code>
            <button
              onClick={() => copyToClipboard(newApiKey || '')}
              className="bi-btn-copy"
              disabled={!newApiKey}
              title={newApiKey ? undefined : t('businessHub.integrations.maskedKeyNoCopy')}
            >
              <Copy size={14} />
            </button>
          </div>
        </div>

        <div className="bi-setting-item">
          <div className="bi-setting-info">
            <h5>{t('businessHub.integrations.regenerateApiKey')}</h5>
            <p>{t('businessHub.integrations.regenerateApiKeyHint')}</p>
          </div>
          <button
            onClick={handleRegenerateApiKey}
            className="bi-btn-secondary"
            disabled={savingIntegration === 'api-key'}
          >
            <RefreshCw size={16} /> {savingIntegration === 'api-key' ? t('businessHub.integrations.regenerating') : t('businessHub.integrations.regenerate')}
          </button>
        </div>
      </div>
    </div>
  );
}
