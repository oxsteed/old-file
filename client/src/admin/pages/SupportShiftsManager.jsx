import { useState, useEffect, useCallback } from 'react';
import { useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import adminApi from '../../lib/adminApi';
import toast from 'react-hot-toast';
import {
  Clock,
  Plus,
  Edit2,
  Trash2,
  RefreshCw,
  Calendar,
  Users,
} from 'lucide-react';
import {
  SupportPageShell,
  SupportHero,
  SupportPanel,
  SupportEmptyState,
  SupportActionButton,
  SupportTag,
} from '../components/support/SupportPageChrome';

const DAY_OPTIONS = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];

export default function SupportShiftsManager() {
  const { t } = useTranslation();
  const { businessId } = useParams();
  const [shifts, setShifts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editingShiftId, setEditingShiftId] = useState(null);
  const [formData, setFormData] = useState({
    name: '',
    start_time: '09:00',
    end_time: '17:00',
    max_agents: 10,
    days: ['monday', 'tuesday', 'wednesday', 'thursday', 'friday'],
  });

  // Day identifiers are API values; display labels are localized.
  const dayName = (day) => t(`adminSupportShifts.day${day.charAt(0).toUpperCase()}${day.slice(1)}`);
  const dayShort = (day) => t(`adminSupportShifts.day${day.charAt(0).toUpperCase()}${day.slice(1)}Short`);

  const loadShifts = useCallback(async () => {
    setLoading(true);
    try {
      const res = await adminApi.get('/support/shifts', {
        params: { business_id: businessId },
      });
      setShifts(res.data.shifts || []);
    } catch (err) {
      console.error('Failed to load shifts:', err);
      setShifts([]);
    } finally {
      setLoading(false);
    }
  }, [businessId]);

  useEffect(() => {
    loadShifts();
  }, [loadShifts]);

  const handleSave = async () => {
    if (!formData.name.trim()) {
      toast.error(t('adminSupportShifts.toastNameRequired'));
      return;
    }
    if (!formData.start_time || !formData.end_time) {
      toast.error(t('adminSupportShifts.toastTimesRequired'));
      return;
    }
    if (formData.end_time <= formData.start_time) {
      toast.error(t('adminSupportShifts.toastEndAfterStart'));
      return;
    }
    const maxAgents = parseInt(formData.max_agents, 10);
    if (!Number.isInteger(maxAgents) || maxAgents < 1) {
      toast.error(t('adminSupportShifts.toastMinAgents'));
      return;
    }

    const payload = {
      ...formData,
      name: formData.name.trim(),
      max_agents: maxAgents,
      days: formData.days,
    };

    try {
      if (editingShiftId) {
        await adminApi.patch(`/support/shifts/${editingShiftId}`, {
          ...payload,
          business_id: businessId,
        });
      } else {
        await adminApi.post('/support/shifts', {
          ...payload,
          business_id: businessId,
        });
      }
      setShowForm(false);
      setEditingShiftId(null);
      setFormData({
        name: '',
        start_time: '09:00',
        end_time: '17:00',
        max_agents: 10,
        days: ['monday', 'tuesday', 'wednesday', 'thursday', 'friday'],
      });
      loadShifts();
      toast.success(editingShiftId ? t('adminSupportShifts.toastUpdated') : t('adminSupportShifts.toastCreated'));
    } catch (err) {
      console.error('Failed to save shift:', err);
      toast.error(t('adminSupportShifts.toastSaveFailed'));
    }
  };

  const handleEditShift = (shift) => {
    setEditingShiftId(shift.id);
    setShowForm(true);
    setFormData({
      name: shift.name || '',
      start_time: shift.start_time || '09:00',
      end_time: shift.end_time || '17:00',
      max_agents: shift.max_agents || 10,
      days: Array.isArray(shift.days) && shift.days.length
        ? shift.days
        : ['monday', 'tuesday', 'wednesday', 'thursday', 'friday'],
    });
  };

  const handleNewShift = () => {
    setEditingShiftId(null);
    setShowForm(true);
    setFormData({
      name: '',
      start_time: '09:00',
      end_time: '17:00',
      max_agents: 10,
      days: ['monday', 'tuesday', 'wednesday', 'thursday', 'friday'],
    });
  };

  const handleCancelForm = () => {
    setShowForm(false);
    setEditingShiftId(null);
    setFormData({
      name: '',
      start_time: '09:00',
      end_time: '17:00',
      max_agents: 10,
      days: ['monday', 'tuesday', 'wednesday', 'thursday', 'friday'],
    });
  };

  const handleDelete = async (shiftId) => {
    if (!window.confirm(t('adminSupportShifts.confirmDelete'))) return;
    try {
      await adminApi.delete(`/support/shifts/${shiftId}`);
      toast.success(t('adminSupportShifts.toastDeleted', { defaultValue: 'Shift deleted.' }));
      loadShifts();
    } catch (err) {
      console.error('Failed to delete shift:', err);
      toast.error(err?.response?.data?.error || t('adminSupportShifts.toastDeleteFailed', { defaultValue: 'Failed to delete the shift.' }));
    }
  };

  const totalCapacity = shifts.reduce((sum, shift) => sum + (shift.max_agents || 0), 0);

  return (
    <SupportPageShell>
      <SupportHero
        icon={Calendar}
        eyebrow={t('adminSupportShifts.heroEyebrow')}
        title={t('adminSupportShifts.heroTitle')}
        description={t('adminSupportShifts.heroDescription')}
        actions={(
          <>
              <SupportActionButton icon={RefreshCw} onClick={loadShifts} tone="secondary">
                {t('common.refresh')}
              </SupportActionButton>
            <SupportActionButton icon={Plus} onClick={handleNewShift} tone="primary">
              {t('adminSupportShifts.newShift')}
            </SupportActionButton>
          </>
        )}
        stats={[
          {
            icon: Calendar,
            label: t('adminSupportShifts.statShifts'),
            value: shifts.length,
            detail: t('adminSupportShifts.statShiftsDetail'),
          },
          {
            icon: Users,
            label: t('adminSupportShifts.statCapacity'),
            value: totalCapacity,
            detail: t('adminSupportShifts.statCapacityDetail'),
            tone: 'text-orange-300',
          },
          {
            icon: Clock,
            label: t('adminSupportShifts.statCoverage'),
            value: shifts.length ? t('adminSupportShifts.coverageScheduled') : t('adminSupportShifts.coverageUnset'),
            detail: shifts.length ? t('adminSupportShifts.coverageScheduledDetail') : t('adminSupportShifts.coverageUnsetDetail'),
            tone: 'text-blue-300',
          },
          {
            icon: Calendar,
            label: t('adminSupportShifts.statWorkweek'),
            value: t('adminSupportShifts.workweekValue'),
            detail: t('adminSupportShifts.workweekDetail'),
            tone: 'text-green-300',
          },
        ]}
      />

      <SupportPanel
        title={t('adminSupportShifts.panelTitle')}
        subtitle={t('adminSupportShifts.panelSubtitle')}
      >
        {shifts.length === 0 ? (
          <SupportEmptyState
            icon={Calendar}
            title={t('adminSupportShifts.emptyTitle')}
            body={t('adminSupportShifts.emptyBody')}
            action={(
              <SupportActionButton icon={Plus} onClick={handleNewShift} tone="primary">
                {t('adminSupportShifts.emptyAction')}
              </SupportActionButton>
            )}
          />
        ) : (
          <div className="grid grid-cols-1 gap-4">
            {shifts.map((shift) => (
              <div key={shift.id} className="rounded-[24px] border border-gray-800 bg-gray-900/70 p-5">
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0 flex-1">
                    <div className="text-lg font-semibold text-white">{shift.name}</div>
                    <div className="mt-2 flex flex-wrap items-center gap-2">
                      <SupportTag tone="blue">
                        {shift.start_time} - {shift.end_time}
                      </SupportTag>
                      <SupportTag tone="orange">{t('adminSupportShifts.maxAgents', { count: shift.max_agents || 0 })}</SupportTag>
                    </div>
                    <div className="mt-4 flex flex-wrap gap-2">
                      {(shift.days || []).map((day) => (
                        <SupportTag key={day}>{dayShort(day)}</SupportTag>
                      ))}
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => handleEditShift(shift)}
                      className="rounded-xl border border-gray-700 bg-gray-900 p-2 text-gray-400 transition hover:text-white"
                      aria-label={t('adminSupportShifts.editShiftAria', { name: shift.name })}
                    >
                      <Edit2 size={15} />
                    </button>
                    <button
                      onClick={() => handleDelete(shift.id)}
                      aria-label={t('adminSupportShifts.deleteShiftAria', { name: shift.name })}
                      className="rounded-xl border border-red-900/40 bg-red-950/30 p-2 text-red-400 transition hover:bg-red-900/30"
                    >
                      <Trash2 size={15} />
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </SupportPanel>

      {showForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="w-full max-w-xl rounded-[28px] border border-gray-700 bg-gray-900 shadow-2xl">
            <div className="flex items-center justify-between border-b border-gray-800 px-6 py-5">
              <div>
            <div className="text-xl font-semibold text-white">{editingShiftId ? t('adminSupportShifts.modalEditTitle') : t('adminSupportShifts.modalNewTitle')}</div>
            <div className="mt-1 text-sm text-gray-500">{editingShiftId ? t('adminSupportShifts.modalEditSubtitle') : t('adminSupportShifts.modalNewSubtitle')}</div>
          </div>
            <button onClick={handleCancelForm} className="text-2xl text-gray-500 hover:text-white">x</button>
            </div>

            <div className="space-y-5 px-6 py-6">
              <div>
                <label className="mb-2 block text-sm text-gray-400">{t('adminSupportShifts.labelName')}</label>
                <input
                  type="text"
                  value={formData.name}
                  onChange={(event) => setFormData({ ...formData, name: event.target.value })}
                  className="w-full rounded-2xl border border-gray-700 bg-gray-950 px-4 py-3 text-white focus:border-orange-500 focus:outline-none"
                  placeholder={t('adminSupportShifts.namePlaceholder')}
                />
              </div>

              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <div>
                  <label className="mb-2 block text-sm text-gray-400">{t('adminSupportShifts.labelStart')}</label>
                  <input
                    type="time"
                    value={formData.start_time}
                    onChange={(event) => setFormData({ ...formData, start_time: event.target.value })}
                    className="w-full rounded-2xl border border-gray-700 bg-gray-950 px-4 py-3 text-white focus:border-orange-500 focus:outline-none"
                  />
                </div>
                <div>
                  <label className="mb-2 block text-sm text-gray-400">{t('adminSupportShifts.labelEnd')}</label>
                  <input
                    type="time"
                    value={formData.end_time}
                    onChange={(event) => setFormData({ ...formData, end_time: event.target.value })}
                    className="w-full rounded-2xl border border-gray-700 bg-gray-950 px-4 py-3 text-white focus:border-orange-500 focus:outline-none"
                  />
                </div>
              </div>

              <div>
                <label className="mb-2 block text-sm text-gray-400">{t('adminSupportShifts.labelMaxAgents')}</label>
                <input
                  type="number"
                  value={formData.max_agents}
                  onChange={(event) => setFormData({ ...formData, max_agents: event.target.value })}
                  min="1"
                  className="w-full rounded-2xl border border-gray-700 bg-gray-950 px-4 py-3 text-white focus:border-orange-500 focus:outline-none"
                />
              </div>

              <div>
                <div className="mb-3 text-sm text-gray-400">{t('adminSupportShifts.labelDays')}</div>
                <div className="flex flex-wrap gap-2">
                  {DAY_OPTIONS.map((day) => {
                    const selected = formData.days.includes(day);
                    return (
                      <button
                        key={day}
                        onClick={() => setFormData({
                          ...formData,
                          days: selected ? formData.days.filter((item) => item !== day) : [...formData.days, day],
                        })}
                        className={`rounded-full border px-3 py-2 text-sm capitalize transition ${
                          selected
                            ? 'border-orange-500/30 bg-orange-500/10 text-orange-300'
                            : 'border-gray-700 bg-gray-950 text-gray-400 hover:border-gray-600'
                        }`}
                      >
                        {dayName(day)}
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="flex gap-3 border-t border-gray-800 pt-5">
              <SupportActionButton tone="secondary" onClick={handleCancelForm}>
                {t('common.cancel')}
              </SupportActionButton>
              <SupportActionButton tone="primary" onClick={handleSave}>
                  {editingShiftId ? t('adminSupportShifts.saveChanges') : t('adminSupportShifts.createShift')}
              </SupportActionButton>
              </div>
            </div>
          </div>
        </div>
      )}
    </SupportPageShell>
  );
}
