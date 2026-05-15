import React, { useState, useEffect } from 'react';
import { axiosInstance } from '../../api/axios';
import toast from 'react-hot-toast';
import { Settings, Copy, RefreshCw, Link2, Trash2, Plus, Check, X } from 'lucide-react';
import '../../styles/BusinessIntegrations.css';

const INTEGRATIONS = [
  {
    id: 'stripe',
    name: 'Stripe Connect',
    description: 'Accept payments and manage payouts',
    icon: '💳',
    status_field: 'stripe_connected'
  },
  {
    id: 'webhooks',
    name: 'Webhooks',
    description: 'Receive real-time notifications for events',
    icon: '🔗',
    status_field: 'webhooks_enabled'
  },
  {
    id: 'sms',
    name: 'SMS Notifications',
    description: 'Send appointment reminders via SMS',
    icon: '📱',
    status_field: 'sms_enabled'
  },
  {
    id: 'calendar',
    name: 'Calendar Sync',
    description: 'Sync appointments to Google Calendar or Outlook',
    icon: '📅',
    status_field: 'calendar_sync_enabled'
  }
];

const WEBHOOK_EVENTS = [
  { id: 'appointment.created', name: 'Appointment Created', description: 'When a new appointment is booked' },
  { id: 'appointment.confirmed', name: 'Appointment Confirmed', description: 'When customer confirms appointment' },
  { id: 'appointment.completed', name: 'Appointment Completed', description: 'When appointment is finished' },
  { id: 'appointment.cancelled', name: 'Appointment Cancelled', description: 'When appointment is cancelled' },
  { id: 'payment.received', name: 'Payment Received', description: 'When payment is received' },
  { id: 'customer.joined', name: 'New Customer', description: 'When a new customer signs up' },
  { id: 'review.received', name: 'Review Received', description: 'When customer leaves a review' }
];

