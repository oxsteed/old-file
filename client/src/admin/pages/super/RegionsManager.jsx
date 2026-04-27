import { useEffect, useState } from 'react';
import { Map, Plus, Edit2, Trash2, Loader2, AlertCircle, X } from 'lucide-react';
import adminApi from '../../../lib/adminApi';
import RegionForm from '../../../components/RegionForm';

function summarizeBoundary(def) {
  if (!def || !def.type) return '—';
  switch (def.type) {
    case 'zip_range':
      return `${def.ranges?.length || 0} ZIP range(s)`;
    case 'city_state':
      return `${def.entries?.length || 0} city/state`;
    case 'geo_radius':
      return `${def.radius_miles} mi around (${def.center?.lat?.toFixed(3)}, ${def.center?.lng?.toFixed(3)})`;
    default:
      return def.type;
  }
}

export default function RegionsManager() {
  const [regions,    setRegions]    = useState([]);
  const [loading,    setLoading]    = useState(true);
  const [loadError,  setLoadError]  = useState(null);
  const [editing,    setEditing]    = useState(null); // null, 'new', or region object
  const [deletingId, setDeletingId] = useState(null);

  const load = async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const { data } = await adminApi.get('/admin/super/regions');
      setRegions(data.regions || []);
    } catch (err) {
      setLoadError(err.response?.data?.error || 'Failed to load regions.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const handleSaved = () => {
    setEditing(null);
    load();
  };

  const handleDelete = async (region) => {
    if (!confirm(`Delete region "${region.name}"? This cannot be undone.`)) return;
    setDeletingId(region.id);
    try {
      await adminApi.delete(`/admin/super/regions/${region.id}`);
      await load();
    } catch (err) {
      alert(err.response?.data?.error || 'Failed to delete region.');
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <div className="max-w-5xl mx-auto px-4 py-6">
      <div className="flex items-start justify-between mb-6">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-md bg-orange-900/40 border border-orange-800">
            <Map size={20} className="text-orange-400" />
          </div>
          <div>
            <h1 className="text-xl font-semibold text-gray-100">Admin regions</h1>
            <p className="text-sm text-gray-400">
              Define geographic territories assignable to regional admins via permission grants.
            </p>
          </div>
        </div>
        <button
          onClick={() => setEditing('new')}
          className="inline-flex items-center gap-2 px-3 py-2 rounded-md text-sm font-medium bg-orange-600 hover:bg-orange-500 text-white"
        >
          <Plus size={14} />
          New region
        </button>
      </div>

      {loadError && (
        <div className="flex items-start gap-2 p-3 mb-4 rounded-md bg-red-950 border border-red-800 text-red-300 text-sm">
          <AlertCircle size={16} className="flex-shrink-0 mt-0.5" />
          <span>{loadError}</span>
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center py-12 text-gray-400">
          <Loader2 size={20} className="animate-spin mr-2" />
          Loading regions…
        </div>
      ) : regions.length === 0 ? (
        <div className="text-center py-12 rounded-lg border border-dashed border-gray-800 text-gray-500">
          No regions defined yet.
        </div>
      ) : (
        <div className="rounded-lg border border-gray-800 bg-gray-950 overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-gray-900 text-xs uppercase text-gray-400">
              <tr>
                <th className="text-left px-4 py-3">Name</th>
                <th className="text-left px-4 py-3">Type</th>
                <th className="text-left px-4 py-3">Coverage</th>
                <th className="text-left px-4 py-3">Description</th>
                <th className="text-right px-4 py-3">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-800">
              {regions.map(r => (
                <tr key={r.id} className="hover:bg-gray-900/40">
                  <td className="px-4 py-3 font-medium text-gray-100">{r.name}</td>
                  <td className="px-4 py-3 text-gray-400">
                    {r.boundary_definition?.type || '—'}
                  </td>
                  <td className="px-4 py-3 text-gray-300">
                    {summarizeBoundary(r.boundary_definition)}
                  </td>
                  <td className="px-4 py-3 text-gray-400 max-w-xs truncate">
                    {r.description || '—'}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center justify-end gap-1">
                      <button
                        onClick={() => setEditing(r)}
                        className="p-1.5 rounded text-gray-400 hover:text-orange-400 hover:bg-gray-800"
                        title="Edit"
                      >
                        <Edit2 size={14} />
                      </button>
                      <button
                        onClick={() => handleDelete(r)}
                        disabled={deletingId === r.id}
                        className="p-1.5 rounded text-gray-400 hover:text-red-400 hover:bg-red-950 disabled:opacity-40"
                        title="Delete"
                      >
                        {deletingId === r.id
                          ? <Loader2 size={14} className="animate-spin" />
                          : <Trash2 size={14} />}
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Drawer / modal */}
      {editing && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="w-full max-w-2xl bg-gray-950 border border-gray-800 rounded-lg shadow-xl">
            <div className="flex items-center justify-between px-5 py-3 border-b border-gray-800">
              <h2 className="text-base font-semibold text-gray-100">
                {editing === 'new' ? 'New region' : `Edit region: ${editing.name}`}
              </h2>
              <button
                onClick={() => setEditing(null)}
                className="p-1 rounded hover:bg-gray-800 text-gray-400 hover:text-gray-100"
              >
                <X size={16} />
              </button>
            </div>
            <div className="p-5 max-h-[70vh] overflow-y-auto">
              <RegionForm
                region={editing === 'new' ? null : editing}
                onSaved={handleSaved}
                onCancel={() => setEditing(null)}
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
