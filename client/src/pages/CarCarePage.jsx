/**
 * CarCarePage.jsx
 * Search NHTSA vehicle data + manage user's garage.
 * Data: NHTSA vPIC API — free U.S. government data, no API key required.
 * OxSteed v2
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { useTranslation } from 'react-i18next';
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
  const { t } = useTranslation();

  // ── NHTSA data ────────────────────────────────────────────────────────
  const [makes,       setMakes]       = useState([]);
  const [models,      setModels]      = useState([]);
  const [makesLoaded, setMakesLoaded] = useState(false);
  const [loadingMakes,  setLoadingMakes]  = useState(false);
  const [loadingModels, setLoadingModels] = useState(false);

  // ── Search state ──────────────────────────────────────────────────────
  const [makeSearch,  setMakeSearch]  = useState('');
  const [selectedMake, setSelectedMake] = useState(null);
  const [modelSearch, setModelSearch] = useState('');
  const [selectedModel, setSelectedModel] = useState(null);
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
        // silent
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
      // fail silently
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
    if (!selectedMake)  return setAddError(t('dashboard.carCare.selectMakeFirst'));
    if (!selectedModel) return setAddError(t('dashboard.carCare.modelPlaceholder'));
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
      setSelectedMake(null);
      setMakeSearch('');
      setSelectedModel(null);
      setModelSearch('');
      setModels([]);
      setYear('');
      setNickname('');
    } catch (err) {
      setAddError(err.response?.data?.error || t('dashboard.carCare.failedAdd'));
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
      setEditError(err.response?.data?.error || t('dashboard.carCare.failedSave'));
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
      // fail silently
    } finally {
      setDeleting(false);
    }
  }

  // ── Render ────────────────────────────────────────────────────────────
  return (
    <PageShell>
      <PageMeta
        title={`${t('dashboard.carCare.pageTitle')} — OxSteed`}
        description={t('dashboard.carCare.pageDesc')}
      />

      <div className="cc-page">

        {/* ── Header ──────────────────────────────────────────────────── */}
        <div className="cc-header">
          <div>
            <h1>{t('dashboard.carCare.pageTitle')}</h1>
            <p>{t('dashboard.carCare.pageDesc')}</p>
          </div>
        </div>

        {/* ── Add vehicle form ─────────────────────────────────────────── */}
        <div className="cc-card cc-add-form">
          <h2>{t('dashboard.carCare.addVehicle')}</h2>

          <div className="cc-form-row">
            {/* Make picker */}
            <div className="cc-field" style={{ position: 'relative' }}>
              <label>{t('dashboard.carCare.makeLbl')}</label>
              <div className="cc-input-wrap">
                <input
                  ref={makeInputRef}
                  type="text"
                  placeholder={loadingMakes ? t('dashboard.carCare.loadingMakes') : t('dashboard.carCare.makePlaceholder')}
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
                    aria-label={t('dashboard.carCare.clearMake')}>×</button>
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
              <label>{t('dashboard.carCare.modelLbl')}</label>
              <div className="cc-input-wrap">
                <input
                  ref={modelInputRef}
                  type="text"
                  placeholder={
                    !selectedMake     ? t('dashboard.carCare.selectMakeFirst') :
                    loadingModels     ? t('dashboard.carCare.loadingModels')   : t('dashboard.carCare.modelPlaceholder')
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
                    aria-label={t('dashboard.carCare.clearModel')}>×</button>
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
              <label>{t('dashboard.carCare.year')} <span className="cc-optional">({t('common.optional')})</span></label>
              <select value={year} onChange={e => setYear(e.target.value)}>
                <option value="">{t('common.na')}</option>
                {YEAR_OPTIONS.map(y => <option key={y} value={y}>{y}</option>)}
              </select>
            </div>

            {/* Nickname */}
            <div className="cc-field">
              <label>{t('dashboard.carCare.nickname')} <span className="cc-optional">({t('common.optional')})</span></label>
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
            {adding ? t('dashboard.carCare.adding') : t('dashboard.carCare.addToGarageBtn')}
          </button>
        </div>

        {/* ── Garage list ──────────────────────────────────────────────── */}
        <div className="cc-garage-header">
          <h2>{t('dashboard.carCare.myGarage')} <span className="cc-count">{garage.length}</span></h2>
        </div>

        {garageLoading ? (
          <div className="cc-spinner-wrap">
            <div className="cc-spinner" />
          </div>
        ) : garage.length === 0 ? (
          <div className="cc-empty">
            <p>{t('dashboard.carCare.noVehiclesYet')}</p>
          </div>
        ) : (
          <div className="cc-garage-grid">
            {garage.map(v => (
              <VehicleCard
                key={v.id}
                vehicle={v}
                onEdit={() => openEdit(v)}
                onDelete={() => setDeleteTarget(v)}
                t={t}
              />
            ))}
          </div>
        )}

        {/* ── Edit modal ───────────────────────────────────────────────── */}
        {editItem && (
          <div className="cc-modal-overlay" onClick={e => e.target === e.currentTarget && setEditItem(null)}>
            <div className="cc-modal">
              <h2>{t('dashboard.carCare.editVehicle')}</h2>
              <p className="cc-modal-vehicle-label">
                {editItem.make_name} {editItem.model_name}
              </p>

              <div className="cc-form-group">
                <label>{t('dashboard.carCare.nickname')}</label>
                <input type="text" value={editNickname}
                  onChange={e => setEditNickname(e.target.value)} maxLength={80}
                  placeholder='e.g. "Daily Driver"' />
              </div>

              <div className="cc-form-group">
                <label>{t('dashboard.carCare.year')}</label>
                <select value={editYear} onChange={e => setEditYear(e.target.value)}>
                  <option value="">{t('dashboard.carCare.notSpecified')}</option>
                  {YEAR_OPTIONS.map(y => <option key={y} value={y}>{y}</option>)}
                </select>
              </div>

              <div className="cc-form-group">
                <label>{t('dashboard.carCare.notesLbl')} <span className="cc-optional">({t('dashboard.carCare.notesPrivate')})</span></label>
                <textarea rows={2} value={editNotes}
                  onChange={e => setEditNotes(e.target.value)}
                  placeholder={t('dashboard.carCare.notesPlaceholder')} maxLength={500} />
              </div>

              {editError && <p className="cc-error">{editError}</p>}

              <div className="cc-modal-actions">
                <button className="btn-ghost" onClick={() => setEditItem(null)}>{t('common.cancel')}</button>
                <button className="btn-primary" onClick={handleEditSave} disabled={editSaving}>
                  {editSaving ? t('dashboard.carCare.saving') : t('dashboard.carCare.saveChanges')}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* ── Delete confirm ───────────────────────────────────────────── */}
        {deleteTarget && (
          <div className="cc-modal-overlay" onClick={e => e.target === e.currentTarget && setDeleteTarget(null)}>
            <div className="cc-modal">
              <h2>{t('dashboard.carCare.removeVehicle')}</h2>
              <p>{t('dashboard.carCare.removeConfirm', { name: deleteTarget.nickname || `${deleteTarget.make_name} ${deleteTarget.model_name}` })}</p>
              <div className="cc-modal-actions">
                <button className="btn-ghost" onClick={() => setDeleteTarget(null)}>{t('dashboard.carCare.keepIt')}</button>
                <button className="btn-danger" onClick={handleDelete} disabled={deleting}>
                  {deleting ? t('dashboard.carCare.removing') : t('dashboard.carCare.removeBtn')}
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
function VehicleCard({ vehicle: v, onEdit, onDelete, t }) {
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
          <span className="cc-nhtsa-tag">{t('dashboard.carCare.nhtsaVerified')}</span>
          {v.notes && <p className="cc-vehicle-notes">{v.notes}</p>}
        </div>
      </div>
      <div className="cc-vehicle-actions">
        <button className="cc-action-btn" onClick={onEdit}>{t('dashboard.carCare.editBtn')}</button>
        <button className="cc-action-btn danger" onClick={onDelete}>{t('dashboard.carCare.removeBtn')}</button>
      </div>
    </div>
  );
}
