import { useEffect,useState } from 'react';
import { useTranslation } from 'react-i18next';
import api from '../../api/axios';
import { moneyMajor } from '../../lib/moneyExact';
import '../../styles/BusinessAnalyticsTab.css';

export function BusinessAnalyticsTab({businessId,onInvoices,viewerId}) {
  return <BusinessInvoiceRevenue key={`${viewerId || ''}:${businessId}`} businessId={businessId} onInvoices={onInvoices}/>;
}

function BusinessInvoiceRevenue({businessId,onInvoices}) {
  const {t,i18n}=useTranslation();
  const [period,setPeriod]=useState('30d'),[currency,setCurrency]=useState(''),[offset,setOffset]=useState(0),[retry,setRetry]=useState(0);
  const key=`${businessId}:${period}:${currency}:${offset}:${retry}`;
  const [state,setState]=useState({key:null,data:null,error:false});
  useEffect(()=>{
    const controller=new AbortController();
    api.get(`/businesses/${businessId}/analytics`,{signal:controller.signal,params:{view:'invoice-revenue',period,currencyCode:currency||undefined,offset}})
      .then(response=>{if(!controller.signal.aborted)setState({key,data:response.data,error:false});})
      .catch(()=>{if(!controller.signal.aborted)setState({key,data:null,error:true});});
    return()=>controller.abort();
  },[businessId,period,currency,offset,retry,key]);
  const data=state.key===key?state.data:null,error=state.key===key&&state.error;
  const money=value=>moneyMajor(value,data?.currency_code,i18n.language);
  return <section className="bat-container" aria-busy={!data&&!error}>
    <h2>{t('analyticsCompletion.businessRevenue')}</h2><p>{t('analyticsCompletion.businessRevenueNote')}</p>
    <label>{t('queryBuilder.periodLabel')} <select aria-label={t('queryBuilder.periodLabel')} value={period} onChange={e=>{setPeriod(e.target.value);setOffset(0);}}>
      {['7d','30d','90d','1y'].map(p=><option key={p} value={p}>{t(`businessAnalytics.dateRange.${p}`)}</option>)}
    </select></label>
    {!data&&!error&&<p role="status">{t('businessAnalytics.loading')}</p>}
    {error&&<div role="alert"><p>{t('businessAnalytics.toastLoadFailed')}</p><button onClick={()=>setRetry(n=>n+1)} data-track="ui.36f9c6e03c.1">{t('queryBuilder.retry')}</button></div>}
    {data&&<>
      <label>{t('helperEarningsV2.currency')} <select aria-label={t('helperEarningsV2.currency')} value={data.currency_code} onChange={e=>{setCurrency(e.target.value);setOffset(0);}}>
        {(data.accounts.length?data.accounts:[data.currency_code]).map(code=><option key={code}>{code}</option>)}
      </select></label>
      <dl className="bat-stats-grid"><div className="bat-stat-card"><dt>{t('analyticsCompletion.businessRevenue')}</dt><dd>{money(data.summary.revenue)}</dd></div>
        <div className="bat-stat-card"><dt>{t('analyticsCompletion.paidInvoices')}</dt><dd>{data.summary.paid_invoices}</dd></div></dl>
      <div className="bat-records"><table><caption>{t('businessAnalytics.revenueTrend')}</caption>
        <thead><tr><th>{t('analyticsCompletion.month')}</th><th>{t('analyticsCompletion.paidInvoices')}</th><th>{t('analyticsCompletion.businessRevenue')}</th></tr></thead>
        <tbody>{data.monthly.map(row=><tr key={row.month}><td>{row.month}</td><td>{row.paid_invoices}</td><td>{money(row.revenue)}</td></tr>)}</tbody>
      </table></div>
      <h3>{t('analyticsCompletion.records')}</h3>
      {!data.invoices.length&&<p>{t('businessAnalytics.noData')}</p>}
      <ul>{data.invoices.map(row=><li key={row.id}><button onClick={onInvoices} data-track="ui.36f9c6e03c.2">{row.invoice_number}</button> · {money(row.revenue)}</li>)}</ul>
      <nav aria-label={t('analyticsCompletion.paidInvoices')}>
        <button disabled={!offset} onClick={()=>setOffset(Math.max(0,offset-20))} data-track="ui.36f9c6e03c.3">{t('helperEarningsV2.previous')}</button>
        <button disabled={!data.hasMore} onClick={()=>setOffset(offset+20)} data-track="ui.36f9c6e03c.4">{t('helperEarningsV2.next')}</button>
      </nav>
    </>}
  </section>;
}
