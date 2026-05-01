import { useState, useEffect, useCallback } from 'react';
import { useParams } from 'react-router-dom';
import adminApi from '../../lib/adminApi';
import { Clock, Plus, Edit2, Trash2, RefreshCw, Calendar } from 'lucide-react';

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
    }
    setLoading(false);
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
      setFormData({ name: '', start_time: '09:00', end_time: '17:00', max_agents: 10, days: [] });
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

  return (
    <div className="p-6 max-w-5xl mx-auto">
      <div className="flex items-start justify-between mb-8">
        <div>
          <h1 className="text-white font-bold text-3xl mb-2">Shifts Manager</h1>
          <p className="text-gray-400 text-sm">Create and manage support team shifts.</p>
        </div>
        <div className="flex gap-3">
          <button
            onClick={loadShifts}
            disabled={loading}
            className="p-2.5 bg-gray-700 border border-gray-600 text-gray-400 rounded-lg hover:text-white transition"
          >
            <RefreshCw size={18} className={loading ? 'animate-spin' : ''} />
          </button>
          <button
            onClick={() => setShowForm(true)}
            className="flex items-center gap-2 px-4 py-2.5 bg-orange-600 hover:bg-orange-700 text-white rounded-lg font-medium transition"
          >
            <Plus size={18} />
            New Shift
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-5 mb-8">
        <div className="bg-gray-800 border border-gray-700 rounded-xl p-6">
          <p className="text-gray-400 text-sm mb-2">Total Shifts</p>
          <p className="text-white text-3xl font-bold">{shifts.length}</p>
        </div>
        <div className="bg-gray-800 border border-gray-700 rounded-xl p-6">
          <p className="text-gray-400 text-sm mb-2">Total Capacity</p>
          <p className="text-white text-3xl font-bold">{shifts.reduce((sum, s) => sum + (s.max_agents || 0), 0)}</p>
          <p className="text-gray-500 text-xs mt-2">agents</p>
        </div>
        <div className="bg-gray-800 border border-gray-700 rounded-xl p-6">
          <p className="text-gray-400 text-sm mb-2">Coverage</p>
          <p className="text-white text-3xl font-bold">24/7</p>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4">
        {shifts.length === 0 ? (
          <div className="text-center py-12 bg-gray-800 border border-gray-700 rounded-xl">
            <Calendar size={40} className="mx-auto mb-3 text-gray-600" />
            <p className="text-gray-400 mb-4">No shifts configured</p>
            <button
              onClick={() => setShowForm(true)}
              className="px-4 py-2 bg-orange-600 hover:bg-orange-700 text-white rounded-lg transition"
            >
              Create First Shift
            </button>
          </div>
        ) : (
          shifts.map(shift => (
            <div key={shift.id} className="bg-gray-800 border border-gray-700 rounded-xl p-6">
              <div className="flex items-start justify-between">
                <div className="flex-1">
                  <h3 className="text-white font-bold text-lg mb-2">{shift.name}</h3>
                  <div className="flex items-center gap-4 text-sm text-gray-400">
                    <span className="flex items-center gap-1">
                      <Clock size={14} />
                      {shift.start_time} - {shift.end_time}
                    </span>
                    <span>{shift.max_agents} max agents</span>
                    <span className="flex flex-wrap gap-1">
                      {(shift.days || []).map(d => (
                        <span key={d} className="px-2 py-1 bg-gray-700 rounded text-xs">
                          {d.slice(0, 3)}
                        </span>
                      ))}
                    </span>
                  </div>
                </div>
                <div className="flex gap-2">
                  <button className="p-2 hover:bg-gray-700 rounded transition">
                    <Edit2 size={16} className="text-gray-400" />
                  </button>
                  <button onClick={() => handleDelete(shift.id)} className="p-2 hover:bg-red-900/30 rounded transition">
                    <Trash2 size={16} className="text-red-400" />
                  </button>
                </div>
              </div>
            </div>
          ))
        )}
      </div>

      {showForm && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-gray-800 border border-gray-700 rounded-xl max-w-lg w-full mx-4">
            <div className="border-b border-gray-700 p-6 flex items-center justify-between">
              <h2 className="text-white font-bold text-xl">New Shift</h2>
              <button onClick={() => setShowForm(false)} className="text-gray-500 hover:text-white text-2xl">×</button>
            </div>
            <div className="p-6 space-y-4">
              <div>
                <label className="block text-gray-400 text-sm mb-2">Shift Name</label>
                <input
                  type="text"
                  value={formData.name}
                  onChange={e => setFormData({ ...formData, name: e.target.value })}
                  className="w-full px-4 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white focus:outline-none focus:border-orange-500"
                  placeholder="e.g., Morning Shift"
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-gray-400 text-sm mb-2">Start Time</label>
                  <input
                    type="time"
                    value={formData.start_time}
                    onChange={e => setFormData({ ...formData, start_time: e.target.value })}
                    className="w-full px-4 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white focus:outline-none focus:border-orange-500"
                  />
                </div>
                <div>
                  <label className="block text-gray-400 text-sm mb-2">End Time</label>
                  <input
                    type="time"
                    value={formData.end_time}
                    onChange={e => setFormData({ ...formData, end_time: e.target.value })}
                    className="w-full px-4 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white focus:outline-none focus:border-orange-500"
                  />
                </div>
              </div>
              <div>
                <label className="block text-gray-400 text-sm mb-2">Max Agents</label>
                <input
                  type="number"
                  value={formData.max_agents}
                  onChange={e => setFormData({ ...formData, max_agents: parseInt(e.target.value) })}
                  className="w-full px-4 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white focus:outline-none focus:border-orange-500"
                  min="1"
                />
              </div>
              <div className="flex gap-3 pt-4 border-t border-gray-700">
                <button
                  onClick={() => setShowForm(false)}
                  className="flex-1 px-4 py-2 bg-gray-700 hover:bg-gray-600 text-white rounded-lg transition"
                >
                  Cancel
                </button>
                <button
                  onClick={handleSave}
                  className="flex-1 px-4 py-2 bg-orange-600 hover:bg-orange-700 text-white rounded-lg transition font-medium"
                >
                  Create Shift
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
