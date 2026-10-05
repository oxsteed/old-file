'use strict';

const {createEvidenceAccumulator,streamStatementCsv,csvText,pdfVolumeDocument}=require('../services/creditStatementExport');
const {normalize}=require('../services/creditStatementPdf');
const snapshots=require('../services/statementSnapshotService');
const {parseRequest,BUDGET,createService}=require('../services/statementExportJobService');
const user='b279247f-65d1-4c3c-8ae7-a4cb5d951849';
const header=count=>({contract:'statement-export-source-v1',product:'oxsteed',currencyCode:'USD',
  kind:'monthly',period:{from:'2026-08-01',to:'2026-08-31'},generatedAt:'2026-09-01T00:00:00.000Z',
  ownerName:'Synthetic',accountLabel:'Synthetic wallet',accountReference:'OC-••••0001',
  openingBalanceCents:'0',closingBalanceCents:String(count),totalCreditsCents:String(count),totalDebitsCents:'0',transactionCount:count});
const row=ordinal=>({ordinal,id:`entry-${ordinal}`,transactionId:'shared-transaction',date:'2026-08-01T00:00:00.000001+00:00',
  type:'load',description:' =1+1',creditCents:'1',debitCents:'0',balanceAfterCents:String(ordinal)});
async function* source(count) {
  for(let start=1;start<=count;start+=BUDGET.chunkRows) {
    yield Array.from({length:Math.min(BUDGET.chunkRows,count-start+1)},(_,i)=>row(start+i));
  }
}

test.each([0,1,5000,5001,100000,1000000])('bounded synthetic %i-entry source is fully reconciled',async count=>{
  const evidence=createEvidenceAccumulator(header(count));let maximum=0;
  for await(const chunk of source(count)){maximum=Math.max(maximum,chunk.length);chunk.forEach(evidence.add);}
  expect(evidence.finish()).toMatchObject({rowCount:count,creditsMinor:String(count),debitsMinor:'0',closingMinor:String(count)});
  expect(maximum).toBeLessThanOrEqual(2000);
},30000);

test('complete 5,001-row CSV streams all entries and does not evaluate hostile text',async()=>{
  const evidence=createEvidenceAccumulator(header(5001));let text='',segments=0;
  for await(const segment of streamStatementCsv(header(5001),source(5001),{onRow:evidence.add})){text+=segment;segments+=1;}
  expect(text.match(/entry-\d+/g)).toHaveLength(5001);
  expect(text).toContain('entry-5001');expect(text).toContain('50.01');
  expect(segments).toBe(5003);expect(evidence.finish().rowCount).toBe(5001);
});
test.each(['=1+1','+cmd','-cmd','@cmd',' \uFEFF\u202E=1+1','\tword','\rword'])('CSV untrusted %p stays text',value=>{
  expect(csvText(value).startsWith('"\'')).toBe(true);
});
test.each([['JPY','100','100'],['BHD','1234','1.234'],['USD','-5','-0.05']])('CSV %s amounts use exact precision',async(currency,minor,expected)=>{
  const s={...header(0),currencyCode:currency,openingBalanceCents:minor,closingBalanceCents:minor};
  let csv='';for await(const part of streamStatementCsv(s,source(0)))csv+=part;
  expect(csv).toContain(expected);
});
test.each(['gap','balance','missing'])('incomplete %s evidence cannot complete',kind=>{
  const evidence=createEvidenceAccumulator(header(1));
  if(kind==='missing')expect(()=>evidence.finish()).toThrow('incomplete');
  else expect(()=>evidence.add({...row(1),...(kind==='gap'?{ordinal:2}:{balanceAfterCents:'9'})})).toThrow('integrity');
});
test('numbered PDF volumes are bounded and explicitly disclose global boundaries',()=>{
  const volume=pdfVolumeDocument(header(5001),[row(2001),row(2002)],{jobId:user,part:2,parts:3,openingMinor:'2000'});
  expect(volume.documentContract).toBe('statement-export-volume-v1');
  expect(volume.volume).toEqual({part:2,parts:3,rowFrom:2001,rowTo:2002,totalRows:5001});
  expect(volume.accountLabel).toContain('[2/3; 2001-2002/5001]');
  expect(normalize(volume)).toMatchObject({transactionCount:2,openingBalanceCents:2000,closingBalanceCents:2002});
});
test('a frozen source is reused without touching the live ledger',async()=>{
  const db={connect:jest.fn()};const materialize=jest.fn();
  expect(await snapshots.freezeExportSource(db,{frozen_header:header(5001)},{materialize})).toEqual(header(5001));
  expect(db.connect).not.toHaveBeenCalled();expect(materialize).not.toHaveBeenCalled();
});
test('frozen row pagination uses bounded ordinal keysets',async()=>{
  const db={query:jest.fn().mockResolvedValue({rows:[{ordinal:'2001',row_data:row(2001)}]})};
  expect(await snapshots.readExportChunk(db,user,2000,2000)).toEqual([row(2001)]);
  expect(db.query.mock.calls[0][0]).toMatch(/ordinal>\$2/);expect(db.query.mock.calls[0][1]).toEqual([user,2000,2000]);
  await expect(snapshots.readExportChunk(db,user,0,5001)).rejects.toMatchObject({code:'statement_snapshot_invalid_chunk_size'});
});
test('request parser cannot accept an arbitrary owner or a forged scope',()=>{
  expect(parseRequest({product:'helper_earnings',helperId:'stranger',format:'pdf'},user).scope_id).toBe(user);
  expect(()=>parseRequest({product:'business',businessId:'1 OR true'},user)).toThrow();
  expect(()=>parseRequest({product:'oxsteed',currencyCode:'ZZZ'},user)).toThrow();
});
test('status reauthorizes current ownership, including removed finance membership',async()=>{
  const db={query:jest.fn().mockResolvedValueOnce({rows:[{id:user,requested_by:user,product:'business',scope_id:'7',account_id:'7',currency_code:'USD'}]})
    .mockResolvedValueOnce({rows:[]})};
  await expect(createService({db}).status(user,user)).rejects.toMatchObject({code:'statement_export_not_found'});
});
