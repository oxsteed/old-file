import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import PageShell from '../../components/PageShell';
import LogisticsLayout from '../../components/logistics/LogisticsLayout';
import { useAuth } from '../../context/AuthContext';
import { createQuote, publishQuote, listStaffQuotes, listLogisticsReconciliation, resolveLogisticsReconciliation, listLogisticsExceptions, resolveLogisticsException, recordPlacementApproval, adminUpdateCampaignStatus } from '../../api/logistics';
import UnsavedChangesGuard from '../../components/logistics/UnsavedChangesGuard';
import '../../styles/logistics/LogisticsWorkspaces.css';
import '../../styles/logistics/LogisticsOperations.css';
export default function OperationsFinancePage() {
    const { t } = useTranslation();
    const { user } = useAuth();
    const label = k => t(`logistics.staff.${k}`);
    const [form, setForm] = useState({ type: 'purchase_order', id: '', description: '', amount: '', deposit: '30', depositDate: '', finalDate: '', terms: '' });
    const [items, setItems] = useState([]);
    const [exceptions, setExceptions] = useState([]);
    const [quotes, setQuotes] = useState([]);
    const [campaign, setCampaign] = useState('');
    const [deadline, setDeadline] = useState('');
    const [notes, setNotes] = useState('');
    const [error, setError] = useState('');
    const [busy, setBusy] = useState(false);
    const [dirty, setDirty] = useState(false);
    const staff = ['admin', 'super_admin', 'logistics_coordinator'].includes(user?.logistics_role || user?.role);
    const action = async (work) => { setBusy(true); setError(''); try {
        await work();
    }
    catch (e) {
        setError(t(`logistics.errors.${e.response?.data?.code}`, { defaultValue: t('logistics.checkout.errors.generic') }));
    }
    finally {
        setBusy(false);
    } };
    const load = () => action(async () => { const [r, e] = await Promise.all([listLogisticsReconciliation(), listLogisticsExceptions()]); setItems(r.data.items); setExceptions(e.data.items); });
    useEffect(() => { if (staff)
        load(); }, [staff]);
    const subject = () => ({ subject_type: form.type, purchase_order_id: form.type === 'purchase_order' ? Number(form.id) : undefined, participant_id: form.type === 'pooled_participant' ? Number(form.id) : undefined });
    const fetchQuotes = async () => { const r = await listStaffQuotes(subject()); setQuotes(r.data.quotes); };
    const update = (key, value) => { setForm(f => ({ ...f, [key]: value })); setDirty(true); };
    const save = e => { e.preventDefault(); action(async () => { await createQuote({ ...subject(), line_items: [{ label: form.description, amount_cents: Math.round(Number(form.amount) * 100) }], deposit_pct: Number(form.deposit) / 100, deposit_due_at: form.depositDate, final_due_at: form.finalDate, cancellation_terms: form.terms }); setDirty(false); await fetchQuotes(); }); };
    const fields = [['description', 'description', 'text'], ['amount', 'amount', 'number'], ['deposit', 'depositPercent', 'number'], ['depositDate', 'deadline', 'datetime-local'], ['finalDate', 'finalDeadline', 'datetime-local']];
    return <PageShell><LogisticsLayout title={label('title')}><UnsavedChangesGuard when={dirty && !busy}/>
 {!staff ? <p role="alert">{t('logistics.operations.internalOnly.body')}</p> : <div className="lx-ops">
 {error && <div role="alert" className="lx-data-error-banner">{error}<button className="lx-btn-secondary" onClick={load}>{label('refresh')}</button></div>}
 <section className="lx-card"><h2>{label('quoteEditor')}</h2><form onSubmit={save} className="lx-ops-form">
 <label>{label('subject')}<select value={form.type} onChange={e => { update('type', e.target.value); setQuotes([]); }}><option value="purchase_order">{label('order')}</option><option value="pooled_participant">{label('participant')}</option></select></label>
 <label>{label('id')}<input required type="number" min="1" value={form.id} onChange={e => { update('id', e.target.value); setQuotes([]); }}/></label>
 {fields.map(([key, name, type]) => <label key={key}>{label(name)}<input required type={type} min={key === 'deposit' ? 1 : 0.01} max={key === 'deposit' ? 100 : undefined} step={type === 'number' ? '.01' : undefined} value={form[key]} onChange={e => update(key, e.target.value)}/></label>)}
 <label className="lx-ops-wide">{t('logistics.checkout.sections.terms')}<textarea required value={form.terms} onChange={e => update('terms', e.target.value)}/></label>
 <div className="lx-btn-row lx-ops-wide"><button disabled={busy} className="lx-btn-primary">{label('save')}</button><button type="button" disabled={busy || !form.id} className="lx-btn-secondary" onClick={() => action(fetchQuotes)}>{label('refresh')}</button></div>
 </form>
 {quotes.map(q => <article className="lx-ops-row" key={q.id}><span>{q.reference} · {t('logistics.checkout.quote.version', { version: q.version })} · {q.total_cents / 100} USD · {q.status}</span>{q.status === 'draft' && <button disabled={busy} className="lx-btn-primary" onClick={() => action(async () => { await publishQuote(q.id); await fetchQuotes(); })}>{label('publish')}</button>}</article>)}
 </section>
 <section className="lx-card"><h2>{label('placement')}</h2><form className="lx-ops-form" onSubmit={e => { e.preventDefault(); action(() => recordPlacementApproval(campaign, notes)); }}>
 <label>{label('campaign')}<input required min="1" type="number" value={campaign} onChange={e => setCampaign(e.target.value)}/></label>
 <label>{label('notes')}<input required value={notes} onChange={e => setNotes(e.target.value)}/></label>
 <label>{label('deadline')}<input type="datetime-local" value={deadline} onChange={e => setDeadline(e.target.value)}/></label>
 <div className="lx-btn-row lx-ops-wide"><button disabled={busy} className="lx-btn-primary">{label('placement')}</button><button type="button" disabled={busy || !campaign || !deadline} className="lx-btn-secondary" onClick={() => action(() => adminUpdateCampaignStatus(campaign, { status: 'deposit_phase', deposit_deadline: deadline, notes }))}>{label('openDeposit')}</button></div></form></section>
 <section className="lx-card"><h2>{label('queues')}</h2><p>{label('reviewHint')}</p><button disabled={busy} className="lx-btn-secondary" onClick={load}>{label('refresh')}</button>
 {!items.length && !exceptions.length && <p role="status">{label('empty')}</p>}
 {[...items.map(i => ({ ...i, kind: 'payment' })), ...exceptions.map(i => ({ ...i, kind: 'exception' }))].map(i => <ReviewItem key={`${i.kind}-${i.id}`} item={i} busy={busy} label={label} onResolve={note => action(async () => { if (i.kind === 'payment')
            await resolveLogisticsReconciliation(i.id, 'resolved', note);
        else
            await resolveLogisticsException(i.id, note); await load(); })}/>)}
 {['admin', 'super_admin'].includes(user?.role) && <Link className="lx-btn-secondary" to="/admin/logistics/refunds">{t('logistics.refunds.openReviewPage')}</Link>}
 </section></div>}
 </LogisticsLayout></PageShell>;
}
function ReviewItem({ item, busy, label, onResolve }) { const [note, setNote] = useState(''); return <form className="lx-ops-review" onSubmit={e => { e.preventDefault(); onResolve(note); }}><h3>{item.reference || `#${item.id}`}</h3><p>{item.reason || item.exception_type} {item.title}</p><label>{label('notes')}<textarea required value={note} onChange={e => setNote(e.target.value)}/></label><button disabled={busy} className="lx-btn-secondary">{label('resolve')}</button></form>; }
