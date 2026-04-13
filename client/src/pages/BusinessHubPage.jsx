import { useState, useEffect, useCallback } from 'react';
import PageMeta from '../components/PageMeta';
import PageShell from '../components/PageShell';
import toast from 'react-hot-toast';
import { useAuth } from '../context/AuthContext';
import {
  listBusinesses, createBusiness,
  getAnalytics,
  listInvoices, createInvoice, updateInvoice, markInvoicePaid, deleteInvoice,
  getTax, refreshTax, markTaxPaid,
  listGoals, createGoal, updateGoal, deleteGoal,
} from '../api/businesses';
import '../styles/BusinessHubPage.css';

const LS_KEY = 'oxs:bh:lastBusinessId';
const HELPER_ROLES = ['helper', 'helper_pro', 'broker'];

// ── formatters ────────────────────────────────────────────────────────────────
function fmt$(n) {
  if (!n && n !== 0) return '—';
  return '$' + parseFloat(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function fmtDate(d) {
  if (!d) return '—';
  const dateOnly = String(d).split('T')[0];
  return new Date(dateOnly + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}
function fmtMonth(m) {
  // m = "2025-03"
  if (!m) return '';
  const [y, mo] = m.split('-');
  return new Date(+y, +mo - 1).toLocaleString('en-US', { month: 'short' });
}

// ── default forms ─────────────────────────────────────────────────────────────
const DEFAULT_BIZ_FORM   = { name: '', description: '', website: '', phone: '', tax_rate: '' };
const DEFAULT_INV_FORM   = {
  client_name: '', client_email: '', client_company: '',
  due_date: '', invoice_tax_rate: '', notes: '', status: 'draft',
  line_items: [{ description: '', quantity: 1, unit_price: '' }],
};
const DEFAULT_GOAL_FORM  = { title: '', goal_type: 'revenue', period: 'monthly', target_value: '', current_value: '' };

// ── main component ────────────────────────────────────────────────────────────
export default function BusinessHubPage() {
  const { user } = useAuth();

  // guard
  if (!user || !HELPER_ROLES.includes(user.role)) {
    return (
      <PageShell>
        <PageMeta title="Business Hub — OxSteed" description="Manage your service business finances, invoices, and goals." />
        <div className="bh-page">
          <div className="bh-empty" style={{ marginTop: '3rem' }}>
            <p style={{ fontWeight: 700 }}>Helpers only</p>
            <p>The Business Hub is available to Helper, Helper Pro, and Broker accounts.</p>
          </div>
        </div>
      </PageShell>
    );
  }

  return <BusinessHubInner />;
}

function BusinessHubInner() {
  const [businesses, setBusinesses]   = useState([]);
  const [bizId, setBizId]             = useState(() => localStorage.getItem(LS_KEY) || '');
  const [tab, setTab]                 = useState('overview');
  const [loadingBiz, setLoadingBiz]   = useState(true);

  // modal state
  const [modal, setModal]     = useState(null); // 'add-biz' | 'add-inv' | 'edit-inv' | 'pay-inv' | 'add-goal' | 'edit-goal' | 'pay-tax'
  const [selected, setSelected] = useState(null);
  const [form, setForm]       = useState({});
  const [saving, setSaving]   = useState(false);
  const [formErr, setFormErr] = useState('');

  // tab data
  const [analytics, setAnalytics]   = useState(null);
  const [analyticsLoading, setAnalyticsLoading] = useState(false);
  const [invoiceData, setInvoiceData] = useState(null);
  const [invoicesLoading, setInvoicesLoading] = useState(false);
  const [taxData, setTaxData]       = useState(null);
  const [taxLoading, setTaxLoading] = useState(false);
  const [goals, setGoals]           = useState([]);
  const [goalsLoading, setGoalsLoading] = useState(false);

  // ── load businesses ──────────────────────────────────────────────────────
  const loadBusinesses = useCallback(async () => {
    setLoadingBiz(true);
    try {
      const list = await listBusinesses();
      setBusinesses(list);
      if (list.length > 0) {
        const saved = localStorage.getItem(LS_KEY);
        const valid = saved && list.find(b => String(b.id) === String(saved));
        const chosen = valid ? saved : String(list[0].id);
        setBizId(chosen);
        localStorage.setItem(LS_KEY, chosen);
      }
    } catch { toast.error('Failed to load businesses'); }
    finally { setLoadingBiz(false); }
  }, []);

  useEffect(() => { loadBusinesses(); }, [loadBusinesses]);

  // ── load tab data when bizId or tab changes ──────────────────────────────
  const loadOverview = useCallback(async () => {
    if (!bizId) return;
    setAnalyticsLoading(true);
    try { setAnalytics(await getAnalytics(bizId)); }
    catch { toast.error('Failed to load analytics'); }
    finally { setAnalyticsLoading(false); }
  }, [bizId]);

  const loadInvoices = useCallback(async () => {
    if (!bizId) return;
    setInvoicesLoading(true);
    try { setInvoiceData(await listInvoices(bizId)); }
    catch { toast.error('Failed to load invoices'); }
    finally { setInvoicesLoading(false); }
  }, [bizId]);

  const loadTax = useCallback(async () => {
    if (!bizId) return;
    setTaxLoading(true);
    try { setTaxData(await getTax(bizId)); }
    catch { toast.error('Failed to load tax estimates'); }
    finally { setTaxLoading(false); }
  }, [bizId]);

  const loadGoals = useCallback(async () => {
    if (!bizId) return;
    setGoalsLoading(true);
    try { setGoals(await listGoals(bizId)); }
    catch { toast.error('Failed to load goals'); }
    finally { setGoalsLoading(false); }
  }, [bizId]);

  useEffect(() => {
    if (!bizId) return;
    if (tab === 'overview') loadOverview();
    else if (tab === 'invoices') loadInvoices();
    else if (tab === 'tax') loadTax();
    else if (tab === 'goals') {
      loadGoals();
      loadOverview();
    }
  }, [bizId, tab, loadOverview, loadInvoices, loadTax, loadGoals]);

  // ── switcher ──────────────────────────────────────────────────────────────
  function handleSwitchBiz(id) {
    setBizId(id);
    localStorage.setItem(LS_KEY, id);
    setAnalyticsLoading(true);
    setAnalytics(null); setInvoiceData(null); setTaxData(null); setGoals([]);
  }

  // ── modal helpers ─────────────────────────────────────────────────────────
  function closeModal() { setModal(null); setSelected(null); setFormErr(''); }
  function fc(e) {
    const { name, value } = e.target;
    setForm(f => ({ ...f, [name]: value }));
  }

  // ── add business ──────────────────────────────────────────────────────────
  async function handleAddBiz() {
    if (!form.name?.trim()) { setFormErr('Business name is required.'); return; }
    setSaving(true);
    try {
      await createBusiness({ ...form, tax_rate: form.tax_rate ? parseFloat(form.tax_rate) : undefined });
      toast.success('Business added');
      closeModal();
      await loadBusinesses();
    } catch (e) { setFormErr(e?.response?.data?.error || 'Failed to create business'); }
    finally { setSaving(false); }
  }

  // ── invoice CRUD ──────────────────────────────────────────────────────────
  async function handleSaveInvoice() {
    if (!form.client_name?.trim()) { setFormErr('Client name is required.'); return; }
    if (!form.due_date) { setFormErr('Due date is required.'); return; }
    const items = (form.line_items || []).filter(li => li.description?.trim());
    if (items.length === 0) { setFormErr('At least one line item is required.'); return; }
    setSaving(true);
    try {
      const payload = {
        ...form,
        invoice_tax_rate: form.invoice_tax_rate ? parseFloat(form.invoice_tax_rate) : undefined,
        line_items: items.map(li => ({
          description: li.description,
          quantity: parseFloat(li.quantity) || 1,
          unit_price: parseFloat(li.unit_price) || 0,
        })),
      };
      if (modal === 'add-inv') {
        await createInvoice(bizId, payload);
        toast.success('Invoice created');
      } else {
        await updateInvoice(bizId, selected.id, payload);
        toast.success('Invoice updated');
      }
      closeModal();
      await loadInvoices();
    } catch (e) { setFormErr(e?.response?.data?.error || 'Failed to save invoice'); }
    finally { setSaving(false); }
  }

  async function handleMarkInvoicePaid() {
    setSaving(true);
    try {
      await markInvoicePaid(bizId, selected.id, form.amount ? parseFloat(form.amount) : undefined);
      toast.success('Invoice marked paid');
      closeModal();
      await loadInvoices();
    } catch (e) { setFormErr(e?.response?.data?.error || 'Failed'); }
    finally { setSaving(false); }
  }

  async function handleDeleteInvoice(inv) {
    if (!window.confirm(`Delete invoice ${inv.invoice_number}?`)) return;
    try {
      await deleteInvoice(bizId, inv.id);
      toast.success('Invoice deleted');
      await loadInvoices();
    } catch { toast.error('Failed to delete invoice'); }
  }

  // ── tax ───────────────────────────────────────────────────────────────────
  async function handleRefreshTax() {
    try {
      await refreshTax(bizId);
      toast.success('Tax estimates refreshed');
      await loadTax();
    } catch { toast.error('Failed to refresh tax estimates'); }
  }

  async function handleMarkTaxPaid() {
    setSaving(true);
    try {
      await markTaxPaid(bizId, selected.id, form.amount ? parseFloat(form.amount) : undefined);
      toast.success('Tax payment recorded');
      closeModal();
      await loadTax();
    } catch (e) { setFormErr(e?.response?.data?.error || 'Failed'); }
    finally { setSaving(false); }
  }

  // ── goals ─────────────────────────────────────────────────────────────────
  async function handleSaveGoal() {
    if (!form.title?.trim()) { setFormErr('Title is required.'); return; }
    if (!form.target_value) { setFormErr('Target value is required.'); return; }
    setSaving(true);
    try {
      const payload = {
        ...form,
        target_value: parseFloat(form.target_value),
        current_value: form.current_value ? parseFloat(form.current_value) : undefined,
      };
      if (modal === 'add-goal') {
        await createGoal(bizId, payload);
        toast.success('Goal added');
      } else {
        await updateGoal(bizId, selected.id, payload);
        toast.success('Goal updated');
      }
      closeModal();
      await loadGoals();
    } catch (e) { setFormErr(e?.response?.data?.error || 'Failed to save goal'); }
    finally { setSaving(false); }
  }

  async function handleDeleteGoal(g) {
    if (!window.confirm(`Delete goal "${g.title}"?`)) return;
    try {
      await deleteGoal(bizId, g.id);
      toast.success('Goal deleted');
      await loadGoals();
    } catch { toast.error('Failed to delete goal'); }
  }

  // ── invoice line items helpers ────────────────────────────────────────────
  function addLineItem() {
    setForm(f => ({ ...f, line_items: [...(f.line_items || []), { description: '', quantity: 1, unit_price: '' }] }));
  }
  function removeLineItem(i) {
    setForm(f => ({ ...f, line_items: f.line_items.filter((_, idx) => idx !== i) }));
  }
  function updateLineItem(i, field, value) {
    setForm(f => {
      const items = [...f.line_items];
      items[i] = { ...items[i], [field]: value };
      return { ...f, line_items: items };
    });
  }
  function calcTotals(lineItems, taxRate) {
    const subtotal = (lineItems || []).reduce((s, li) => s + (parseFloat(li.quantity) || 0) * (parseFloat(li.unit_price) || 0), 0);
    const taxAmt   = subtotal * ((parseFloat(taxRate) || 0) / 100);
    return { subtotal, taxAmt, total: subtotal + taxAmt };
  }

  // ── current biz object ────────────────────────────────────────────────────
  const currentBiz = businesses.find(b => String(b.id) === String(bizId));

  // ── render ────────────────────────────────────────────────────────────────
  return (
    <PageShell>
      <PageMeta title="Business Hub — OxSteed" description="Manage your service business finances, invoices, and goals." />
      <div className="bh-page">

        {/* Header */}
        <div className="bh-header">
          <div>
            <h1>Business Hub</h1>
            <p>Manage invoices, track taxes, and monitor your business goals.</p>
          </div>
          <div className="bh-header-actions">
            <button className="bh-btn primary" onClick={() => { setForm(DEFAULT_BIZ_FORM); setFormErr(''); setModal('add-biz'); }}>
              + Add Business
            </button>
          </div>
        </div>

        {/* Business switcher */}
        {loadingBiz ? (
          <p className="bh-loading">Loading businesses…</p>
        ) : businesses.length === 0 ? (
          <div className="bh-empty">
            <p style={{ fontWeight: 700 }}>No businesses yet</p>
            <p>Add your first business to start tracking invoices, taxes, and goals.</p>
            <button className="bh-btn primary" onClick={() => { setForm(DEFAULT_BIZ_FORM); setFormErr(''); setModal('add-biz'); }}>
              Add a Business
            </button>
          </div>
        ) : (
          <>
            <div className="bh-switcher">
              <span className="bh-switcher-label">Business</span>
              <select value={bizId} onChange={e => handleSwitchBiz(e.target.value)}>
                {businesses.map(b => (
                  <option key={b.id} value={b.id}>{b.name}</option>
                ))}
              </select>
              {currentBiz?.is_primary && <span className="bh-primary-tag">Primary</span>}
            </div>

            {/* Tabs */}
            <div className="bh-tabs">
              {['overview', 'invoices', 'tax', 'goals'].map(t => (
                <button key={t} className={`bh-tab${tab === t ? ' active' : ''}`} onClick={() => setTab(t)}>
                  {t.charAt(0).toUpperCase() + t.slice(1)}
                </button>
              ))}
            </div>

            {/* ── Overview tab ────────────────────────────────────── */}
            {tab === 'overview' && (
              analyticsLoading ? <p className="bh-loading">Loading analytics…</p> :
              !analytics ? <p className="bh-error">Could not load analytics.</p> :
              <OverviewTab analytics={analytics} />
            )}

            {/* ── Invoices tab ─────────────────────────────────────── */}
            {tab === 'invoices' && (
              invoicesLoading ? <p className="bh-loading">Loading invoices…</p> :
              <InvoicesTab
                data={invoiceData}
                onNew={() => { setForm(DEFAULT_INV_FORM); setFormErr(''); setModal('add-inv'); }}
                onEdit={inv => {
                  setSelected(inv);
                  setForm({
                    client_name: inv.client_name || '',
                    client_email: inv.client_email || '',
                    client_company: inv.client_company || '',
                    due_date: inv.due_date ? inv.due_date.split('T')[0] : '',
                    invoice_tax_rate: inv.invoice_tax_rate ?? '',
                    notes: inv.notes || '',
                    status: inv.status || 'draft',
                    line_items: (inv.line_items?.length ? inv.line_items : [{ description: '', quantity: 1, unit_price: '' }]),
                  });
                  setFormErr('');
                  setModal('edit-inv');
                }}
                onPay={inv => { setSelected(inv); setForm({ amount: inv.total || '' }); setFormErr(''); setModal('pay-inv'); }}
                onDelete={handleDeleteInvoice}
              />
            )}

            {/* ── Tax tab ──────────────────────────────────────────── */}
            {tab === 'tax' && (
              taxLoading ? <p className="bh-loading">Loading tax estimates…</p> :
              <TaxTab
                data={taxData}
                onRefresh={handleRefreshTax}
                onPay={est => { setSelected(est); setForm({ amount: est.estimated_tax || '' }); setFormErr(''); setModal('pay-tax'); }}
              />
            )}

            {/* ── Goals tab ────────────────────────────────────────── */}
            {tab === 'goals' && (
              goalsLoading ? <p className="bh-loading">Loading goals…</p> :
              <GoalsTab
                goals={goals}
                analytics={analytics}
                onNew={() => { setForm(DEFAULT_GOAL_FORM); setFormErr(''); setModal('add-goal'); }}
                onEdit={g => {
                  setSelected(g);
                  setForm({
                    title: g.title || '',
                    goal_type: g.goal_type || 'revenue',
                    period: g.period || 'monthly',
                    target_value: g.target_value ?? '',
                    current_value: g.current_value ?? '',
                  });
                  setFormErr('');
                  setModal('edit-goal');
                }}
                onDelete={handleDeleteGoal}
              />
            )}
          </>
        )}

        {/* ── Modal: Add Business ───────────────────────────────────── */}
        {modal === 'add-biz' && (
          <div className="bh-modal-overlay" onClick={e => e.target === e.currentTarget && closeModal()}>
            <div className="bh-modal">
              <h2>Add Business</h2>
              <div className="bh-field"><label>Name *</label><input name="name" value={form.name || ''} onChange={fc} placeholder="My Service Co." /></div>
              <div className="bh-field"><label>Description</label><textarea name="description" value={form.description || ''} onChange={fc} rows={2} /></div>
              <div className="bh-field-row">
                <div className="bh-field"><label>Phone</label><input name="phone" value={form.phone || ''} onChange={fc} /></div>
                <div className="bh-field"><label>Website</label><input name="website" value={form.website || ''} onChange={fc} placeholder="https://" /></div>
              </div>
              <div className="bh-field"><label>Default Tax Rate (%)</label><input type="number" name="tax_rate" value={form.tax_rate || ''} onChange={fc} placeholder="0" min="0" max="100" step="0.01" /></div>
              {formErr && <p style={{ color: '#f87171', fontSize: '0.85rem', marginBottom: '0.5rem' }}>{formErr}</p>}
              <div className="bh-modal-actions">
                <button className="bh-btn" onClick={closeModal}>Cancel</button>
                <button className="bh-btn primary" onClick={handleAddBiz} disabled={saving}>{saving ? 'Saving…' : 'Add Business'}</button>
              </div>
            </div>
          </div>
        )}

        {/* ── Modal: Add / Edit Invoice ─────────────────────────────── */}
        {(modal === 'add-inv' || modal === 'edit-inv') && (
          <div className="bh-modal-overlay" onClick={e => e.target === e.currentTarget && closeModal()}>
            <div className="bh-modal">
              <h2>{modal === 'add-inv' ? 'New Invoice' : 'Edit Invoice'}</h2>
              <div className="bh-field-row">
                <div className="bh-field"><label>Client Name *</label><input name="client_name" value={form.client_name || ''} onChange={fc} /></div>
                <div className="bh-field"><label>Client Email</label><input type="email" name="client_email" value={form.client_email || ''} onChange={fc} /></div>
              </div>
              <div className="bh-field-row">
                <div className="bh-field"><label>Company</label><input name="client_company" value={form.client_company || ''} onChange={fc} /></div>
                <div className="bh-field"><label>Due Date *</label><input type="date" name="due_date" value={form.due_date || ''} onChange={fc} /></div>
              </div>
              <div className="bh-field-row">
                <div className="bh-field"><label>Tax Rate (%)</label><input type="number" name="invoice_tax_rate" value={form.invoice_tax_rate || ''} onChange={fc} placeholder="0" min="0" max="100" step="0.01" /></div>
                <div className="bh-field">
                  <label>Status</label>
                  <select name="status" value={form.status || 'draft'} onChange={fc}>
                    <option value="draft">Draft</option>
                    <option value="sent">Sent</option>
                    <option value="paid">Paid</option>
                    <option value="cancelled">Cancelled</option>
                  </select>
                </div>
              </div>

              {/* Line items */}
              <div className="bh-field"><label>Line Items</label></div>
              <div className="bh-line-items">
                {(form.line_items || []).map((li, i) => (
                  <div key={i} className="bh-line-item">
                    <input placeholder="Description" value={li.description || ''} onChange={e => updateLineItem(i, 'description', e.target.value)} />
                    <input type="number" placeholder="Qty" value={li.quantity || ''} onChange={e => updateLineItem(i, 'quantity', e.target.value)} min="0" step="0.01" />
                    <input type="number" placeholder="Unit $" value={li.unit_price || ''} onChange={e => updateLineItem(i, 'unit_price', e.target.value)} min="0" step="0.01" />
                    <button className="bh-line-remove" onClick={() => removeLineItem(i)} disabled={(form.line_items || []).length <= 1}>×</button>
                  </div>
                ))}
                <button className="bh-line-add" onClick={addLineItem}>+ Add line item</button>
              </div>

              {/* Live totals preview */}
              {(() => {
                const { subtotal, taxAmt, total } = calcTotals(form.line_items, form.invoice_tax_rate);
                return (
                  <div className="bh-totals">
                    <div>Subtotal: {fmt$(subtotal)}</div>
                    {taxAmt > 0 && <div>Tax ({form.invoice_tax_rate || 0}%): {fmt$(taxAmt)}</div>}
                    <div className="grand">Total: {fmt$(total)}</div>
                  </div>
                );
              })()}

              <div className="bh-field"><label>Notes</label><textarea name="notes" value={form.notes || ''} onChange={fc} rows={2} /></div>
              {formErr && <p style={{ color: '#f87171', fontSize: '0.85rem', marginBottom: '0.5rem' }}>{formErr}</p>}
              <div className="bh-modal-actions">
                <button className="bh-btn" onClick={closeModal}>Cancel</button>
                <button className="bh-btn primary" onClick={handleSaveInvoice} disabled={saving}>{saving ? 'Saving…' : modal === 'add-inv' ? 'Create Invoice' : 'Save Changes'}</button>
              </div>
            </div>
          </div>
        )}

        {/* ── Modal: Mark Invoice Paid ──────────────────────────────── */}
        {modal === 'pay-inv' && selected && (
          <div className="bh-modal-overlay" onClick={e => e.target === e.currentTarget && closeModal()}>
            <div className="bh-modal">
              <h2>Mark Invoice Paid</h2>
              <p style={{ fontSize: '0.88rem', color: 'var(--muted-text)', marginBottom: '1rem' }}>
                Invoice {selected.invoice_number} · Total {fmt$(selected.total)}
              </p>
              <div className="bh-field"><label>Amount Received ($)</label><input type="number" name="amount" value={form.amount || ''} onChange={fc} min="0" step="0.01" /></div>
              {formErr && <p style={{ color: '#f87171', fontSize: '0.85rem', marginBottom: '0.5rem' }}>{formErr}</p>}
              <div className="bh-modal-actions">
                <button className="bh-btn" onClick={closeModal}>Cancel</button>
                <button className="bh-btn primary" onClick={handleMarkInvoicePaid} disabled={saving}>{saving ? 'Saving…' : 'Mark Paid'}</button>
              </div>
            </div>
          </div>
        )}

        {/* ── Modal: Add / Edit Goal ────────────────────────────────── */}
        {(modal === 'add-goal' || modal === 'edit-goal') && (
          <div className="bh-modal-overlay" onClick={e => e.target === e.currentTarget && closeModal()}>
            <div className="bh-modal">
              <h2>{modal === 'add-goal' ? 'Add Goal' : 'Edit Goal'}</h2>
              <div className="bh-field"><label>Title *</label><input name="title" value={form.title || ''} onChange={fc} placeholder="e.g. Monthly Revenue Target" /></div>
              <div className="bh-field-row">
                <div className="bh-field">
                  <label>Type</label>
                  <select name="goal_type" value={form.goal_type || 'revenue'} onChange={fc}>
                    <option value="revenue">Revenue</option>
                    <option value="profit">Profit</option>
                    <option value="jobs">Jobs Completed</option>
                    <option value="clients">Clients</option>
                    <option value="invoiced">Invoiced</option>
                  </select>
                </div>
                <div className="bh-field">
                  <label>Period</label>
                  <select name="period" value={form.period || 'monthly'} onChange={fc}>
                    <option value="weekly">Weekly</option>
                    <option value="monthly">Monthly</option>
                    <option value="quarterly">Quarterly</option>
                    <option value="yearly">Yearly</option>
                  </select>
                </div>
              </div>
              <div className="bh-field-row">
                <div className="bh-field"><label>Target Value *</label><input type="number" name="target_value" value={form.target_value || ''} onChange={fc} min="0" step="0.01" /></div>
                <div className="bh-field"><label>Current Value</label><input type="number" name="current_value" value={form.current_value || ''} onChange={fc} min="0" step="0.01" /></div>
              </div>
              {formErr && <p style={{ color: '#f87171', fontSize: '0.85rem', marginBottom: '0.5rem' }}>{formErr}</p>}
              <div className="bh-modal-actions">
                <button className="bh-btn" onClick={closeModal}>Cancel</button>
                <button className="bh-btn primary" onClick={handleSaveGoal} disabled={saving}>{saving ? 'Saving…' : modal === 'add-goal' ? 'Add Goal' : 'Save Changes'}</button>
              </div>
            </div>
          </div>
        )}

        {/* ── Modal: Mark Tax Paid ──────────────────────────────────── */}
        {modal === 'pay-tax' && selected && (
          <div className="bh-modal-overlay" onClick={e => e.target === e.currentTarget && closeModal()}>
            <div className="bh-modal">
              <h2>Record Tax Payment</h2>
              <p style={{ fontSize: '0.88rem', color: 'var(--muted-text)', marginBottom: '1rem' }}>
                Q{selected.quarter} {selected.year} · Estimated {fmt$(selected.estimated_tax)}
              </p>
              <div className="bh-field"><label>Amount Paid ($)</label><input type="number" name="amount" value={form.amount || ''} onChange={fc} min="0" step="0.01" /></div>
              {formErr && <p style={{ color: '#f87171', fontSize: '0.85rem', marginBottom: '0.5rem' }}>{formErr}</p>}
              <div className="bh-modal-actions">
                <button className="bh-btn" onClick={closeModal}>Cancel</button>
                <button className="bh-btn primary" onClick={handleMarkTaxPaid} disabled={saving}>{saving ? 'Saving…' : 'Record Payment'}</button>
              </div>
            </div>
          </div>
        )}

      </div>
    </PageShell>
  );
}

// ── Overview tab ──────────────────────────────────────────────────────────────
function OverviewTab({ analytics }) {
  const a = analytics;
  const monthly = a?.monthly || [];
  const profitCls = value => {
    const parsed = parseFloat(value);
    if (Number.isNaN(parsed)) return undefined;
    return parsed >= 0 ? 'positive' : 'negative';
  };
  const allVals = monthly.flatMap(m => [
    parseFloat(m.revenue) || 0,
    parseFloat(m.expenses) || 0,
    parseFloat(m.profit)   || 0,
  ]);
  const maxVal = Math.max(...allVals, 1);

  return (
    <>
      {/* KPI grid */}
      <div className="bh-kpi-grid">
        <KPI label="MTD Revenue"    value={fmt$(a?.mtd?.revenue)}    cls="positive" />
        <KPI label="MTD Profit"     value={fmt$(a?.mtd?.profit)}     cls={profitCls(a?.mtd?.profit)} />
        <KPI label="Last Mo Revenue" value={fmt$(a?.last_month?.revenue)} />
        <KPI label="YTD Revenue"    value={fmt$(a?.ytd?.revenue)}    cls="positive" />
        <KPI label="YTD Profit"     value={fmt$(a?.ytd?.profit)}     cls={profitCls(a?.ytd?.profit)} />
        <KPI label="Outstanding"    value={fmt$(a?.invoices?.outstanding_total)} cls="warn"
          sub={`${a?.invoices?.sent || 0} sent`} />
        <KPI label="Overdue"        value={fmt$(a?.invoices?.overdue_total)}     cls="negative"
          sub={`${a?.invoices?.overdue_count || 0} invoices`} />
        <KPI label="Jobs (6m)"      value={a?.jobs?.completed_6m ?? '—'} />
        <KPI label="Avg Job Value"  value={fmt$(a?.jobs?.avg_value)} />
      </div>

      {/* 6-month P&L bar chart */}
      {monthly.length > 0 && (
        <div className="bh-card">
          <div className="bh-card-header">
            <div><h2>6-Month P&amp;L</h2></div>
          </div>
          <div className="bh-chart">
            {monthly.map((m, i) => {
              const rev = parseFloat(m.revenue)  || 0;
              const exp = parseFloat(m.expenses) || 0;
              const pro = parseFloat(m.profit)   || 0;
              const pct = v => `${Math.max(2, Math.round((Math.abs(v) / maxVal) * 180))}px`;
              return (
                <div key={i} className="bh-chart-bar-group">
                  <div className="bh-chart-bars">
                    <div className="bh-chart-bar revenue" style={{ height: pct(rev) }} title={`Revenue: ${fmt$(rev)}`} />
                    <div className="bh-chart-bar expense" style={{ height: pct(exp) }} title={`Expenses: ${fmt$(exp)}`} />
                    <div className="bh-chart-bar profit"  style={{ height: pct(pro) }} title={`Profit: ${fmt$(pro)}`} />
                  </div>
                  <span className="bh-chart-month">{fmtMonth(m.month)}</span>
                </div>
              );
            })}
          </div>
          <div className="bh-chart-legend">
            {[['revenue', '#4ade80', 'Revenue'], ['expense', '#f87171', 'Expenses'], ['profit', '#60a5fa', 'Profit']].map(([, color, label]) => (
              <span key={label} className="bh-chart-legend-item">
                <span className="bh-chart-legend-dot" style={{ background: color }} />
                {label}
              </span>
            ))}
          </div>
        </div>
      )}
    </>
  );
}

function KPI({ label, value, cls, sub }) {
  return (
    <div className="bh-kpi">
      <div className="bh-kpi-label">{label}</div>
      <div className={`bh-kpi-value${cls ? ' ' + cls : ''}`}>{value}</div>
      {sub && <div className="bh-kpi-sub">{sub}</div>}
    </div>
  );
}

// ── Invoices tab ──────────────────────────────────────────────────────────────
function InvoicesTab({ data, onNew, onEdit, onPay, onDelete }) {
  const invoices = data?.invoices || [];
  const summary  = data?.summary  || {};

  return (
    <>
      {/* Summary counts */}
      <div className="bh-kpi-grid" style={{ marginBottom: '1rem' }}>
        <KPI label="Draft"       value={summary.draft       || 0} />
        <KPI label="Sent"        value={summary.sent        || 0} />
        <KPI label="Paid"        value={summary.paid        || 0} cls="positive" />
        <KPI label="Overdue"     value={summary.overdue     || 0} cls="negative" />
        <KPI label="Outstanding" value={fmt$(summary.outstanding_total)} cls="warn" />
      </div>

      <div className="bh-card">
        <div className="bh-card-header">
          <div><h2>Invoices</h2></div>
          <button className="bh-btn primary sm" onClick={onNew}>+ New Invoice</button>
        </div>

        {invoices.length === 0 ? (
          <div className="bh-empty"><p>No invoices yet.</p><button className="bh-btn primary" onClick={onNew}>Create Invoice</button></div>
        ) : (
          <div className="bh-table-wrap">
            <table className="bh-table">
              <thead>
                <tr>
                  <th>#</th><th>Client</th><th>Status</th><th>Due</th>
                  <th className="num">Total</th><th className="num">Paid</th><th></th>
                </tr>
              </thead>
              <tbody>
                {invoices.map(inv => (
                  <tr key={inv.id}>
                    <td style={{ fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>{inv.invoice_number}</td>
                    <td>
                      <div>{inv.client_name}</div>
                      {inv.client_company && <div style={{ fontSize: '0.75rem', color: 'var(--muted-text)' }}>{inv.client_company}</div>}
                    </td>
                    <td><span className={`bh-status ${inv.status}`}>{inv.status}</span></td>
                    <td style={{ whiteSpace: 'nowrap', color: inv.status === 'overdue' ? '#f87171' : undefined }}>{fmtDate(inv.due_date)}</td>
                    <td className="num">{fmt$(inv.total)}</td>
                    <td className="num">{fmt$(inv.amount_paid)}</td>
                    <td style={{ whiteSpace: 'nowrap' }}>
                      {inv.status !== 'paid' && inv.status !== 'cancelled' && (
                        <button className="bh-btn sm" style={{ marginRight: '0.3rem' }} onClick={() => onPay(inv)}>Mark Paid</button>
                      )}
                      <button className="bh-btn sm" style={{ marginRight: '0.3rem' }} onClick={() => onEdit(inv)}>Edit</button>
                      <button className="bh-btn sm danger" onClick={() => onDelete(inv)}>Delete</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  );
}

// ── Tax tab ───────────────────────────────────────────────────────────────────
function TaxTab({ data, onRefresh, onPay }) {
  const estimates = data?.estimates || [];
  return (
    <div className="bh-card">
      <div className="bh-card-header">
        <div>
          <h2>Quarterly Tax Estimates</h2>
          <p>Based on OxSteed earnings + paid invoices − expenses.</p>
        </div>
        <button className="bh-btn sm" onClick={onRefresh}>Refresh Estimates</button>
      </div>

      {estimates.length === 0 ? (
        <div className="bh-empty"><p>No tax estimates yet. Click "Refresh Estimates" to calculate.</p></div>
      ) : (
        <div className="bh-table-wrap">
          <table className="bh-table">
            <thead>
              <tr>
                <th>Quarter</th><th>Due</th><th>Status</th>
                <th className="num">Est. Net Income</th><th className="num">Est. Tax</th><th></th>
              </tr>
            </thead>
            <tbody>
              {estimates.map(est => (
                <tr key={est.id}>
                  <td>Q{est.quarter} {est.year}</td>
                  <td style={{ whiteSpace: 'nowrap', color: est.status === 'overdue' ? '#f87171' : undefined }}>{fmtDate(est.due_date)}</td>
                  <td><span className={`bh-status ${est.status}`}>{est.status}</span></td>
                  <td className="num">{fmt$(est.estimated_net_income)}</td>
                  <td className="num">{fmt$(est.estimated_tax)}</td>
                  <td>
                    {est.status !== 'paid' && (
                      <button className="bh-btn sm" onClick={() => onPay(est)}>Mark Paid</button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ── Goals tab ─────────────────────────────────────────────────────────────────
function GoalsTab({ goals, analytics, onNew, onEdit, onDelete }) {
  return (
    <div className="bh-card">
      <div className="bh-card-header">
        <div><h2>Goals</h2></div>
        <button className="bh-btn primary sm" onClick={onNew}>+ Add Goal</button>
      </div>

      {goals.length === 0 ? (
        <div className="bh-empty"><p>No goals yet.</p><button className="bh-btn primary" onClick={onNew}>Add a Goal</button></div>
      ) : (
        <div className="bh-goal-list">
          {goals.map(g => {
            // optionally pull current value from analytics for revenue/profit types
            let current = parseFloat(g.current_value) || 0;
            if (g.goal_type === 'revenue' && analytics?.mtd?.revenue)   current = Math.max(current, parseFloat(analytics.mtd.revenue)  || 0);
            if (g.goal_type === 'profit'  && analytics?.mtd?.profit)    current = Math.max(current, parseFloat(analytics.mtd.profit)   || 0);
            const target = parseFloat(g.target_value) || 1;
            const pct    = Math.min(100, Math.round((current / target) * 100));
            const done   = pct >= 100;
            return (
              <div key={g.id} className="bh-goal">
                <div className="bh-goal-row">
                  <div>
                    <div className="bh-goal-title">{g.title}</div>
                    <div className="bh-goal-meta">{g.goal_type} · {g.period}</div>
                  </div>
                  <div style={{ display: 'flex', gap: '0.4rem' }}>
                    <button className="bh-btn sm" onClick={() => onEdit(g)}>Edit</button>
                    <button className="bh-btn sm danger" onClick={() => onDelete(g)}>Delete</button>
                  </div>
                </div>
                <div className="bh-goal-progress-track">
                  <div className={`bh-goal-progress-fill${done ? ' done' : ''}`} style={{ width: `${pct}%` }} />
                </div>
                <div className="bh-goal-stats">
                  <span><strong>{pct}%</strong> complete</span>
                  <span>{fmt$(current)} / <strong>{fmt$(target)}</strong></span>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
