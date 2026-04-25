import React, { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import api from '../../api/axios';
import { toast } from 'sonner';
import '../../styles/AvailabilityBlockModal.css';

const TYPES = [
  { value: 'available', label: 'calendar.blockTypeAvailable' },
  { value: 'unavailable', label: 'calendar.blockTypeUnavailable' },
  { value: 'busy', label: 'calendar.blockTypeBusy' }
];

const RECURRING_RULES = [
  { value: null, label: 'calendar.noRecurrence' },
  { value: 'FREQ=DAILY', label: 'calendar.recDaily' },
  { value: 'FREQ=WEEKLY', label: 'calendar.recWeekly' },
  { value: 'FREQ=MONTHLY', label: 'calendar.recMonthly' }
];

export default function AvailabilityBlockModal({ initialDate, initialHour, onClose, onCreated }) {
  const { t } = useTranslation();
  const [loading, setLoading] = useState(false);
  const [form, setForm] = useState(() => {
    const date = initialDate || new Date();
    const hour = initialHour || 9;

    const startTime = new Date(date);
    startTime.setHours(hour, 0, 0, 0);

    const endTime = new Date(startTime);
    endTime.setHours(hour + 1, 0, 0, 0);

    return {
      start_time: startTime.toISOString().slice(0, 16),
      end_time: endTime.toISOString().slice(0, 16),
      type: 'available',
      title: '',
      notes: '',
      recurring_rule: null,
      recurring_until: ''
    };
  });

  const handleInputChange = (e) => {
    const { name, value } = e.target;
    setForm((prev) => ({ ...prev, [name]: value }));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();

    if (!form.start_time || !form.end_time) {
      toast.error(t('calendar.provideTimes'));
      return;
    }

    const startTime = new Date(form.start_time);
    const endTime = new Date(form.end_time);

    if (endTime <= startTime) {
      toast.error(t('calendar.endAfterStart'));
      return;
    }

    try {
      setLoading(true);
      await api.post('/calendar/availability', {
        start_time: startTime.toISOString(),
        end_time: endTime.toISOString(),
        type: form.type,
        title: form.title || null,
        notes: form.notes || null,
        recurring_rule: form.recurring_rule,
        recurring_until: form.recurring_until ? new Date(form.recurring_until).toISOString() : null
      });

      toast.success(t('calendar.availabilityCreated'));
      onCreated();
    } catch (err) {
      toast.error(t('calendar.errorCreatingBlock'));
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="abm-overlay" onClick={onClose}>
      <div className="abm-modal" onClick={(e) => e.stopPropagation()}>
        <div className="abm-header">
          <h2>{t('calendar.blockTime')}</h2>
          <button className="abm-close" onClick={onClose}>✕</button>
        </div>

        <form onSubmit={handleSubmit} className="abm-form">
          <div className="abm-form-group">
            <label>{t('calendar.blockType')} *</label>
            <select
              name="type"
              value={form.type}
              onChange={handleInputChange}
              required
            >
              {TYPES.map((type) => (
                <option key={type.value} value={type.value}>
                  {t(type.label)}
                </option>
              ))}
            </select>
          </div>

          <div className="abm-form-group">
            <label>{t('calendar.startTime')} *</label>
            <input
              type="datetime-local"
              name="start_time"
              value={form.start_time}
              onChange={handleInputChange}
              required
            />
          </div>

          <div className="abm-form-group">
            <label>{t('calendar.endTime')} *</label>
            <input
              type="datetime-local"
              name="end_time"
              value={form.end_time}
              onChange={handleInputChange}
              required
            />
          </div>

          <div className="abm-form-group">
            <label>{t('calendar.title')}</label>
            <input
              type="text"
              name="title"
              value={form.title}
              onChange={handleInputChange}
              placeholder={t('calendar.blockTitlePlaceholder')}
              maxLength={255}
            />
          </div>

          <div className="abm-form-group">
            <label>{t('calendar.notes')}</label>
            <textarea
              name="notes"
              value={form.notes}
              onChange={handleInputChange}
              placeholder={t('calendar.blockNotesPlaceholder')}
              rows="3"
            />
          </div>

          <div className="abm-section">
            <h3>{t('calendar.recurrence')}</h3>

            <div className="abm-form-group">
              <label>{t('calendar.recurringPattern')}</label>
              <select
                name="recurring_rule"
                value={form.recurring_rule || ''}
                onChange={handleInputChange}
              >
                {RECURRING_RULES.map((rule) => (
                  <option key={rule.value || 'none'} value={rule.value || ''}>
                    {t(rule.label)}
                  </option>
                ))}
              </select>
            </div>

            {form.recurring_rule && (
              <div className="abm-form-group">
                <label>{t('calendar.recurringUntil')}</label>
                <input
                  type="date"
                  name="recurring_until"
                  value={form.recurring_until}
                  onChange={handleInputChange}
                />
              </div>
            )}
          </div>

          <div className="abm-footer">
            <button
              type="button"
              className="abm-btn abm-btn-secondary"
              onClick={onClose}
              disabled={loading}
            >
              {t('common.cancel')}
            </button>
            <button
              type="submit"
              className="abm-btn abm-btn-primary"
              disabled={loading}
            >
              {t('calendar.createBlock')}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
