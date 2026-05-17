import { useState, useEffect, useCallback } from 'react';
import { useParams } from 'react-router-dom';
import adminApi from '../../lib/adminApi';
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
  const { businessId } = useParams();
  const [shifts, setShifts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [formData, setFormData] = useState({
    name: '',
    start_time: '09:00',
    end_time: '17:00',
    max_agents: 10,
    days: ['monday', 'tuesday', 'wednesday', 'thursday', 'friday'],
  });

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
    try {
      await adminApi.post('/support/shifts', {
        ...formData,
        business_id: businessId,
      });
      setShowForm(false);
      setFormData({
        name: '',
        start_time: '09:00',
        end_time: '17:00',
        max_agents: 10,
        days: ['monday', 'tuesday', 'wednesday', 'thursday', 'friday'],
      });
      loadShifts();
    } catch (err) {
      console.error('Failed to save shift:', err);
    }
  };

  const handleDelete = async (shiftId) => {
    if (!window.confirm('Delete this shift?')) return;
    try {
      await adminApi.delete(`/support/shifts/${shiftId}`);
      loadShifts();
    } catch (err) {
      console.error('Failed to delete shift:', err);
    }
  };

  const totalCapacity = shifts.reduce((sum, shift) => sum + (shift.max_agents || 0), 0);

  return (
    <SupportPageShell>
      <SupportHero
        icon={Calendar}
        eyebrow="Coverage Planning"
        title="Support shifts"
        description="Plan shift windows, capacity, and recurring coverage so the support queue always has the right staffing rhythm behind it."
        actions={(
          <>
            <SupportActionButton icon={RefreshCw} onClick={loadShifts} tone="secondary">
              Refresh
            </SupportActionButton>
            <SupportActionButton icon={Plus} onClick={() => setShowForm(true)} tone="primary">
              New shift
            </SupportActionButton>
          </>
        )}
        stats={[
          {
            icon: Calendar,
            label: 'Shifts',
            value: shifts.length,
            detail: 'Configured recurring support shifts.',
          },
          {
            icon: Users,
            label: 'Capacity',
            value: totalCapacity,
            detail: 'Total max-agent capacity across all shifts.',
            tone: 'text-orange-300',
          },
          {
            icon: Clock,
            label: 'Coverage',
            value: shifts.length ? 'Scheduled' : 'Unset',
            detail: shifts.length ? 'At least one recurring coverage window exists.' : 'Create a shift to start coverage planning.',
            tone: 'text-blue-300',
          },
          {
            icon: Calendar,
            label: 'Workweek',
            value: '7-day',
            detail: 'Supports weekday and weekend coverage patterns.',
            tone: 'text-green-300',
          },
        ]}
      />

      <SupportPanel
        title="Shift schedule"
        subtitle="Review recurring coverage blocks and the staffing capacity each one provides."
      >
        {shifts.length === 0 ? (
          <SupportEmptyState
            icon={Calendar}
            title="No shifts configured"
            body="Create the first support shift to start defining queue coverage and staffing capacity."
            action={(
              <SupportActionButton icon={Plus} onClick={() => setShowForm(true)} tone="primary">
                Create first shift
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
                      <SupportTag tone="orange">{shift.max_agents} max agents</SupportTag>
                    </div>
                    <div className="mt-4 flex flex-wrap gap-2">
                      {(shift.days || []).map((day) => (
                        <SupportTag key={day}>{day.slice(0, 3)}</SupportTag>
                      ))}
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    <button className="rounded-xl border border-gray-700 bg-gray-900 p-2 text-gray-400 transition hover:text-white">
                      <Edit2 size={15} />
                    </button>
                    <button
                      onClick={() => handleDelete(shift.id)}
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
                <div className="text-xl font-semibold text-white">New shift</div>
                <div className="mt-1 text-sm text-gray-500">Define a recurring support coverage block.</div>
              </div>
              <button onClick={() => setShowForm(false)} className="text-2xl text-gray-500 hover:text-white">x</button>
            </div>

            <div className="space-y-5 px-6 py-6">
              <div>
                <label className="mb-2 block text-sm text-gray-400">Shift name</label>
                <input
                  type="text"
                  value={formData.name}
                  onChange={(event) => setFormData({ ...formData, name: event.target.value })}
                  className="w-full rounded-2xl border border-gray-700 bg-gray-950 px-4 py-3 text-white focus:border-orange-500 focus:outline-none"
                  placeholder="e.g. Morning Support"
                />
              </div>

              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <div>
                  <label className="mb-2 block text-sm text-gray-400">Start time</label>
                  <input
                    type="time"
                    value={formData.start_time}
                    onChange={(event) => setFormData({ ...formData, start_time: event.target.value })}
                    className="w-full rounded-2xl border border-gray-700 bg-gray-950 px-4 py-3 text-white focus:border-orange-500 focus:outline-none"
                  />
                </div>
                <div>
                  <label className="mb-2 block text-sm text-gray-400">End time</label>
                  <input
                    type="time"
                    value={formData.end_time}
                    onChange={(event) => setFormData({ ...formData, end_time: event.target.value })}
                    className="w-full rounded-2xl border border-gray-700 bg-gray-950 px-4 py-3 text-white focus:border-orange-500 focus:outline-none"
                  />
                </div>
              </div>

              <div>
                <label className="mb-2 block text-sm text-gray-400">Max agents</label>
                <input
                  type="number"
                  value={formData.max_agents}
                  onChange={(event) => setFormData({ ...formData, max_agents: parseInt(event.target.value, 10) || 0 })}
                  min="1"
                  className="w-full rounded-2xl border border-gray-700 bg-gray-950 px-4 py-3 text-white focus:border-orange-500 focus:outline-none"
                />
              </div>

              <div>
                <div className="mb-3 text-sm text-gray-400">Coverage days</div>
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
                        {day}
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="flex gap-3 border-t border-gray-800 pt-5">
                <SupportActionButton tone="secondary" onClick={() => setShowForm(false)}>
                  Cancel
                </SupportActionButton>
                <SupportActionButton tone="primary" onClick={handleSave}>
                  Create shift
                </SupportActionButton>
              </div>
            </div>
          </div>
        </div>
      )}
    </SupportPageShell>
  );
}
