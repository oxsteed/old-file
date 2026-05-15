// client/src/components/businessHub/BusinessClientsTab.jsx
//
// Business Hub > Clients tab: per-business CRM with search, status filtering,
// inline add/edit/archive, and lifetime-value summary.

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Mail, MessageSquare, Phone, Plus, Search, Trash2, Users, X } from 'lucide-react';
import toast from 'react-hot-toast';
import {
  listBusinessClients,
  createBusinessClient,
  updateBusinessClient,
  deleteBusinessClient,
} from '../../api/businesses';
import { formatMoney } from '../../lib/format';
import '../../styles/BusinessClientsTab.css';

const STATUSES = [
  { id: 'all',      label: 'All clients' },
  { id: 'active',   label: 'Active' },
  { id: 'lead',     label: 'Leads' },
  { id: 'past',     label: 'Past' },
  { id: 'archived', label: 'Archived' },
  { id: 'blocked',  label: 'Blocked' },
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
  const [draft, setDraft] = useState(initial || DEFAULT_DRAFT);
  const [busy, setBusy] = useState(false);
  useEffect(() => { setDraft(initial || DEFAULT_DRAFT); }, [initial]);
  if (!open) return null;
  const update = (patch) => setDraft({ ...draft, ...patch });

  const save = async () => {
    if (!draft.display_name?.trim()) { toast.error('Name is required'); return; }
    setBusy(true);
    try { await onSave(draft); } finally { setBusy(false); }
  };

  return (
    <div className="bct-modal-backdrop" role="dialog" aria-modal="true">
      <div className="bct-modal">
        <div className="bct-modal-head">
          <h3>{draft.id ? 'Edit client' : 'Add client'}</h3>
          <button type="button" onClick={onClose} aria-label="Close"><X size={18} /></button>
        </div>
        <div className="bct-modal-body">
          <label className="bct-field">
            <span>Name</span>
            <input autoFocus value={draft.display_name || ''} onChange={(e) => update({ display_name: e.target.value })} maxLength={160} />
          </label>
          <div className="bct-grid-2">
            <label className="bct-field">
              <span>Email</span>
              <input type="email" value={draft.email || ''} onChange={(e) => update({ email: e.target.value })} />
            </label>
            <label className="bct-field">
              <span>Phone</span>
              <input value={draft.phone || ''} onChange={(e) => update({ phone: e.target.value })} />
            </label>
          </div>
          <label className="bct-field">
            <span>Address</span>
            <input value={draft.address_line || ''} onChange={(e) => update({ address_line: e.target.value })} placeholder="123 Main St" />
          </label>
          <div className="bct-grid-3">
            <label className="bct-field">
              <span>City</span>
              <input value={draft.city || ''} onChange={(e) => update({ city: e.target.value })} />
            </label>
            <label className="bct-field">
              <span>State / Region</span>
              <input value={draft.state || ''} onChange={(e) => update({ state: e.target.value })} />
            </label>
            <label className="bct-field">
              <span>ZIP / Postal</span>
              <input value={draft.postal_code || ''} onChange={(e) => update({ postal_code: e.target.value })} />
            </label>
          </div>
          <div className="bct-grid-2">
            <label className="bct-field">
              <span>Status</span>
              <select value={draft.status || 'active'} onChange={(e) => update({ status: e.target.value })}>
                {STATUSES.filter((s) => s.id !== 'all').map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
              </select>
            </label>
            <label className="bct-field">
              <span>Preferred contact</span>
              <select value={draft.preferred_contact || ''} onChange={(e) => update({ preferred_contact: e.target.value })}>
                <option value="">No preference</option>
                <option value="email">Email</option>
                <option value="phone">Phone</option>
                <option value="sms">SMS</option>
              </select>
            </label>
          </div>
          <label className="bct-field">
            <span>Tags (comma separated)</span>
            <input
              value={(draft.tags || []).join(', ')}
              onChange={(e) => update({ tags: e.target.value.split(',').map((s) => s.trim()).filter(Boolean) })}
              placeholder="vip, recurring, referral"
            />
          </label>
          <label className="bct-field">
            <span>Internal notes</span>
            <textarea rows={4} value={draft.internal_notes || ''} onChange={(e) => update({ internal_notes: e.target.value })} maxLength={4000} />
          </label>
        </div>
        <div className="bct-modal-foot">
          {draft.id ? (
            <button type="button" className="bct-btn danger" onClick={() => onDelete(draft)} disabled={busy}>
              <Trash2 size={14} /> Archive
            </button>
          ) : <span />}
          <div className="bct-modal-actions">
            <button type="button" className="bct-btn ghost" onClick={onClose}>Cancel</button>
            <button type="button" className="bct-btn primary" onClick={save} disabled={busy}>
              {draft.id ? 'Save' : 'Add client'}
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
  return (
    <button type="button" className="bct-card" onClick={() => onOpen(client)}>
      <div className="bct-card-head">
        <div className="bct-avatar" aria-hidden="true">
          {(client.display_name || '?').slice(0, 1).toUpperCase()}
        </div>
        <div className="bct-card-main">
          <strong>{client.display_name}</strong>
          <span className="bct-card-status" style={{ background: color }}>{client.status}</span>
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
        <div><strong>{client.total_jobs || 0}</strong><span>job{client.total_jobs === 1 ? '' : 's'}</span></div>
        <div><strong>{formatMoney((client.lifetime_value_cents || 0) / 100, currency)}</strong><span>lifetime</span></div>
        <div><strong>{client.last_job_at ? new Date(client.last_job_at).toLocaleDateString() : '-'}</strong><span>last job</span></div>
      </div>
    </button>
  );
}

export default function BusinessClientsTab({ bizId, businessName, currency }) {
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
      toast.error('Could not load clients');
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
        toast.success('Client updated');
      } else {
        await createBusinessClient(bizId, d);
        toast.success('Client added');
      }
      setModalOpen(false);
      load();
    } catch (err) {
      const msg = err?.response?.data?.message || err?.message || 'Save failed';
      toast.error(typeof msg === 'string' ? msg : 'Save failed');
    }
  };
  const handleDelete = async (d) => {
    if (!d?.id) return;
    if (!window.confirm(`Archive ${d.display_name}?`)) return;
    try {
      await deleteBusinessClient(bizId, d.id);
      toast.success('Client archived');
      setModalOpen(false);
      load();
    } catch {
      toast.error('Could not archive');
    }
  };

  return (
    <div className="bct-root">
      <div className="bct-header">
        <div>
          <span className="bct-kicker"><Users size={16} /> Clients</span>
          <h2>{businessName ? `${businessName}'s clients` : 'Your clients'}</h2>
          <p>
            A private CRM scoped to this business. Track customers, leads, notes, and lifetime value
            without mixing them up with your other businesses.
          </p>
        </div>
        <button type="button" className="bct-btn primary" onClick={handleOpenNew}>
          <Plus size={14} /> Add client
        </button>
      </div>

      <div className="bct-summary">
        <div><strong>{total || counts.all}</strong><span>total</span></div>
        <div><strong>{counts.active}</strong><span>active</span></div>
        <div><strong>{counts.lead}</strong><span>leads</span></div>
        <div><strong>{formatMoney(totalLifetime, currency)}</strong><span>lifetime revenue</span></div>
      </div>

      <div className="bct-controls">
        <label className="bct-search">
          <Search size={14} />
          <input
            placeholder="Search by name, email, or phone"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </label>
        <div className="bct-status-row" role="tablist" aria-label="Filter by status">
          {STATUSES.map((s) => (
            <button
              key={s.id}
              type="button"
              className={'bct-status-pill' + (statusFilter === s.id ? ' active' : '')}
              onClick={() => setStatusFilter(s.id)}
            >
              {s.label}
              {s.id !== 'all' && counts[s.id] != null && <em>{counts[s.id]}</em>}
            </button>
          ))}
        </div>
        <label className="bct-sort">
          <span>Sort</span>
          <select value={sort} onChange={(e) => setSort(e.target.value)}>
            <option value="recent">Most recent</option>
            <option value="lifetime">Highest lifetime value</option>
            <option value="name">Name (A-Z)</option>
          </select>
        </label>
      </div>

      {loading ? (
        <div className="bct-empty">Loading clients...</div>
      ) : items.length === 0 ? (
        <div className="bct-empty">
          <MessageSquare size={28} />
          <h3>No clients yet</h3>
          <p>Add a customer manually now, or convert past job participants into clients automatically as you complete work.</p>
          <button type="button" className="bct-btn primary" onClick={handleOpenNew}>
            <Plus size={14} /> Add your first client
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
