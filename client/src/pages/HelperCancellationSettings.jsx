import React, { useState, useEffect, useMemo, useRef } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  ShieldCheck,
  Banknote,
  ChevronRight,
  Info,
  RotateCcw,
  Check,
  Clock3,
  Wallet,
  FileText,
  History,
} from 'lucide-react';
import api from '../api/axios';
import toast from 'react-hot-toast';
import PageShell from '../components/PageShell';
import PageMeta from '../components/PageMeta';
import './HelperCancellationSettings.css';

const DEFAULT_CUSTOM_POLICY = { deposit_percent: 50, terms: '', min_notice_hours: 48 };

function Toggle({ checked, onChange, label }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      className={`pcs-toggle${checked ? ' is-on' : ''}`}
      onClick={() => onChange(!checked)}
    >
      <span className="pcs-toggle-knob" aria-hidden="true" />
    </button>
  );
}

function StatusPill({ active, t }) {
  return (
    <span className={`pcs-status${active ? ' is-on' : ''}`}>
      <span className="pcs-status-dot" aria-hidden="true" />
      {active ? t('cancellationSettings.statusOn') : t('cancellationSettings.statusOff')}
    </span>
  );
}

function formatHistoryDate(iso, locale) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso || '';
  try {
    return new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' }).format(d);
  } catch {
    return d.toLocaleString();
  }
}

function historyChangeText(change, t) {
  const kind = change?.kind;
  const label = change?.label || '';
  switch (kind) {
    case 'payment_method_added':
      return t('cancellationSettings.historyPaymentMethodAdded', 'Added payment method "{{label}}"', { label });
    case 'payment_method_removed':
      return t('cancellationSettings.historyPaymentMethodRemoved', 'Removed payment method "{{label}}"', { label });
    case 'payment_method_updated':
      return t('cancellationSettings.historyPaymentMethodUpdated', 'Updated payment method "{{label}}"', { label });
    case 'deposit_changed':
      return t(
        'cancellationSettings.historyDepositChanged',
        'Changed deposit from {{from}}% to {{to}}%',
        { from: change.from, to: change.to }
      );
    case 'notice_changed':
      return t(
        'cancellationSettings.historyNoticeChanged',
        'Changed minimum notice from {{from}} to {{to}} hours',
        { from: change.from, to: change.to }
      );
    case 'terms_changed':
      return t('cancellationSettings.historyTermsChanged', 'Updated payment terms');
    case 'custom_enabled':
      return t('cancellationSettings.historyCustomEnabled', 'Turned on custom off-platform payment');
    case 'custom_disabled':
      return t('cancellationSettings.historyCustomDisabled', 'Turned off custom off-platform payment');
    default:
      return t('cancellationSettings.historyUnknownChange', 'Setting updated');
  }
}

