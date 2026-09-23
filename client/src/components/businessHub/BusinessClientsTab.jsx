// client/src/components/businessHub/BusinessClientsTab.jsx
//
// Business Hub > Clients tab: per-business CRM with search, status filtering,
// inline add/edit/archive, and lifetime-value summary.

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Mail, MessageSquare, Phone, Plus, Search, Trash2, Users, X } from 'lucide-react';
import toast from 'react-hot-toast';
import {
  listBusinessClients,
  createBusinessClient,
  updateBusinessClient,
  deleteBusinessClient,
} from '../../api/businesses';
import { formatDate, formatMoney } from '../../lib/format';
import AddressAutocomplete from '../../components/AddressAutocomplete';
import '../../styles/BusinessClientsTab.css';

const STATUSES = [
  { id: 'all',      label: 'all' },
  { id: 'active',   label: 'active' },
  { id: 'lead',     label: 'lead' },
  { id: 'past',     label: 'past' },
  { id: 'archived', label: 'archived' },
  { id: 'blocked',  label: 'blocked' },
];

const STATUS_COLORS = {
  active:   '#10b981',
  lead:     '#f97316',
  past:     '#64748b',
  archived: '#94a3b8',
  blocked:  '#ef4444',
};

const DEFAULT_DRAFT = {
  display_name: '',
  email: '',
  phone: '',
  address_line: '',
  city: '',
  state: '',
  postal_code: '',
  country: '',
  status: 'active',
  preferred_contact: '',
  tags: [],
  internal_notes: '',
};

