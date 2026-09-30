import React from 'react';
import { useTranslation } from 'react-i18next';
import axios from '../../../api/axios';
import { useAbortableFetch } from '../../lib/useAbortableFetch';
import AdminErrorState from '../../lib/AdminErrorState';
import '../../../styles/logistics/LogisticsHomePage.css';

export default function SuperAdminLogisticsControl() {
  const { t } = useTranslation();
  const { data, loading, error, reload } = useAbortableFetch(async (signal) => {
    // Direct requests (not the api wrappers) so the abort signal reaches the network calls.
    const [markup, fees, restrictions, stats] = await Promise.all([
      axios.get('/admin/logistics/markup-rules', { signal }).then(r => r.data),
      axios.get('/admin/logistics/fee-rules', { signal }).then(r => r.data),
      axios.get('/admin/logistics/restrictions', { signal }).then(r => r.data),
      axios.get('/admin/logistics/stats', { signal }).then(r => r.data),
    ]);
    return {
      markup: markup.data || [],
      fees: fees.data || [],
      restrictions: restrictions.data || [],
      stats: stats.data || null,
    };
  }, []);

  const markup       = data?.markup       || [];
  const fees         = data?.fees         || [];
  const restrictions = data?.restrictions || [];
  const stats        = data?.stats        || null;

  return (
    <div className="lx-page">
      <div className="lx-page-header">
        <h1 className="lx-page-title">{t('adminLogisticsControl.title')}</h1>
        <p className="lx-page-sub">{t('adminLogisticsControl.subtitle')}</p>
      </div>
      {loading && <div className="lx-loading">{t('common.loading')}</div>}
      {!loading && error && <AdminErrorState onRetry={reload} />}
      {!loading && !error && (
      <>
      <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fit, minmax(180px, 1fr))', gap:'1rem', marginBottom:'1.5rem' }}>
        {[
          [t('adminLogisticsControl.stats.markupRules'), markup.length, '📈'],
          [t('adminLogisticsControl.stats.feeRules'), fees.length, '💸'],
          [t('adminLogisticsControl.stats.countryRestrictions'), restrictions.length, '⛔'],
          [t('adminLogisticsControl.stats.poStatuses'), stats?.purchaseOrders?.length || 0, '📦'],
        ].map(([label, value, icon]) => (
          <div key={label} className="lx-card" style={{ textAlign:'center' }}>
            <div style={{ fontSize:'1.4rem' }}>{icon}</div>
            <div style={{ fontSize:'1.4rem', fontWeight:800, color:'#f97316' }}>{value}</div>
            <div style={{ color:'#64748b', fontSize:'.8rem', fontWeight:600 }}>{label}</div>
          </div>
        ))}
      </div>
      <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:'1.5rem' }}>
        <div className="lx-card">
          <h2 style={{ marginTop:0 }}>{t('adminLogisticsControl.markupTitle')}</h2>
          <div className="lx-table-wrap">
            <table className="lx-table">
              <thead><tr><th>{t('adminLogisticsControl.markupTable.scope')}</th><th>{t('adminLogisticsControl.markupTable.category')}</th><th>{t('adminLogisticsControl.markupTable.markupPct')}</th><th>{t('adminLogisticsControl.markupTable.priority')}</th></tr></thead>
              <tbody>
                {markup.slice(0, 12).map((rule) => (
                  <tr key={rule.id}>
                    <td>{rule.scope}</td>
                    <td>{rule.category || '—'}</td>
                    <td>{rule.markup_pct !== null ? `${(Number(rule.markup_pct) * 100).toFixed(1)}%` : '—'}</td>
                    <td>{rule.priority}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
        <div className="lx-card">
          <h2 style={{ marginTop:0 }}>{t('adminLogisticsControl.feesTitle')}</h2>
          <div style={{ fontSize:'.85rem', color:'#64748b', lineHeight:1.8, marginBottom:'1rem' }}>
            {t('adminLogisticsControl.feesDescription')}
          </div>
          <div className="lx-table-wrap">
            <table className="lx-table">
              <thead><tr><th>{t('adminLogisticsControl.feesTable.feeType')}</th><th>{t('adminLogisticsControl.feesTable.scope')}</th><th>{t('adminLogisticsControl.feesTable.active')}</th></tr></thead>
              <tbody>
                {fees.slice(0, 6).map((fee) => (
                  <tr key={`f-${fee.id}`}>
                    <td>{fee.fee_type}</td>
                    <td>{fee.scope}</td>
                    <td>{fee.is_active ? t('common.yes') : t('common.no')}</td>
                  </tr>
                ))}
                {restrictions.slice(0, 6).map((rule) => (
                  <tr key={`r-${rule.category}-${rule.country_code}`}>
                    <td>{rule.category} ({rule.country_code})</td>
                    <td>{t('adminLogisticsControl.restrictionScope')}</td>
                    <td>{rule.requires_approval ? t('adminLogisticsControl.approvalRequired') : t('adminLogisticsControl.approvalOpen')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
      </>
      )}
    </div>
  );
}
