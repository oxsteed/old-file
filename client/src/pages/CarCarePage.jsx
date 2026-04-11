/**
 * CarCarePage.jsx
 * Search NHTSA vehicle data + manage user's garage.
 * Data: NHTSA vPIC API — free U.S. government data, no API key required.
 * OxSteed v2
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import PageShell from '../components/PageShell';
import PageMeta  from '../components/PageMeta';
import api       from '../api/axios';
import '../styles/CarCarePage.css';

// ── helpers ────────────────────────────────────────────────────────────────
const CURRENT_YEAR = new Date().getFullYear();
const YEAR_OPTIONS = Array.from({ length: CURRENT_YEAR - 1885 }, (_, i) => CURRENT_YEAR - i);

function normalise(str) {
  return str.toLowerCase().replace(/\s+/g, ' ').trim();
}

export default function CarCarePage() {
  // ── NHTSA data ────────────────────────────────────────────────────────
  const [makes,       setMakes]       = useState([]);
  const [models,      setModels]      = useState([]);
  const [makesLoaded, setMakesLoaded] = useState(false);
  const [loadingMakes,  setLoadingMakes]  = useState(false);
  const [loadingModels, setLoadingModels] = useState(false);

  // ── Search state ──────────────────────────────────────────────────────
  const [makeSearch,  setMakeSearch]  = useState('');
  const [selectedMake, setSelectedMake] = useState(null);   // { id, name }
  const [modelSearch, setModelSearch] = useState('');
  const [selectedModel, setSelectedModel] = useState(null); // { makeId, makeName, modelId, modelName }
  const [year,        setYear]        = useState('');
  const [nickname,    setNickname]    = useState('');

  // ── Dropdown visibility ───────────────────────────────────────────────
  const [showMakeDD,  setShowMakeDD]  = useState(false);
  const [showModelDD, setShowModelDD] = useState(false);

  // ── Garage ────────────────────────────────────────────────────────────
  const [garage,   setGarage]   = useState([]);
  const [garageLoading, setGarageLoading] = useState(true);

  // ── Form state ────────────────────────────────────────────────────────
  const [adding,  setAdding]  = useState(false);
  const [addError, setAddError] = useState('');

  // ── Edit modal ────────────────────────────────────────────────────────
  const [editItem,    setEditItem]    = useState(null);
  const [editNickname, setEditNickname] = useState('');
  const [editYear,    setEditYear]    = useState('');
  const [editNotes,   setEditNotes]   = useState('');
  const [editSaving,  setEditSaving]  = useState(false);
  const [editError,   setEditError]   = useState('');

  // ── Delete confirm ────────────────────────────────────────────────────
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [deleting, setDeleting] = useState(false);

  const makeInputRef  = useRef(null);
  const modelInputRef = useRef(null);

  // ── Load garage on mount ──────────────────────────────────────────────
  useEffect(() => {
    (async () => {
      try {
        const { data } = await api.get('/vehicles/my');
        setGarage(data);
      } catch {
        // silent — user may be loading slowly
      } finally {
        setGarageLoading(false);
      }
    })();
  }, []);

  // ── Load makes (lazy — on first focus of make input) ─────────────────
  const loadMakes = useCallback(async () => {
    if (makesLoaded) return;
    setLoadingMakes(true);
    try {
      const { data } = await api.get('/vehicles/makes');
      setMakes(data);
      setMakesLoaded(true);
    } catch {
      // fail silently — user can retry
    } finally {
      setLoadingMakes(false);
    }
  }, [makesLoaded]);

  // ── Load models when make is selected ────────────────────────────────
  useEffect(() => {
    if (!selectedMake) { setModels([]); return; }
    let active = true;
    setLoadingModels(true);
    setModels([]);
    setSelectedModel(null);
    setModelSearch('');
    (async () => {
      try {
        const { data } = await api.get('/vehicles/models', { params: { make: selectedMake.name } });
        if (active) setModels(data);
      } catch {
        // fail silently
      } finally {
        if (active) setLoadingModels(false);
      }
    })();
    return () => { active = false; };
  }, [selectedMake]);

  // ── Filtered lists ────────────────────────────────────────────────────
  const filteredMakes = makeSearch.length < 1
    ? makes.slice(0, 80)
    : makes.filter(m => normalise(m.name).includes(normalise(makeSearch))).slice(0, 80);

  const filteredModels = modelSearch.length < 1
    ? models
    : models.filter(m => normalise(m.modelName).includes(normalise(modelSearch)));

  // ── Handlers ──────────────────────────────────────────────────────────
  function handleMakeInputFocus() {
    loadMakes();
    setShowMakeDD(true);
  }
  function handleMakeSelect(make) {
    setSelectedMake(make);
    setMakeSearch(make.name);
    setShowMakeDD(false);
  }
  function handleMakeClear() {
    setSelectedMake(null);
    setMakeSearch('');
    setModels([]);
    setSelectedModel(null);
    setModelSearch('');
    setTimeout(() => makeInputRef.current?.focus(), 0);
  }
  function handleModelSelect(model) {
    setSelectedModel(model);
    setModelSearch(model.modelName);
    setShowModelDD(false);
  }
  function handleModelClear() {
    setSelectedModel(null);
    setModelSearch('');
    setTimeout(() => modelInputRef.current?.focus(), 0);
  }

  async function handleAdd() {
    if (!selectedMake)  return setAddError('Select a make first.');
    if (!selectedModel) return setAddError('Select a model first.');
    setAdding(true);
    setAddError('');
    try {
      const payload = {
        make_id:    selectedMake.id,
        make_name:  selectedMake.name,
        model_id:   selectedModel.modelId,
        model_name: selectedModel.modelName,
        year:       year || undefined,
        nickname:   nickname.trim() || undefined,
      };
      const { data } = await api.post('/vehicles/my', payload);
      setGarage(prev => [data, ...prev]);
      // reset form
      setSelectedMake(null);
      setMakeSearch('');
      setSelectedModel(null);
      setModelSearch('');
      setModels([]);
      setYear('');
      setNickname('');
    } catch (err) {
      setAddError(err.response?.data?.error || 'Failed to add vehicle.');
    } finally {
      setAdding(false);
    }
  }

  // ── Edit handlers ─────────────────────────────────────────────────────
  function openEdit(v) {
    setEditItem(v);
    setEditNickname(v.nickname || '');
    setEditYear(v.year ? String(v.year) : '');
    setEditNotes(v.notes || '');
    setEditError('');
  }
  async function handleEditSave() {
    setEditSaving(true);
    setEditError('');
    try {
      const { data } = await api.patch(`/vehicles/my/${editItem.id}`, {
        nickname: editNickname.trim() || undefined,
        year:     editYear     || undefined,
        notes:    editNotes.trim() || undefined,
      });
      setGarage(prev => prev.map(v => v.id === data.id ? { ...v, ...data } : v));
      setEditItem(null);
    } catch (err) {
      setEditError(err.response?.data?.error || 'Failed to save.');
    } finally {
      setEditSaving(false);
    }
  }

  // ── Delete handlers ───────────────────────────────────────────────────
  async function handleDelete() {
    setDeleting(true);
    try {
      await api.delete(`/vehicles/my/${deleteTarget.id}`);
      setGarage(prev => prev.filter(v => v.id !== deleteTarget.id));
      setDeleteTarget(null);
    } catch {
      // fail silently — edge case
    } finally {
      setDeleting(false);
    }
  }

  // ── Render ────────────────────────────────────────────────────────────
  return (
    <PageShell>
      <PageMeta
        title="Car Care — OxSteed"
        description="Search and save your vehicles using official U.S. NHTSA data."
      />

      <div className="cc-page">

        {/* ── Header ──────────────────────────────────────────────────── */}
        <div className="cc-header">
          <div>
            <h1>Car Care</h1>
            <p>Search and save your vehicles. Data from the <a
              href="https://vpic.nhtsa.dot.gov/api/"
              target="_blank" rel="noopener noreferrer"
            >U.S. NHTSA vPIC API</a> — free government data, always up to date.</p>
          </div>
        </div>

        {/* ── Add vehicle form ─────────────────────────────────────────── */}
        <div className="cc-card cc-add-form">
          <h2>Add a Vehicle</h2>

          <div className="cc-form-row">
            {/* Make picker */}
            <div className="cc-field" style={{ position: 'relative' }}>
              <label>Make</label>
              <div className="cc-input-wrap">
                <input
                  ref={makeInputRef}
                  type="text"
                  placeholder={loadingMakes ? 'Loading makes…' : 'e.g. Toyota'}
                  value={makeSearch}
                  onChange={e => {
                    setMakeSearch(e.target.value);
                    setSelectedMake(null);
                    setShowMakeDD(true);
                  }}
                  onFocus={handleMakeInputFocus}
                  onBlur={() => setTimeout(() => setShowMakeDD(false), 150)}
                  disabled={loadingMakes}
                  autoComplete="off"
                />
                {selectedMake && (
                  <button className="cc-clear-btn" onClick={handleMakeClear} type="button"
                    aria-label="Clear make">×</button>
                )}
              </div>
              {showMakeDD && filteredMakes.length > 0 && (
                <ul className="cc-dropdown">
                  {filteredMakes.map(m => (
                    <li key={m.id} onMouseDown={() => handleMakeSelect(m)}>
                      {m.name}
                    </li>
                  ))}
                </ul>
              )}
            </div>

            {/* Model picker */}
            <div className="cc-field" style={{ position: 'relative' }}>
              <label>Model</label>
              <div className="cc-input-wrap">
                <input
                  ref={modelInputRef}
                  type="text"
                  placeholder={
                    !selectedMake     ? 'Select make first' :
                    loadingModels     ? 'Loading models…'   : 'e.g. Camry'
                  }
                  value={modelSearch}
                  onChange={e => {
                    setModelSearch(e.target.value);
                    setSelectedModel(null);
                    setShowModelDD(true);
                  }}
                  onFocus={() => selectedMake && setShowModelDD(true)}
                  onBlur={() => setTimeout(() => setShowModelDD(false), 150)}
                  disabled={!selectedMake || loadingModels}
                  autoComplete="off"
                />
                {selectedModel && (
                  <button className="cc-clear-btn" onClick={handleModelClear} type="button"
                    aria-label="Clear model">×</button>
                )}
              </div>
              {showModelDD && filteredModels.length > 0 && (
                <ul className="cc-dropdown">
                  {filteredModels.map(m => (
                    <li key={m.modelId} onMouseDown={() => handleModelSelect(m)}>
                      {m.modelName}
                    </li>
                  ))}
                </ul>
              )}
            </div>

            {/* Year */}
            <div className="cc-field cc-field-sm">
              <label>Year <span className="cc-optional">(optional)</span></label>
              <select value={year} onChange={e => setYear(e.target.value)}>
                <option value="">Any</option>
                {YEAR_OPTIONS.map(y => <option key={y} value={y}>{y}</option>)}
              </select>
            </div>

            {/* Nickname */}
            <div className="cc-field">
              <label>Nickname <span className="cc-optional">(optional)</span></label>
              <input
                type="text"
                placeholder='e.g. "My Commuter"'
                value={nickname}
                onChange={e => setNickname(e.target.value)}
                maxLength={80}
              />
            </div>
          </div>

          {addError && <p className="cc-error">{addError}</p>}

          <button
            className="cc-add-btn"
            onClick={handleAdd}
            disabled={adding || !selectedMake || !selectedModel}
          >
            {adding ? 'Adding…' : '+ Add to My Garage'}
          </button>
        </div>

        {/* ── Garage list ──────────────────────────────────────────────── */}
        <div className="cc-garage-header">
          <h2>My Garage <span className="cc-count">{garage.length}</span></h2>
        </div>

        {garageLoading ? (
          <div className="cc-spinner-wrap">
            <div className="cc-spinner" />
          </div>
        ) : garage.length === 0 ? (
          <div className="cc-empty">
            <p>No vehicles saved yet. Search above to add your first one.</p>
          </div>
        ) : (
          <div className="cc-garage-grid">
            {garage.map(v => (
              <VehicleCard
                key={v.id}
                vehicle={v}
                onEdit={() => openEdit(v)}
                onDelete={() => setDeleteTarget(v)}
              />
            ))}
          </div>
        )}

        {/* ── Edit modal ───────────────────────────────────────────────── */}
        {editItem && (
          <div className="cc-modal-overlay" onClick={e => e.target === e.currentTarget && setEditItem(null)}>
            <div className="cc-modal">
              <h2>Edit Vehicle</h2>
              <p className="cc-modal-vehicle-label">
                {editItem.make_name} {editItem.model_name}
              </p>

              <div className="cc-form-group">
                <label>Nickname</label>
                <input type="text" value={editNickname}
                  onChange={e => setEditNickname(e.target.value)} maxLength={80}
                  placeholder='e.g. "Daily Driver"' />
              </div>

              <div className="cc-form-group">
                <label>Year</label>
                <select value={editYear} onChange={e => setEditYear(e.target.value)}>
                  <option value="">Not specified</option>
                  {YEAR_OPTIONS.map(y => <option key={y} value={y}>{y}</option>)}
                </select>
              </div>

              <div className="cc-form-group">
                <label>Notes <span className="cc-optional">(private)</span></label>
                <textarea rows={2} value={editNotes}
                  onChange={e => setEditNotes(e.target.value)}
                  placeholder="Reminders, quirks, service history…" maxLength={500} />
              </div>

              {editError && <p className="cc-error">{editError}</p>}

              <div className="cc-modal-actions">
                <button className="btn-ghost" onClick={() => setEditItem(null)}>Cancel</button>
                <button className="btn-primary" onClick={handleEditSave} disabled={editSaving}>
                  {editSaving ? 'Saving…' : 'Save Changes'}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* ── Delete confirm ───────────────────────────────────────────── */}
        {deleteTarget && (
          <div className="cc-modal-overlay" onClick={e => e.target === e.currentTarget && setDeleteTarget(null)}>
            <div className="cc-modal">
              <h2>Remove Vehicle</h2>
              <p>Remove <strong>{deleteTarget.nickname || `${deleteTarget.make_name} ${deleteTarget.model_name}`}</strong> from your garage?</p>
              <div className="cc-modal-actions">
                <button className="btn-ghost" onClick={() => setDeleteTarget(null)}>Keep It</button>
                <button className="btn-danger" onClick={handleDelete} disabled={deleting}>
                  {deleting ? 'Removing…' : 'Remove'}
                </button>
              </div>
            </div>
          </div>
        )}

      </div>
    </PageShell>
  );
}

// ── VehicleCard ────────────────────────────────────────────────────────────
function VehicleCard({ vehicle: v, onEdit, onDelete }) {
  return (
    <div className="cc-vehicle-card">
      <div className="cc-vehicle-main">
        <div className="cc-vehicle-name">
          {v.nickname
            ? <><span className="cc-nickname">{v.nickname}</span> <span className="cc-make-model">{v.make_name} {v.model_name}</span></>
            : <span className="cc-make-model">{v.make_name} {v.model_name}</span>
          }
        </div>
        {v.year && <span className="cc-year-badge">{v.year}</span>}
        <div className="cc-vehicle-meta">
          <span className="cc-nhtsa-tag">NHTSA verified</span>
          {v.notes && <p className="cc-vehicle-notes">{v.notes}</p>}
        </div>
      </div>
      <div className="cc-vehicle-actions">
        <button className="cc-action-btn" onClick={onEdit}>Edit</button>
        <button className="cc-action-btn danger" onClick={onDelete}>Remove</button>
      </div>
    </div>
  );
}
