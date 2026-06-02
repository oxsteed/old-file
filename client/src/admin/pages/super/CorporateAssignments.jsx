import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Plus, X, Building2, MapPin, Calendar, Trash2, Edit3,
  AlertTriangle, Crown, Shield, Loader2, ChevronDown,
} from 'lucide-react';
import toast from 'react-hot-toast';
import adminApi from '../../lib/adminApi';
import {
  getCorporateCatalog,
  listCorporateAssignments,
  createCorporateAssignment,
  updateCorporateAssignment,
  endCorporateAssignment,
} from '../../../api/corporateRoles';

function fmtDate(d) {
  if (!d) return '-';
  return new Date(d).toLocaleDateString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric',
  });
}

function userName(row) {
  const f = row.user_first_name || row.first_name || '';
  const l = row.user_last_name  || row.last_name  || '';
  const full = `${f} ${l}`.trim();
  return full || row.user_email || row.email || row.user_id;
}

function StatusPill({ assignment }) {
  if (assignment.is_active) {
    return (
      <span className="px-2 py-0.5 text-xs rounded-full bg-green-900 text-green-300 font-medium">
        Active
      </span>
    );
  }
  return (
    <span className="px-2 py-0.5 text-xs rounded-full bg-gray-700 text-gray-300 font-medium">
      Ended
    </span>
  );
}

// ── Assign modal ──────────────────────────────────────────────────────────

