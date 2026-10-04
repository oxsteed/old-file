import React, { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import api from '../../api/axios';
import { toast } from 'sonner';
import { SuggestDropdown } from '../SuggestDropdown';
import '../../styles/CreateAppointmentModal.css';

export default function CreateAppointmentModal({ onClose, onCreated }) {
  const { t } = useTranslation();
  const [loading, setLoading] = useState(false);
  const [searchHelpers, setSearchHelpers] = useState('');
  const [helpers, setHelpers] = useState([]);
  const [searchingHelpers, setSearchingHelpers] = useState(false);
  const [form, setForm] = useState({
    helper_id: '',
    service_description: '',
    scheduled_start_time: '',
    scheduled_end_time: '',
    location_address: '',
    estimated_duration_minutes: 60,
    customer_notes: ''
  });

  const handleHelperSearch = async (query) => {
    setSearchHelpers(query);

    if (query.trim().length < 2) {
      setHelpers([]);
      return;
    }

    try {
      setSearchingHelpers(true);
      const res = await api.get('/helpers/list', {
        params: { query, limit: 10 }
      });
      setHelpers(res.data.helpers || []);
    } catch (err) {
      console.error(err);
      setHelpers([]);
    } finally {
      setSearchingHelpers(false);
    }
  };

  const handleInputChange = (e) => {
    const { name, value } = e.target;
    setForm((prev) => ({ ...prev, [name]: value }));
  };

  const handleSelectHelper = (helper) => {
    setForm((prev) => ({ ...prev, helper_id: helper.id }));
    setSearchHelpers(helper.ownerName || helper.businessName || '');
    setHelpers([]);
  };

  const handleSelectHelperItem = (item) => {
    const helper = helpers.find((h) => h.id === item.id);
    if (helper) handleSelectHelper(helper);
  };

  const helperSuggestItems = useMemo(
    () =>
      helpers.map((helper) => ({
        id: helper.id,
        title: helper.ownerName || helper.businessName,
        meta:
          Array.isArray(helper.categories) && helper.categories.length > 0
            ? helper.categories.slice(0, 2).join(', ')
            : undefined,
        icon: helper.avatar ? (
          <img
            src={helper.avatar}
            alt=""
            style={{ width: '100%', height: '100%', objectFit: 'cover', borderRadius: '0.625rem' }}
          />
        ) : undefined,
      })),
    [helpers],
  );

  const handleSubmit = async (e) => {
    e.preventDefault();

    if (!form.helper_id || !form.service_description || !form.scheduled_start_time) {
      toast.error(t('calendar.fillRequiredFields'));
      return;
    }

    const startTime = new Date(form.scheduled_start_time);
    const endTime = new Date(form.scheduled_end_time);

    if (!form.scheduled_end_time || endTime <= startTime) {
      toast.error(t('calendar.endAfterStart'));
      return;
    }

    if (startTime < new Date()) {
      toast.error(t('calendar.cannotSchedulePast'));
      return;
    }

    try {
      setLoading(true);
      await api.post('/calendar/appointments', {
        // helper_id is a UUID string - never parseInt it
        helper_id: form.helper_id,
        service_description: form.service_description,
        scheduled_start_time: startTime.toISOString(),
        scheduled_end_time: endTime.toISOString(),
        location_address: form.location_address || null,
        estimated_duration_minutes: parseInt(form.estimated_duration_minutes, 10) || 60,
        customer_notes: form.customer_notes || null
      });

      onCreated();
    } catch (err) {
      if (err.response?.status === 409) {
        toast.error(t('calendar.helperUnavailable'));
      } else {
        toast.error(t('calendar.errorRequesting'));
      }
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="cam-overlay" onClick={onClose}>
      <div className="cam-modal" onClick={(e) => e.stopPropagation()}>
        <div className="cam-header">
          <h2>{t('calendar.requestAppointment')}</h2>
          <button className="cam-close" onClick={onClose}>✕</button>
        </div>

        <form onSubmit={handleSubmit} className="cam-form">
          <div className="cam-form-group">
            <label>{t('calendar.selectHelper')} *</label>
            <div className="cam-helper-search">
              <SuggestDropdown
                id="cam-helper-search"
                items={helperSuggestItems}
                value={searchHelpers}
                onQueryChange={handleHelperSearch}
                onSelect={handleSelectHelperItem}
                recentsKey="oxsteed_appointment_helper_recent"
                placeholder={t('calendar.searchHelperPlaceholder')}
                ariaLabel={t('calendar.selectHelper')}
              />
              {searchingHelpers && <div className="cam-loading">{t('common.loading')}</div>}
            </div>
            {form.helper_id && <div className="cam-selected-helper">{t('calendar.helperSelected')}</div>}
          </div>

          <div className="cam-form-group">
            <label>{t('calendar.serviceDescription')} *</label>
            <textarea
              name="service_description"
              value={form.service_description}
              onChange={handleInputChange}
              placeholder={t('calendar.describeServicePlaceholder')}
              rows="3"
              required
            />
          </div>

          <div className="cam-form-row">
            <div className="cam-form-group">
              <label>{t('calendar.startTime')} *</label>
              <input
                type="datetime-local"
                name="scheduled_start_time"
                value={form.scheduled_start_time}
                onChange={handleInputChange}
                required
              />
            </div>

            <div className="cam-form-group">
              <label>{t('calendar.endTime')} *</label>
              <input
                type="datetime-local"
                name="scheduled_end_time"
                value={form.scheduled_end_time}
                onChange={handleInputChange}
                required
              />
            </div>
          </div>

          <div className="cam-form-row">
            <div className="cam-form-group">
              <label>{t('calendar.duration')}</label>
              <input
                type="number"
                name="estimated_duration_minutes"
                value={form.estimated_duration_minutes}
                onChange={handleInputChange}
                min="15"
                max="480"
                step="15"
              />
              <span className="cam-unit">{t('calendar.minutes')}</span>
            </div>
          </div>

          <div className="cam-form-group">
            <label>{t('calendar.location')}</label>
            <input
              type="text"
              name="location_address"
              value={form.location_address}
              onChange={handleInputChange}
              placeholder={t('calendar.locationPlaceholder')}
            />
          </div>

          <div className="cam-form-group">
            <label>{t('calendar.additionalNotes')}</label>
            <textarea
              name="customer_notes"
              value={form.customer_notes}
              onChange={handleInputChange}
              placeholder={t('calendar.notesPlaceholder')}
              rows="3"
            />
          </div>

          <div className="cam-footer">
            <button
              type="button"
              className="cam-btn cam-btn-secondary"
              onClick={onClose}
              disabled={loading}
            >
              {t('common.cancel')}
            </button>
            <button
              type="submit"
              className="cam-btn cam-btn-primary"
              disabled={loading || !form.helper_id}
            >
              {t('calendar.sendRequest')}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
