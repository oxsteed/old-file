import React, { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import api from '../../api/axios';
import toast from 'react-hot-toast';
import { Plus, Trash2, Edit2, ChevronRight, DollarSign, Filter } from 'lucide-react';

const STAGES = [
  { id: 'new', color: '#94a3b8' },
  { id: 'contacted', color: '#3b82f6' },
  { id: 'quoted', color: '#f59e0b' },
  { id: 'negotiating', color: '#8b5cf6' },
  { id: 'won', color: '#10b981' },
  { id: 'lost', color: '#ef4444' }
];

export function LeadPipeline({ businessId }) {
  const { t } = useTranslation();
  const [leads, setLeads] = useState([]);
  const [summary, setSummary] = useState([]);
  const [loading, setLoading] = useState(false);
  const [filter, setFilter] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState(null);
  const [selected, setSelected] = useState(null);
  const [form, setForm] = useState({ name: '', email: '', phone: '', service_interest: '', budget_cents: '', notes: '', source: 'manual' });

  useEffect(() => { load(); }, [businessId, filter]);

  const load = async () => {
    setLoading(true);
    try {
      const res = await api.get(`/businesses/${businessId}/leads`, { params: filter ? { status: filter } : {} });
      setLeads(res.data.leads || []);
      setSummary(res.data.summary || []);
    } catch { toast.error(t('businessHub.leads.toastLoadFail')); }
    finally { setLoading(false); }
  };

  const save = async () => {
    if (!form.name) return toast.error(t('businessHub.leads.toastNameRequired'));
    const payload = { ...form, budget_cents: form.budget_cents ? Math.round(parseFloat(form.budget_cents) * 100) : null };
    try {
      if (editing) {
        await api.put(`/businesses/${businessId}/leads/${editing.id}`, payload);
        toast.success(t('businessHub.leads.toastUpdated'));
      } else {
        await api.post(`/businesses/${businessId}/leads`, payload);
        toast.success(t('businessHub.leads.toastAdded'));
      }
      setShowForm(false); setEditing(null); setForm({ name: '', email: '', phone: '', service_interest: '', budget_cents: '', notes: '', source: 'manual' }); load();
    } catch { toast.error(t('businessHub.leads.toastSaveFail')); }
  };

  const moveStage = async (lead, newStatus) => {
    try {
      await api.put(`/businesses/${businessId}/leads/${lead.id}`, { ...lead, status: newStatus });
      toast.success(t('businessHub.leads.toastStageUpdated'));
      load();
    } catch { toast.error(t('businessHub.leads.toastStageUpdateFail')); }
  };

  const remove = async (id) => {
    if (!window.confirm(t('businessHub.leads.confirmDelete'))) return;
    try { await api.delete(`/businesses/${businessId}/leads/${id}`); toast.success(t('businessHub.leads.toastDeleted')); if (selected?.id === id) setSelected(null); load(); }
    catch { toast.error(t('common.failed')); }
  };

  const stageLabel = (stage) => t(`businessHub.leads.stages.${stage.id}`);
  const getStageCount = (stage) => (summary.find(s => s.status === stage.id)?.count) || 0;
  const totalValue = leads.reduce((s, l) => s + (l.budget_cents || 0), 0);

  const startEdit = (lead) => {
    setEditing(lead);
    setForm({ name: lead.name, email: lead.email || '', phone: lead.phone || '', service_interest: lead.service_interest || '', budget_cents: lead.budget_cents ? (lead.budget_cents / 100).toFixed(2) : '', notes: lead.notes || '', source: lead.source || 'manual' });
    setShowForm(true);
  };

  return (
    <div style={{ padding: '1.5rem' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem' }}>
        <div>
          <h3 style={{ margin: 0, fontSize: '1.25rem', fontWeight: 600 }}>{t('businessHub.leads.title')}</h3>
          <p style={{ margin: '0.25rem 0 0', color: 'var(--muted-text)', fontSize: '0.875rem' }}>{t('businessHub.leads.subtitle')}</p>
        </div>
        <button onClick={() => { setEditing(null); setShowForm(true); }} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', background: '#f97316', color: '#fff', border: 'none', borderRadius: '0.5rem', padding: '0.6rem 1.2rem', cursor: 'pointer', fontWeight: 600 }}>
          <Plus size={16} /> {t('businessHub.leads.addLead')}
        </button>
      </div>

      {/* Pipeline overview */}
      <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '1.5rem', overflowX: 'auto', paddingBottom: '0.5rem' }}>
        {STAGES.map((stage, i) => (
          <React.Fragment key={stage.id}>
            <button onClick={() => setFilter(filter === stage.id ? '' : stage.id)} style={{ flexShrink: 0, padding: '0.5rem 1rem', border: `2px solid ${filter === stage.id ? stage.color : 'var(--border-color)'}`, borderRadius: '0.5rem', background: filter === stage.id ? stage.color + '22' : 'transparent', color: filter === stage.id ? stage.color : 'var(--muted-text)', cursor: 'pointer', fontSize: '0.8rem', fontWeight: 600 }}>
              {stageLabel(stage)}<br /><span style={{ color: stage.color, fontSize: '1.1rem' }}>{getStageCount(stage)}</span>
            </button>
            {i < STAGES.length - 1 && <ChevronRight size={16} style={{ alignSelf: 'center', color: 'var(--border-color)', flexShrink: 0 }} />}
          </React.Fragment>
        ))}
        <div style={{ marginLeft: 'auto', background: 'var(--card-bg)', border: '1px solid var(--border-color)', borderRadius: '0.5rem', padding: '0.5rem 1rem', flexShrink: 0 }}>
          <div style={{ fontSize: '0.7rem', color: 'var(--muted-text)' }}>{t('businessHub.leads.pipelineValue')}</div>
          <div style={{ fontWeight: 700, color: '#10b981' }}>${(totalValue / 100).toFixed(0)}</div>
        </div>
      </div>

      {showForm && (
        <div style={{ background: 'var(--card-bg)', border: '1px solid var(--border-color)', borderRadius: '0.75rem', padding: '1.25rem', marginBottom: '1.5rem' }}>
          <h4 style={{ margin: '0 0 1rem' }}>{editing ? t('businessHub.leads.editLead') : t('businessHub.leads.newLead')}</h4>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
            {[['name','name','text'],['email','email','email'],['phone','phone','tel'],['service_interest','serviceInterest','text'],['budget_cents','budget','number'],['source','source','text']].map(([k,l,inputType]) => (
              <div key={k}>
                <label style={{ display: 'block', fontSize: '0.875rem', marginBottom: '0.25rem', color: 'var(--muted-text)' }}>{t(`businessHub.leads.fields.${l}`)}</label>
                <input type={inputType} step={inputType==='number'?'0.01':undefined} value={form[k]} onChange={e => setForm(f => ({ ...f, [k]: e.target.value }))} style={{ width: '100%', padding: '0.6rem', border: '1px solid var(--border-color)', borderRadius: '0.5rem', background: 'var(--card-bg)', color: 'var(--app-text)', boxSizing: 'border-box' }} />
              </div>
            ))}
            <div style={{ gridColumn: '1/-1' }}>
              <label style={{ display: 'block', fontSize: '0.875rem', marginBottom: '0.25rem', color: 'var(--muted-text)' }}>{t('businessHub.leads.fields.notes')}</label>
              <textarea value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} rows={2} style={{ width: '100%', padding: '0.6rem', border: '1px solid var(--border-color)', borderRadius: '0.5rem', background: 'var(--card-bg)', color: 'var(--app-text)', resize: 'vertical', boxSizing: 'border-box' }} />
            </div>
          </div>
          <div style={{ display: 'flex', gap: '0.75rem', justifyContent: 'flex-end', marginTop: '1rem' }}>
            <button onClick={() => { setShowForm(false); setEditing(null); }} style={{ padding: '0.5rem 1rem', border: '1px solid var(--border-color)', borderRadius: '0.5rem', background: 'transparent', color: 'var(--app-text)', cursor: 'pointer' }}>{t('common.cancel')}</button>
            <button onClick={save} style={{ padding: '0.5rem 1rem', background: '#f97316', color: '#fff', border: 'none', borderRadius: '0.5rem', cursor: 'pointer', fontWeight: 600 }}>{t('common.save')}</button>
          </div>
        </div>
      )}

      {loading ? <p style={{ color: 'var(--muted-text)' }}>{t('common.loading')}</p> : leads.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '3rem', color: 'var(--muted-text)' }}>
          <DollarSign size={48} style={{ opacity: 0.3, marginBottom: '1rem' }} />
          <p>{filter ? t('businessHub.leads.noLeadsInStage') : t('businessHub.leads.noLeadsYet')}</p>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
          {leads.map(lead => {
            const stage = STAGES.find(s => s.id === lead.status) || STAGES[0];
            return (
              <div key={lead.id} style={{ display: 'flex', alignItems: 'center', gap: '1rem', background: 'var(--card-bg)', border: '1px solid var(--border-color)', borderRadius: '0.5rem', padding: '0.75rem 1rem', cursor: 'pointer' }} onClick={() => setSelected(selected?.id === lead.id ? null : lead)}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                    <span style={{ fontWeight: 600 }}>{lead.name}</span>
                    <span style={{ fontSize: '0.75rem', padding: '0.1rem 0.6rem', borderRadius: '999px', background: stage.color + '22', color: stage.color, fontWeight: 600 }}>{stageLabel(stage)}</span>
                  </div>
                  <div style={{ fontSize: '0.75rem', color: 'var(--muted-text)' }}>
                    {lead.service_interest && `${lead.service_interest} · `}{lead.email || lead.phone || t('businessHub.leads.noContactInfo')}
                    {lead.source && ` · ${t('businessHub.leads.via')} ${lead.source}`}
                  </div>
                </div>
                {lead.budget_cents > 0 && <div style={{ fontWeight: 700, color: '#10b981', fontSize: '0.875rem', whiteSpace: 'nowrap' }}>${(lead.budget_cents / 100).toFixed(0)}</div>}

                {/* Stage mover */}
                <select value={lead.status || 'new'} onChange={e => { e.stopPropagation(); moveStage(lead, e.target.value); }} onClick={e => e.stopPropagation()} style={{ padding: '0.3rem 0.5rem', border: '1px solid var(--border-color)', borderRadius: '0.35rem', background: 'var(--card-bg)', color: 'var(--app-text)', fontSize: '0.75rem' }}>
                  {STAGES.map(s => <option key={s.id} value={s.id}>{stageLabel(s)}</option>)}
                </select>

                <button onClick={e => { e.stopPropagation(); startEdit(lead); }} style={{ padding: '0.4rem', border: 'none', background: 'transparent', cursor: 'pointer', color: 'var(--muted-text)' }}><Edit2 size={14} /></button>
                <button onClick={e => { e.stopPropagation(); remove(lead.id); }} style={{ padding: '0.4rem', border: 'none', background: 'transparent', cursor: 'pointer', color: '#ef4444' }}><Trash2 size={14} /></button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
