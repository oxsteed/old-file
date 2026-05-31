import React, { useState, useEffect } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import axios from 'axios';
import PageMeta from '../../components/PageMeta';
import { useTranslation } from 'react-i18next';

export default function SMSPreferences() {
  const { t } = useTranslation();
  const [phoneInput, setPhoneInput] = useState('');
  const [showOtpInput, setShowOtpInput] = useState(false);
  const [otpCode, setOtpCode] = useState('');
  const [countdownTimer, setCountdownTimer] = useState(0);
  const [showSuccess, setShowSuccess] = useState(false);
  const [smsEnabled, setSmsEnabled] = useState(true);
  const [notificationTypes, setNotificationTypes] = useState({
    orderCreated: true,
    paymentConfirmed: true,
    orderShipped: true,
    orderCancelled: true,
    orderRefunded: true,
  });

  // Fetch SMS preferences
  const { data: preferences, isLoading, refetch } = useQuery({
    queryKey: ['smsPreferences'],
    queryFn: async () => {
      const res = await axios.get('/api/notifications/sms/preferences');
      return res.data.data;
    },
  });

  // Populate form when preferences load
  useEffect(() => {
    if (preferences) {
      setPhoneInput(preferences.phoneNumber || '');
      setSmsEnabled(preferences.smsEnabled !== false);
      setNotificationTypes(preferences.notificationTypes || {});
    }
  }, [preferences]);

  // Countdown timer for OTP resend
  useEffect(() => {
    if (countdownTimer > 0) {
      const timer = setTimeout(() => setCountdownTimer(countdownTimer - 1), 1000);
      return () => clearTimeout(timer);
    }
  }, [countdownTimer]);

  // Request phone verification mutation
  const requestVerificationMutation = useMutation({
    mutationFn: async () => {
      await axios.post('/api/notifications/sms/request-verification', {
        phoneNumber: formatPhoneNumber(phoneInput),
      });
    },
    onSuccess: () => {
      setShowOtpInput(true);
      setCountdownTimer(60);
      setOtpCode('');
    },
    onError: (error) => {
      alert(`${t('common.error')}: ${error.response?.data?.error || error.message}`);
    },
  });

  // Verify OTP mutation
  const verifyOtpMutation = useMutation({
    mutationFn: async () => {
      await axios.post('/api/notifications/sms/verify-otp', {
        otp: otpCode,
      });
    },
    onSuccess: () => {
      setShowSuccess(true);
      setShowOtpInput(false);
      setOtpCode('');
      refetch();
      setTimeout(() => setShowSuccess(false), 3000);
    },
    onError: (error) => {
      alert(`${t('common.error')}: ${error.response?.data?.error || t('smsPreferences.invalidOtp')}`);
      setOtpCode('');
    },
  });

  // Update preferences mutation
  const updateMutation = useMutation({
    mutationFn: async () => {
      await axios.put('/api/notifications/sms/preferences', {
        smsEnabled,
        notificationTypes,
      });
    },
    onSuccess: () => {
      setShowSuccess(true);
      setTimeout(() => setShowSuccess(false), 3000);
    },
    onError: (error) => {
      alert(`${t('common.error')}: ${error.response?.data?.error || error.message}`);
    },
  });

  const handlePhoneChange = (e) => {
    setPhoneInput(e.target.value.replace(/\D/g, ''));
  };

  const formatPhoneNumber = (phone) => {
    const cleaned = phone.replace(/\D/g, '');
    if (cleaned.length === 10) {
      return `+1${cleaned}`;
    } else if (cleaned.length === 11) {
      return `+${cleaned}`;
    }
    return `+${cleaned}`;
  };

  const handleToggleNotificationType = (type) => {
    setNotificationTypes({
      ...notificationTypes,
      [type]: !notificationTypes[type],
    });
  };

  if (isLoading) {
    return (
      <div className="min-h-screen bg-gray-50 dark:bg-gray-900 p-6">
        <PageMeta title={t('smsPreferences.metaTitle')} description={t('smsPreferences.metaDescription')} />
        <div className="flex items-center justify-center h-64">
          <div className="animate-spin rounded-full h-8 w-8 border-4 border-gray-300 border-t-blue-600"></div>
        </div>
      </div>
    );
  }

  const phoneVerified = preferences?.phoneVerified || false;

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900">
      <PageMeta title={t('smsPreferences.metaTitle')} description={t('smsPreferences.metaDescription')} />

      <div className="mx-auto max-w-3xl px-4 py-12">
        {/* Header */}
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-gray-900 dark:text-white">{t('smsPreferences.title')}</h1>
          <p className="mt-2 text-gray-600 dark:text-gray-400">
            {t('smsPreferences.subtitle')}
          </p>
        </div>

        {/* Success Message */}
        {showSuccess && (
          <div className="mb-6 rounded-lg bg-green-50 p-4 text-green-800 dark:bg-green-900 dark:text-green-100">
            <p className="font-medium">{t('smsPreferences.saved')}</p>
          </div>
        )}

        {/* Phone Number Setup */}
        <Card title={t('smsPreferences.phone.title')} description={t('smsPreferences.phone.description')}>
          {!phoneVerified ? (
            <div className="space-y-4">
              {!showOtpInput ? (
                <>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                      {t('smsPreferences.phone.label')}
                    </label>
                    <input
                      type="tel"
                      placeholder={t('smsPreferences.phone.placeholder')}
                      value={phoneInput}
                      onChange={handlePhoneChange}
                      maxLength="15"
                      className="w-full rounded-lg border border-gray-300 bg-white px-4 py-2 text-gray-900 placeholder-gray-500 dark:border-gray-600 dark:bg-gray-700 dark:text-white dark:placeholder-gray-400"
                    />
                    <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                      {t('smsPreferences.phone.formatHelp')}
                    </p>
                  </div>
                  <button
                    onClick={() => requestVerificationMutation.mutate()}
                    disabled={phoneInput.length < 10 || requestVerificationMutation.isPending}
                    className="w-full rounded-lg bg-blue-600 px-4 py-2 text-white hover:bg-blue-700 disabled:opacity-50 font-medium transition"
                  >
                    {requestVerificationMutation.isPending ? t('smsPreferences.phone.sending') : t('smsPreferences.phone.sendCode')}
                  </button>
                </>
              ) : (
                <>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                      {t('smsPreferences.otp.label')}
                    </label>
                    <p className="text-sm text-gray-600 dark:text-gray-400 mb-3">
                      {t('smsPreferences.otp.help')}
                    </p>
                    <input
                      type="text"
                      placeholder="000000"
                      value={otpCode}
                      onChange={(e) => setOtpCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                      maxLength="6"
                      className="w-full rounded-lg border border-gray-300 bg-white px-4 py-3 text-2xl text-center font-mono tracking-widest text-gray-900 placeholder-gray-500 dark:border-gray-600 dark:bg-gray-700 dark:text-white dark:placeholder-gray-400"
                    />
                  </div>
                  <div className="flex gap-2">
                    <button
                      onClick={() => verifyOtpMutation.mutate()}
                      disabled={otpCode.length !== 6 || verifyOtpMutation.isPending}
                      className="flex-1 rounded-lg bg-blue-600 px-4 py-2 text-white hover:bg-blue-700 disabled:opacity-50 font-medium transition"
                    >
                      {verifyOtpMutation.isPending ? t('smsPreferences.otp.verifying') : t('smsPreferences.otp.verify')}
                    </button>
                    <button
                      onClick={() => {
                        setShowOtpInput(false);
                        setOtpCode('');
                      }}
                      className="flex-1 rounded-lg border border-gray-300 px-4 py-2 hover:bg-gray-100 dark:border-gray-600 dark:hover:bg-gray-700 font-medium transition"
                    >
                      {t('common.cancel')}
                    </button>
                  </div>
                  <p className="text-xs text-gray-500 dark:text-gray-400 text-center">
                    {countdownTimer > 0 ? (
                      <>{t('smsPreferences.otp.resendIn', { seconds: countdownTimer })}</>
                    ) : (
                      <button
                        onClick={() => requestVerificationMutation.mutate()}
                        className="text-blue-600 hover:text-blue-700 font-medium"
                      >
                        {t('smsPreferences.otp.resend')}
                      </button>
                    )}
                  </p>
                </>
              )}
            </div>
          ) : (
            <div className="flex items-center justify-between p-4 bg-green-50 dark:bg-green-900 rounded-lg border border-green-200 dark:border-green-700">
              <div>
                <p className="font-medium text-green-900 dark:text-green-100">{t('smsPreferences.phone.verified')}</p>
                <p className="text-sm text-green-700 dark:text-green-200">{preferences?.phoneNumber}</p>
              </div>
              <button
                onClick={() => setShowOtpInput(true)}
                className="text-green-700 hover:text-green-800 dark:text-green-300 dark:hover:text-green-200 font-medium text-sm"
              >
                {t('common.edit')}
              </button>
            </div>
          )}
        </Card>

        {/* SMS Notifications Enable/Disable */}
        {phoneVerified && (
          <>
            <Card title={t('smsPreferences.enabled.title')} description={t('smsPreferences.enabled.description')}>
              <div className="flex items-center justify-between p-4 rounded-lg border border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-700 transition">
                <div>
                  <p className="font-medium text-gray-900 dark:text-white">{t('smsPreferences.enabled.receiveTitle')}</p>
                  <p className="text-sm text-gray-600 dark:text-gray-400">{t('smsPreferences.enabled.receiveDesc')}</p>
                </div>
                <label className="relative inline-flex items-center cursor-pointer">
                  <input
                    type="checkbox"
                    checked={smsEnabled}
                    onChange={(e) => setSmsEnabled(e.target.checked)}
                    className="sr-only peer"
                  />
                  <div className="w-11 h-6 bg-gray-300 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-blue-300 dark:peer-focus:ring-blue-800 rounded-full peer dark:bg-gray-700 peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all dark:border-gray-600 peer-checked:bg-blue-600"></div>
                </label>
              </div>
            </Card>

            {/* Notification Types */}
            {smsEnabled && (
              <Card title={t('smsPreferences.types.title')} description={t('smsPreferences.types.description')}>
                <div className="space-y-3">
                  {[
                    { key: 'orderCreated', label: t('smsPreferences.types.orderCreated.label'), desc: t('smsPreferences.types.orderCreated.desc') },
                    { key: 'paymentConfirmed', label: t('smsPreferences.types.paymentConfirmed.label'), desc: t('smsPreferences.types.paymentConfirmed.desc') },
                    { key: 'orderShipped', label: t('smsPreferences.types.orderShipped.label'), desc: t('smsPreferences.types.orderShipped.desc') },
                    { key: 'orderCancelled', label: t('smsPreferences.types.orderCancelled.label'), desc: t('smsPreferences.types.orderCancelled.desc') },
                    { key: 'orderRefunded', label: t('smsPreferences.types.orderRefunded.label'), desc: t('smsPreferences.types.orderRefunded.desc') },
                  ].map((item) => (
                    <label
                      key={item.key}
                      className="flex items-start gap-3 p-3 rounded-lg border border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-700 cursor-pointer transition"
                    >
                      <input
                        type="checkbox"
                        checked={notificationTypes[item.key] || false}
                        onChange={() => handleToggleNotificationType(item.key)}
                        className="mt-1 h-4 w-4 text-blue-600"
                      />
                      <div>
                        <p className="font-medium text-gray-900 dark:text-white">{item.label}</p>
                        <p className="text-sm text-gray-600 dark:text-gray-400">{item.desc}</p>
                      </div>
                    </label>
                  ))}
                </div>
              </Card>
            )}

            {/* Save Button */}
            <div className="mt-8">
              <button
                onClick={() => updateMutation.mutate()}
                disabled={updateMutation.isPending}
                className="w-full rounded-lg bg-blue-600 px-6 py-3 text-white hover:bg-blue-700 disabled:opacity-50 font-medium transition text-lg"
              >
                {updateMutation.isPending ? t('common.saving') : t('smsPreferences.save')}
              </button>
            </div>
          </>
        )}

        {/* Info */}
        <div className="mt-8 rounded-lg bg-blue-50 dark:bg-blue-900 p-4 text-sm text-blue-800 dark:text-blue-100">
          <p>
            <strong>{t('smsPreferences.notePrefix')}:</strong> {t('smsPreferences.note')}
          </p>
        </div>
      </div>
    </div>
  );
}

function Card({ title, description, children }) {
  return (
    <div className="mb-6 rounded-lg border border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-800 p-6">
      <h2 className="text-xl font-semibold text-gray-900 dark:text-white">{title}</h2>
      <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">{description}</p>
      <div className="mt-4">{children}</div>
    </div>
  );
}
