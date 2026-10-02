import { useEffect, useState, useCallback, useRef } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Plus, Search, Pencil, Trash2, ToggleLeft, ToggleRight, X, Check } from 'lucide-react';
import { adminRoute } from '../adminRouteManifest';
import adminApi from '../../lib/adminApi';
import toast from 'react-hot-toast';
import { useAbortableFetch } from '../lib/useAbortableFetch';

const EMPTY_FORM = { name: '', category: '', is_active: true };

export default function SkillsManager() {
  const { t } = useTranslation();
  const [categories, setCategories] = useState([]);
  const [filters,   setFilters]   = useState({ q: '', category: '', offset: 0, limit: 50 });
  const [showForm,  setShowForm]  = useState(false);
  const [editing,   setEditing]   = useState(null);
  const [form,      setForm]      = useState(EMPTY_FORM);
  const [saving,    setSaving]    = useState(false);
  const [catSearch, setCatSearch] = useState('');
  const [catSugs,   setCatSugs]   = useState([]);
  const catRef = useRef(null);

  // Debounce the search box: typing no longer fires a request per keystroke.
  const [qInput, setQInput] = useState('');
  const qTimer = useRef(null);
  useEffect(() => {
    clearTimeout(qTimer.current);
    qTimer.current = setTimeout(() => {
      setFilters(p => (p.q === qInput ? p : { ...p, q: qInput, offset: 0 }));
    }, 350);
    return () => clearTimeout(qTimer.current);
  }, [qInput]);

  // Sequence-guarded + abortable: out-of-order responses can no longer
  // clobber the list with stale results.
  const { data: skillsData, loading, reload } = useAbortableFetch(async (signal) => {
    const params = { ...filters };
    if (!params.q) delete params.q;
    if (!params.category) delete params.category;
    const { data } = await adminApi.get('/admin/skills-lookup', { params, signal });
    return data;
  }, [filters]);
  const skills = skillsData?.skills || [];
  const total = skillsData?.total || 0;

  const fetchSkills = () => reload();

  const fetchCategories = useCallback(async () => {
    try {
      const { data } = await adminApi.get('/admin/skills-lookup/categories');
      setCategories(data.categories || []);
    } catch { /* silent */ }
  }, []);

  useEffect(() => { fetchCategories(); }, [fetchCategories]);

  // Category autocomplete for form
  useEffect(() => {
    if (!catSearch.trim()) { setCatSugs([]); return; }
    const term = catSearch.toLowerCase();
    setCatSugs(categories.filter(c => c.toLowerCase().includes(term)).slice(0, 8));
  }, [catSearch, categories]);

  // Click-outside to close cat dropdown
  useEffect(() => {
    const handler = (e) => {
      if (catRef.current && !catRef.current.contains(e.target)) setCatSugs([]);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const openAdd = () => {
    setEditing(null);
    setForm(EMPTY_FORM);
    setCatSearch('');
    setShowForm(true);
  };

  const openEdit = (skill) => {
    setEditing(skill);
    setForm({ name: skill.name, category: skill.category || '', is_active: skill.is_active });
    setCatSearch(skill.category || '');
    setShowForm(true);
  };

  const handleSave = async (e) => {
    e.preventDefault();
    if (!form.name.trim()) return toast.error(t('adminSkillsManager.nameRequired'));
    setSaving(true);
    try {
      if (editing) {
        await adminApi.put(`/admin/skills-lookup/${editing.id}`, form);
        toast.success(t('adminSkillsManager.updated'));
      } else {
        await adminApi.post('/admin/skills-lookup', form);
        toast.success(t('adminSkillsManager.added'));
      }
      setShowForm(false);
      fetchSkills();
      fetchCategories();
    } catch (err) {
      toast.error(err?.response?.data?.error || t('adminSkillsManager.saveFailed'));
    } finally {
      setSaving(false);
    }
  };

  const handleToggle = async (skill) => {
    try {
      await adminApi.put(`/admin/skills-lookup/${skill.id}`, { is_active: !skill.is_active });
      toast.success(skill.is_active ? t('adminSkillsManager.hidden') : t('adminSkillsManager.restored'));
      fetchSkills();
    } catch {
      toast.error(t('adminSkillsManager.toggleFailed'));
    }
  };

  const handleDelete = async (skill) => {
    if (!confirm(t('adminSkillsManager.hardDeleteConfirm', { name: skill.name }))) return;
    try {
      await adminApi.delete(`/admin/skills-lookup/${skill.id}?hard=true`);
      toast.success(t('adminSkillsManager.deleted'));
      fetchSkills();
      fetchCategories();
    } catch {
      toast.error(t('adminSkillsManager.deleteFailed'));
    }
  };

  return (
    <div className="max-w-5xl mx-auto px-4 py-6">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-bold text-white">{t('adminSkillsManager.title')}</h1>
          <p className="text-sm text-gray-400 mt-0.5">
            {t('adminSkillsManager.subtitle', { count: total })}
          </p>
          <Link
            to={adminRoute('licenses').path}
            className="mt-2 inline-block text-sm font-medium text-orange-300 hover:text-orange-200"
          >
            {t('adminSkillsManager.licensesLink')}
          </Link>
        </div>
        <button
          onClick={openAdd}
          className="flex items-center gap-2 px-4 py-2 bg-orange-500 hover:bg-orange-600 text-white text-sm font-semibold rounded-lg transition"
        >
          <Plus size={16} /> {t('adminSkillsManager.addSkill')}
        </button>
      </div>

      {/* Filters */}
      <div className="flex gap-3 mb-4">
        <div className="relative flex-1">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
          <input
            value={qInput}
            onChange={e => setQInput(e.target.value)}
            placeholder={t('adminSkillsManager.searchPlaceholder')}
            className="w-full pl-8 pr-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-sm text-white placeholder-gray-500 focus:border-orange-500 focus:outline-none"
          />
        </div>
        <select
          value={filters.category}
          onChange={e => setFilters(p => ({ ...p, category: e.target.value, offset: 0 }))}
          className="bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:border-orange-500 focus:outline-none"
        >
          <option value="">{t('adminSkillsManager.allCategories')}</option>
          {categories.map(c => <option key={c} value={c}>{c}</option>)}
        </select>
      </div>

      {/* Table */}
      <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-800 text-xs uppercase tracking-wider text-gray-500">
              <th className="text-left px-4 py-3 font-medium">{t('adminSkillsManager.colName')}</th>
              <th className="text-left px-4 py-3 font-medium">{t('adminSkillsManager.colCategory')}</th>
              <th className="text-left px-4 py-3 font-medium">{t('adminSkillsManager.colStatus')}</th>
              <th className="text-right px-4 py-3 font-medium">{t('adminSkillsManager.colActions')}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-800">
            {loading ? (
              <tr><td colSpan={4} className="text-center py-10 text-gray-500">{t('adminSkillsManager.loading')}</td></tr>
            ) : skills.length === 0 ? (
              <tr><td colSpan={4} className="text-center py-10 text-gray-500">{t('adminSkillsManager.noSkills')}</td></tr>
            ) : skills.map(skill => (
              <tr key={skill.id} className={`hover:bg-gray-800/50 transition ${!skill.is_active ? 'opacity-50' : ''}`}>
                <td className="px-4 py-3 text-white font-medium">{skill.name}</td>
                <td className="px-4 py-3 text-gray-400">{skill.category || <span className="text-gray-600 italic">{t('adminSkillsManager.none')}</span>}</td>
                <td className="px-4 py-3">
                  <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold ${
                    skill.is_active ? 'bg-green-500/10 text-green-400' : 'bg-gray-700 text-gray-500'
                  }`}>
                    {skill.is_active ? t('adminSkillsManager.active') : t('adminSkillsManager.hiddenBadge')}
                  </span>
                </td>
                <td className="px-4 py-3">
                  <div className="flex items-center justify-end gap-1">
                    <button
                      onClick={() => handleToggle(skill)}
                      title={skill.is_active ? t('adminSkillsManager.hideTitle') : t('adminSkillsManager.restoreTitle')}
                      className="p-1.5 text-gray-500 hover:text-orange-400 transition rounded hover:bg-gray-800"
                    >
                      {skill.is_active ? <ToggleRight size={16} /> : <ToggleLeft size={16} />}
                    </button>
                    <button
                      onClick={() => openEdit(skill)}
                      title={t('adminSkillsManager.editTitle')}
                      className="p-1.5 text-gray-500 hover:text-white transition rounded hover:bg-gray-800"
                    >
                      <Pencil size={14} />
                    </button>
                    <button
                      onClick={() => handleDelete(skill)}
                      title={t('adminSkillsManager.deleteTitle')}
                      className="p-1.5 text-gray-500 hover:text-red-400 transition rounded hover:bg-gray-800"
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      {total > filters.limit && (
        <div className="flex items-center justify-between mt-4 text-sm text-gray-400">
          <span>{t('adminSkillsManager.showing', { from: filters.offset + 1, to: Math.min(filters.offset + filters.limit, total), total })}</span>
          <div className="flex gap-2">
            <button
              disabled={filters.offset === 0}
              onClick={() => setFilters(p => ({ ...p, offset: Math.max(0, p.offset - p.limit) }))}
              className="px-3 py-1.5 bg-gray-800 border border-gray-700 rounded-lg hover:bg-gray-700 disabled:opacity-40 transition"
            >{t('adminSkillsManager.previous')}</button>
            <button
              disabled={filters.offset + filters.limit >= total}
              onClick={() => setFilters(p => ({ ...p, offset: p.offset + p.limit }))}
              className="px-3 py-1.5 bg-gray-800 border border-gray-700 rounded-lg hover:bg-gray-700 disabled:opacity-40 transition"
            >{t('adminSkillsManager.next')}</button>
          </div>
        </div>
      )}

      {/* Add / Edit Modal */}
      {showForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
          <div className="bg-gray-900 border border-gray-700 rounded-2xl p-6 w-full max-w-sm shadow-2xl">
            <div className="flex items-center justify-between mb-5">
              <h3 className="font-bold text-white">{editing ? t('adminSkillsManager.editSkill') : t('adminSkillsManager.addNewSkill')}</h3>
              <button onClick={() => setShowForm(false)} className="text-gray-500 hover:text-white transition">
                <X size={18} />
              </button>
            </div>

            <form onSubmit={handleSave} className="space-y-4">
              <div>
                <label className="block text-[10px] uppercase tracking-widest font-semibold text-gray-500 mb-1.5">
                  {t('adminSkillsManager.nameLabel')} <span className="text-orange-500">*</span>
                </label>
                <input
                  required
                  value={form.name}
                  onChange={e => setForm(p => ({ ...p, name: e.target.value }))}
                  placeholder="e.g. Drywall Repair"
                  className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-600 focus:border-orange-500 focus:outline-none"
                />
              </div>

              <div ref={catRef} className="relative">
                <label className="block text-[10px] uppercase tracking-widest font-semibold text-gray-500 mb-1.5">
                  {t('adminSkillsManager.categoryLabel')}
                </label>
                <input
                  value={catSearch}
                  onChange={e => {
                    setCatSearch(e.target.value);
                    setForm(p => ({ ...p, category: e.target.value }));
                  }}
                  placeholder="e.g. Electrical"
                  className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-600 focus:border-orange-500 focus:outline-none"
                />
                {catSugs.length > 0 && (
                  <div className="absolute z-10 mt-1 w-full bg-gray-800 border border-gray-700 rounded-lg overflow-hidden shadow-lg">
                    {catSugs.map(c => (
                      <button
                        key={c} type="button"
                        className="w-full text-left px-3 py-2 text-sm text-gray-300 hover:bg-gray-700 hover:text-white transition"
                        onClick={() => {
                          setCatSearch(c);
                          setForm(p => ({ ...p, category: c }));
                          setCatSugs([]);
                        }}
                      >{c}</button>
                    ))}
                  </div>
                )}
              </div>

              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={form.is_active}
                  onChange={e => setForm(p => ({ ...p, is_active: e.target.checked }))}
                  className="accent-orange-500"
                />
                <span className="text-sm text-gray-400">{t('adminSkillsManager.activeLabel')}</span>
              </label>

              <div className="flex gap-3 pt-1">
                <button
                  type="button"
                  onClick={() => setShowForm(false)}
                  className="flex-1 py-2.5 border border-gray-700 text-gray-400 hover:text-white rounded-lg text-sm transition"
                >{t('common.cancel')}</button>
                <button
                  type="submit"
                  disabled={saving}
                  className="flex-1 flex items-center justify-center gap-2 py-2.5 bg-orange-500 hover:bg-orange-600 text-white font-semibold rounded-lg text-sm disabled:opacity-50 transition"
                >
                  <Check size={16} /> {saving ? t('adminSkillsManager.saving') : (editing ? t('adminSkillsManager.saveChanges') : t('adminSkillsManager.addSkill'))}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
