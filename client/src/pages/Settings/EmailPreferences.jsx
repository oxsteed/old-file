import React, { useState, useEffect } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import axios from 'axios';
import PageMeta from '../../components/PageMeta';
import { useAuth } from '../../hooks/useAuth';

export default function EmailPreferences() {
  const { user } = useAuth();
  const [showSuccess, setShowSuccess] = useState(false);
  const [frequency, setFrequency] = useState('real-time');
  const [emailNotifications, setEmailNotifications] = useState(true);
  const [marketingEmails, setMarketingEmails] = useState(true);
  const [smsNotifications, setSmsNotifications] = useState(true);
  const [pushNotifications, setPushNotifications] = useState(true);

  // Fetch preferences
  const { data: preferences, isLoading } = useQuery({
    queryKey: ['emailPreferences'],
    queryFn: async () => {
      const res = await axios.get('/api/notifications/email');
      return res.data.data;
    },
  });

  // Populate form when preferences load
  useEffect(() => {
    if (preferences) {
      setFrequency(preferences.frequency || 'real-time');
      setEmailNotifications(preferences.emailNotifications !== false);
      setMarketingEmails(preferences.marketingEmails !== false);
      setSmsNotifications(preferences.smsNotifications !== false);
      setPushNotifications(preferences.pushNotifications !== false);
    }
  }, [preferences]);

  // Update preferences mutation
  const updateMutation = useMutation({
    mutationFn: async () => {
      await axios.put('/api/notifications/email', {
        frequency,
        emailNotifications,
        marketingEmails,
        smsNotifications,
        pushNotifications,
      });
    },
    onSuccess: () => {
      setShowSuccess(true);
      setTimeout(() => setShowSuccess(false), 3000);
    },
    onError: (error) => {
      alert(`Error: ${error.response?.data?.error || error.message}`);
    },
  });

  // Unsubscribe mutation
  const unsubscribeMutation = useMutation({
    mutationFn: async () => {
      await axios.post('/api/notifications/email/unsubscribe-all');
    },
    onSuccess: () => {
      alert('You have been unsubscribed from all emails');
      window.location.reload();
    },
    onError: (error) => {
      alert(`Error: ${error.response?.data?.error || error.message}`);
    },
  });

  if (isLoading) {
    return (
      <div className="min-h-screen bg-gray-50 dark:bg-gray-900 p-6">
        <PageMeta title="Email Preferences" description="Manage your email notifications" />
        <div className="flex items-center justify-center h-64">
          <div className="animate-spin rounded-full h-8 w-8 border-4 border-gray-300 border-t-blue-600"></div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900">
      <PageMeta title="Email Preferences" description="Manage your email notifications" />

      <div className="mx-auto max-w-3xl px-4 py-12">
        {/* Header */}
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-gray-900 dark:text-white">Email Preferences</h1>
          <p className="mt-2 text-gray-600 dark:text-gray-400">
            Control how and when you receive email notifications from OxSteed
          </p>
        </div>

        {/* Success Message */}
        {showSuccess && (
          <div className="mb-6 rounded-lg bg-green-50 p-4 text-green-800 dark:bg-green-900 dark:text-green-100">
            <p className="font-medium">✓ Your preferences have been saved</p>
          </div>
        )}

        {/* Email Frequency */}
        <Card title="Email Frequency" description="Choose how frequently you want to receive notifications">
          <div className="space-y-3">
            {[
              { value: 'real-time', label: 'Real-time', description: 'Receive emails immediately' },
              { value: 'daily', label: 'Daily Digest', description: 'Receive one email per day with all updates' },
              { value: 'weekly', label: 'Weekly Digest', description: 'Receive one email per week' },
              { value: 'off', label: 'Off', description: 'Disable all email notifications' },
            ].map((option) => (
              <label key={option.value} className="flex items-start gap-3 p-3 rounded-lg border-2 border-gray-200 dark:border-gray-700 cursor-pointer transition hover:bg-gray-100 dark:hover:bg-gray-800" style={{ borderColor: frequency === option.value ? '#3b82f6' : undefined, backgroundColor: frequency === option.value ? '#eff6ff' : undefined }}>
                <input
                  type="radio"
                  name="frequency"
                  value={option.value}
                  checked={frequency === option.value}
                  onChange={(e) => setFrequency(e.target.value)}
                  className="mt-1 h-4 w-4 text-blue-600"
                />
                <div>
                  <p className="font-medium text-gray-900 dark:text-white">{option.label}</p>
                  <p className="text-sm text-gray-600 dark:text-gray-400">{option.description}</p>
                </div>
              </label>
            ))}
          </div>
        </Card>

        {/* Notification Categories */}
        <Card title="Notification Categories" description="Choose which types of emails you want to receive">
          <div className="space-y-4">
            <ToggleOption
              label="Order Updates"
              description="Notifications about your orders, payments, and shipments"
              checked={emailNotifications}
              onChange={setEmailNotifications}
            />
            <ToggleOption
              label="Marketing Emails"
              description="New products, promotions, and exclusive offers"
              checked={marketingEmails}
              onChange={setMarketingEmails}
            />
            <ToggleOption
              label="SMS Notifications"
              description="Order and account updates via SMS (requires phone verification)"
              checked={smsNotifications}
              onChange={setSmsNotifications}
            />
            <ToggleOption
              label="Push Notifications"
              description="Browser and app notifications"
              checked={pushNotifications}
              onChange={setPushNotifications}
            />
          </div>
        </Card>

        {/* Danger Zone */}
        <Card title="Unsubscribe" description="Unsubscribe from all emails" variant="danger">
          <p className="text-sm text-gray-600 dark:text-gray-400 mb-4">
            This will unsubscribe you from all marketing and transactional emails. You can re-subscribe anytime.
          </p>
          <button
            onClick={() => {
              if (confirm('Are you sure you want to unsubscribe from all emails?')) {
                unsubscribeMutation.mutate();
              }
            }}
            disabled={unsubscribeMutation.isPending}
            className="rounded-lg bg-red-600 px-4 py-2 text-white hover:bg-red-700 disabled:opacity-50 font-medium transition"
          >
            {unsubscribeMutation.isPending ? 'Unsubscribing...' : 'Unsubscribe from All Emails'}
          </button>
        </Card>

        {/* Save Button */}
        <div className="mt-8">
          <button
            onClick={() => updateMutation.mutate()}
            disabled={updateMutation.isPending}
            className="w-full rounded-lg bg-blue-600 px-6 py-3 text-white hover:bg-blue-700 disabled:opacity-50 font-medium transition text-lg"
          >
            {updateMutation.isPending ? 'Saving...' : 'Save Preferences'}
          </button>
        </div>

        {/* Info */}
        <div className="mt-8 rounded-lg bg-blue-50 dark:bg-blue-900 p-4 text-sm text-blue-800 dark:text-blue-100">
          <p>
            <strong>Note:</strong> Transactional emails (order confirmations, password resets, etc.) will always be sent regardless of your preferences.
          </p>
        </div>
      </div>
    </div>
  );
}

function Card({ title, description, children, variant = 'default' }) {
  const bgClass = {
    default: 'bg-white dark:bg-gray-800 border-gray-200 dark:border-gray-700',
    danger: 'bg-red-50 dark:bg-red-900 border-red-200 dark:border-red-700',
  }[variant];

  return (
    <div className={`mb-6 rounded-lg border ${bgClass} p-6`}>
      <h2 className="text-xl font-semibold text-gray-900 dark:text-white">{title}</h2>
      <p className={`mt-1 text-sm ${variant === 'danger' ? 'text-red-700 dark:text-red-100' : 'text-gray-600 dark:text-gray-400'}`}>
        {description}
      </p>
      <div className="mt-4">{children}</div>
    </div>
  );
}

function ToggleOption({ label, description, checked, onChange }) {
  return (
    <div className="flex items-center justify-between p-4 rounded-lg border border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-700 transition">
      <div>
        <p className="font-medium text-gray-900 dark:text-white">{label}</p>
        <p className="text-sm text-gray-600 dark:text-gray-400">{description}</p>
      </div>
      <label className="relative inline-flex items-center cursor-pointer">
        <input
          type="checkbox"
          checked={checked}
          onChange={(e) => onChange(e.target.checked)}
          className="sr-only peer"
        />
        <div className="w-11 h-6 bg-gray-300 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-blue-300 dark:peer-focus:ring-blue-800 rounded-full peer dark:bg-gray-700 peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all dark:border-gray-600 peer-checked:bg-blue-600"></div>
      </label>
    </div>
  );
}
