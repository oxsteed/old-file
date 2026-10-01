import { useState, useEffect, useCallback } from 'react';
import api from '../../api/axios';
import toast from 'react-hot-toast';
import { useTranslation } from 'react-i18next';

const DAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];

function weekDays(weekStart) {
  const days = [];
  const start = new Date(weekStart + 'T00:00:00');
  for (let i = 0; i < 7; i++) {
    const d = new Date(start);
    d.setDate(d.getDate() + i);
    days.push(d.toISOString().split('T')[0]);
  }
  return days;
}

function getWeekStart(date) {
  const d = new Date(date);
  d.setDate(d.getDate() - d.getDay());
  return d.toISOString().split('T')[0];
}

const DEFAULT_SHIFT = { user_id: '', shift_date: '', start_time: '09:00', end_time: '17:00', role_label: '', notes: '' };
const DEFAULT_HOURS = { user_id: '', entry_date: new Date().toISOString().split('T')[0], hours_worked: '', description: '' };

export function StaffSchedulingTab({ businessId }) {
  const { t } = useTranslation();
  const [weekStart, setWeekStart] = useState(() => getWeekStart(new Date()));
  const [schedule, setSchedule] = useState([]);
  const [entries, setEntries] = useState([]);
  const [totals, setTotals] = useState([]);
  const [members, setMembers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showShiftForm, setShowShiftForm] = useState(false);
  const [showHoursForm, setShowHoursForm] = useState(false);
  const [shiftForm, setShiftForm] = useState(DEFAULT_SHIFT);
  const [hoursForm, setHoursForm] = useState(DEFAULT_HOURS);
  const [saving, setSaving] = useState(false);

  const loadMembers = useCallback(async () => {
    try {
      const { data } = await api.get(`/businesses/${businessId}/members`);
      setMembers(data.members || data || []);
    } catch {}
  }, [businessId]);

  const loadSchedule = useCallback(async () => {
    setLoading(true);
    try {
      const [schedRes, timeRes] = await Promise.all([
        api.get(`/businesses/${businessId}/staff-schedule?week_start=${weekStart}`),
        api.get(`/businesses/${businessId}/time-entries?from_date=${weekStart}`),
      ]);
      setSchedule(schedRes.data.schedule || []);
      setEntries(timeRes.data.entries || []);
      setTotals(timeRes.data.totals || []);
    } catch {
      toast.error(t('businessHub.staffScheduling.loadScheduleFailed'));
    } finally {
      setLoading(false);
    }
  }, [businessId, weekStart]);

  useEffect(() => { loadMembers(); }, [loadMembers]);
  useEffect(() => { loadSchedule(); }, [loadSchedule]);

  function prevWeek() {
    const d = new Date(weekStart + 'T00:00:00');
    d.setDate(d.getDate() - 7);
    setWeekStart(d.toISOString().split('T')[0]);
  }
  function nextWeek() {
    const d = new Date(weekStart + 'T00:00:00');
    d.setDate(d.getDate() + 7);
    setWeekStart(d.toISOString().split('T')[0]);
  }

  const days = weekDays(weekStart);

  async function handleAddShift() {
    if (!shiftForm.user_id || !shiftForm.shift_date) return toast.error(t('businessHub.staffScheduling.userDateRequired'));
    setSaving(true);
    try {
      await api.post(`/businesses/${businessId}/staff-schedule`, shiftForm);
      toast.success(t('businessHub.staffScheduling.shiftAdded'));
      setShowShiftForm(false);
      setShiftForm(DEFAULT_SHIFT);
      await loadSchedule();
    } catch (e) { toast.error(e?.response?.data?.error || t('businessHub.staffScheduling.shiftAddFailed')); }
    finally { setSaving(false); }
  }

  async function handleDeleteShift(id) {
    if (!window.confirm(t('businessHub.staffScheduling.shiftDeleteConfirm'))) return;
    try {
      await api.delete(`/businesses/${businessId}/staff-schedule/${id}`);
      toast.success(t('businessHub.staffScheduling.shiftDeleted'));
      await loadSchedule();
    } catch { toast.error(t('businessHub.staffScheduling.shiftDeleteFailed')); }
  }

  async function handleLogHours() {
    if (!hoursForm.user_id || !hoursForm.hours_worked) return toast.error(t('businessHub.staffScheduling.userHoursRequired'));
    setSaving(true);
    try {
      await api.post(`/businesses/${businessId}/time-entries`, hoursForm);
      toast.success(t('businessHub.staffScheduling.hoursLogged'));
      setShowHoursForm(false);
      setHoursForm(DEFAULT_HOURS);
      await loadSchedule();
    } catch (e) { toast.error(e?.response?.data?.error || t('businessHub.staffScheduling.hoursLogFailed')); }
    finally { setSaving(false); }
  }

  async function handleDeleteEntry(id) {
    try {
      await api.delete(`/businesses/${businessId}/time-entries/${id}`);
      toast.success(t('businessHub.staffScheduling.entryDeleted'));
      await loadSchedule();
    } catch { toast.error(t('businessHub.staffScheduling.entryDeleteFailed')); }
  }

  return (
    <div className="p-4 text-white">
      <h2 className="text-xl font-bold mb-4">{t('businessHub.staffScheduling.title')}</h2>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">

        {/* Schedule panel */}
        <div>
          <div className="flex items-center justify-between mb-3">
            <h3 className="font-semibold text-orange-400">{t('businessHub.staffScheduling.scheduleTitle')}</h3>
            <div className="flex items-center gap-2">
              <button onClick={prevWeek} aria-label={t('businessHub.staffScheduling.previousWeek')} className="bg-gray-700 hover:bg-gray-600 text-white px-2 py-1 rounded text-sm">‹</button>
              <span className="text-xs text-gray-400">{weekStart}</span>
              <button onClick={nextWeek} aria-label={t('businessHub.staffScheduling.nextWeek')} className="bg-gray-700 hover:bg-gray-600 text-white px-2 py-1 rounded text-sm">›</button>
            </div>
          </div>

          {loading ? (
            <div className="text-center text-gray-400 py-6">{t('businessHub.staffScheduling.loadingSchedule')}</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs border-collapse">
                <thead>
                  <tr className="border-b border-gray-700">
                    <th className="text-start pb-2 pe-2 text-gray-400">{t('businessHub.staffScheduling.staff')}</th>
                    {days.map((d, i) => (
                      <th key={d} className="pb-2 px-1 text-gray-400 text-center">
                        {t(`common.weekdays.${DAYS[new Date(d + 'T00:00:00').getDay()]}`)}<br />
                        <span className="text-gray-500">{d.slice(5)}</span>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {schedule.length === 0 ? (
                    <tr>
                      <td colSpan={8} className="text-center text-gray-500 py-4">{t('businessHub.staffScheduling.noShifts')}</td>
                    </tr>
                  ) : schedule.map(person => (
                    <tr key={person.user_id} className="border-b border-gray-800">
                      <td className="py-2 pe-2 font-medium text-white whitespace-nowrap">{person.first_name} {person.last_name?.charAt(0)}.</td>
                      {days.map(d => {
                        const shift = person.shifts.find(s => s.shift_date?.split('T')[0] === d);
                        return (
                          <td key={d} className="py-2 px-1 text-center">
                            {shift ? (
                              <div className="bg-orange-500/20 border border-orange-500/40 rounded p-1 text-orange-300 text-xs">
                                <div>{shift.start_time?.slice(0,5)}-{shift.end_time?.slice(0,5)}</div>
                                {shift.role_label && <div className="text-orange-400 text-xs opacity-75 truncate">{shift.role_label}</div>}
                                <button onClick={() => handleDeleteShift(shift.id)} aria-label={t('businessHub.staffScheduling.deleteShift')} className="text-red-400 hover:text-red-300 text-xs">×</button>
                              </div>
                            ) : <span className="text-gray-700">-</span>}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <button onClick={() => setShowShiftForm(!showShiftForm)}
            className="mt-3 bg-orange-500 hover:bg-orange-600 text-white px-4 py-2 rounded text-sm font-medium">
            + {t('businessHub.staffScheduling.addShift')}
          </button>

          {showShiftForm && (
            <div className="bg-gray-800 border border-gray-700 rounded-lg p-3 mt-3 space-y-2">
              <div>
                <label className="text-xs text-gray-400 block mb-1">{t('businessHub.staffScheduling.staffMember')}</label>
                <select value={shiftForm.user_id} onChange={e => setShiftForm(f => ({ ...f, user_id: e.target.value }))}
                  className="w-full bg-gray-700 border border-gray-600 text-white rounded px-2 py-1 text-sm">
                  <option value="">{t('businessHub.staffScheduling.selectStaff')}</option>
                  {members.map(m => (
                    <option key={m.user_id || m.id} value={m.user_id || m.id}>
                      {m.first_name} {m.last_name}
                    </option>
                  ))}
                </select>
              </div>
              <div className="grid grid-cols-3 gap-2">
                <div>
                  <label className="text-xs text-gray-400 block mb-1">{t('businessHub.staffScheduling.date')}</label>
                  <input type="date" value={shiftForm.shift_date}
                    onChange={e => setShiftForm(f => ({ ...f, shift_date: e.target.value }))}
                    className="w-full bg-gray-700 border border-gray-600 text-white rounded px-2 py-1 text-sm" />
                </div>
                <div>
                  <label className="text-xs text-gray-400 block mb-1">{t('businessHub.staffScheduling.start')}</label>
                  <input type="time" value={shiftForm.start_time}
                    onChange={e => setShiftForm(f => ({ ...f, start_time: e.target.value }))}
                    className="w-full bg-gray-700 border border-gray-600 text-white rounded px-2 py-1 text-sm" />
                </div>
                <div>
                  <label className="text-xs text-gray-400 block mb-1">{t('businessHub.staffScheduling.end')}</label>
                  <input type="time" value={shiftForm.end_time}
                    onChange={e => setShiftForm(f => ({ ...f, end_time: e.target.value }))}
                    className="w-full bg-gray-700 border border-gray-600 text-white rounded px-2 py-1 text-sm" />
                </div>
              </div>
              <div>
                <input value={shiftForm.role_label} onChange={e => setShiftForm(f => ({ ...f, role_label: e.target.value }))}
                  className="w-full bg-gray-700 border border-gray-600 text-white rounded px-2 py-1 text-sm" placeholder={t('businessHub.staffScheduling.roleLabelOptional')} />
              </div>
              <div className="flex gap-2">
                <button onClick={handleAddShift} disabled={saving}
                  className="bg-orange-500 hover:bg-orange-600 text-white px-3 py-1 rounded text-sm disabled:opacity-50">
                  {saving ? t('businessHub.staffScheduling.adding') : t('businessHub.staffScheduling.addShift')}
                </button>
                <button onClick={() => setShowShiftForm(false)} className="bg-gray-700 text-white px-3 py-1 rounded text-sm">{t('common.cancel')}</button>
              </div>
            </div>
          )}
        </div>

        {/* Time entries panel */}
        <div>
          <div className="flex items-center justify-between mb-3">
            <h3 className="font-semibold text-orange-400">{t('businessHub.staffScheduling.timeEntriesTitle')}</h3>
          </div>

          {totals.length > 0 && (
            <div className="mb-3 space-y-1">
              {totals.map(t => (
                <div key={t.user_id} className="flex justify-between text-sm bg-gray-800 rounded px-3 py-1">
                  <span className="text-gray-300">{t.name}</span>
                  <span className="text-orange-400 font-medium">{parseFloat(t.total_hours).toFixed(1)} hrs</span>
                </div>
              ))}
            </div>
          )}

          <button onClick={() => setShowHoursForm(!showHoursForm)}
            className="mb-3 bg-blue-600 hover:bg-blue-500 text-white px-4 py-2 rounded text-sm font-medium">
            + {t('businessHub.staffScheduling.logHours')}
          </button>

          {showHoursForm && (
            <div className="bg-gray-800 border border-gray-700 rounded-lg p-3 mb-3 space-y-2">
              <div>
                <label className="text-xs text-gray-400 block mb-1">{t('businessHub.staffScheduling.staffMember')}</label>
                <select value={hoursForm.user_id} onChange={e => setHoursForm(f => ({ ...f, user_id: e.target.value }))}
                  className="w-full bg-gray-700 border border-gray-600 text-white rounded px-2 py-1 text-sm">
                  <option value="">{t('businessHub.staffScheduling.selectStaff')}</option>
                  {members.map(m => (
                    <option key={m.user_id || m.id} value={m.user_id || m.id}>
                      {m.first_name} {m.last_name}
                    </option>
                  ))}
                </select>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-xs text-gray-400 block mb-1">{t('businessHub.staffScheduling.date')}</label>
                  <input type="date" value={hoursForm.entry_date}
                    onChange={e => setHoursForm(f => ({ ...f, entry_date: e.target.value }))}
                    className="w-full bg-gray-700 border border-gray-600 text-white rounded px-2 py-1 text-sm" />
                </div>
                <div>
                  <label className="text-xs text-gray-400 block mb-1">{t('businessHub.staffScheduling.hoursWorked')}</label>
                  <input type="number" value={hoursForm.hours_worked} step="0.5" min="0.5" max="24"
                    onChange={e => setHoursForm(f => ({ ...f, hours_worked: e.target.value }))}
                  className="w-full bg-gray-700 border border-gray-600 text-white rounded px-2 py-1 text-sm" placeholder={t('businessHub.staffScheduling.hoursPlaceholder')} />
                </div>
              </div>
              <input value={hoursForm.description} onChange={e => setHoursForm(f => ({ ...f, description: e.target.value }))}
                className="w-full bg-gray-700 border border-gray-600 text-white rounded px-2 py-1 text-sm" placeholder={t('businessHub.staffScheduling.descriptionOptional')} />
              <div className="flex gap-2">
                <button onClick={handleLogHours} disabled={saving}
                  className="bg-blue-600 hover:bg-blue-500 text-white px-3 py-1 rounded text-sm disabled:opacity-50">
                  {saving ? t('businessHub.staffScheduling.logging') : t('businessHub.staffScheduling.logHours')}
                </button>
                <button onClick={() => setShowHoursForm(false)} className="bg-gray-700 text-white px-3 py-1 rounded text-sm">{t('common.cancel')}</button>
              </div>
            </div>
          )}

          {entries.length === 0 ? (
            <div className="text-center text-gray-500 py-6 text-sm">{t('businessHub.staffScheduling.noTimeEntries')}</div>
          ) : (
            <div className="space-y-2">
              {entries.map(e => (
                <div key={e.id} className="bg-gray-800 border border-gray-700 rounded px-3 py-2 flex justify-between items-center text-sm">
                  <div>
                    <span className="font-medium text-white">{e.first_name} {e.last_name}</span>
                    <span className="text-gray-400 ms-2">{e.entry_date?.split('T')[0]}</span>
                    {e.description && <div className="text-gray-400 text-xs">{e.description}</div>}
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-orange-400 font-bold">{parseFloat(e.hours_worked).toFixed(1)} {t('businessHub.staffScheduling.hoursUnit')}</span>
                    <button onClick={() => handleDeleteEntry(e.id)} aria-label={t('businessHub.staffScheduling.deleteEntry')} className="text-red-400 hover:text-red-300 text-xs">×</button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