export function BusinessIntegrations({ businessId }) {
  const [integrations, setIntegrations] = useState({});
  const [loading, setLoading] = useState(false);
  const [webhooks, setWebhooks] = useState([]);
  const [showWebhookForm, setShowWebhookForm] = useState(false);
  const [webhookForm, setWebhookForm] = useState({
    url: '',
    events: []
  });
  const [stripeAuthUrl, setStripeAuthUrl] = useState(null);

  useEffect(() => {
    loadIntegrations();
  }, [businessId]);

  const loadIntegrations = async () => {
    try {
      setLoading(true);
      const [intRes, webhookRes] = await Promise.all([
        axiosInstance.get(`/api/businesses/${businessId}/integrations`),
        axiosInstance.get(`/api/businesses/${businessId}/webhooks`)
      ]);
      setIntegrations(intRes.data);
      setWebhooks(webhookRes.data || []);
    } catch (error) {
      toast.error('Failed to load integrations');
    } finally {
      setLoading(false);
    }
  };

  const handleStripeConnect = async () => {
    try {
      const response = await axiosInstance.post(
        `/api/businesses/${businessId}/integrations/stripe/auth`
      );
      window.location.href = response.data.auth_url;
    } catch (error) {
      toast.error('Failed to initiate Stripe connection');
    }
  };

  const handleDisconnectStripe = async () => {
    if (!window.confirm('Disconnect Stripe? You will need to reconnect to accept payments.')) return;
    
    try {
      await axiosInstance.post(
        `/api/businesses/${businessId}/integrations/stripe/disconnect`
      );
      toast.success('Stripe disconnected');
      loadIntegrations();
    } catch (error) {
      toast.error('Failed to disconnect Stripe');
    }
  };

  const handleAddWebhook = async () => {
    if (!webhookForm.url || webhookForm.events.length === 0) {
      toast.error('Please fill in all fields');
      return;
    }

    try {
      await axiosInstance.post(
        `/api/businesses/${businessId}/webhooks`,
        webhookForm
      );
      toast.success('Webhook created');
      setShowWebhookForm(false);
      setWebhookForm({ url: '', events: [] });
      loadIntegrations();
    } catch (error) {
      toast.error('Failed to create webhook');
    }
  };

  const handleDeleteWebhook = async (webhookId) => {
    if (!window.confirm('Delete this webhook?')) return;

    try {
      await axiosInstance.delete(
        `/api/businesses/${businessId}/webhooks/${webhookId}`
      );
      toast.success('Webhook deleted');
      loadIntegrations();
    } catch (error) {
      toast.error('Failed to delete webhook');
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
    toast.success('Copied to clipboard');
  };

  if (loading) {
    return <div className="bi-loading">Loading integrations...</div>;
  }

  return (
    <div className="bi-container">
      <div className="bi-header">
        <h3>Integrations & Settings</h3>
      </div>

      <div className="bi-integrations-grid">
        {INTEGRATIONS.map(integration => {
          const isEnabled = integrations[integration.status_field];
          return (
            <div key={integration.id} className={`bi-integration-card ${isEnabled ? 'enabled' : 'disabled'}`}>
              <div className="bi-integration-header">
                <span className="bi-integration-icon">{integration.icon}</span>
                <h4>{integration.name}</h4>
                <span className={`bi-status-badge ${isEnabled ? 'active' : 'inactive'}`}>
                  {isEnabled ? <Check size={14} /> : <X size={14} />}
                  {isEnabled ? 'Connected' : 'Not Connected'}
                </span>
              </div>
              <p className="bi-integration-desc">{integration.description}</p>

              {integration.id === 'stripe' && (
                <div className="bi-integration-actions">
                  {isEnabled ? (
                    <>
                      <div className="bi-stripe-info">
                        <p className="bi-connected-as">
                          <strong>Account:</strong> {integrations.stripe_account_id}
                        </p>
                      </div>
                      <button
                        onClick={handleDisconnectStripe}
                        className="bi-btn-danger"
                      >
                        Disconnect Stripe
                      </button>
                    </>
                  ) : (
                    <button
                      onClick={handleStripeConnect}
                      className="bi-btn-primary"
                    >
                      <Link2 size={16} /> Connect Stripe
                    </button>
                  )}
                </div>
              )}

              {integration.id === 'webhooks' && (
                <div className="bi-integration-actions">
                  <p className="bi-status-text">
                    {webhooks.length} webhook{webhooks.length !== 1 ? 's' : ''} configured
                  </p>
                  <button
                    onClick={() => setShowWebhookForm(!showWebhookForm)}
                    className="bi-btn-secondary"
                  >
                    <Plus size={16} /> Add Webhook
                  </button>
                </div>
              )}

              {integration.id === 'sms' && (
                <div className="bi-integration-actions">
                  <p className="bi-status-text">
                    {isEnabled ? 'SMS reminders enabled' : 'Enable SMS reminders for customers'}
                  </p>
                  <button
                    className={isEnabled ? 'bi-btn-danger' : 'bi-btn-primary'}
                    onClick={() => toast.info('SMS configuration in settings')}
                  >
                    {isEnabled ? 'Disable' : 'Enable'} SMS
                  </button>
                </div>
              )}

              {integration.id === 'calendar' && (
                <div className="bi-integration-actions">
                  <p className="bi-status-text">
                    {isEnabled ? 'Calendar sync active' : 'Connect your calendar account'}
                  </p>
                  <button
                    className="bi-btn-primary"
                    onClick={() => toast.info('Calendar setup coming soon')}
                  >
                    <Settings size={16} /> Configure
                  </button>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {showWebhookForm && (
        <div className="bi-webhook-form-container">
          <h4>Add Webhook</h4>
          
          <div className="bi-form-group">
            <label>Webhook URL *</label>
            <input
              type="url"
              value={webhookForm.url}
              onChange={(e) => setWebhookForm({ ...webhookForm, url: e.target.value })}
              placeholder="https://your-api.example.com/webhooks"
              required
            />
            <small>HTTPS URLs only. We'll POST events to this URL.</small>
          </div>

          <div className="bi-form-group">
            <label>Events to Subscribe To *</label>
            <div className="bi-event-checkboxes">
              {WEBHOOK_EVENTS.map(event => (
                <label key={event.id} className="bi-checkbox-label">
                  <input
                    type="checkbox"
                    checked={webhookForm.events.includes(event.id)}
                    onChange={() => toggleWebhookEvent(event.id)}
                  />
                  <span className="bi-checkbox-text">
                    <strong>{event.name}</strong>
                    <span className="bi-event-desc">{event.description}</span>
                  </span>
                </label>
              ))}
            </div>
          </div>

          <div className="bi-form-buttons">
            <button onClick={() => setShowWebhookForm(false)} className="bi-btn-cancel">
              Cancel
            </button>
            <button onClick={handleAddWebhook} className="bi-btn-save">
              Create Webhook
            </button>
          </div>
        </div>
      )}

      {webhooks.length > 0 && (
        <div className="bi-webhooks-list">
          <h4>Active Webhooks</h4>
          {webhooks.map(webhook => (
            <div key={webhook.id} className="bi-webhook-item">
              <div className="bi-webhook-info">
                <p className="bi-webhook-url">
                  {webhook.url}
                  <button
                    onClick={() => copyToClipboard(webhook.url)}
                    className="bi-btn-copy"
                    aria-label="Copy URL"
                  >
                    <Copy size={14} />
                  </button>
                </p>
                <p className="bi-webhook-events">
                  <strong>Events:</strong> {webhook.events.length} subscribed
                </p>
                <p className="bi-webhook-status">
                  Last delivery: {webhook.last_delivery_at ? new Date(webhook.last_delivery_at).toLocaleDateString() : 'Never'}
                </p>
              </div>
              <button
                onClick={() => handleDeleteWebhook(webhook.id)}
                className="bi-btn-delete"
                aria-label="Delete webhook"
              >
                <Trash2 size={16} />
              </button>
            </div>
          ))}
        </div>
      )}

      <div className="bi-settings-section">
        <h4>API & Developer Settings</h4>
        
        <div className="bi-setting-item">
          <div className="bi-setting-info">
            <h5>API Key</h5>
            <p>Use this key for direct API access</p>
          </div>
          <div className="bi-setting-value">
            <code>{integrations.api_key || 'sk_' + 'x'.repeat(32)}</code>
            <button
              onClick={() => copyToClipboard(integrations.api_key || '')}
              className="bi-btn-copy"
            >
              <Copy size={14} />
            </button>
          </div>
        </div>

        <div className="bi-setting-item">
          <div className="bi-setting-info">
            <h5>Regenerate API Key</h5>
            <p>Create a new API key. Old key will be invalidated.</p>
          </div>
          <button
            onClick={() => toast.info('API key regeneration feature coming soon')}
            className="bi-btn-secondary"
          >
            <RefreshCw size={16} /> Regenerate
          </button>
        </div>
      </div>
    </div>
  );
}
