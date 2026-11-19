import { useEffect, useState, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import api from '../../api/axios';
import Navbar from '../../components/Navbar';
import Footer from '../../components/Footer';
import './SavedLocations.css';

/**
 * Group 1, item 43: manage saved service locations. The customer saves
 * the addresses work happens at (home, office, a property) with optional
 * entry instructions, then picks one in the booking flow instead of
 * retyping the address. Owner-scoped; addresses are private.
 */
export default function SavedLocations() {
  const { t } = useTranslation();
  const [locations, setLocations] = useState([]);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [error, setError] = useState('');
  const [form, setForm] = useState({ label: '', address: '', entry_instructions: '', is_default: false });
  const [editingId, setEditingId] = useState(null);
  const [saving, setSaving] = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    setFailed(false);
    api.get('/life/saved-locations')
      .then((r) => setLocations(Array.isArray(r.data?.saved_locations) ? r.data.saved_locations : []))
      .catch(() => setFailed(true))
      .finally(() => setLoading(false));
  }, []);

  useEffect(load, [load]);

  function startEdit(loc) {
    setEditingId(loc.id);
    setForm({
      label: loc.label || '',
      address: loc.address || '',
      entry_instructions: loc.entry_instructions || '',
      is_default: !!loc.is_default,
    });
    setError('');
  }

  function resetForm() {
    setEditingId(null);
    setForm({ label: '', address: '', entry_instructions: '', is_default: false });
    setError('');
  }

  async function save() {
    if (!form.label.trim() || !form.address.trim()) {
      setError(t('settings.savedLocations.required'));
      return;
    }
    setSaving(true);
    setError('');
    try {
      if (editingId) {
        await api.put(`/life/saved-locations/${editingId}`, form);
      } else {
        await api.post('/life/saved-locations', form);
      }
      resetForm();
      load();
    } catch (err) {
      setError(err?.response?.data?.error || t('settings.savedLocations.saveFailed'));
    } finally {
      setSaving(false);
    }
  }

  async function remove(id) {
    try {
      await api.delete(`/life/saved-locations/${id}`);
      load();
    } catch {
      setError(t('settings.savedLocations.deleteFailed'));
    }
  }

  return (
    <div className="min-h-screen flex flex-col sl-page">
      <Navbar />
      <main className="flex-1 max-w-3xl w-full mx-auto px-4 py-8 flex flex-col gap-6">
        <div>
          <Link to="/settings" className="text-sm text-orange-400 underline">{t('settings.savedLocations.backToSettings')}</Link>
          {' · '}
          <Link to="/household" className="text-sm text-orange-400 underline">{t('settings.savedLocations.householdLink')}</Link>
          <h1 className="text-3xl font-bold tracking-tight mt-2">{t('settings.savedLocations.title')}</h1>
          <p className="text-sm mt-1 text-muted">{t('settings.savedLocations.subtitle')}</p>
        </div>

        {loading ? (
          <p className="text-sm text-muted">{t('lifePages.loading')}</p>
        ) : failed ? (
          <div role="alert" className="rounded-xl p-4 flex items-center justify-between gap-3 sl-alert">
            <span className="text-sm text-red-300">{t('lifePages.loadFailed')}</span>
            <button type="button" onClick={load} className="shrink-0 text-sm font-semibold text-red-300 underline">{t('common.retry')}</button>
          </div>
        ) : (
          <>
            {locations.length === 0 ? (
              <p className="text-sm text-muted">{t('settings.savedLocations.empty')}</p>
            ) : (
              <ul className="flex flex-col gap-3">
                {locations.map((loc) => (
                  <li key={loc.id} className="rounded-xl border border-border p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <span className="text-sm font-semibold">{loc.label}</span>
                        {loc.is_default && (
                          <span className="ms-2 text-xs px-2 py-0.5 rounded-full bg-orange-500/20 text-orange-300">
                            {t('settings.savedLocations.defaultBadge')}
                          </span>
                        )}
                        <p className="text-sm mt-1 text-muted">{loc.address}</p>
                        {loc.entry_instructions && (
                          <p className="text-sm mt-1 text-muted">{loc.entry_instructions}</p>
                        )}
                      </div>
                      <div className="flex gap-2 shrink-0">
                        <button type="button" onClick={() => startEdit(loc)} className="text-sm text-orange-400 underline">
                          {t('common.edit')}
                        </button>
                        <button type="button" onClick={() => remove(loc.id)} className="text-sm text-red-400 underline">
                          {t('common.delete')}
                        </button>
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            )}

            <section className="rounded-xl border border-border p-5">
              <h2 className="text-lg font-semibold mb-3">
                {editingId ? t('settings.savedLocations.editTitle') : t('settings.savedLocations.addTitle')}
              </h2>
              <div className="flex flex-col gap-3">
                <label className="text-sm font-medium">
                  {t('settings.savedLocations.labelLabel')}
                  <input
                    type="text"
                    value={form.label}
                    maxLength={80}
                    onChange={(e) => setForm((f) => ({ ...f, label: e.target.value }))}
                    placeholder={t('settings.savedLocations.labelPlaceholder')}
                    className="mt-1 w-full rounded-lg border border-border p-2 text-sm bg-transparent"
                  />
                </label>
                <label className="text-sm font-medium">
                  {t('settings.savedLocations.addressLabel')}
                  <input
                    type="text"
                    value={form.address}
                    maxLength={500}
                    onChange={(e) => setForm((f) => ({ ...f, address: e.target.value }))}
                    placeholder={t('settings.savedLocations.addressPlaceholder')}
                    className="mt-1 w-full rounded-lg border border-border p-2 text-sm bg-transparent"
                  />
                </label>
                <label className="text-sm font-medium">
                  {t('settings.savedLocations.entryLabel')}
                  <textarea
                    rows={2}
                    value={form.entry_instructions}
                    maxLength={1000}
                    onChange={(e) => setForm((f) => ({ ...f, entry_instructions: e.target.value }))}
                    placeholder={t('settings.savedLocations.entryPlaceholder')}
                    className="mt-1 w-full rounded-lg border border-border p-2 text-sm bg-transparent"
                  />
                </label>
                <label className="text-sm flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={form.is_default}
                    onChange={(e) => setForm((f) => ({ ...f, is_default: e.target.checked }))}
                  />
                  {t('settings.savedLocations.defaultLabel')}
                </label>
                {error && <p role="alert" className="text-sm text-red-300">{error}</p>}
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={save}
                    disabled={saving}
                    className="px-4 py-2 rounded-xl bg-orange-500 hover:bg-orange-600 text-white text-sm font-semibold disabled:opacity-50"
                  >
                    {editingId ? t('common.save') : t('settings.savedLocations.addButton')}
                  </button>
                  {editingId && (
                    <button type="button" onClick={resetForm} className="px-4 py-2 rounded-xl border border-border text-sm">
                      {t('common.cancel')}
                    </button>
                  )}
                </div>
              </div>
            </section>
          </>
        )}
      </main>
      <Footer />
    </div>
  );
}
