import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import api from '../api/axios';
import { formatCents, formatDate } from '../lib/format';
import '../components/HelperWorkPanel.css';
export default function SharedBusinessQuotePage(){
 const {token}=useParams();return <Quote key={token} token={token}/>;
}
function Quote({token}){
 const {t,i18n}=useTranslation(),tr=key=>t(`businessStandards.${key}`);
 const [quote,setQuote]=useState(null),[error,setError]=useState(''),[busy,setBusy]=useState(false),[reload,setReload]=useState(0);
 useEffect(()=>{let active=true;setError('');api.get(`/businesses/quotes/view/${encodeURIComponent(token)}`).then(({data})=>{if(active)setQuote(data);}).catch(()=>{if(active){setQuote(null);setError('quoteError');}});return()=>{active=false;};},[token,reload]);
 async function respond(response){if(busy)return;setBusy(true);setError('');try{const {data}=await api.post(`/businesses/quotes/view/${encodeURIComponent(token)}/respond`,{response});setQuote(data);}catch{setError('respondError');}finally{setBusy(false);}}
 return <main className="helper-work" data-track-private><h1>{quote?.title||tr('quoteTitle')}</h1>{error&&<p role="alert">{tr(error)}</p>}
  {!quote&&!error&&<p role="status">{tr('loading')}</p>}
  {quote&&<><p>{quote.client_name}</p><p>{t(`businessQuotes.status.${quote.status}`)}</p>
   <ul>{(quote.line_items||[]).map((row,index)=><li key={index}>{row.description} × {row.quantity} · {formatCents(Math.round(Number(row.quantity)*Number(row.unit_price_cents??Number(row.unit_price)*100)),i18n.language)}</li>)}</ul>
   <p>{t('businessQuotes.total')}: {formatCents(quote.total_cents,i18n.language)}</p>
   {quote.valid_until&&<p>{tr('validUntil')}: {formatDate(quote.valid_until)}</p>}
   <h2>{tr('terms')}</h2><p className="helper-work__text">{quote.standard_terms||tr('noTerms')}</p>
   {quote.status==='sent'&&<><p>{tr('consent')}</p><button type="button" disabled={busy} onClick={()=>respond('approved')}>{tr('accept')}</button><button type="button" disabled={busy} onClick={()=>respond('declined')}>{tr('decline')}</button></>}
  </>}
  <button type="button" disabled={busy} onClick={()=>setReload(value=>value+1)}>{tr('reloadQuote')}</button>
 </main>;
}
