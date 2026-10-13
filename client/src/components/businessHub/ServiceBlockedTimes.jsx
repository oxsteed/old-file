import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import api from '../../api/axios';
import toast from 'react-hot-toast';
import { CalendarOff, Plus, Trash2, X } from 'lucide-react';

// Review P2-3-F03: per-service "time off" manager. business_service_blocked_times
// previously had zero writers; the slot engine already subtracts these blocks,
// so this UI is what lets a merchant actually block bookings for time off.

function formatBlockRange(startIso, endIso) {
  try {
    const s = new Date(startIso);
    const e = new Date(endIso);
    const opts = { month: 'short', day: 'numeric' };
    const timeOpts = { hour: 'numeric', minute: '2-digit' };
    return `${s.toLocaleDateString(undefined, opts)} ${s.toLocaleTimeString(undefined, timeOpts)} - ${e.toLocaleTimeString(undefined, timeOpts)}`;
  } catch {
    return String(startIso);
  }
}

export function ServiceBlockedTimes({ businessId, serviceId }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [blocks, setBlocks] = useState([]);
  const [loading, setLoading] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({ date: '', start: '', end: '', reason: '' });

  const load = async () => {
    setLoading(true);
    try {
      const res = await api.get(`/businesses/${businessId}/services/${serviceId}/blocked-times`);
      setBlocks(Array.isArray(res.data) ? res.data : []);
      setLoaded(true);
    } catch {
      toast.error(t('businessServices.toastBlocksLoadFailed'));
    } finally {
      setLoading(false);
    }
  };

  const toggle = () => {
    const next = !open;
    setOpen(next);
    if (next && !loaded) load();
  };

  const handleSave = async () => {
    if (!form.date || !form.start || !form.end) {
      toast.error(t('businessServices.toastBlockInvalid'));
      return;
    }
    const startIso = new Date(`${form.date}T${form.start}:00`).toISOString();
    const endIso = new Date(`${form.date}T${form.end}:00`).toISOString();
    if (Number.isNaN(new Date(startIso).getTime()) || new Date(startIso) >= new Date(endIso)) {
      toast.error(t('businessServices.toastBlockInvalid'));
      return;
    }
    setSaving(true);
    try {
      await api.post(`/businesses/${businessId}/services/${serviceId}/blocked-times`, {
        start_time: startIso,
        end_time: endIso,
        reason: form.reason || undefined,
      });
      toast.success(t('businessServices.toastBlockSaved'));
      setForm({ date: '', start: '', end: '', reason: '' });
      setShowForm(false);
      await load();
    } catch (err) {
      const msg = err?.response?.data?.error;
      toast.error(msg || t('businessServices.toastBlockFailed'));
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (blockId) => {
    if (!window.confirm(t('businessServices.timeOffConfirmRemove'))) return;
    try {
      await api.delete(`/businesses/${businessId}/services/${serviceId}/blocked-times/${blockId}`);
      toast.success(t('businessServices.toastBlockRemoved'));
      await load();
    } catch {
      toast.error(t('businessServices.toastBlockFailed'));
    }
  };

  return (
    <div className="bst-timeoff">
      <button type="button" className="bst-timeoff-toggle" onClick={toggle} aria-expanded={open}>
        <CalendarOff size={14} />
        <span>{t('businessServices.timeOffToggle')}</span>
        {loaded && blocks.length > 0 && <span className="bst-timeoff-count">{blocks.length}</span>}
      </button>
      {open && (
        <div className="bst-timeoff-body">
          <p className="bst-timeoff-desc">{t('businessServices.timeOffDesc')}</p>
          {loading ? (
            <p className="bst-timeoff-empty">{t('businessServices.loading')}</p>
          ) : blocks.length === 0 ? (
            <p className="bst-timeoff-empty">{t('businessServices.timeOffEmpty')}</p>
          ) : (
            <ul className="bst-timeoff-list">
              {blocks.map((b) => (
                <li key={b.id} className="bst-timeoff-row">
                  <div>
                    <div className="bst-timeoff-range">{formatBlockRange(b.start_time, b.end_time)}</div>
                    {b.reason && <div className="bst-timeoff-reason">{b.reason}</div>}
                  </div>
                  <button
                    type="button"
                    className="bst-btn-action delete"
                    aria-label={t('businessServices.timeOffRemove')}
                    onClick={() => handleDelete(b.id)}
                  >
                    <Trash2 size={14} />
                  </button>
                </li>
              ))}
            </ul>
          )}
          {showForm ? (
            <div className="bst-timeoff-form">
              <div className="bst-timeoff-form-row">
                <label>
                  {t('businessServices.timeOffDate')}
                  <input type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} />
                </label>
                <label>
                  {t('businessServices.timeOffStart')}
                  <input type="time" value={form.start} onChange={(e) => setForm({ ...form, start: e.target.value })} />
                </label>
                <label>
                  {t('businessServices.timeOffEnd')}
                  <input type="time" value={form.end} onChange={(e) => setForm({ ...form, end: e.target.value })} />
                </label>
              </div>
              <label className="bst-timeoff-reason-label">
                {t('businessServices.timeOffReason')}
                <input
                  type="text"
                  value={form.reason}
                  maxLength={500}
                  onChange={(e) => setForm({ ...form, reason: e.target.value })}
                />
              </label>
              <div className="bst-timeoff-form-actions">
                <button type="button" className="bst-btn-cancel" onClick={() => setShowForm(false)}>
                  <X size={14} /> {t('businessServices.timeOffCancel')}
                </button>
                <button type="button" className="bst-btn-save" onClick={handleSave} disabled={saving}>
                  {t('businessServices.timeOffBlock')}
                </button>
              </div>
            </div>
          ) : (
            <button type="button" className="bst-timeoff-add" onClick={() => setShowForm(true)}>
              <Plus size={14} /> {t('businessServices.timeOffBlock')}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
