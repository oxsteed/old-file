import { useState } from 'react';
import { Link } from 'react-router-dom';
import axios from '../../api/axios';
import toast from 'react-hot-toast';
import { useAbortableFetch } from '../lib/useAbortableFetch';
import AdminErrorState from '../lib/AdminErrorState';

const PACKAGE_TIERS = [
  { tier: 'initial', label: 'Initial', price: 10000, description: 'One 60-minute consultation session to assess your needs and map next steps.', sessions: 1 },
  { tier: 'foundation', label: 'Foundation', price: 75000, description: 'Three sessions plus a written business plan and market analysis.', sessions: 3 },
  { tier: 'implementation', label: 'Implementation', price: 150000, description: 'Six sessions with full setup of legal, financial, and operational systems.', sessions: 6 },
  { tier: 'transformation', label: 'Transformation', price: 300000, description: 'Twelve sessions with deep coaching, branding, and growth roadmap.', sessions: 12 },
];

const INVOICE_STATUS_COLORS = {
  sent: '#0EA5E9',
  paid: '#10B981',
  overdue: '#EF4444',
  pending: '#FFA500',
  cancelled: '#6B7280',
};

function formatMoney(cents) {
  return `$${((cents || 0) / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function PackageCard({ pkg, onEdit, onToggle }) {
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState({ name: pkg.package_name || pkg.name || pkg.tier, description: pkg.description || '', base_price: pkg.base_price || 0, session_count: pkg.session_count || pkg.duration_hours || 1, is_active: pkg.is_active !== false });
  const [saving, setSaving] = useState(false);

  async function saveEdit() {
    // Guard against invalid package data before it ever reaches the server.
    const price = Number(form.base_price);
    const sessionCount = Number(form.session_count);
    if (!form.name.trim()) { toast.error('Package name is required'); return; }
    if (!Number.isFinite(price) || price <= 0) { toast.error('Price must be greater than zero'); return; }
    if (!Number.isInteger(sessionCount) || sessionCount <= 0) { toast.error('Session count must be a whole number of at least 1'); return; }
    try {
      setSaving(true);
      await onEdit(pkg.id, { ...form, name: form.name.trim(), base_price: price, session_count: sessionCount });
      setEditing(false);
    } finally {
      setSaving(false);
    }
  }

  // Optimistic toggle with rollback: if the PATCH fails, revert the card to
  // the real server state instead of showing a stale activation state.
  async function toggleActive() {
    const next = !form.is_active;
    setForm(f => ({ ...f, is_active: next }));
    try {
      await onToggle(pkg.id, next);
    } catch {
      setForm(f => ({ ...f, is_active: !next }));
    }
  }

  const inputStyle = { width: '100%', padding: '0.5rem 0.75rem', borderRadius: '6px', border: '1px solid var(--color-border)', background: 'var(--color-bg)', color: 'var(--color-text)', fontSize: '0.9rem', boxSizing: 'border-box', marginBottom: '0.5rem' };

  return (
    <div style={{ background: 'var(--color-surface)', border: `2px solid ${form.is_active ? 'var(--color-primary)' : 'var(--color-border)'}`, borderRadius: '10px', padding: '1.5rem', position: 'relative', opacity: form.is_active ? 1 : 0.7 }}>
      {!form.is_active && (
        <span style={{ position: 'absolute', top: '1rem', right: '1rem', background: '#6B7280', color: 'white', fontSize: '0.7rem', fontWeight: 700, padding: '0.2rem 0.5rem', borderRadius: '4px', textTransform: 'uppercase' }}>Inactive</span>
      )}
      {editing ? (
        <div>
          <label style={{ display: 'block', fontWeight: 600, fontSize: '0.8rem', marginBottom: '0.25rem' }}>Name</label>
          <input style={inputStyle} value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} />
          <label style={{ display: 'block', fontWeight: 600, fontSize: '0.8rem', marginBottom: '0.25rem' }}>Price (cents)</label>
          <input type="number" style={inputStyle} value={form.base_price} onChange={e => setForm({ ...form, base_price: parseInt(e.target.value) || 0 })} />
          <label style={{ display: 'block', fontWeight: 600, fontSize: '0.8rem', marginBottom: '0.25rem' }}>Sessions</label>
          <input type="number" style={inputStyle} value={form.session_count} onChange={e => setForm({ ...form, session_count: parseInt(e.target.value) || 1 })} />
          <label style={{ display: 'block', fontWeight: 600, fontSize: '0.8rem', marginBottom: '0.25rem' }}>Description</label>
          <textarea style={{ ...inputStyle, minHeight: '70px', resize: 'vertical', fontFamily: 'inherit' }} value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} />
          <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.5rem' }}>
            <button onClick={saveEdit} disabled={saving} style={{ padding: '0.5rem 1rem', borderRadius: '6px', border: 'none', background: 'var(--color-primary)', color: 'white', fontWeight: 600, cursor: 'pointer', flex: 1 }}>
              {saving ? 'Saving...' : 'Save'}
            </button>
            <button onClick={() => setEditing(false)} style={{ padding: '0.5rem 1rem', borderRadius: '6px', border: '1px solid var(--color-border)', background: 'none', cursor: 'pointer', color: 'var(--color-text)' }}>
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '0.5rem' }}>
            <h3 style={{ margin: 0, fontSize: '1.1rem', fontWeight: 700 }}>{pkg.package_name || pkg.name || pkg.tier}</h3>
            <span style={{ fontSize: '1.6rem', fontWeight: 700, color: 'var(--color-primary)' }}>{formatMoney(pkg.base_price)}</span>
          </div>
          <p style={{ color: 'var(--color-text-muted)', fontSize: '0.85rem', margin: '0.25rem 0 0.75rem' }}>
            {pkg.duration_hours || pkg.session_count || 1} session{(pkg.duration_hours || pkg.session_count) !== 1 ? 's' : ''}
          </p>
          <p style={{ margin: '0 0 1rem', fontSize: '0.9rem', lineHeight: 1.5 }}>{pkg.description || 'No description provided.'}</p>
          <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
            {pkg.id && (
              <button onClick={() => setEditing(true)} style={{ padding: '0.4rem 0.8rem', borderRadius: '6px', border: '1px solid var(--color-primary)', background: 'none', color: 'var(--color-primary)', fontSize: '0.8rem', fontWeight: 600, cursor: 'pointer' }}>
                Edit
              </button>
            )}
            <button onClick={toggleActive} style={{ padding: '0.4rem 0.8rem', borderRadius: '6px', border: `1px solid ${form.is_active ? '#EF4444' : '#10B981'}`, background: 'none', color: form.is_active ? '#EF4444' : '#10B981', fontSize: '0.8rem', fontWeight: 600, cursor: 'pointer' }}>
              {form.is_active ? 'Disable' : 'Enable'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function ManualInvoiceModal({ onClose, onCreated }) {
  const [form, setForm] = useState({ client_email: '', client_name: '', package_tier: 'initial', amount_cents: 10000, notes: '' });
  const [saving, setSaving] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    if (!form.client_email || !form.client_name) { toast.error('Client name and email are required'); return; }
    if (!Number.isFinite(Number(form.amount_cents)) || Number(form.amount_cents) <= 0) { toast.error('Amount must be greater than zero'); return; }
    try {
      setSaving(true);
      await axios.post('/consulting/admin/invoices/generate-manual', form);
      toast.success('Invoice generated and sent');
      onCreated();
      onClose();
    } catch (err) {
      toast.error(err?.response?.data?.error || 'Failed to generate invoice');
    } finally {
      setSaving(false);
    }
  }

  const inputStyle = { width: '100%', padding: '0.6rem 0.75rem', borderRadius: '6px', border: '1px solid var(--color-border)', background: 'var(--color-bg)', color: 'var(--color-text)', fontSize: '0.9rem', boxSizing: 'border-box' };
  const labelStyle = { display: 'block', fontWeight: 600, marginBottom: '0.35rem', fontSize: '0.85rem' };
  const fieldStyle = { marginBottom: '1rem' };

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: '1rem' }}>
      <div style={{ background: 'var(--color-surface)', borderRadius: '10px', padding: '2rem', maxWidth: '500px', width: '100%', maxHeight: '90vh', overflowY: 'auto' }}>
        <h2 style={{ margin: '0 0 1.5rem', fontSize: '1.3rem', fontWeight: 700 }}>Generate Manual Invoice</h2>
        <form onSubmit={handleSubmit}>
          <div style={fieldStyle}>
            <label style={labelStyle}>Client Name *</label>
            <input style={inputStyle} value={form.client_name} onChange={e => setForm({ ...form, client_name: e.target.value })} required />
          </div>
          <div style={fieldStyle}>
            <label style={labelStyle}>Client Email *</label>
            <input type="email" style={inputStyle} value={form.client_email} onChange={e => setForm({ ...form, client_email: e.target.value })} required />
          </div>
          <div style={fieldStyle}>
            <label style={labelStyle}>Package</label>
            <select style={inputStyle} value={form.package_tier} onChange={e => {
              const pkg = PACKAGE_TIERS.find(p => p.tier === e.target.value);
              setForm({ ...form, package_tier: e.target.value, amount_cents: pkg?.price || form.amount_cents });
            }}>
              {PACKAGE_TIERS.map(p => <option key={p.tier} value={p.tier}>{p.label} ({formatMoney(p.price)})</option>)}
            </select>
          </div>
          <div style={fieldStyle}>
            <label style={labelStyle}>Amount (cents)</label>
            <input type="number" style={inputStyle} value={form.amount_cents} onChange={e => setForm({ ...form, amount_cents: parseInt(e.target.value) || 0 })} />
            <p style={{ margin: '0.25rem 0 0', fontSize: '0.8rem', color: 'var(--color-text-muted)' }}>= {formatMoney(form.amount_cents)}</p>
          </div>
          <div style={fieldStyle}>
            <label style={labelStyle}>Notes (optional)</label>
            <textarea style={{ ...inputStyle, minHeight: '70px', resize: 'vertical', fontFamily: 'inherit' }} value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} />
          </div>
          <div style={{ display: 'flex', gap: '0.75rem', justifyContent: 'flex-end' }}>
            <button type="button" onClick={onClose} style={{ padding: '0.6rem 1.25rem', borderRadius: '6px', border: '1px solid var(--color-border)', background: 'none', cursor: 'pointer', color: 'var(--color-text)' }}>Cancel</button>
            <button type="submit" disabled={saving} style={{ padding: '0.6rem 1.25rem', borderRadius: '6px', border: 'none', background: 'var(--color-primary)', color: 'white', fontWeight: 600, cursor: 'pointer' }}>
              {saving ? 'Generating...' : 'Generate & Send'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export default function ConsultingPayments() {
  const [activeTab, setActiveTab] = useState('packages');
  const [showInvoiceModal, setShowInvoiceModal] = useState(false);

  const { data, error, loading, reload } = useAbortableFetch(async (signal) => {
    // All four requests must succeed together; a partial dashboard with
    // silently missing purchases or invoices would be worse than an error state.
    const [pkgRes, dashRes, purchRes, invRes] = await Promise.all([
      axios.get('/consulting/packages', { signal }),
      axios.get('/consulting/admin/dashboard-stats', { signal }),
      axios.get('/consulting/admin/purchases', { signal }),
      axios.get('/consulting/admin/invoices', { signal }),
    ]);
    return {
      packages: pkgRes.data || [],
      revenueStats: dashRes.data,
      purchases: purchRes.data || [],
      invoices: invRes.data || [],
    };
  }, []);

  const packages = data?.packages ?? [];
  const purchases = data?.purchases ?? [];
  const invoices = data?.invoices ?? [];
  const revenueStats = data?.revenueStats ?? null;

  async function handleEditPackage(id, form) {
    try {
      await axios.patch(`/consulting/admin/packages/${id}`, form);
      toast.success('Package updated');
      reload();
    } catch {
      toast.error('Failed to update package');
    }
  }

  async function handleTogglePackage(id, isActive) {
    try {
      await axios.patch(`/consulting/admin/packages/${id}`, { is_active: isActive });
      toast.success(isActive ? 'Package enabled' : 'Package disabled');
    } catch {
      toast.error('Failed to toggle package');
      // Rethrow so the PackageCard rolls its optimistic toggle back.
      throw new Error('Failed to toggle package');
    }
  }

  const tabStyle = (isActive) => ({
    padding: '0.65rem 1.25rem',
    background: 'none',
    border: 'none',
    cursor: 'pointer',
    fontWeight: isActive ? 700 : 500,
    color: isActive ? 'var(--color-primary)' : 'var(--color-text-muted)',
    borderBottom: isActive ? '3px solid var(--color-primary)' : '3px solid transparent',
    fontSize: '0.95rem',
  });

  const thStyle = { background: 'var(--color-bg)', padding: '0.85rem 1rem', textAlign: 'left', borderBottom: '2px solid var(--color-border)', fontWeight: 600, fontSize: '0.85rem' };
  const tdStyle = { padding: '0.85rem 1rem', borderBottom: '1px solid var(--color-border)', fontSize: '0.9rem' };

  const handleDownloadInvoice = async (invoice) => {
    const invoiceId = invoice.id;
    const invoiceName = invoice.invoice_number || invoice.id;

    try {
      const response = await axios.get(`/consulting/admin/invoices/${invoiceId}/download`, {
        responseType: 'blob',
      });

      const contentDisposition = response.headers?.['content-disposition'] || '';
      const filenameMatch = /filename="([^"]+)"/.exec(contentDisposition);
      const filename = filenameMatch?.[1] || `consulting-invoice-${invoiceName}.csv`;

      const blob = new Blob([response.data], { type: response.headers?.['content-type'] || 'text/csv' });
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      window.URL.revokeObjectURL(url);
      toast.success('Invoice download started');
    } catch (err) {
      toast.error(err?.response?.data?.error || err?.response?.data?.message || 'Failed to download invoice');
    }
  };

  if (loading) {
    return (
      <div style={{ maxWidth: '1200px', margin: '0 auto', padding: '2rem', color: 'var(--color-text-muted)' }}>
        Loading payment data...
      </div>
    );
  }

  if (error) {
    return (
      <div style={{ maxWidth: '1200px', margin: '0 auto', padding: '2rem' }}>
        <AdminErrorState onRetry={reload} />
      </div>
    );
  }

  return (
    <div style={{ maxWidth: '1200px', margin: '0 auto', padding: '2rem' }}>
      {/* Breadcrumb */}
      <nav style={{ fontSize: '0.85rem', color: 'var(--color-text-muted)', marginBottom: '1.25rem' }}>
        <Link to="/admin" style={{ color: 'var(--color-primary)', textDecoration: 'none' }}>Admin</Link>
        {' / '}
        <Link to="/admin/consulting" style={{ color: 'var(--color-primary)', textDecoration: 'none' }}>Consulting</Link>
        {' / '}
        <span>Payments</span>
      </nav>

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '1.5rem', flexWrap: 'wrap', gap: '1rem' }}>
        <h1 style={{ margin: 0, fontSize: '1.75rem', fontWeight: 700 }}>Consulting Payments</h1>
        <button onClick={() => setShowInvoiceModal(true)} style={{ padding: '0.65rem 1.25rem', borderRadius: '8px', border: 'none', background: 'var(--color-primary)', color: 'white', fontWeight: 600, cursor: 'pointer' }}>
          + Generate Invoice
        </button>
      </div>

      {/* Revenue Summary */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: '1rem', marginBottom: '2rem' }}>
        {[
          { label: 'Total Revenue', value: formatMoney(revenueStats?.total_revenue_cents), color: '#10B981' },
          { label: 'Active Packages', value: revenueStats?.active_packages || 0, color: 'var(--color-primary)' },
          { label: 'Pending Payments', value: formatMoney(revenueStats?.pending_revenue_cents), color: '#FFA500' },
          { label: 'Refunds Issued', value: formatMoney(revenueStats?.refunded_cents), color: '#EF4444' },
        ].map(s => (
          <div key={s.label} style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: '10px', padding: '1.25rem 1.5rem' }}>
            <p style={{ margin: '0 0 0.25rem', fontSize: '0.78rem', color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>{s.label}</p>
            <div style={{ fontSize: '1.6rem', fontWeight: 700, color: s.color || 'var(--color-text)' }}>{s.value}</div>
          </div>
        ))}
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', gap: '0.25rem', borderBottom: '1px solid var(--color-border)', marginBottom: '1.75rem' }}>
        <button style={tabStyle(activeTab === 'packages')} onClick={() => setActiveTab('packages')}>Available Packages</button>
        <button style={tabStyle(activeTab === 'purchases')} onClick={() => setActiveTab('purchases')}>Client Purchases</button>
        <button style={tabStyle(activeTab === 'invoices')} onClick={() => setActiveTab('invoices')}>Invoices</button>
      </div>

      {/* Packages Tab */}
      {activeTab === 'packages' && (
        <div>
          {packages.length === 0 ? (
            <div>
              <p style={{ color: 'var(--color-text-muted)', marginBottom: '1.5rem' }}>No packages found in database. Showing default package templates:</p>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '1.5rem' }}>
                {PACKAGE_TIERS.map(pkg => (
                  <div key={pkg.tier} style={{ background: 'var(--color-surface)', border: '2px solid var(--color-primary)', borderRadius: '10px', padding: '1.5rem' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '0.5rem' }}>
                      <h3 style={{ margin: 0, fontSize: '1.1rem', fontWeight: 700 }}>{pkg.label}</h3>
                      <span style={{ fontSize: '1.6rem', fontWeight: 700, color: 'var(--color-primary)' }}>{formatMoney(pkg.price)}</span>
                    </div>
                    <p style={{ color: 'var(--color-text-muted)', fontSize: '0.85rem', margin: '0.25rem 0 0.75rem' }}>{pkg.sessions} session{pkg.sessions !== 1 ? 's' : ''}</p>
                    <p style={{ margin: 0, fontSize: '0.9rem', lineHeight: 1.5 }}>{pkg.description}</p>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '1.5rem' }}>
              {packages.map(pkg => (
                <PackageCard key={pkg.id} pkg={pkg} onEdit={handleEditPackage} onToggle={handleTogglePackage} />
              ))}
            </div>
          )}
        </div>
      )}

      {/* Purchases Tab */}
      {activeTab === 'purchases' && (
        <div>
          {purchases.length === 0 ? (
            <div style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: '10px', padding: '3rem', textAlign: 'center' }}>
              <p style={{ fontSize: '1rem', fontWeight: 600, marginBottom: '0.5rem' }}>No purchases yet</p>
              <p style={{ color: 'var(--color-text-muted)' }}>Client purchases will appear here once clients pay for consulting packages.</p>
            </div>
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', background: 'var(--color-surface)', borderRadius: '10px', overflow: 'hidden' }}>
                <thead>
                  <tr>
                    {['Client', 'Email', 'Package', 'Amount', 'Fulfillment', 'Sessions Left', 'Purchased'].map(h => (
                      <th key={h} style={thStyle}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {purchases.map(p => (
                    <tr key={p.id}>
                      <td style={{ ...tdStyle, fontWeight: 600 }}>{p.first_name} {p.last_name}</td>
                      <td style={tdStyle}>{p.email}</td>
                      <td style={tdStyle}>{p.package_name || p.service_tier}</td>
                      <td style={tdStyle}>{formatMoney(p.total_cost_cents || p.amount_cents)}</td>
                      <td style={tdStyle}>
                        <span style={{ background: p.status === 'completed' ? '#10B981' : p.status === 'active' ? '#0EA5E9' : '#FFA500', color: 'white', padding: '0.2rem 0.6rem', borderRadius: '12px', fontSize: '0.78rem', fontWeight: 600 }}>
                          {p.status || 'active'}
                        </span>
                      </td>
                      <td style={tdStyle}>{p.sessions_remaining ?? '-'}</td>
                      <td style={{ ...tdStyle, color: 'var(--color-text-muted)', whiteSpace: 'nowrap' }}>
                        {p.purchase_date || p.created_at ? new Date(p.purchase_date || p.created_at).toLocaleDateString() : '-'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* Invoices Tab */}
      {activeTab === 'invoices' && (
        <div>
          {invoices.length === 0 ? (
            <div style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: '10px', padding: '3rem', textAlign: 'center' }}>
              <p style={{ fontSize: '1rem', fontWeight: 600, marginBottom: '0.5rem' }}>No invoices yet</p>
              <p style={{ color: 'var(--color-text-muted)', marginBottom: '1.5rem' }}>Generate a manual invoice to get started, or invoices will appear here as clients make purchases.</p>
              <button onClick={() => setShowInvoiceModal(true)} style={{ padding: '0.65rem 1.5rem', borderRadius: '8px', border: 'none', background: 'var(--color-primary)', color: 'white', fontWeight: 600, cursor: 'pointer' }}>
                Generate Invoice
              </button>
            </div>
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', background: 'var(--color-surface)', borderRadius: '10px', overflow: 'hidden' }}>
                <thead>
                  <tr>
                    {['Invoice #', 'Client', 'Package', 'Amount', 'Status', 'Due Date', 'Actions'].map(h => (
                      <th key={h} style={thStyle}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {invoices.map(inv => (
                    <tr key={inv.id}>
                      <td style={{ ...tdStyle, fontFamily: 'monospace', fontSize: '0.85rem' }}>{inv.invoice_number}</td>
                      <td style={{ ...tdStyle, fontWeight: 600 }}>{inv.client_name || `${inv.first_name || ''} ${inv.last_name || ''}`.trim() || inv.email}</td>
                      <td style={tdStyle}>{inv.package_name || inv.service_tier || '-'}</td>
                      <td style={{ ...tdStyle, fontWeight: 600 }}>{formatMoney(inv.amount_cents)}</td>
                      <td style={tdStyle}>
                        <span style={{ background: INVOICE_STATUS_COLORS[inv.status] || '#6B7280', color: 'white', padding: '0.2rem 0.6rem', borderRadius: '12px', fontSize: '0.78rem', fontWeight: 600 }}>
                          {inv.status}
                        </span>
                      </td>
                      <td style={{ ...tdStyle, whiteSpace: 'nowrap', color: 'var(--color-text-muted)' }}>
                        {inv.due_date ? new Date(inv.due_date).toLocaleDateString() : '-'}
                      </td>
                      <td style={tdStyle}>
                        <button
                          onClick={() => handleDownloadInvoice(inv)}
                          style={{ padding: '0.3rem 0.6rem', borderRadius: '5px', border: '1px solid var(--color-primary)', background: 'none', color: 'var(--color-primary)', fontSize: '0.78rem', cursor: 'pointer', fontWeight: 600 }}
                        >
                          Download
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {showInvoiceModal && (
        <ManualInvoiceModal onClose={() => setShowInvoiceModal(false)} onCreated={reload} />
      )}
    </div>
  );
}
