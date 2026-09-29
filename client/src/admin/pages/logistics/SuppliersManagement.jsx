import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { adminApproveSupplier, adminUpdateSupplier } from '../../../api/logistics';
import axios from '../../../api/axios';
import toast from 'react-hot-toast';
import { useAbortableFetch } from '../../lib/useAbortableFetch';
import ConfirmDialog from '../../lib/ConfirmDialog';
import AdminErrorState from '../../lib/AdminErrorState';
import '../../../styles/logistics/LogisticsHomePage.css';

export default function SuppliersManagement() {
  const { t } = useTranslation();
  const [filter, setFilter]       = useState({ country:'', trust_rating:'', is_active:'' });
  const [selected, setSelected]   = useState(null);
  const [confirmAction, setConfirmAction] = useState(null); // { type: 'approve'|'deactivate', id, name }

  const { data, loading, error, reload } = useAbortableFetch(async (signal) => {
    // Direct request (not the api wrapper) so the abort signal reaches the network call.
    const { data: payload } = await axios.get('/admin/logistics/suppliers', {
      params: {
        country:      filter.country || undefined,
        trust_rating: filter.trust_rating || undefined,
        is_active:    filter.is_active !== '' ? filter.is_active : undefined,
      },
      signal,
    });
    return { suppliers: payload.suppliers || [], total: payload.total || 0 };
  }, [filter]);
  const suppliers = data?.suppliers || [];

  const doConfirmAction = async () => {
    const { type, id } = confirmAction;
    try {
      if (type === 'approve') await adminApproveSupplier(id);
      else await adminUpdateSupplier(id, { is_active: false });
      toast.success(type === 'approve' ? 'Supplier approved' : 'Supplier deactivated');
      reload();
    } catch (err) {
      throw new Error(err.response?.data?.error || err.message || 'Action failed');
    }
  };

  return (
    <div className="lx-page">
      <div className="lx-page-header">
        <h1 className="lx-page-title">🏭 Suppliers Management</h1>
        <p className="lx-page-sub">Approve, rate, and manage supplier profiles and their product catalogs.</p>
      </div>

      <div className="lx-filter-bar">
        <input className="lx-input" placeholder="Country (e.g. CN)" maxLength={2}
          value={filter.country} onChange={e => setFilter(f => ({...f, country: e.target.value.toUpperCase()}))}
          style={{ maxWidth: 120 }} />
        <select className="lx-select" value={filter.trust_rating}
          onChange={e => setFilter(f => ({...f, trust_rating: e.target.value}))}>
          <option value="">All Trust Ratings</option>
          {[1,2,3,4,5].map(n => <option key={n} value={n}>≥ {n} stars</option>)}
        </select>
        <select className="lx-select" value={filter.is_active}
          onChange={e => setFilter(f => ({...f, is_active: e.target.value}))}>
          <option value="">All Status</option>
          <option value="true">Active</option>
          <option value="false">Inactive</option>
        </select>
      </div>

      {loading && <div className="lx-loading">Loading…</div>}
      {!loading && error && <AdminErrorState onRetry={reload} />}

      <div className="lx-table-wrap">
        <table className="lx-table">
          <thead>
            <tr>
              <th>Supplier</th><th>Country</th><th>Categories</th>
              <th>Trust</th><th>Quality</th><th>KYB</th><th>Status</th><th>Products</th><th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {suppliers.map(s => (
              <tr key={s.id} onClick={() => setSelected(s)} style={{ cursor:'pointer' }}>
                <td>
                  <div style={{ fontWeight:700 }}>{s.company_name}</div>
                  <div style={{ fontSize:'.75rem', color:'#64748b' }}>{s.contact_email}</div>
                </td>
                <td>{s.country} {s.city && `· ${s.city}`}</td>
                <td style={{ fontSize:'.75rem' }}>{s.approved_categories?.slice(0,2).join(', ')}</td>
                <td>
                  {'★'.repeat(s.internal_trust_rating||0)}
                  {'☆'.repeat(5-(s.internal_trust_rating||0))}
                </td>
                <td>{parseFloat(s.quality_score||0).toFixed(1)}/5</td>
                <td>
                  <span style={{ color: s.kyb_verified ? '#22c55e' : '#dc2626', fontWeight:700, fontSize:'.8rem' }}>
                    {s.kyb_verified ? '✓' : '✗'}
                  </span>
                </td>
                <td>
                  <span style={{ color: s.is_active ? '#22c55e' : '#ef4444', fontWeight:700, fontSize:'.8rem' }}>
                    {s.is_active ? 'Active' : 'Inactive'}
                  </span>
                </td>
                <td>{s.product_count || 0}</td>
                <td onClick={e => e.stopPropagation()} style={{ display:'flex', gap:'.35rem', flexWrap:'wrap' }}>
                  {!s.approved_at && (
                    <button className="lx-btn-primary" style={{ fontSize:'.72rem', padding:'.25rem .65rem' }}
                      onClick={() => setConfirmAction({ type:'approve', id:s.id, name:s.company_name })}>Approve</button>
                  )}
                  {s.is_active && (
                    <button className="lx-btn-secondary" style={{ fontSize:'.72rem', padding:'.25rem .65rem' }}
                      onClick={() => setConfirmAction({ type:'deactivate', id:s.id, name:s.company_name })}>Deactivate</button>
                  )}
                </td>
              </tr>
            ))}
            {suppliers.length === 0 && !loading && !error && (
              <tr><td colSpan={9} style={{ textAlign:'center', padding:'2rem', color:'#94a3b8' }}>No suppliers found.</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Detail drawer */}
      {selected && (
        <div style={{
          position:'fixed', right:0, top:0, bottom:0, width:420,
          background:'var(--card-bg,#fff)', boxShadow:'-4px 0 24px rgba(0,0,0,.15)',
          overflow:'auto', padding:'1.5rem', zIndex:9999,
        }}>
          <div style={{ display:'flex', justifyContent:'space-between', marginBottom:'1rem' }}>
            <h2 style={{ fontWeight:800, margin:0 }}>{selected.company_name}</h2>
            <button onClick={() => setSelected(null)} style={{ border:'none', background:'none', fontSize:'1.25rem', cursor:'pointer' }}>✕</button>
          </div>
          {[
            ['Legal Name', selected.legal_name],
            ['Country', selected.country],
            ['City', selected.city],
            ['Address', selected.address],
            ['Contact', selected.contact_name],
            ['Email', selected.contact_email],
            ['Phone', selected.contact_phone],
            ['Website', selected.website],
            ['Payment Terms', selected.payment_terms],
            ['Trust Rating', `${selected.internal_trust_rating}/5`],
            ['Quality Score', `${parseFloat(selected.quality_score||0).toFixed(1)}/5`],
            ['Communication', `${parseFloat(selected.communication_score||0).toFixed(1)}/5`],
            ['On-Time Rate', `${((parseFloat(selected.on_time_rate||0))*100).toFixed(0)}%`],
            ['Disputes', selected.dispute_count || 0],
            ['KYB Verified', selected.kyb_verified ? `Yes (${new Date(selected.kyb_verified_at).toLocaleDateString()})` : 'No'],
            ['Approved', selected.approved_at ? new Date(selected.approved_at).toLocaleDateString() : 'Pending'],
          ].filter(([,v]) => v).map(([k,v]) => (
            <div key={k} style={{ display:'flex', justifyContent:'space-between', padding:'.4rem 0', borderBottom:'1px solid #f1f5f9', fontSize:'.85rem' }}>
              <span style={{ color:'#64748b' }}>{k}</span>
              <span style={{ fontWeight:600 }}>{v}</span>
            </div>
          ))}
          {selected.approved_categories?.length > 0 && (
            <div style={{ marginTop:'.75rem' }}>
              <div style={{ fontWeight:700, fontSize:'.85rem', marginBottom:'.4rem' }}>Approved Categories</div>
              <div style={{ display:'flex', gap:'.35rem', flexWrap:'wrap' }}>
                {selected.approved_categories.map(c => (
                  <span key={c} style={{ background:'#f1f5f9', borderRadius:999, padding:'.15rem .6rem', fontSize:'.72rem', fontWeight:700 }}>{c}</span>
                ))}
              </div>
            </div>
          )}
          {selected.compliance_notes && (
            <div style={{ marginTop:'.75rem', background:'#fef2f2', borderRadius:'.5rem', padding:'.75rem', fontSize:'.82rem', color:'#b91c1c' }}>
              <strong>Compliance Notes:</strong> {selected.compliance_notes}
            </div>
          )}
        </div>
      )}

      <ConfirmDialog
        open={confirmAction != null}
        title={confirmAction?.type === 'deactivate' ? 'Deactivate supplier' : 'Approve supplier'}
        message={
          confirmAction?.type === 'deactivate'
            ? `Deactivate ${confirmAction?.name || 'this supplier'}? They will no longer be available for new sourcing.`
            : `Approve ${confirmAction?.name || 'this supplier'} as an approved supplier?`
        }
        danger={confirmAction?.type === 'deactivate'}
        confirmLabel={confirmAction?.type === 'deactivate' ? 'Deactivate' : 'Approve supplier'}
        onConfirm={doConfirmAction}
        onClose={() => setConfirmAction(null)}
      />
    </div>
  );
}
