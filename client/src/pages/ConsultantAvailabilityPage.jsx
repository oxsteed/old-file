import React, { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import toast from 'react-hot-toast';
import axios from '../api/axios';

const DAYS_OF_WEEK = [
  { value: 0, label: 'Sunday' },
  { value: 1, label: 'Monday' },
  { value: 2, label: 'Tuesday' },
  { value: 3, label: 'Wednesday' },
  { value: 4, label: 'Thursday' },
  { value: 5, label: 'Friday' },
  { value: 6, label: 'Saturday' },
];

export default function ConsultantAvailabilityPage() {
  const { t } = useTranslation();
  const [availability, setAvailability] = useState([]);
  const [blockedDates, setBlockedDates] = useState([]);
  const [loading, setLoading] = useState(false);
  const [editing, setEditing] = useState(null);
  const [newAvailability, setNewAvailability] = useState({
    dayOfWeek: 1,
    startTime: '09:00',
    endTime: '17:00',
    isActive: true,
  });
  const [newBlockedDate, setNewBlockedDate] = useState({
    blockedDate: '',
    reason: '',
  });

  // Load availability on mount
  useEffect(() => {
    loadAvailability();
    loadBlockedDates();
  }, []);

  const loadAvailability = async () => {
    try {
      setLoading(true);
      // Assuming consultant ID is from auth context or user ID
      const response = await axios.get(`/api/scheduling/consultants/me/availability`);
      setAvailability(response.data);
    } catch (err) {
      toast.error(t('common.errorLoading') || 'Failed to load availability');
      console.error('Failed to load availability', err);
    } finally {
      setLoading(false);
    }
  };

  const loadBlockedDates = async () => {
    try {
      const response = await axios.get(`/api/scheduling/consultants/me/blocked-dates`);
      setBlockedDates(response.data);
    } catch (err) {
      toast.error(t('common.errorLoading') || 'Failed to load blocked dates');
      console.error('Failed to load blocked dates', err);
    }
  };

  const handleSaveAvailability = async () => {
    try {
      setLoading(true);
      await axios.post(`/api/scheduling/consultants/me/availability`, newAvailability);
      toast.success(t('scheduling.availabilitySaved') || 'Availability saved');
      setNewAvailability({
        dayOfWeek: 1,
        startTime: '09:00',
        endTime: '17:00',
        isActive: true,
      });
      setEditing(null);
      loadAvailability();
    } catch (err) {
      toast.error(t('common.errorUpdating') || 'Failed to save availability');
      console.error('Failed to save availability', err);
    } finally {
      setLoading(false);
    }
  };

  const handleAddBlockedDate = async () => {
    try {
      if (!newBlockedDate.blockedDate) {
        toast.error(t('scheduling.dateRequired') || 'Please select a date');
        return;
      }

      setLoading(true);
      await axios.post(`/api/scheduling/consultants/me/blocked-dates`, newBlockedDate);
      toast.success(t('scheduling.blockedDateAdded') || 'Blocked date added');
      setNewBlockedDate({ blockedDate: '', reason: '' });
      loadBlockedDates();
    } catch (err) {
      toast.error(t('common.errorUpdating') || 'Failed to add blocked date');
      console.error('Failed to add blocked date', err);
    } finally {
      setLoading(false);
    }
  };

  const handleRemoveBlockedDate = async (dateId) => {
    try {
      setLoading(true);
      await axios.delete(`/api/scheduling/consultants/me/blocked-dates/${dateId}`);
      toast.success(t('scheduling.blockedDateRemoved') || 'Blocked date removed');
      loadBlockedDates();
    } catch (err) {
      toast.error(t('common.errorUpdating') || 'Failed to remove blocked date');
      console.error('Failed to remove blocked date', err);
    } finally {
      setLoading(false);
    }
  };

  const pageStyle = {
    maxWidth: '900px',
    margin: '0 auto',
    padding: '2rem',
  };

  const sectionStyle = {
    marginBottom: '3rem',
    background: 'var(--color-surface)',
    padding: '1.5rem',
    borderRadius: '12px',
    boxShadow: '0 2px 4px rgba(0, 0, 0, 0.1)',
  };

  const titleStyle = {
    fontSize: '1.75rem',
    fontWeight: 'bold',
    marginBottom: '2rem',
    color: 'var(--color-text)',
  };

  const sectionTitleStyle = {
    fontSize: '1.25rem',
    fontWeight: 'bold',
    marginBottom: '1.5rem',
    color: 'var(--color-text)',
  };

  const formGroupStyle = {
    marginBottom: '1rem',
  };

  const labelStyle = {
    display: 'block',
    fontWeight: '500',
    marginBottom: '0.5rem',
    color: 'var(--color-text)',
  };

  const inputStyle = {
    width: '100%',
    padding: '0.75rem',
    borderRadius: '6px',
    border: '1px solid var(--color-border)',
    background: 'var(--color-bg)',
    color: 'var(--color-text)',
    fontSize: '0.875rem',
  };

  const gridStyle = {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
    gap: '1rem',
  };

  const tableStyle = {
    width: '100%',
    borderCollapse: 'collapse',
    marginTop: '1rem',
  };

  const tableHeaderStyle = {
    background: 'var(--color-bg)',
    padding: '0.75rem',
    textAlign: 'left',
    fontWeight: '600',
    borderBottom: '2px solid var(--color-border)',
    color: 'var(--color-text)',
  };

  const tableCellStyle = {
    padding: '0.75rem',
    borderBottom: '1px solid var(--color-border)',
    color: 'var(--color-text)',
  };

  const buttonStyle = {
    padding: '0.75rem 1rem',
    borderRadius: '6px',
    border: 'none',
    cursor: 'pointer',
    fontWeight: '600',
    fontSize: '0.875rem',
    transition: 'all 0.2s',
  };

  const primaryButtonStyle = {
    ...buttonStyle,
    background: 'var(--color-primary)',
    color: 'white',
    opacity: loading ? 0.6 : 1,
  };

  const dangerButtonStyle = {
    ...buttonStyle,
    background: '#ef4444',
    color: 'white',
    opacity: loading ? 0.6 : 1,
  };

  return (
    <div style={pageStyle}>
      <h1 style={titleStyle}>{t('scheduling.manageAvailability') || 'Manage Your Availability'}</h1>

      {/* Recurring Availability */}
      <div style={sectionStyle}>
        <h2 style={sectionTitleStyle}>{t('scheduling.recurringSchedule') || 'Recurring Weekly Schedule'}</h2>
        <p style={{ color: 'var(--color-text-muted)', marginBottom: '1.5rem' }}>
          {t('scheduling.recurringDesc') || 'Set your regular working hours for each day of the week'}
        </p>

        <div style={gridStyle}>
          <div style={formGroupStyle}>
            <label style={labelStyle}>{t('scheduling.dayOfWeek') || 'Day of Week'}</label>
            <select
              value={newAvailability.dayOfWeek}
              onChange={(e) => setNewAvailability({ ...newAvailability, dayOfWeek: parseInt(e.target.value) })}
              style={inputStyle}
            >
              {DAYS_OF_WEEK.map((day) => (
                <option key={day.value} value={day.value}>
                  {day.label}
                </option>
              ))}
            </select>
          </div>

          <div style={formGroupStyle}>
            <label style={labelStyle}>{t('scheduling.startTime') || 'Start Time'}</label>
            <input
              type="time"
              value={newAvailability.startTime}
              onChange={(e) => setNewAvailability({ ...newAvailability, startTime: e.target.value })}
              style={inputStyle}
            />
          </div>

          <div style={formGroupStyle}>
            <label style={labelStyle}>{t('scheduling.endTime') || 'End Time'}</label>
            <input
              type="time"
              value={newAvailability.endTime}
              onChange={(e) => setNewAvailability({ ...newAvailability, endTime: e.target.value })}
              style={inputStyle}
            />
          </div>

          <div style={formGroupStyle}>
            <label style={labelStyle}>{t('scheduling.active') || 'Active'}</label>
            <input
              type="checkbox"
              checked={newAvailability.isActive}
              onChange={(e) => setNewAvailability({ ...newAvailability, isActive: e.target.checked })}
              style={{ width: '1.25rem', height: '1.25rem', cursor: 'pointer' }}
            />
          </div>
        </div>

        <button
          style={primaryButtonStyle}
          onClick={handleSaveAvailability}
          disabled={loading}
        >
          {loading ? (t('common.saving') || 'Saving...') : (t('common.save') || 'Save Availability')}
        </button>

        {availability.length > 0 && (
          <div style={{ marginTop: '2rem' }}>
            <h3 style={{ fontWeight: '600', marginBottom: '1rem', color: 'var(--color-text)' }}>
              {t('scheduling.currentSchedule') || 'Your Current Schedule'}
            </h3>
            <table style={tableStyle}>
              <thead>
                <tr style={{ background: 'var(--color-bg)' }}>
                  <th style={tableHeaderStyle}>{t('scheduling.day') || 'Day'}</th>
                  <th style={tableHeaderStyle}>{t('scheduling.hours') || 'Hours'}</th>
                  <th style={tableHeaderStyle}>{t('scheduling.status') || 'Status'}</th>
                </tr>
              </thead>
              <tbody>
                {availability.map((slot) => (
                  <tr key={slot.id}>
                    <td style={tableCellStyle}>
                      {DAYS_OF_WEEK.find((d) => d.value === slot.day_of_week)?.label}
                    </td>
                    <td style={tableCellStyle}>
                      {slot.start_time} - {slot.end_time}
                    </td>
                    <td style={tableCellStyle}>
                      {slot.is_active ? (
                        <span style={{ color: '#10b981' }}>✓ {t('scheduling.active') || 'Active'}</span>
                      ) : (
                        <span style={{ color: '#6b7280' }}>✗ {t('scheduling.inactive') || 'Inactive'}</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Blocked Dates */}
      <div style={sectionStyle}>
        <h2 style={sectionTitleStyle}>{t('scheduling.blockedDates') || 'Block Your Time Off'}</h2>
        <p style={{ color: 'var(--color-text-muted)', marginBottom: '1.5rem' }}>
          {t('scheduling.blockedDatesDesc') || 'Mark dates when you are unavailable (holidays, vacation, etc.)'}
        </p>

        <div style={gridStyle}>
          <div style={formGroupStyle}>
            <label style={labelStyle}>{t('scheduling.date') || 'Date'}</label>
            <input
              type="date"
              value={newBlockedDate.blockedDate}
              onChange={(e) => setNewBlockedDate({ ...newBlockedDate, blockedDate: e.target.value })}
              style={inputStyle}
            />
          </div>

          <div style={formGroupStyle}>
            <label style={labelStyle}>{t('scheduling.reason') || 'Reason (Optional)'}</label>
            <input
              type="text"
              placeholder="e.g., Vacation, Holiday"
              value={newBlockedDate.reason}
              onChange={(e) => setNewBlockedDate({ ...newBlockedDate, reason: e.target.value })}
              style={inputStyle}
            />
          </div>
        </div>

        <button
          style={primaryButtonStyle}
          onClick={handleAddBlockedDate}
          disabled={loading}
        >
          {loading ? (t('common.saving') || 'Saving...') : (t('scheduling.addBlockedDate') || 'Add Blocked Date')}
        </button>

        {blockedDates.length > 0 && (
          <div style={{ marginTop: '2rem' }}>
            <h3 style={{ fontWeight: '600', marginBottom: '1rem', color: 'var(--color-text)' }}>
              {t('scheduling.timeOff') || 'Your Time Off'}
            </h3>
            <table style={tableStyle}>
              <thead>
                <tr style={{ background: 'var(--color-bg)' }}>
                  <th style={tableHeaderStyle}>{t('scheduling.date') || 'Date'}</th>
                  <th style={tableHeaderStyle}>{t('scheduling.reason') || 'Reason'}</th>
                  <th style={tableHeaderStyle}>{t('common.actions') || 'Actions'}</th>
                </tr>
              </thead>
              <tbody>
                {blockedDates.map((blocked) => (
                  <tr key={blocked.id}>
                    <td style={tableCellStyle}>
                      {new Date(blocked.blocked_date).toLocaleDateString('en-US', {
                        weekday: 'short',
                        month: 'short',
                        day: 'numeric',
                        year: 'numeric',
                      })}
                    </td>
                    <td style={tableCellStyle}>{blocked.reason || '-'}</td>
                    <td style={tableCellStyle}>
                      <button
                        style={dangerButtonStyle}
                        onClick={() => handleRemoveBlockedDate(blocked.id)}
                        disabled={loading}
                      >
                        {t('common.remove') || 'Remove'}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