function AssignModal({ catalog, regions, initial, onClose, onSaved }) {
  const isEdit = Boolean(initial?.id);

  const [admins, setAdmins] = useState([]);
  const [form, setForm] = useState({
    user_id:            initial?.user_id || '',
    department_id:      initial?.department_id || '',
    title_id:           initial?.title_id || '',
    country_code:       initial?.country_code || '',
    region_id:          initial?.region_id || '',
    reports_to_user_id: initial?.reports_to_user_id || '',
    notes:              initial?.notes || '',
  });
  const [saving, setSaving] = useState(false);
  const [error,  setError]  = useState(null);

  useEffect(() => {
    adminApi.get('/admin/super/internal-staff')
      .then(({ data }) => {
        const list = (data.accounts || data.admins || [])
          .filter(a => a.is_active !== false);
        setAdmins(list);
      })
      .catch(() => setAdmins([]));
  }, []);

  // When department changes, clear title (unless still in dept)
  const titlesForDept = useMemo(() => {
    if (!form.department_id) return [];
    return (catalog?.titles || []).filter(t => t.department_id === Number(form.department_id));
  }, [catalog, form.department_id]);

  function setF(k, v) { setForm(f => ({ ...f, [k]: v })); }

  async function handleSubmit(e) {
    e.preventDefault();
    setError(null);
    if (!form.user_id || !form.title_id) {
      setError('User and title are required.');
      return;
    }
    setSaving(true);
    try {
      const payload = {
        user_id:  form.user_id,
        title_id: Number(form.title_id),
        country_code: form.country_code || null,
        region_id:    form.region_id ? Number(form.region_id) : null,
        reports_to_user_id: form.reports_to_user_id || null,
        notes: form.notes || null,
      };
      if (isEdit) {
        await updateCorporateAssignment(initial.id, payload);
      } else {
        await createCorporateAssignment(payload);
      }
      onSaved();
    } catch (e) {
      setError(e?.response?.data?.error || 'Failed to save assignment.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div className="bg-gray-900 border border-gray-700 rounded-xl p-6 w-full max-w-2xl shadow-2xl max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between mb-5">
          <h2 className="text-white font-semibold text-lg">
            {isEdit ? 'Edit corporate assignment' : 'Assign corporate title'}
          </h2>
          <button onClick={onClose} className="text-gray-500 hover:text-gray-300">
            <X size={18} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          {/* user */}
          <div>
            <label className="block text-sm text-gray-400 mb-1">Internal user *</label>
            <select
              value={form.user_id}
              onChange={(e) => setF('user_id', e.target.value)}
              disabled={isEdit}
              className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white"
            >
              <option value="">- Select an internal staff member -</option>
              {admins.map(a => (
                <option key={a.id} value={a.id}>
                  {(a.first_name || '') + ' ' + (a.last_name || '')} - {a.email} ({a.role})
                </option>
              ))}
            </select>
            <p className="text-xs text-gray-500 mt-1">
              Corporate titles can be held by employees, admins, and super-admins.
            </p>
          </div>

          {/* department */}
          <div>
            <label className="block text-sm text-gray-400 mb-1">Department *</label>
            <select
              value={form.department_id}
              onChange={(e) => { setF('department_id', e.target.value); setF('title_id', ''); }}
              disabled={isEdit}
              className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white"
            >
              <option value="">- Select department -</option>
              {(catalog?.departments || []).map(d => (
                <option key={d.id} value={d.id}>{d.name}</option>
              ))}
            </select>
          </div>

          {/* title */}
          <div>
            <label className="block text-sm text-gray-400 mb-1">Title *</label>
            <select
              value={form.title_id}
              onChange={(e) => setF('title_id', e.target.value)}
              disabled={!form.department_id || isEdit}
              className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white"
            >
              <option value="">- Select title -</option>
              {titlesForDept.map(t => (
                <option key={t.id} value={t.id}>
                  {t.name}{t.is_csuite ? ' (C-suite)' : ''} - L{t.seniority_level}
                </option>
              ))}
            </select>
            <p className="text-xs text-gray-500 mt-1">
              Higher seniority levels and C-suite titles can only be assigned by super-admin.
            </p>
          </div>

          {/* country + region */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm text-gray-400 mb-1">Country (ISO-2)</label>
              <input
                type="text"
                value={form.country_code}
                onChange={(e) => setF('country_code', e.target.value.toUpperCase().slice(0, 2))}
                placeholder="e.g. US, MX, HT, FR"
                className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white"
              />
              <p className="text-xs text-gray-500 mt-1">Empty = global scope</p>
            </div>
            <div>
              <label className="block text-sm text-gray-400 mb-1">Region</label>
              <select
                value={form.region_id}
                onChange={(e) => setF('region_id', e.target.value)}
                className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white"
              >
                <option value="">- None -</option>
                {(regions || []).map(r => (
                  <option key={r.id} value={r.id}>{r.name}</option>
                ))}
              </select>
            </div>
          </div>

          {/* reports to */}
          <div>
            <label className="block text-sm text-gray-400 mb-1">Reports to</label>
            <select
              value={form.reports_to_user_id}
              onChange={(e) => setF('reports_to_user_id', e.target.value)}
              className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white"
            >
              <option value="">- None -</option>
              {admins.map(a => (
                <option key={a.id} value={a.id}>
                  {(a.first_name || '') + ' ' + (a.last_name || '')} - {a.email}
                </option>
              ))}
            </select>
          </div>

          {/* notes */}
          <div>
            <label className="block text-sm text-gray-400 mb-1">Notes</label>
            <textarea
              value={form.notes}
              onChange={(e) => setF('notes', e.target.value)}
              rows={3}
              maxLength={1000}
              className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white"
            />
          </div>

          {error && (
            <div className="text-sm text-red-300 bg-red-900/30 border border-red-900 rounded-lg px-3 py-2 flex items-center gap-2">
              <AlertTriangle size={16} />
              {error}
            </div>
          )}

          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-sm text-gray-400 hover:text-white"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving}
              className="px-4 py-2 text-sm font-medium bg-orange-500 hover:bg-orange-600 disabled:opacity-50 text-white rounded-lg flex items-center gap-2"
            >
              {saving && <Loader2 size={14} className="animate-spin" />}
              {isEdit ? 'Save changes' : 'Assign title'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────

export default function CorporateAssignments() {
  const { t } = useTranslation();

  const [catalog,     setCatalog]     = useState(null);
  const [regions,     setRegions]     = useState([]);
  const [assignments, setAssignments] = useState([]);
  const [filters, setFilters] = useState({
    department_id: '', title_id: '', country: '', active: 'true',
  });
  const [loading,     setLoading]     = useState(true);
  const [error,       setError]       = useState(null);
  const [modalState,  setModalState]  = useState(null); // null | { initial? }

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [cat, regs, assigns] = await Promise.all([
        getCorporateCatalog(),
        adminApi.get('/admin/regions').then(r => r.data?.regions || r.data?.data || [])
          .catch(() => []),
        listCorporateAssignments(filters),
      ]);
      setCatalog(cat);
      setRegions(regs);
      setAssignments(assigns);
    } catch (e) {
      setError(e?.response?.data?.error || 'Failed to load assignments.');
    } finally {
      setLoading(false);
    }
  }, [filters]);

  useEffect(() => { load(); }, [load]);

  function setFilter(k, v) { setFilters(f => ({ ...f, [k]: v })); }

  async function handleEnd(id) {
    if (!window.confirm('End this assignment? The user will lose its associated permissions.')) return;
    try {
      await endCorporateAssignment(id);
      await load();
    } catch (e) {
      toast.error(e?.response?.data?.error || 'Failed to end assignment.');
    }
  }

  const titlesForFilterDept = useMemo(() => {
    if (!filters.department_id) return catalog?.titles || [];
    return (catalog?.titles || []).filter(t => t.department_id === Number(filters.department_id));
  }, [catalog, filters.department_id]);

  return (
    <div className="p-6 max-w-7xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-semibold text-white flex items-center gap-2">
            <Building2 size={22} />
            Corporate Assignments
          </h1>
          <p className="text-gray-400 text-sm mt-1">
            Assign corporate titles to OxSteed staff. Country-scoped, override-aware.
          </p>
        </div>
        <button
          onClick={() => setModalState({})}
          className="px-4 py-2 text-sm font-medium bg-orange-500 hover:bg-orange-600 text-white rounded-lg flex items-center gap-2"
        >
          <Plus size={16} /> Assign title
        </button>
      </div>

      {/* filters */}
      <div className="bg-gray-900 border border-gray-800 rounded-xl p-4 mb-5 grid grid-cols-2 md:grid-cols-4 gap-3">
        <select
          value={filters.department_id}
          onChange={(e) => setFilter('department_id', e.target.value)}
          className="bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white text-sm"
        >
          <option value="">All departments</option>
          {(catalog?.departments || []).map(d => (
            <option key={d.id} value={d.id}>{d.name}</option>
          ))}
        </select>
        <select
          value={filters.title_id}
          onChange={(e) => setFilter('title_id', e.target.value)}
          className="bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white text-sm"
        >
          <option value="">All titles</option>
          {titlesForFilterDept.map(t => (
            <option key={t.id} value={t.id}>{t.name}</option>
          ))}
        </select>
        <input
          type="text"
          placeholder="Country (ISO-2)"
          value={filters.country}
          onChange={(e) => setFilter('country', e.target.value.toUpperCase().slice(0, 2))}
          className="bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white text-sm"
        />
        <select
          value={filters.active}
          onChange={(e) => setFilter('active', e.target.value)}
          className="bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white text-sm"
        >
          <option value="true">Active only</option>
          <option value="false">Ended only</option>
        </select>
      </div>

      {error && (
        <div className="bg-red-900/30 border border-red-900 rounded-lg px-4 py-3 mb-4 text-red-300 text-sm">
          {error}
        </div>
      )}

      <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
        {loading ? (
          <div className="p-10 text-center text-gray-400">
            <Loader2 className="inline animate-spin mr-2" size={18} /> Loading...
          </div>
        ) : assignments.length === 0 ? (
          <div className="p-10 text-center text-gray-500">
            No assignments match the current filters.
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-gray-950 text-gray-400 text-xs uppercase">
              <tr>
                <th className="text-left px-4 py-3">User</th>
                <th className="text-left px-4 py-3">Title</th>
                <th className="text-left px-4 py-3">Department</th>
                <th className="text-left px-4 py-3">Scope</th>
                <th className="text-left px-4 py-3">Started</th>
                <th className="text-left px-4 py-3">Status</th>
                <th className="px-4 py-3"></th>
              </tr>
            </thead>
            <tbody>
              {assignments.map(row => (
                <tr key={row.id} className="border-t border-gray-800 hover:bg-gray-950">
                  <td className="px-4 py-3">
                    <div className="text-white">{userName(row)}</div>
                    <div className="text-xs text-gray-500">{row.user_email}</div>
                  </td>
                  <td className="px-4 py-3">
                    <div className="text-white flex items-center gap-2">
                      {row.is_csuite && <Crown size={14} className="text-yellow-400" />}
                      {row.title_name}
                    </div>
                    <div className="text-xs text-gray-500">L{row.seniority_level}</div>
                  </td>
                  <td className="px-4 py-3 text-gray-300">{row.department_name}</td>
                  <td className="px-4 py-3 text-gray-300">
                    <div className="flex items-center gap-1 text-xs">
                      <MapPin size={12} />
                      {row.country_code || 'Global'}
                      {row.region_name ? ` / ${row.region_name}` : ''}
                    </div>
                  </td>
                  <td className="px-4 py-3 text-gray-400 text-xs">{fmtDate(row.started_at)}</td>
                  <td className="px-4 py-3"><StatusPill assignment={row} /></td>
                  <td className="px-4 py-3 text-right">
                    <button
                      onClick={() => setModalState({ initial: row })}
                      className="text-gray-400 hover:text-white p-1"
                      title="Edit"
                    >
                      <Edit3 size={15} />
                    </button>
                    {row.is_active && (
                      <button
                        onClick={() => handleEnd(row.id)}
                        className="text-gray-400 hover:text-red-400 p-1 ml-1"
                        title="End assignment"
                      >
                        <Trash2 size={15} />
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {modalState && (
        <AssignModal
          catalog={catalog}
          regions={regions}
          initial={modalState.initial}
          onClose={() => setModalState(null)}
          onSaved={async () => { setModalState(null); await load(); }}
        />
      )}
    </div>
  );
}