function ClientFormModal({ open, initial, onClose, onSave, onDelete }) {
  const { t } = useTranslation();
  const [draft, setDraft] = useState(initial || DEFAULT_DRAFT);
  const [busy, setBusy] = useState(false);
  useEffect(() => { setDraft(initial || DEFAULT_DRAFT); }, [initial]);
  if (!open) return null;
  const update = (patch) => setDraft({ ...draft, ...patch });

  const save = async () => {
    if (!draft.display_name?.trim()) { toast.error(t('businessClients.toastNameRequired')); return; }
    setBusy(true);
    try { await onSave(draft); } finally { setBusy(false); }
  };

  return (
    <div className="bct-modal-backdrop" role="dialog" aria-modal="true">
      <div className="bct-modal">
        <div className="bct-modal-head">
          <h3>{draft.id ? t('businessClients.modalEdit') : t('businessClients.modalAdd')}</h3>
          <button type="button" onClick={onClose} aria-label={t('businessClients.close')}><X size={18} /></button>
        </div>
        <div className="bct-modal-body">
          <label className="bct-field">
            <span>{t('businessClients.fieldName')}</span>
            <input autoFocus value={draft.display_name || ''} onChange={(e) => update({ display_name: e.target.value })} maxLength={160} />
          </label>
          <div className="bct-grid-2">
            <label className="bct-field">
              <span>{t('businessClients.fieldEmail')}</span>
              <input type="email" value={draft.email || ''} onChange={(e) => update({ email: e.target.value })} />
            </label>
            <label className="bct-field">
              <span>{t('businessClients.fieldPhone')}</span>
              <input value={draft.phone || ''} onChange={(e) => update({ phone: e.target.value })} />
            </label>
          </div>
          <label className="bct-field">
            <span>{t('businessClients.fieldAddress')}</span>
            <AddressAutocomplete
              value={draft.address_line || ''}
              onChange={(value) => update({ address_line: value })}
              onSelect={(place) => update({
                address_line: place.addressLine1 || place.display,
                city: place.city || draft.city,
                state: place.state || draft.state,
                postal_code: place.zip || draft.postal_code,
                country: place.country || draft.country,
              })}
              placeholder={t('businessClients.placeholderAddress')}
              ariaLabel={t('businessClients.fieldAddress')}
              autoComplete="street-address"
            />
          </label>
          <div className="bct-grid-3">
            <label className="bct-field">
              <span>{t('businessClients.fieldCity')}</span>
              <input value={draft.city || ''} onChange={(e) => update({ city: e.target.value })} />
            </label>
            <label className="bct-field">
              <span>{t('businessClients.fieldStateRegion')}</span>
              <input value={draft.state || ''} onChange={(e) => update({ state: e.target.value })} />
            </label>
            <label className="bct-field">
              <span>{t('businessClients.fieldZip')}</span>
              <input value={draft.postal_code || ''} onChange={(e) => update({ postal_code: e.target.value })} />
            </label>
          </div>
          <div className="bct-grid-2">
            <label className="bct-field">
              <span>{t('businessClients.fieldStatus')}</span>
              <select value={draft.status || 'active'} onChange={(e) => update({ status: e.target.value })}>
                {STATUSES.filter((s) => s.id !== 'all').map((s) => (
                  <option key={s.id} value={s.id}>{t(`businessClients.status.${s.label}`)}</option>
                ))}
              </select>
            </label>
            <label className="bct-field">
              <span>{t('businessClients.fieldPreferredContact')}</span>
              <select value={draft.preferred_contact || ''} onChange={(e) => update({ preferred_contact: e.target.value })}>
                <option value="">{t('businessClients.preferredContactAny')}</option>
                <option value="email">{t('businessClients.preferredContactEmail')}</option>
                <option value="phone">{t('businessClients.preferredContactPhone')}</option>
                <option value="sms">{t('businessClients.preferredContactSms')}</option>
              </select>
            </label>
          </div>
          <label className="bct-field">
            <span>{t('businessClients.fieldTags')}</span>
            <input
              value={(draft.tags || []).join(', ')}
              onChange={(e) => update({ tags: e.target.value.split(',').map((s) => s.trim()).filter(Boolean) })}
              placeholder={t('businessClients.placeholderTags')}
            />
          </label>
          <label className="bct-field">
            <span>{t('businessClients.fieldInternalNotes')}</span>
            <textarea rows={4} value={draft.internal_notes || ''} onChange={(e) => update({ internal_notes: e.target.value })} maxLength={4000} />
          </label>
        </div>
        <div className="bct-modal-foot">
          {draft.id ? (
            <button type="button" className="bct-btn danger" onClick={() => onDelete(draft)} disabled={busy}>
              <Trash2 size={14} /> {t('businessClients.btnArchive')}
            </button>
          ) : <span />}
          <div className="bct-modal-actions">
            <button type="button" className="bct-btn ghost" onClick={onClose}>{t('businessClients.btnCancel')}</button>
            <button type="button" className="bct-btn primary" onClick={save} disabled={busy}>
              {draft.id ? t('businessClients.btnSave') : t('businessClients.btnAdd')}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function ClientCard({ client, currency, onOpen }) {
  const color = STATUS_COLORS[client.status] || '#64748b';
  const tags = Array.isArray(client.tags) ? client.tags : [];
  const { t } = useTranslation();
  return (
    <button type="button" className="bct-card" onClick={() => onOpen(client)}>
      <div className="bct-card-head">
        <div className="bct-avatar" aria-hidden="true">
          {(client.display_name || '?').slice(0, 1).toUpperCase()}
        </div>
        <div className="bct-card-main">
          <strong>{client.display_name}</strong>
          <span className="bct-card-status" style={{ background: color }}>
            {client.status
              ? t(`businessClients.status.${client.status}`, { defaultValue: client.status })
              : t('businessClients.status.unknown')}
          </span>
        </div>
      </div>
      <div className="bct-card-meta">
        {client.email && <span><Mail size={11} /> {client.email}</span>}
        {client.phone && <span><Phone size={11} /> {client.phone}</span>}
      </div>
      {tags.length > 0 && (
        <div className="bct-card-tags">
          {tags.map((t) => <span key={t}>{t}</span>)}
        </div>
      )}
      <div className="bct-card-stats">
        <div><strong>{client.total_jobs || 0}</strong><span>{t('businessClients.statJobs', { count: client.total_jobs || 0 })}</span></div>
        <div><strong>{formatMoney((client.lifetime_value_cents || 0) / 100, { currency })}</strong><span>{t('businessClients.statLifetime')}</span></div>
        <div><strong>{client.last_job_at ? formatDate(client.last_job_at) : '-'}</strong><span>{t('businessClients.statLastJob')}</span></div>
      </div>
    </button>
  );
}

export default function BusinessClientsTab({ bizId, businessName, currency }) {
  const { t } = useTranslation();
  const [items, setItems] = useState([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState('all');
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState('recent');
  const [modalOpen, setModalOpen] = useState(false);
  const [draft, setDraft] = useState(null);

  const load = useCallback(async () => {
    if (!bizId) return;
    setLoading(true);
    try {
      const data = await listBusinessClients(bizId, {
        status: statusFilter === 'all' ? undefined : statusFilter,
        search: search || undefined,
        sort,
        limit: 200,
      });
      setItems(Array.isArray(data?.clients) ? data.clients : []);
      setTotal(data?.total || 0);
    } catch (err) {
      toast.error(t('businessClients.toastLoadFailed'));
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, [bizId, statusFilter, search, sort]);

  useEffect(() => { load(); }, [load]);

  const counts = useMemo(() => {
    const c = { all: items.length, active: 0, lead: 0, past: 0, archived: 0, blocked: 0 };
    for (const it of items) c[it.status] = (c[it.status] || 0) + 1;
    return c;
  }, [items]);

  const totalLifetime = useMemo(
    () => items.reduce((acc, it) => acc + (it.lifetime_value_cents || 0), 0) / 100,
    [items],
  );

  const handleOpenNew = () => { setDraft(DEFAULT_DRAFT); setModalOpen(true); };
  const handleOpenExisting = (c) => { setDraft({ ...c }); setModalOpen(true); };
  const handleSave = async (d) => {
    try {
      if (d.id) {
        await updateBusinessClient(bizId, d.id, d);
        toast.success(t('businessClients.toastUpdated'));
      } else {
        await createBusinessClient(bizId, d);
        toast.success(t('businessClients.toastCreated'));
      }
      setModalOpen(false);
      load();
    } catch (err) {
      const msg = err?.response?.data?.message || err?.message || t('businessClients.saveFailed');
      toast.error(typeof msg === 'string' ? msg : t('businessClients.saveFailed'));
    }
  };
  const handleDelete = async (d) => {
    if (!d?.id) return;
    if (!window.confirm(t('businessClients.confirmArchive', { name: d.display_name }))) return;
    try {
      await deleteBusinessClient(bizId, d.id);
      toast.success(t('businessClients.toastArchived'));
      setModalOpen(false);
      load();
    } catch {
      toast.error(t('businessClients.toastArchiveFailed'));
    }
  };

  return (
    <div className="bct-root">
      <div className="bct-header">
        <div>
          <span className="bct-kicker"><Users size={16} /> {t('businessClients.sectionClients')}</span>
          <h2>{businessName ? t('businessClients.businessClientsTitleWithName', { name: businessName }) : t('businessClients.yourClients')}</h2>
          <p>
            {t('businessClients.intro')}
          </p>
        </div>
        <button type="button" className="bct-btn primary" onClick={handleOpenNew}>
          <Plus size={14} /> {t('businessClients.btnAdd')}
        </button>
      </div>

      <div className="bct-summary">
        <div><strong>{total || counts.all}</strong><span>{t('businessClients.cardTotal')}</span></div>
        <div><strong>{counts.active}</strong><span>{t('businessClients.cardActive')}</span></div>
        <div><strong>{counts.lead}</strong><span>{t('businessClients.cardLeads')}</span></div>
        <div><strong>{formatMoney(totalLifetime, { currency })}</strong><span>{t('businessClients.cardLifetime')}</span></div>
      </div>

      <div className="bct-controls">
        <label className="bct-search">
          <Search size={14} />
          <input
            placeholder={t('businessClients.searchPlaceholder')}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </label>
        <div className="bct-status-row" role="tablist" aria-label={t('businessClients.filterByStatus')}>
          {STATUSES.map((s) => (
            <button
              key={s.id}
              type="button"
              className={'bct-status-pill' + (statusFilter === s.id ? ' active' : '')}
              onClick={() => setStatusFilter(s.id)}
            >
              {t(`businessClients.status.${s.label}`)}
              {s.id !== 'all' && counts[s.id] != null && <em>{counts[s.id]}</em>}
            </button>
          ))}
        </div>
        <label className="bct-sort">
          <span>{t('businessClients.sort')}</span>
          <select value={sort} onChange={(e) => setSort(e.target.value)}>
            <option value="recent">{t('businessClients.sortRecent')}</option>
            <option value="lifetime">{t('businessClients.sortLifetime')}</option>
            <option value="name">{t('businessClients.sortName')}</option>
          </select>
        </label>
      </div>

      {loading ? (
        <div className="bct-empty">{t('businessClients.loading')}</div>
      ) : items.length === 0 ? (
        <div className="bct-empty">
          <MessageSquare size={28} />
          <h3>{t('businessClients.emptyTitle')}</h3>
          <p>{t('businessClients.emptyBody')}</p>
          <button type="button" className="bct-btn primary" onClick={handleOpenNew}>
            <Plus size={14} /> {t('businessClients.btnAddFirst')}
          </button>
        </div>
      ) : (
        <div className="bct-grid">
          {items.map((c) => (
            <ClientCard key={c.id} client={c} currency={currency} onOpen={handleOpenExisting} />
          ))}
        </div>
      )}

      <ClientFormModal
        open={modalOpen}
        initial={draft}
        onClose={() => setModalOpen(false)}
        onSave={handleSave}
        onDelete={handleDelete}
      />
    </div>
  );
}
