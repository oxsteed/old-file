import React, { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import api from '../../api/axios';
import toast from 'react-hot-toast';
import { Plus, Trash2, Clock, Users, LogIn, LogOut } from 'lucide-react';

const TABS = ['shifts', 'time'];

export function StaffScheduler({ businessId }) {
  const { t } = useTranslation();
  const [tab, setTab] = useState('shifts');
  const [shifts, setShifts] = useState([]);
  const [timeEntries, setTimeEntries] = useState([]);
  const [loading, setLoading] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ shift_start: '', shift_end: '', role: '', notes: '' });

  useEffect(() => {
    if (tab === 'shifts') loadShifts();
    else loadTime();
  }, [businessId, tab]);

  const loadShifts = async () => {
    setLoading(true);
    try { const res = await api.get(`/businesses/${businessId}/staff/shifts`); setShifts(res.data || []); }
    catch { toast.error(t('businessHub.staffScheduler.toastLoadShiftsFail')); }
    finally { setLoading(false); }
  };

  const loadTime = async () => {
    setLoading(true);
    try { const res = await api.get(`/businesses/${businessId}/staff/time-entries`); setTimeEntries(res.data || []); }
    catch { toast.error(t('businessHub.staffScheduler.toastLoadTimeFail')); }
    finally { setLoading(false); }
  };

  const saveShift = async () => {
    if (!form.shift_start || !form.shift_end) return toast.error(t('businessHub.staffScheduler.toastShiftTimesRequired'));
    try { await api.post(`/businesses/${businessId}/staff/shifts`, { ...form, user_id: null }); toast.success(t('businessHub.staffScheduler.toastShiftAdded')); setShowForm(false); setForm({ shift_start: '', shift_end: '', role: '', notes: '' }); loadShifts(); }
    catch { toast.error(t('businessHub.staffScheduler.toastShiftSaveFail')); }
  };

  const deleteShift = async (id) => {
    if (!window.confirm(t('businessHub.staffScheduler.confirmDeleteShift'))) return;
    try { await api.delete(`/businesses/${businessId}/staff/shifts/${id}`); toast.success(t('businessHub.staffScheduler.toastDeleted')); loadShifts(); }
    catch { toast.error(t('common.failed')); }
  };

  const clockIn = async () => {
    try { await api.post(`/businesses/${businessId}/staff/clock-in`); toast.success(t('businessHub.staffScheduler.toastClockedIn')); loadTime(); }
    catch (err) { toast.error(err?.response?.data?.error || t('businessHub.staffScheduler.toastClockInFail')); }
  };

  const clockOut = async (id) => {
    try { await api.post(`/businesses/${businessId}/staff/clock-out/${id}`); toast.success(t('businessHub.staffScheduler.toastClockedOut')); loadTime(); }
    catch { toast.error(t('businessHub.staffScheduler.toastClockOutFail')); }
  };

  const formatDuration = (hours) => {
    if (!hours) return '-';
    const h = Math.floor(hours);
    const m = Math.round((hours - h) * 60);
    return `${h}h ${m}m`;
  };

  return (
    <div style={{ padding: '1.5rem' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem' }}>
        <div>
          <h3 style={{ margin: 0, fontSize: '1.25rem', fontWeight: 600 }}>{t('businessHub.staffScheduler.title')}</h3>
          <p style={{ margin: '0.25rem 0 0', color: 'var(--muted-text)', fontSize: '0.875rem' }}>{t('businessHub.staffScheduler.subtitle')}</p>
        </div>
        <div style={{ display: 'flex', gap: '0.5rem' }}>
          <button onClick={clockIn} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', background: '#10b981', color: '#fff', border: 'none', borderRadius: '0.5rem', padding: '0.6rem 1rem', cursor: 'pointer', fontWeight: 600, fontSize: '0.875rem' }}>
            <LogIn size={14} /> {t('businessHub.staffScheduler.clockIn')}
          </button>
          {tab === 'shifts' && <button onClick={() => setShowForm(true)} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', background: '#f97316', color: '#fff', border: 'none', borderRadius: '0.5rem', padding: '0.6rem 1rem', cursor: 'pointer', fontWeight: 600, fontSize: '0.875rem' }}>
            <Plus size={14} /> {t('businessHub.staffScheduler.addShift')}
          </button>}
        </div>
      </div>

      <div style={{ display: 'flex', borderBottom: '1px solid var(--border-color)', marginBottom: '1.5rem' }}>
        {[['shifts', t('businessHub.staffScheduler.tabs.shifts'), <Users size={14} />], ['time', t('businessHub.staffScheduler.tabs.timeEntries'), <Clock size={14} />]].map(([id, label, icon]) => (
          <button key={id} onClick={() => setTab(id)} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', padding: '0.75rem 1.25rem', border: 'none', background: 'transparent', cursor: 'pointer', color: tab === id ? '#f97316' : 'var(--muted-text)', borderBottom: tab === id ? '2px solid #f97316' : '2px solid transparent', fontWeight: tab === id ? 600 : 400, fontSize: '0.875rem' }}>
            {icon} {label}
          </button>
        ))}
      </div>

      {showForm && tab === 'shifts' && (
        <div style={{ background: 'var(--card-bg)', border: '1px solid var(--border-color)', borderRadius: '0.75rem', padding: '1.25rem', marginBottom: '1.5rem' }}>
          <h4 style={{ margin: '0 0 1rem' }}>{t('businessHub.staffScheduler.newShift')}</h4>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
            {[
              ['shift_start', t('businessHub.staffScheduler.fields.start'), 'datetime-local'],
              ['shift_end', t('businessHub.staffScheduler.fields.end'), 'datetime-local'],
              ['role', t('businessHub.staffScheduler.fields.role'), 'text'],
            ].map(([k,l,tpe]) => (
              <div key={k}>
                <label style={{ display: 'block', fontSize: '0.875rem', marginBottom: '0.25rem', color: 'var(--muted-text)' }}>{l}</label>
                <input type={tpe} value={form[k]} onChange={e => setForm(f => ({ ...f, [k]: e.target.value }))} style={{ width: '100%', padding: '0.6rem', border: '1px solid var(--border-color)', borderRadius: '0.5rem', background: 'var(--card-bg)', color: 'var(--app-text)', boxSizing: 'border-box' }} />
              </div>
            ))}
          </div>
          <div style={{ display: 'flex', gap: '0.75rem', justifyContent: 'flex-end', marginTop: '1rem' }}>
            <button onClick={() => setShowForm(false)} style={{ padding: '0.5rem 1rem', border: '1px solid var(--border-color)', borderRadius: '0.5rem', background: 'transparent', color: 'var(--app-text)', cursor: 'pointer' }}>{t('common.cancel')}</button>
            <button onClick={saveShift} style={{ padding: '0.5rem 1rem', background: '#f97316', color: '#fff', border: 'none', borderRadius: '0.5rem', cursor: 'pointer', fontWeight: 600 }}>{t('common.save')}</button>
          </div>
        </div>
      )}

      {loading ? <p style={{ color: 'var(--muted-text)' }}>{t('common.loading')}</p> : tab === 'shifts' ? (
        shifts.length === 0 ? <div style={{ textAlign: 'center', padding: '3rem', color: 'var(--muted-text)' }}><Users size={48} style={{ opacity: 0.3, marginBottom: '1rem' }} /><p>{t('businessHub.staffScheduler.emptyShifts')}</p></div>
        : shifts.map(s => (
          <div key={s.id} style={{ display: 'flex', alignItems: 'center', gap: '1rem', background: 'var(--card-bg)', border: '1px solid var(--border-color)', borderRadius: '0.5rem', padding: '0.75rem 1rem', marginBottom: '0.5rem' }}>
            <div style={{ flex: 1 }}>
              <div style={{ fontWeight: 600 }}>{s.user_name || t('businessHub.staffScheduler.unassigned')}{s.role && ` · ${s.role}`}</div>
              <div style={{ fontSize: '0.875rem', color: 'var(--muted-text)' }}>{new Date(s.shift_start).toLocaleString()} – {new Date(s.shift_end).toLocaleString()}</div>
            </div>
            <button onClick={() => deleteShift(s.id)} style={{ padding: '0.4rem', border: 'none', background: 'transparent', cursor: 'pointer', color: '#ef4444' }}><Trash2 size={14} /></button>
          </div>
        ))
      ) : (
        timeEntries.length === 0 ? <div style={{ textAlign: 'center', padding: '3rem', color: 'var(--muted-text)' }}><Clock size={48} style={{ opacity: 0.3, marginBottom: '1rem' }} /><p>{t('businessHub.staffScheduler.emptyTime')}</p></div>
        : timeEntries.map(e => (
          <div key={e.id} style={{ display: 'flex', alignItems: 'center', gap: '1rem', background: 'var(--card-bg)', border: '1px solid var(--border-color)', borderRadius: '0.5rem', padding: '0.75rem 1rem', marginBottom: '0.5rem' }}>
            <div style={{ flex: 1 }}>
              <div style={{ fontWeight: 600 }}>{e.user_name}</div>
              <div style={{ fontSize: '0.875rem', color: 'var(--muted-text)' }}>
                {t('businessHub.staffScheduler.time.in')} {new Date(e.clock_in).toLocaleString()}{' '}
                {e.clock_out ? `· ${t('businessHub.staffScheduler.time.out')} ${new Date(e.clock_out).toLocaleString()}` : `· ${t('businessHub.staffScheduler.time.stillWorking')}`}
              </div>
            </div>
            <div style={{ fontWeight: 600, color: e.clock_out ? '#10b981' : '#f59e0b' }}>{formatDuration(parseFloat(e.hours))}</div>
            {!e.clock_out && <button onClick={() => clockOut(e.id)} style={{ display: 'flex', alignItems: 'center', gap: '0.25rem', padding: '0.4rem 0.75rem', background: '#ef4444', color: '#fff', border: 'none', borderRadius: '0.5rem', cursor: 'pointer', fontSize: '0.75rem', fontWeight: 600 }}><LogOut size={12} /> {t('businessHub.staffScheduler.time.clockOut')}</button>}
          </div>
        ))
      )}
    </div>
  );
}