export default function HelperCancellationSettings() {
  const { t, i18n } = useTranslation();
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const [saving, setSaving] = useState(false);
  const [history, setHistory] = useState([]);
  const [historyLoading, setHistoryLoading] = useState(true);
  const [historyFailed, setHistoryFailed] = useState(false);
  const [oxsteedEnabled, setOxsteedEnabled] = useState(true);
  const [customEnabled, setCustomEnabled] = useState(false);
  const [customPolicy, setCustomPolicy] = useState(DEFAULT_CUSTOM_POLICY);
  const snapshotRef = useRef(null);

  const paymentDetails = Array.isArray(customPolicy.payment_details)
    ? customPolicy.payment_details
    : [];

  const updatePaymentDetail = (index, field, value) => {
    setCustomPolicy({
      ...customPolicy,
      payment_details: paymentDetails.map((d, i) =>
        i === index ? { ...d, [field]: value } : d
      ),
    });
  };

  const addPaymentDetail = () => {
    if (paymentDetails.length >= 5) return;
    setCustomPolicy({
      ...customPolicy,
      payment_details: [
        ...paymentDetails,
        { label: '', link_url: '', handle: '', instructions: '' },
      ],
    });
  };

  const removePaymentDetail = (index) => {
    setCustomPolicy({
      ...customPolicy,
      payment_details: paymentDetails.filter((_, i) => i !== index),
    });
  };

  const loadPolicies = async () => {
    setLoading(true);
    setLoadFailed(false);
    try {
      const { data } = await api.get('/helper-settings/policies');
      const next = {
        oxsteed: data.data.oxsteed_enabled ?? true,
        custom: data.data.custom_enabled ?? false,
        policy: data.data.custom_policy || DEFAULT_CUSTOM_POLICY,
      };
      setOxsteedEnabled(next.oxsteed);
      setCustomEnabled(next.custom);
      setCustomPolicy({ ...DEFAULT_CUSTOM_POLICY, ...next.policy });
      snapshotRef.current = JSON.stringify({
        oxsteed: next.oxsteed,
        custom: next.custom,
        policy: { ...DEFAULT_CUSTOM_POLICY, ...next.policy },
      });
    } catch (err) {
      setLoadFailed(true);
      console.error('Error loading policies:', err);
    } finally {
      setLoading(false);
    }
  };

  const loadHistory = async () => {
    setHistoryLoading(true);
    setHistoryFailed(false);
    try {
      const { data } = await api.get('/helper-settings/policies/history');
      const entries = data?.data?.history ?? data?.history ?? [];
      setHistory(Array.isArray(entries) ? entries : []);
    } catch (err) {
      setHistoryFailed(true);
      console.error('Error loading policy history:', err);
    } finally {
      setHistoryLoading(false);
    }
  };

  useEffect(() => {
    loadPolicies();
    loadHistory();
  }, []);

  const dirty = useMemo(() => {
    if (!snapshotRef.current) return false;
    return (
      snapshotRef.current !==
      JSON.stringify({ oxsteed: oxsteedEnabled, custom: customEnabled, policy: customPolicy })
    );
  }, [oxsteedEnabled, customEnabled, customPolicy]);

  const handleDiscard = () => {
    if (!snapshotRef.current) return;
    const snap = JSON.parse(snapshotRef.current);
    setOxsteedEnabled(snap.oxsteed);
    setCustomEnabled(snap.custom);
    setCustomPolicy(snap.policy);
  };

  const handleSave = async () => {
    if (!oxsteedEnabled && !customEnabled) {
      toast.error(t('cancellationSettings.enableAtLeastOne'));
      return;
    }
    if (customEnabled) {
      const missingLabel = (customPolicy.payment_details || []).some(
        (d) => !(d?.label || '').trim()
      );
      if (missingLabel) {
        toast.error(
          t(
            'cancellationSettings.paymentDetailLabelRequired',
            'Add a label for each payment method.'
          )
        );
        return;
      }
    }
    setSaving(true);
    try {
      await api.put('/helper-settings/policies', {
        oxsteed_enabled: oxsteedEnabled,
        custom_enabled: customEnabled,
        custom_policy: customEnabled ? customPolicy : {},
      });
      toast.success(t('cancellationSettings.policiesSaved'));
      snapshotRef.current = JSON.stringify({
        oxsteed: oxsteedEnabled,
        custom: customEnabled,
        policy: customPolicy,
      });
      loadHistory();
    } catch (err) {
      const errorMsg =
        err.response?.data?.message ||
        err.response?.data?.error ||
        t('common.failedToUpdate');
      toast.error(errorMsg);
    } finally {
      setSaving(false);
    }
  };

  const activeCount = (oxsteedEnabled ? 1 : 0) + (customEnabled ? 1 : 0);

  const tiers = [
    {
      window: t('cancellationSettings.threeDaysPlus'),
      fee: t('cancellationSettings.tier0'),
      caption: t('cancellationSettings.tierFreeCaption'),
      level: 0,
    },
    {
      window: t('cancellationSettings.twentyFourTo72Hours'),
      fee: t('cancellationSettings.tier50'),
      caption: t('cancellationSettings.tierHalfCaption'),
      level: 1,
    },
    {
      window: t('cancellationSettings.lessThan24Hours'),
      fee: t('cancellationSettings.tier100'),
      caption: t('cancellationSettings.tierFullCaption'),
      level: 2,
    },
  ];

  if (loading) {
    return (
      <PageShell>
        <PageMeta title={t('cancellationSettings.pageTitle')} />
        <div className="pcs-page" aria-busy="true">
          <div className="pcs-skeleton pcs-skeleton-title" />
          <div className="pcs-skeleton pcs-skeleton-card" />
          <div className="pcs-skeleton pcs-skeleton-card" />
        </div>
      </PageShell>
    );
  }

  if (loadFailed) {
    return (
      <PageShell>
        <PageMeta title={t('cancellationSettings.pageTitle')} />
        <div className="pcs-page pcs-error">
          <div className="pcs-error-icon" aria-hidden="true">
            <Info size={28} />
          </div>
          <h1>{t('cancellationSettings.pageTitle')}</h1>
          <p>{t('cancellationSettings.loadError')}</p>
          <button type="button" className="pcs-btn pcs-btn-secondary" onClick={loadPolicies}>
            <RotateCcw size={16} aria-hidden="true" /> {t('common.retry')}
          </button>
        </div>
      </PageShell>
    );
  }

  return (
    <PageShell>
      <PageMeta title={t('cancellationSettings.pageTitle')} />
      <div className="pcs-page">
        <nav className="pcs-breadcrumb" aria-label="Breadcrumb">
          <Link to="/settings">{t('cancellationSettings.backToSettings')}</Link>
          <ChevronRight size={14} aria-hidden="true" />
          <span aria-current="page">{t('cancellationSettings.pageTitle')}</span>
        </nav>

        <header className="pcs-header">
          <div>
            <h1>{t('cancellationSettings.pageTitle')}</h1>
            <p className="pcs-subtitle">{t('cancellationSettings.pageSubtitle')}</p>
          </div>
          <div
            className="pcs-summary"
            role="status"
            aria-label={t('cancellationSettings.methodsEnabled', { count: activeCount })}
          >
            <span className="pcs-summary-count">{activeCount}/2</span>
            <span>{t('cancellationSettings.methodsEnabled', { count: activeCount })}</span>
          </div>
        </header>

        {/* OxSteed platform payment */}
        <section
          className={`pcs-card${oxsteedEnabled ? ' is-active' : ''}`}
          aria-labelledby="pcs-oxsteed-title"
        >
          <div className="pcs-card-head">
            <div className="pcs-card-identity">
              <span className="pcs-icon-tile pcs-icon-tile-brand" aria-hidden="true">
                <ShieldCheck size={22} />
              </span>
              <div>
                <h2 id="pcs-oxsteed-title">
                  {t('cancellationSettings.oxsteadPayment')}
                  <span className="pcs-badge">{t('cancellationSettings.recommended')}</span>
                </h2>
                <p>{t('cancellationSettings.oxsteadDescription')}</p>
              </div>
            </div>
            <div className="pcs-card-controls">
              <StatusPill active={oxsteedEnabled} t={t} />
              <Toggle
                checked={oxsteedEnabled}
                onChange={setOxsteedEnabled}
                label={t('cancellationSettings.enableOxsteed')}
              />
            </div>
          </div>

          {oxsteedEnabled && (
            <div className="pcs-card-body">
              <h3 className="pcs-section-label">{t('cancellationSettings.cancellationPolicy')}</h3>
              <ol className="pcs-tiers">
                {tiers.map((tier) => (
                  <li key={tier.fee} className={`pcs-tier pcs-tier-${tier.level}`}>
                    <span className="pcs-tier-fee">{tier.fee}</span>
                    <span className="pcs-tier-window">{tier.window}</span>
                    <span className="pcs-tier-caption">{tier.caption}</span>
                    <span className="pcs-tier-bar" aria-hidden="true">
                      <span className="pcs-tier-fill" />
                    </span>
                  </li>
                ))}
              </ol>
              <div className="pcs-callout pcs-callout-success">
                <Check size={16} aria-hidden="true" />
                <p>{t('cancellationSettings.helperProtected')}</p>
              </div>
            </div>
          )}
        </section>

        {/* Custom off-platform payment */}
        <section
          className={`pcs-card${customEnabled ? ' is-active' : ''}`}
          aria-labelledby="pcs-custom-title"
        >
          <div className="pcs-card-head">
            <div className="pcs-card-identity">
              <span className="pcs-icon-tile pcs-icon-tile-neutral" aria-hidden="true">
                <Banknote size={22} />
              </span>
              <div>
                <h2 id="pcs-custom-title">{t('cancellationSettings.customPayment')}</h2>
                <p>{t('cancellationSettings.customDescription')}</p>
              </div>
            </div>
            <div className="pcs-card-controls">
              <StatusPill active={customEnabled} t={t} />
              <Toggle
                checked={customEnabled}
                onChange={setCustomEnabled}
                label={t('cancellationSettings.enableCustom')}
              />
            </div>
          </div>

          {customEnabled && (
            <div className="pcs-card-body pcs-form">
              <div className="pcs-field">
                <label htmlFor="pcs-deposit">
                  <span className="pcs-field-icon" aria-hidden="true">
                    <Wallet size={15} />
                  </span>
                  {t('cancellationSettings.depositRequired')}
                </label>
                <div className="pcs-slider-row">
                  <input
                    id="pcs-deposit"
                    type="range"
                    min="0"
                    max="100"
                    step="5"
                    value={customPolicy.deposit_percent ?? 50}
                    onChange={(e) =>
                      setCustomPolicy({
                        ...customPolicy,
                        deposit_percent: parseInt(e.target.value, 10) || 0,
                      })
                    }
                    className="pcs-slider"
                    aria-describedby="pcs-deposit-hint"
                  />
                  <output className="pcs-slider-value" htmlFor="pcs-deposit">
                    {customPolicy.deposit_percent ?? 50}%
                  </output>
                </div>
                <p id="pcs-deposit-hint" className="pcs-hint">
                  {t('cancellationSettings.depositHint')}
                </p>
              </div>

              <div className="pcs-field">
                <label htmlFor="pcs-notice">
                  <span className="pcs-field-icon" aria-hidden="true">
                    <Clock3 size={15} />
                  </span>
                  {t('cancellationSettings.minimumNoticeHours')}
                </label>
                <div className="pcs-input-wrap">
                  <input
                    id="pcs-notice"
                    type="number"
                    min="0"
                    value={customPolicy.min_notice_hours ?? 48}
                    onChange={(e) =>
                      setCustomPolicy({
                        ...customPolicy,
                        min_notice_hours: parseInt(e.target.value, 10) || 0,
                      })
                    }
                    className="pcs-input"
                    aria-describedby="pcs-notice-hint"
                  />
                </div>
                <p id="pcs-notice-hint" className="pcs-hint">
                  {t('cancellationSettings.noticeHint')}
                </p>
              </div>

              <div className="pcs-field">
                <label htmlFor="pcs-terms">
                  <span className="pcs-field-icon" aria-hidden="true">
                    <FileText size={15} />
                  </span>
                  {t('cancellationSettings.yourTerms')}
                </label>
                <textarea
                  id="pcs-terms"
                  value={customPolicy.terms ?? ''}
                  onChange={(e) => setCustomPolicy({ ...customPolicy, terms: e.target.value })}
                  placeholder={t('cancellationSettings.termsPlaceholder')}
                  maxLength={1000}
                  rows={4}
                  className="pcs-textarea"
                />
                <p className="pcs-counter" aria-live="polite">
                  {(customPolicy.terms?.length || 0)}/1000
                </p>
              </div>

              <div className="pcs-field">
                <label>
                  <span className="pcs-field-icon" aria-hidden="true">
                    <Wallet size={15} />
                  </span>
                  {t('cancellationSettings.paymentDetailsTitle', 'How customers pay you')}
                </label>
                <p className="pcs-hint">
                  {t(
                    'cancellationSettings.paymentDetailsHint',
                    'These details are shown to customers who choose direct payment, so they know where to send it.'
                  )}
                </p>
                <div className="pcs-paydetails">
                  {paymentDetails.map((detail, index) => (
                    <div key={index} className="pcs-paydetail">
                      <div className="pcs-paydetail-head">
                        <span className="pcs-paydetail-name">
                          {t('cancellationSettings.paymentDetailNumber', 'Method {{n}}', { n: index + 1 })}
                        </span>
                        <button
                          type="button"
                          className="pcs-btn pcs-btn-ghost pcs-paydetail-remove"
                          onClick={() => removePaymentDetail(index)}
                          aria-label={t('cancellationSettings.removePaymentDetail', 'Remove payment method')}
                        >
                          {t('cancellationSettings.removePaymentDetail', 'Remove')}
                        </button>
                      </div>
                      <div className="pcs-paydetail-grid">
                        <label className="pcs-paydetail-field">
                          <span>{t('cancellationSettings.paymentDetailLabel', 'Label')}</span>
                          <input
                            type="text"
                            value={detail.label ?? ''}
                            maxLength={60}
                            onChange={(e) => updatePaymentDetail(index, 'label', e.target.value)}
                            placeholder={t(
                              'cancellationSettings.paymentDetailLabelPlaceholder',
                              'Mobile money, Bank transfer'
                            )}
                            className="pcs-input"
                          />
                        </label>
                        <label className="pcs-paydetail-field">
                          <span>{t('cancellationSettings.paymentDetailLink', 'Payment link')}</span>
                          <input
                            type="url"
                            value={detail.link_url ?? ''}
                            maxLength={500}
                            onChange={(e) => updatePaymentDetail(index, 'link_url', e.target.value)}
                            placeholder="https://"
                            className="pcs-input"
                            dir="ltr"
                          />
                        </label>
                        <label className="pcs-paydetail-field">
                          <span>{t('cancellationSettings.paymentDetailHandle', 'Account handle or ID')}</span>
                          <input
                            type="text"
                            value={detail.handle ?? ''}
                            maxLength={120}
                            onChange={(e) => updatePaymentDetail(index, 'handle', e.target.value)}
                            placeholder={t(
                              'cancellationSettings.paymentDetailHandlePlaceholder',
                              'Account number, username, or wallet ID'
                            )}
                            className="pcs-input"
                          />
                        </label>
                        <label className="pcs-paydetail-field pcs-paydetail-full">
                          <span>{t('cancellationSettings.paymentDetailInstructions', 'Instructions')}</span>
                          <textarea
                            value={detail.instructions ?? ''}
                            maxLength={500}
                            rows={2}
                            onChange={(e) => updatePaymentDetail(index, 'instructions', e.target.value)}
                            placeholder={t(
                              'cancellationSettings.paymentDetailInstructionsPlaceholder',
                              'Anything the customer should know to complete the payment'
                            )}
                            className="pcs-textarea"
                          />
                        </label>
                      </div>
                    </div>
                  ))}
                </div>
                {paymentDetails.length < 5 ? (
                  <button
                    type="button"
                    className="pcs-btn pcs-btn-secondary"
                    onClick={addPaymentDetail}
                  >
                    {t('cancellationSettings.addPaymentDetail', 'Add payment method')}
                  </button>
                ) : (
                  <p className="pcs-hint">
                    {t('cancellationSettings.paymentDetailMax', 'You can add up to 5 payment methods.')}
                  </p>
                )}
              </div>
            </div>
          )}
        </section>

        {/* Payment details change history */}
        <section className="pcs-card" aria-labelledby="pcs-history-title">
          <div className="pcs-card-head">
            <div className="pcs-card-identity">
              <span className="pcs-icon-tile pcs-icon-tile-neutral" aria-hidden="true">
                <History size={22} />
              </span>
              <div>
                <h2 id="pcs-history-title">{t('cancellationSettings.historyTitle', 'History')}</h2>
                <p>
                  {t(
                    'cancellationSettings.historyDescription',
                    'A permanent record of every change to how you receive payment. Entries cannot be edited or deleted.'
                  )}
                </p>
              </div>
            </div>
          </div>
          <div className="pcs-card-body">
            {historyLoading ? (
              <div aria-busy="true" aria-label={t('cancellationSettings.historyTitle', 'History')}>
                <div className="pcs-skeleton pcs-skeleton-line" />
                <div className="pcs-skeleton pcs-skeleton-line" />
                <div className="pcs-skeleton pcs-skeleton-line" />
              </div>
            ) : historyFailed ? (
              <div className="pcs-history-error">
                <p>{t('cancellationSettings.historyLoadError', 'Could not load history.')}</p>
                <button type="button" className="pcs-btn pcs-btn-secondary" onClick={loadHistory}>
                  <RotateCcw size={16} aria-hidden="true" /> {t('cancellationSettings.historyRetry', 'Retry')}
                </button>
              </div>
            ) : history.length === 0 ? (
              <p className="pcs-history-empty">
                {t('cancellationSettings.historyEmpty', 'No changes recorded yet.')}
              </p>
            ) : (
              <ol className="pcs-history">
                {history.map((entry) => (
                  <li key={entry.id} className="pcs-history-item">
                    <span className="pcs-history-dot" aria-hidden="true" />
                    <div className="pcs-history-content">
                      <time className="pcs-history-time" dateTime={entry.created_at}>
                        {formatHistoryDate(entry.created_at, i18n.language)}
                      </time>
                      <ul className="pcs-history-changes">
                        {(entry.changes || []).map((change, idx) => (
                          <li key={idx}>{historyChangeText(change, t)}</li>
                        ))}
                      </ul>
                    </div>
                  </li>
                ))}
              </ol>
            )}
          </div>
        </section>

        <div className="pcs-callout pcs-callout-info">
          <Info size={16} aria-hidden="true" />
          <p>
            <strong>{t('cancellationSettings.noteTitle')}: </strong>
            {t('cancellationSettings.noteBody')}
          </p>
        </div>

        <div className={`pcs-savebar${dirty ? ' is-visible' : ''}`} aria-live="polite">
          {dirty && (
            <>
              <span className="pcs-dirty">
                <span className="pcs-dirty-dot" aria-hidden="true" />
                {t('cancellationSettings.unsavedChanges')}
              </span>
              <div className="pcs-savebar-actions">
                <button
                  type="button"
                  className="pcs-btn pcs-btn-ghost"
                  onClick={handleDiscard}
                  disabled={saving}
                >
                  {t('cancellationSettings.discard')}
                </button>
                <button
                  type="button"
                  className="pcs-btn pcs-btn-primary"
                  onClick={handleSave}
                  disabled={saving}
                >
                  {saving ? t('common.saving') : t('common.save')}
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </PageShell>
  );
}
