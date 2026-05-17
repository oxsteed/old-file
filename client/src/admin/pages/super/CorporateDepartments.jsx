import { useCallback, useEffect, useState } from 'react';
import {
  Building2, Plus, Edit3, X, AlertTriangle, Loader2,
  Crown, ChevronDown, ChevronRight, Shield,
} from 'lucide-react';
import {
  getCorporateCatalog,
  upsertCorporateDepartment,
  upsertCorporateTitle,
  setDepartmentDefaultPermissions,
} from '../../../api/corporateRoles';

// ── Department edit modal ────────────────────────────────────────────────

function DepartmentModal({ initial, onClose, onSaved }) {
  const [form, setForm] = useState({
    id: initial?.id || null,
    code: initial?.code || '',
    name: initial?.name || '',
    description: initial?.description || '',
    icon: initial?.icon || '',
    color: initial?.color || '#7c3aed',
    sort_order: initial?.sort_order ?? 0,
    is_active: initial?.is_active ?? true,
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  function setF(k, v) { setForm(f => ({ ...f, [k]: v })); }

  async function handleSubmit(e) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      await upsertCorporateDepartment(form);
      onSaved();
    } catch (e) {
      setError(e?.response?.data?.error || 'Failed to save.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div className="bg-gray-900 border border-gray-700 rounded-xl p-6 w-full max-w-lg shadow-2xl">
        <div className="flex items-center justify-between mb-5">
          <h2 className="text-white font-semibold text-lg">
            {initial ? 'Edit department' : 'New department'}
          </h2>
          <button onClick={onClose} className="text-gray-500 hover:text-gray-300"><X size={18} /></button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm text-gray-400 mb-1">Code *</label>
              <input
                type="text"
                value={form.code}
                onChange={(e) => setF('code', e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, '_'))}
                disabled={Boolean(initial)}
                className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white"
              />
            </div>
            <div>
              <label className="block text-sm text-gray-400 mb-1">Name *</label>
              <input
                type="text"
                value={form.name}
                onChange={(e) => setF('name', e.target.value)}
                className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white"
              />
            </div>
          </div>

          <div>
            <label className="block text-sm text-gray-400 mb-1">Description</label>
            <textarea
              value={form.description}
              onChange={(e) => setF('description', e.target.value)}
              rows={2}
              className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white"
            />
          </div>

          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="block text-sm text-gray-400 mb-1">Color</label>
              <input
                type="color"
                value={form.color}
                onChange={(e) => setF('color', e.target.value)}
                className="w-full h-10 bg-gray-800 border border-gray-700 rounded-lg cursor-pointer"
              />
            </div>
            <div>
              <label className="block text-sm text-gray-400 mb-1">Icon</label>
              <input
                type="text"
                value={form.icon}
                onChange={(e) => setF('icon', e.target.value)}
                placeholder="lucide name"
                className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white"
              />
            </div>
            <div>
              <label className="block text-sm text-gray-400 mb-1">Sort</label>
              <input
                type="number"
                value={form.sort_order}
                onChange={(e) => setF('sort_order', Number(e.target.value))}
                className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white"
              />
            </div>
          </div>

          <label className="flex items-center gap-2 text-sm text-gray-300">
            <input
              type="checkbox"
              checked={form.is_active}
              onChange={(e) => setF('is_active', e.target.checked)}
            />
            Active
          </label>

          {error && (
            <div className="text-sm text-red-300 bg-red-900/30 border border-red-900 rounded-lg px-3 py-2 flex items-center gap-2">
              <AlertTriangle size={16} /> {error}
            </div>
          )}

          <div className="flex justify-end gap-2 pt-2">
            <button type="button" onClick={onClose} className="px-4 py-2 text-sm text-gray-400 hover:text-white">
              Cancel
            </button>
            <button type="submit" disabled={saving}
              className="px-4 py-2 text-sm font-medium bg-orange-500 hover:bg-orange-600 disabled:opacity-50 text-white rounded-lg flex items-center gap-2">
              {saving && <Loader2 size={14} className="animate-spin" />}
              Save
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ── Title edit modal ─────────────────────────────────────────────────────

function TitleModal({ initial, departments, onClose, onSaved }) {
  const [form, setForm] = useState({
    id: initial?.id || null,
    department_id: initial?.department_id || departments[0]?.id || '',
    code: initial?.code || '',
    name: initial?.name || '',
    description: initial?.description || '',
    seniority_level: initial?.seniority_level ?? 4,
    is_csuite: initial?.is_csuite ?? false,
    is_active: initial?.is_active ?? true,
    sort_order: initial?.sort_order ?? 0,
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  function setF(k, v) { setForm(f => ({ ...f, [k]: v })); }

  async function handleSubmit(e) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      await upsertCorporateTitle(form);
      onSaved();
    } catch (e) {
      setError(e?.response?.data?.error || 'Failed to save.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div className="bg-gray-900 border border-gray-700 rounded-xl p-6 w-full max-w-lg shadow-2xl max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between mb-5">
          <h2 className="text-white font-semibold text-lg">
            {initial ? 'Edit title' : 'New title'}
          </h2>
          <button onClick={onClose} className="text-gray-500 hover:text-gray-300"><X size={18} /></button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm text-gray-400 mb-1">Department *</label>
            <select
              value={form.department_id}
              onChange={(e) => setF('department_id', Number(e.target.value))}
              className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white"
            >
              {departments.map(d => (
                <option key={d.id} value={d.id}>{d.name}</option>
              ))}
            </select>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm text-gray-400 mb-1">Code *</label>
              <input
                type="text"
                value={form.code}
                onChange={(e) => setF('code', e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, '_'))}
                disabled={Boolean(initial)}
                className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white"
              />
            </div>
            <div>
              <label className="block text-sm text-gray-400 mb-1">Name *</label>
              <input
                type="text"
                value={form.name}
                onChange={(e) => setF('name', e.target.value)}
                className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white"
              />
            </div>
          </div>

          <div>
            <label className="block text-sm text-gray-400 mb-1">Description</label>
            <textarea
              value={form.description}
              onChange={(e) => setF('description', e.target.value)}
              rows={2}
              className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm text-gray-400 mb-1">Seniority (1-10)</label>
              <input
                type="number"
                min="1" max="10"
                value={form.seniority_level}
                onChange={(e) => setF('seniority_level', Number(e.target.value))}
                className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white"
              />
            </div>
            <div>
              <label className="block text-sm text-gray-400 mb-1">Sort order</label>
              <input
                type="number"
                value={form.sort_order}
                onChange={(e) => setF('sort_order', Number(e.target.value))}
                className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white"
              />
            </div>
          </div>

          <div className="flex items-center gap-4">
            <label className="flex items-center gap-2 text-sm text-gray-300">
              <input type="checkbox" checked={form.is_csuite}
                onChange={(e) => setF('is_csuite', e.target.checked)} />
              C-suite title
            </label>
            <label className="flex items-center gap-2 text-sm text-gray-300">
              <input type="checkbox" checked={form.is_active}
                onChange={(e) => setF('is_active', e.target.checked)} />
              Active
            </label>
          </div>

          {error && (
            <div className="text-sm text-red-300 bg-red-900/30 border border-red-900 rounded-lg px-3 py-2 flex items-center gap-2">
              <AlertTriangle size={16} /> {error}
            </div>
          )}

          <div className="flex justify-end gap-2 pt-2">
            <button type="button" onClick={onClose} className="px-4 py-2 text-sm text-gray-400 hover:text-white">
              Cancel
            </button>
            <button type="submit" disabled={saving}
              className="px-4 py-2 text-sm font-medium bg-orange-500 hover:bg-orange-600 disabled:opacity-50 text-white rounded-lg flex items-center gap-2">
              {saving && <Loader2 size={14} className="animate-spin" />}
              Save
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ── Department default-permissions editor ────────────────────────────────

function PermissionsEditor({ department, catalog, onSaved }) {
  const allPermissions = catalog?.permissions || [];
  const initialAllowed = new Set(department.permissions || []);
  const [allowed, setAllowed] = useState(initialAllowed);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  const grouped = {};
  for (const p of allPermissions) {
    if (!grouped[p.group_key]) grouped[p.group_key] = [];
    grouped[p.group_key].push(p);
  }

  function toggle(code) {
    setAllowed(s => {
      const next = new Set(s);
      if (next.has(code)) next.delete(code);
      else next.add(code);
      return next;
    });
  }

  async function save() {
    setSaving(true);
    setError(null);
    try {
      const payload = Array.from(allowed).map(code => ({ code, allow: true }));
      await setDepartmentDefaultPermissions(department.id, payload);
      onSaved();
    } catch (e) {
      setError(e?.response?.data?.error || 'Failed to save permissions.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="mt-4 bg-gray-950 border border-gray-800 rounded-lg p-4">
      <div className="text-sm font-medium text-white mb-3">Default permissions</div>
      <div className="space-y-3 max-h-[400px] overflow-y-auto">
        {Object.entries(grouped).map(([group, perms]) => (
          <div key={group}>
            <div className="text-xs text-gray-500 uppercase mb-1">{group}</div>
            <div className="space-y-1">
              {perms.map(p => (
                <label key={p.code} className="flex items-start gap-2 text-sm text-gray-300 hover:bg-gray-900 px-2 py-1 rounded">
                  <input
                    type="checkbox"
                    checked={allowed.has(p.code)}
                    onChange={() => toggle(p.code)}
                    className="mt-1"
                  />
                  <div className="flex-1 min-w-0">
                    <code className="text-xs text-orange-300">{p.code}</code>
                    {p.description && (
                      <div className="text-xs text-gray-500">{p.description}</div>
                    )}
                  </div>
                </label>
              ))}
            </div>
          </div>
        ))}
      </div>
      {error && <div className="text-red-300 text-sm mt-3">{error}</div>}
      <div className="flex justify-end mt-3">
        <button onClick={save} disabled={saving}
          className="px-4 py-2 text-sm font-medium bg-orange-500 hover:bg-orange-600 disabled:opacity-50 text-white rounded-lg flex items-center gap-2">
          {saving && <Loader2 size={14} className="animate-spin" />}
          Save defaults
        </button>
      </div>
    </div>
  );
}

// ── Page ─────────────────────────────────────────────────────────────────

export default function CorporateDepartments() {
  const [catalog, setCatalog] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState(null);
  const [openDept, setOpenDept] = useState(null);
  const [showPerms, setShowPerms] = useState(null); // dept.id
  const [deptModal,  setDeptModal]  = useState(null);   // null | dept | {}
  const [titleModal, setTitleModal] = useState(null);   // null | title | { department_id }

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const cat = await getCorporateCatalog();
      setCatalog(cat);
    } catch (e) {
      setError(e?.response?.data?.error || 'Failed to load catalog.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  if (loading) {
    return (
      <div className="p-10 text-center text-gray-400">
        <Loader2 className="inline animate-spin mr-2" size={18} /> Loading...
      </div>
    );
  }

  if (error) {
    return <div className="p-6 text-red-400">{error}</div>;
  }

  return (
    <div className="p-6 max-w-7xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-semibold text-white flex items-center gap-2">
            <Shield size={22} />
            Corporate Departments & Titles
          </h1>
          <p className="text-gray-400 text-sm mt-1">
            Super-admin only. Manage departments, titles, and their default permission sets.
          </p>
        </div>
        <button
          onClick={() => setDeptModal({})}
          className="px-4 py-2 text-sm font-medium bg-orange-500 hover:bg-orange-600 text-white rounded-lg flex items-center gap-2"
        >
          <Plus size={16} /> New department
        </button>
      </div>

      <div className="space-y-3">
        {(catalog?.departments || []).map(dept => {
          const isOpen = openDept === dept.code;
          return (
            <div key={dept.code} className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
              <div
                className="px-5 py-4 flex items-center justify-between hover:bg-gray-950 cursor-pointer"
                style={{ borderLeft: `4px solid ${dept.color || '#7c3aed'}` }}
                onClick={() => setOpenDept(o => o === dept.code ? null : dept.code)}
              >
                <div className="flex items-center gap-3">
                  <Building2 size={18} style={{ color: dept.color || '#7c3aed' }} />
                  <div>
                    <div className="text-white font-semibold">{dept.name}</div>
                    <div className="text-xs text-gray-500">
                      {dept.titles?.length || 0} titles - {dept.permissions?.length || 0} default permissions
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={(e) => { e.stopPropagation(); setShowPerms(s => s === dept.id ? null : dept.id); setOpenDept(dept.code); }}
                    className="px-3 py-1 text-xs text-gray-300 hover:text-white border border-gray-700 hover:border-gray-500 rounded-lg"
                  >
                    Permissions
                  </button>
                  <button
                    onClick={(e) => { e.stopPropagation(); setDeptModal(dept); }}
                    className="text-gray-500 hover:text-white p-1"
                    title="Edit department"
                  >
                    <Edit3 size={15} />
                  </button>
                  {isOpen ? <ChevronDown size={18} className="text-gray-500" />
                          : <ChevronRight size={18} className="text-gray-500" />}
                </div>
              </div>

              {isOpen && (
                <div className="p-5 border-t border-gray-800">
                  <div className="flex items-center justify-between mb-3">
                    <h3 className="text-sm font-medium text-gray-300">Titles</h3>
                    <button
                      onClick={() => setTitleModal({ department_id: dept.id })}
                      className="px-3 py-1 text-xs text-orange-300 hover:text-orange-200 flex items-center gap-1"
                    >
                      <Plus size={12} /> Add title
                    </button>
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2">
                    {(dept.titles || []).sort((a, b) => b.seniority_level - a.seniority_level).map(t => (
                      <div key={t.id} className="bg-gray-950 border border-gray-800 rounded-lg px-3 py-2 flex items-center justify-between">
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2">
                            {t.is_csuite && <Crown size={11} className="text-yellow-400 flex-shrink-0" />}
                            <div className="text-white text-sm truncate">{t.name}</div>
                          </div>
                          <div className="text-xs text-gray-500">L{t.seniority_level} - {t.code}</div>
                        </div>
                        <button
                          onClick={() => setTitleModal(t)}
                          className="text-gray-500 hover:text-white p-1 ml-2"
                          title="Edit"
                        >
                          <Edit3 size={13} />
                        </button>
                      </div>
                    ))}
                    {!dept.titles?.length && (
                      <div className="text-xs text-gray-500 italic col-span-full">
                        No titles defined.
                      </div>
                    )}
                  </div>

                  {showPerms === dept.id && (
                    <PermissionsEditor
                      department={dept}
                      catalog={catalog}
                      onSaved={async () => { setShowPerms(null); await load(); }}
                    />
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {deptModal && (
        <DepartmentModal
          initial={deptModal.id ? deptModal : null}
          onClose={() => setDeptModal(null)}
          onSaved={async () => { setDeptModal(null); await load(); }}
        />
      )}

      {titleModal && (
        <TitleModal
          initial={titleModal.id ? titleModal : null}
          departments={catalog.departments}
          onClose={() => setTitleModal(null)}
          onSaved={async () => { setTitleModal(null); await load(); }}
        />
      )}
    </div>
  );
}
