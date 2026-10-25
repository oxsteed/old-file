'use strict';
const page=`<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>OxSteed</title><link rel="stylesheet" href="/hub.css"></head>
<body><main><h1>OxSteed</h1><form id="connect"><label><span data-copy="device"></span><input id="device" type="number" min="1" required></label>
<label><span data-copy="credential"></span><input id="credential" type="password" autocomplete="off" required></label><button data-copy="connect"></button></form>
<p id="status" role="status" aria-live="polite"></p><section id="pos" hidden><h2 data-copy="sale"></h2><form id="checkout">
<label><span data-copy="shift"></span><select id="shift" required></select></label><label><span data-copy="item"></span><select id="item" required></select></label>
<label><span data-copy="quantity"></span><input id="quantity" type="number" min="1" max="99" value="1" required></label>
<label><span data-copy="cash"></span><input id="cash" inputmode="decimal" required></label><button data-copy="checkout"></button></form></section>
<section><h2 data-copy="tickets"></h2><div id="tickets"></div></section><button id="disconnect" hidden data-copy="disconnect"></button></main><script src="/hub.js" defer></script></body></html>`;
const css=`:root{color-scheme:light dark;font:18px system-ui}body{margin:0;background:Canvas;color:CanvasText}main{max-inline-size:48rem;margin:auto;padding:1rem}form{display:flex;flex-wrap:wrap;gap:1rem;align-items:end}label{display:grid;gap:.4rem;flex:1;min-inline-size:10rem}input,select,button{font:inherit;padding:.7rem;min-block-size:44px}button{cursor:pointer}article{border:1px solid GrayText;padding:1rem;margin-block:1rem;border-radius:.6rem}article button{margin-inline-end:.5rem}#status{min-block-size:2rem;overflow-wrap:anywhere}[hidden]{display:none!important}`;
const script=`'use strict';
const copy={en:['Device','Device credential','Connect','Cash sale','Open drawer','Item','Quantity','Cash received','Record cash sale','Tickets','Disconnect','Connected','Unavailable. Check connection or pairing.','Start','Ready','Picked up','Change'],
es:['Dispositivo','Credencial del dispositivo','Conectar','Venta en efectivo','Caja abierta','Artículo','Cantidad','Efectivo recibido','Registrar venta','Pedidos','Desconectar','Conectado','No disponible. Revise la conexión o vinculación.','Iniciar','Listo','Recogido','Cambio'],
fr:['Appareil',"Identifiant de l’appareil",'Connecter','Vente en espèces','Caisse ouverte','Article','Quantité','Espèces reçues','Enregistrer la vente','Commandes','Déconnecter','Connecté','Indisponible. Vérifiez la connexion ou l’association.','Commencer','Prêt','Récupéré','Monnaie'],
ht:['Aparèy','Kòd aksè aparèy la','Konekte','Vant an lajan kach','Kès ki ouvè','Atik','Kantite','Lajan kach resevwa','Anrejistre vant lan','Kòmann','Dekonekte','Konekte','Pa disponib. Verifye koneksyon an oswa asosiyasyon an.','Kòmanse','Pare','Ranmase','Monnen'],
ar:['الجهاز','بيانات اعتماد الجهاز','اتصال','بيع نقدي','درج مفتوح','الصنف','الكمية','النقد المستلم','تسجيل البيع','الطلبات','قطع الاتصال','متصل','غير متاح. تحقق من الاتصال أو الاقتران.','بدء','جاهز','تم الاستلام','الباقي']};
const lang=Object.keys(copy).find(l=>navigator.language.startsWith(l))||'en',text=copy[lang];document.documentElement.lang=lang;document.documentElement.dir=lang==='ar'?'rtl':'ltr';
const keys=['device','credential','connect','sale','shift','item','quantity','cash','checkout','tickets','disconnect'];
document.querySelectorAll('[data-copy]').forEach(e=>e.textContent=text[keys.indexOf(e.dataset.copy)]);
const el=id=>document.getElementById(id);let auth=null,snapshot=null,role=null,polling=false,pendingSale=JSON.parse(sessionStorage.getItem("oxsteed-lan-pending")||"null");
const status=value=>el('status').textContent=value;
async function api(path,body){const res=await fetch('/v1/'+path,{method:body?'POST':'GET',headers:{'Content-Type':'application/json','X-Device-Id':auth.id,Authorization:'Bearer '+auth.token},...(body?{body:JSON.stringify(body)}:{})});
 const result=await res.json();if(!res.ok)throw Error(result.code);return result;}
function option(select,value,label){const o=document.createElement('option');o.value=value;o.textContent=label;select.append(o);}
function freezeSale(){for(const input of el('checkout').querySelectorAll('input,select'))input.disabled=Boolean(pendingSale);}
function money(cents){return new Intl.NumberFormat(lang,{style:'currency',currency:snapshot.currencyCode}).format(cents/10**new Intl.NumberFormat('en',{style:'currency',currency:snapshot.currencyCode}).resolvedOptions().maximumFractionDigits);}
async function poll(){if(!auth||polling)return;polling=true;try{const data=await api('orders');el('tickets').replaceChildren();for(const order of data.orders){const article=document.createElement('article');const p=document.createElement('p');p.textContent='LAN-'+order.queueNumber;article.append(p);
 if(order.sale)for(const item of order.sale.items){const line=document.createElement('p');line.textContent=item.quantity+' × '+item.name;article.append(line);}
 const next={received:['start',13],preparing:['ready',14],ready:['pickup',15]}[order.state];if(next&&['pos','kitchen'].includes(role)&&(next[0]!=='pickup'||role==='pos')){const button=document.createElement('button');button.textContent=text[next[1]];button.onclick=async()=>{button.disabled=true;try{await api('actions',{id:order.id,action:next[0],expectedRevision:order.revision,operationId:crypto.randomUUID()});await poll();}catch{status(text[12]);}finally{button.disabled=false;}};article.append(button);}el('tickets').append(article);} }catch{status(text[12]);}finally{polling=false;}}
el('connect').onsubmit=async event=>{event.preventDefault();auth={id:el('device').value,token:el('credential').value};try{snapshot=await api('snapshot');role=snapshot.peerRole;
 el('shift').replaceChildren();for(const shift of snapshot.shifts||[])option(el('shift'),shift.id,shift.staff_label||'#'+shift.id);
 el('item').replaceChildren();for(const item of snapshot.items||[])option(el('item'),item.id,item.name+' · '+money(Number(item.price_cents)));
 el('pos').hidden=role!=='pos';el('connect').hidden=true;el('disconnect').hidden=false;el('credential').value='';freezeSale();status(text[11]);await poll();}catch{auth=null;status(text[12]);}};
el('checkout').onsubmit=async event=>{event.preventDefault();const button=event.submitter;button.disabled=true;try{
 const digits=new Intl.NumberFormat('en',{style:'currency',currency:snapshot.currencyCode}).resolvedOptions().maximumFractionDigits;
 const parts=(pendingSale?'0':el('cash').value.trim()).replace(',','.').split('.');if(!/^\\d+$/.test(parts[0])||parts.length>2||(parts[1]||'').length>digits||!/^\\d*$/.test(parts[1]||''))throw Error('amount');
 if(!pendingSale){pendingSale={idempotencyKey:crypto.randomUUID(),shiftId:Number(el('shift').value),items:[{menuItemId:Number(el('item').value),quantity:Number(el('quantity').value)}],cashTenderedCents:Number(parts[0])*10**digits+Number((parts[1]||'').padEnd(digits,'0'))};sessionStorage.setItem('oxsteed-lan-pending',JSON.stringify(pendingSale));}freezeSale();const result=await api('orders',pendingSale);
 status('LAN-'+result.queueNumber+' · '+text[16]+': '+money(result.cashTenderedCents-result.totalCents));pendingSale=null;sessionStorage.removeItem('oxsteed-lan-pending');freezeSale();await poll();}catch{status(text[12]);}finally{button.disabled=false;}};
el('disconnect').onclick=()=>location.reload();setInterval(poll,2000);
`;
module.exports={page,css,script};
