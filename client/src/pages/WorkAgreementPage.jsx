import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  AlertCircle, ArrowLeft, Camera, CheckCircle2, Clock3, FileText, FolderOpen,
  History, PenLine, Plus, ShieldCheck, Upload, XCircle,
} from 'lucide-react';
import PageMeta from '../components/PageMeta';
import PageShell from '../components/PageShell';
import useAuth from '../hooks/useAuth';
import SignaturePad from '../components/SignaturePad';
import '../components/SignaturePad.css';
import api from '../api/axios';
import './WorkAgreementPage.css';

function Section({ icon: Icon, title, children, action, id }) {
  return (
    <section className="wa-section" id={id}>
      <header className="wa-section__head">
        <h2><Icon size={18} aria-hidden="true" /> {title}</h2>
        {action}
      </header>
      {children}
    </section>
  );
}

export default function WorkAgreementPage() {
  const { t } = useTranslation();
  const { id } = useParams();
  const { user } = useAuth();

  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [signOpen, setSignOpen] = useState(false);
  const [signatureData, setSignatureData] = useState(null);
  const [coSignOpen, setCoSignOpen] = useState(false);
  const [coSignatureData, setCoSignatureData] = useState(null);
  const [coPending, setCoPending] = useState(null);
  const [signing, setSigning] = useState(false);
  const [coOpen, setCoOpen] = useState(false);
  const [coDesc, setCoDesc] = useState('');
  const [coPrice, setCoPrice] = useState('');
  const [evType, setEvType] = useState('before_photo');
  const [evUrl, setEvUrl] = useState('');
  const [evDesc, setEvDesc] = useState('');
  const [docUrl, setDocUrl] = useState('');
  const [docName, setDocName] = useState('');
  const [claimDesc, setClaimDesc] = useState('');
  const [claimOpen, setClaimOpen] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data: d } = await api.get(`/api/work-agreements/${id}`);
      setData(d);
    } catch (e) {
      setError(e.response?.data?.error || t('workAgreement.loadError', { defaultValue: 'Could not load the agreement.' }));
    } finally {
      setLoading(false);
    }
  }, [id, t]);

  useEffect(() => { load(); }, [load]);

  const sign = async () => {
    if (!signatureData) return;
    setSigning(true);
    try {
      await api.post(`/api/work-agreements/${id}/sign`, {
        versionId: data.currentVersion?.id,
        signatureData,
        role: data.myRole,
      });
      setSignOpen(false);
      setSignatureData(null);
      load();
    } catch (e) {
      setError(e.response?.data?.error || t('workAgreement.signError', { defaultValue: 'Could not save the signature.' }));
    } finally {
      setSigning(false);
    }
  };

  const proposeChangeOrder = async () => {
    if (!coDesc.trim()) return;
    setCoPending({ type: 'propose' });
    setCoSignatureData(null);
    setCoSignOpen(true);
  };

  const submitChangeOrderProposal = async () => {
    if (!coSignatureData) return;
    try {
      await api.post(`/api/work-agreements/${id}/change-orders`, {
        description: coDesc.trim(),
        priceChangeCents: Math.round(Number(coPrice || 0) * 100),
        signatureData: coSignatureData,
      });
      setCoOpen(false); setCoDesc(''); setCoPrice('');
      setCoSignOpen(false); setCoSignatureData(null); setCoPending(null);
      load();
    } catch (e) {
      setError(e.response?.data?.error || t('workAgreement.coError', { defaultValue: 'Could not propose the change order.' }));
    }
  };

  const decideChangeOrder = (coId, decision) => {
    setCoPending({ type: 'decide', coId, decision });
    setCoSignatureData(null);
    setCoSignOpen(true);
  };

  const submitChangeOrderDecision = async () => {
    if (!coSignatureData || !coPending?.coId) return;
    try {
      await api.post(`/api/work-agreements/${id}/change-orders/${coPending.coId}/${coPending.decision}`, {
        signatureData: coSignatureData,
      });
      setCoSignOpen(false); setCoSignatureData(null); setCoPending(null);
      load();
    } catch (e) {
      setError(e.response?.data?.error || t('workAgreement.coError', { defaultValue: 'Could not update the change order.' }));
    }
  };

  const addEvidence = async () => {
    try {
      await api.post(`/api/work-agreements/${id}/evidence`, { type: evType, fileUrl: evUrl.trim(), description: evDesc.trim() });
      setEvUrl(''); setEvDesc(''); load();
    } catch (e) {
      setError(e.response?.data?.error || t('workAgreement.evidenceError', { defaultValue: 'Could not add evidence.' }));
    }
  };

  const addDocument = async () => {
    try {
      await api.post(`/api/work-agreements/${id}/documents`, { fileUrl: docUrl.trim(), fileName: docName.trim() });
      setDocUrl(''); setDocName(''); load();
    } catch (e) {
      setError(e.response?.data?.error || t('workAgreement.docError', { defaultValue: 'Could not add the document.' }));
    }
  };

  const fileClaim = async () => {
    try {
      await api.post(`/api/work-agreements/${id}/warranty-claims`, { description: claimDesc.trim() });
      setClaimOpen(false); setClaimDesc(''); load();
    } catch (e) {
      setError(e.response?.data?.error || t('workAgreement.claimError', { defaultValue: 'Could not file the claim.' }));
    }
  };

  if (loading) {
    return <PageShell><main className="wa-page"><p>{t('workAgreement.loading', { defaultValue: 'Loading…' })}</p></main></PageShell>;
  }

  const agreement = data?.agreement;
  const version = data?.currentVersion;
  const signatures = data?.signatures || [];
  const signedRoles = new Set(signatures.map((s) => s.signer_role));
  const myRole = data?.myRole;
  const iSigned = myRole && signedRoles.has(myRole);
  const bothSigned = signedRoles.has('helper') && signedRoles.has('customer');

  return (
    <PageShell>
      <PageMeta
        title={t('workAgreement.detailTitle', { defaultValue: 'Work Agreement | OxSteed' })}
        description={t('workAgreement.detailDescription', { defaultValue: 'Signed work agreement, versions, change orders, evidence and warranty.' })}
        url={`/agreements/${id}`}
      />
      <main className="wa-page">
        <Link to="/jobs" className="wa-back"><ArrowLeft size={16} aria-hidden="true" /> {t('workAgreement.back', { defaultValue: 'Back' })}</Link>
        {error && <p className="wa-error" role="alert">{error}</p>}
        {!agreement && !loading && <p>{t('workAgreement.notFound', { defaultValue: 'Agreement not found.' })}</p>}

        {agreement && (
          <>
            <header className="wa-header">
              <div>
                <p className="wa-eyebrow">{t('workAgreement.eyebrow', { defaultValue: 'Work agreement' })}</p>
                <h1>{t('workAgreement.heading', { defaultValue: 'Agreement' })} · {agreement.status?.replaceAll('_', ' ')}</h1>
                <p className="wa-records-note">
                  <ShieldCheck size={14} aria-hidden="true" />
                  {t('workAgreement.recordsNote', { defaultValue: 'OxSteed keeps the records. You and the other party decide the terms.' })}
                </p>
              </div>
              {myRole && !iSigned && version && (
                <button type="button" className="wa-primary" onClick={() => setSignOpen(true)}>
                  <PenLine size={16} aria-hidden="true" />
                  {t('workAgreement.signCta', { defaultValue: 'Sign this version' })}
                </button>
              )}
            </header>
            {agreement.status === 'active' && (
              <div className="wa-issue-banner" role="note">
                <AlertCircle size={18} aria-hidden="true" />
                <div>
                  <strong>{t('workAgreement.issueTitle', { defaultValue: 'Having an issue with this work?' })}</strong>
                  <p>{t('workAgreement.issueBody', { defaultValue: 'Check your warranty terms below and file a claim here first. OxSteed records the claim; you and the other party resolve it.' })}</p>
                </div>
                <button type="button" className="wa-btn" onClick={() => { setClaimOpen(true); document.getElementById('wa-warranty')?.scrollIntoView({ behavior: 'smooth' }); }}>
                  {t('workAgreement.fileClaim', { defaultValue: 'File claim' })}
                </button>
              </div>
            )}

            <Section icon={PenLine} title={t('workAgreement.signatures', { defaultValue: 'Signatures' })}>
              <div className="wa-signatures">
                {['helper', 'customer'].map((role) => {
                  const sig = signatures.find((s) => s.signer_role === role);
                  return (
                    <div key={role} className={`wa-sig ${sig ? 'is-signed' : ''}`}>
                      <span className="wa-sig__role">{t(`workAgreement.role_${role}`, { defaultValue: role })}</span>
                      {sig ? (
                        <>
                          <img src={sig.signature_data} alt={t('workAgreement.signedAlt', { defaultValue: 'Signature' })} className="wa-sig__img" />
                          <span className="wa-sig__meta"><CheckCircle2 size={14} aria-hidden="true" /> {new Date(sig.signed_at).toLocaleDateString()}</span>
                        </>
                      ) : (
                        <span className="wa-sig__meta"><Clock3 size={14} aria-hidden="true" /> {t('workAgreement.awaiting', { defaultValue: 'Awaiting signature' })}</span>
                      )}
                    </div>
                  );
                })}
              </div>
              {!bothSigned && <p className="wa-muted">{t('workAgreement.bothRequired', { defaultValue: 'Both parties must sign before the agreement becomes active.' })}</p>}
            </Section>

            <Section icon={History} title={t('workAgreement.versions', { defaultValue: 'Versions' })}>
              <ol className="wa-timeline">
                {(data.versions || [version]).filter(Boolean).map((v) => (
                  <li key={v.id} className={v.id === version?.id ? 'is-current' : ''}>
                    <span className="wa-timeline__n">v{v.version_number}</span>
                    <span className="wa-timeline__meta">{new Date(v.created_at).toLocaleDateString()}</span>
                    {v.id === version?.id && <span className="wa-pill">{t('workAgreement.current', { defaultValue: 'Current' })}</span>}
                  </li>
                ))}
              </ol>
              {version?.content && (
                <details className="wa-details">
                  <summary>{t('workAgreement.viewTerms', { defaultValue: 'View agreed terms' })}</summary>
                  <pre>{JSON.stringify(version.content, null, 2)}</pre>
                </details>
              )}
            </Section>

            <Section icon={FileText} title={t('workAgreement.changeOrders', { defaultValue: 'Change orders' })}
              action={<button type="button" className="wa-btn" onClick={() => setCoOpen(true)}><Plus size={14} aria-hidden="true" /> {t('workAgreement.proposeCo', { defaultValue: 'Propose' })}</button>}>
              {(data.changeOrders || []).length === 0 && <p className="wa-muted">{t('workAgreement.noChangeOrders', { defaultValue: 'No change orders yet.' })}</p>}
              {(data.changeOrders || []).map((co) => (
                <div key={co.id} className="wa-co">
                  <p>{co.description}</p>
                  <p className="wa-muted">{t('workAgreement.priceChange', { defaultValue: 'Price change' })}: {(co.price_change_cents / 100).toFixed(2)}</p>
                  <span className={`wa-pill wa-pill--${co.status}`}>{co.status}</span>
                  {co.status === 'proposed' && (
                    <div className="wa-row">
                      <button type="button" className="wa-btn" onClick={() => decideChangeOrder(co.id, 'approve')}>{t('workAgreement.approve', { defaultValue: 'Approve' })}</button>
                      <button type="button" className="wa-btn wa-btn--danger" onClick={() => decideChangeOrder(co.id, 'reject')}>{t('workAgreement.reject', { defaultValue: 'Reject' })}</button>
                    </div>
                  )}
                </div>
              ))}
              {coOpen && (
                <div className="wa-form">
                  <label>{t('workAgreement.coDesc', { defaultValue: 'Description' })}
                    <textarea rows={3} value={coDesc} onChange={(e) => setCoDesc(e.target.value)} /></label>
                  <label>{t('workAgreement.coPrice', { defaultValue: 'Price change (USD)' })}
                    <input type="number" step="0.01" value={coPrice} onChange={(e) => setCoPrice(e.target.value)} /></label>
                  <div className="wa-row">
                    <button type="button" className="wa-primary" onClick={proposeChangeOrder} disabled={!coDesc.trim()}>{t('workAgreement.submit', { defaultValue: 'Submit' })}</button>
                    <button type="button" className="wa-btn" onClick={() => setCoOpen(false)}>{t('workAgreement.cancel', { defaultValue: 'Cancel' })}</button>
                  </div>
                </div>
              )}
            </Section>

            <Section icon={Camera} title={t('workAgreement.evidence', { defaultValue: 'Evidence' })}>
              <div className="wa-evidence-grid">
                {(data.evidence || []).map((ev) => (
                  <figure key={ev.id} className="wa-ev">
                    {ev.evidence_type !== 'testing_record' ? (
                      <img src={ev.file_url} alt={ev.description || ev.evidence_type} loading="lazy" />
                    ) : (
                      <a href={ev.file_url} target="_blank" rel="noreferrer" className="wa-ev__doc">{t('workAgreement.testingRecord', { defaultValue: 'Testing record' })}</a>
                    )}
                    <figcaption><span className="wa-pill">{ev.evidence_type?.replaceAll('_', ' ')}</span> {ev.description}</figcaption>
                  </figure>
                ))}
              </div>
              <div className="wa-form wa-form--inline">
                <select value={evType} onChange={(e) => setEvType(e.target.value)} aria-label={t('workAgreement.evidenceType', { defaultValue: 'Evidence type' })}>
                  <option value="before_photo">{t('workAgreement.beforePhoto', { defaultValue: 'Before photo' })}</option>
                  <option value="after_photo">{t('workAgreement.afterPhoto', { defaultValue: 'After photo' })}</option>
                  <option value="testing_record">{t('workAgreement.testingRecord', { defaultValue: 'Testing record' })}</option>
                </select>
                <input value={evUrl} onChange={(e) => setEvUrl(e.target.value)} placeholder={t('workAgreement.fileUrl', { defaultValue: 'File URL' })} />
                <input value={evDesc} onChange={(e) => setEvDesc(e.target.value)} placeholder={t('workAgreement.description', { defaultValue: 'Description' })} />
                <button type="button" className="wa-btn" onClick={addEvidence} disabled={!evUrl.trim()}><Upload size={14} aria-hidden="true" /> {t('workAgreement.add', { defaultValue: 'Add' })}</button>
              </div>
            </Section>

            <Section icon={FolderOpen} title={t('workAgreement.vault', { defaultValue: 'Document vault' })}>
              {(data.documents || []).length === 0 && <p className="wa-muted">{t('workAgreement.noDocuments', { defaultValue: 'No outside paperwork uploaded yet.' })}</p>}
              <ul className="wa-docs">
                {(data.documents || []).map((doc) => (
                  <li key={doc.id}><a href={doc.file_url} target="_blank" rel="noreferrer">{doc.file_name}</a></li>
                ))}
              </ul>
              <div className="wa-form wa-form--inline">
                <input value={docUrl} onChange={(e) => setDocUrl(e.target.value)} placeholder={t('workAgreement.fileUrl', { defaultValue: 'File URL' })} />
                <input value={docName} onChange={(e) => setDocName(e.target.value)} placeholder={t('workAgreement.fileName', { defaultValue: 'File name' })} />
                <button type="button" className="wa-btn" onClick={addDocument} disabled={!docUrl.trim() || !docName.trim()}><Upload size={14} aria-hidden="true" /> {t('workAgreement.add', { defaultValue: 'Add' })}</button>
              </div>
            </Section>

            <Section id="wa-warranty" icon={ShieldCheck} title={t('workAgreement.warranty', { defaultValue: 'Warranty claims' })}
              action={<button type="button" className="wa-btn" onClick={() => setClaimOpen(true)}><Plus size={14} aria-hidden="true" /> {t('workAgreement.fileClaim', { defaultValue: 'File claim' })}</button>}>
              <p className="wa-muted">{t('workAgreement.warrantyNote', { defaultValue: 'OxSteed records the claim. The parties resolve it between themselves.' })}</p>
              {(data.warrantyClaims || []).map((c) => (
                <div key={c.id} className="wa-co">
                  <p>{c.description}</p>
                  <span className={`wa-pill wa-pill--${c.status}`}>{c.status?.replaceAll('_', ' ')}</span>
                  {c.resolution_note && <p className="wa-muted">{c.resolution_note}</p>}
                </div>
              ))}
              {claimOpen && (
                <div className="wa-form">
                  <label>{t('workAgreement.claimDesc', { defaultValue: 'What went wrong?' })}
                    <textarea rows={3} value={claimDesc} onChange={(e) => setClaimDesc(e.target.value)} /></label>
                  <div className="wa-row">
                    <button type="button" className="wa-primary" onClick={fileClaim} disabled={!claimDesc.trim()}>{t('workAgreement.submit', { defaultValue: 'Submit' })}</button>
                    <button type="button" className="wa-btn" onClick={() => setClaimOpen(false)}>{t('workAgreement.cancel', { defaultValue: 'Cancel' })}</button>
                  </div>
                </div>
              )}
            </Section>

            {signOpen && (
              <div className="wa-modal" role="dialog" aria-modal="true" aria-label={t('workAgreement.signTitle', { defaultValue: 'Sign the agreement' })}>
                <div className="wa-modal__box">
                  <h2>{t('workAgreement.signTitle', { defaultValue: 'Sign the agreement' })}</h2>
                  <p className="wa-muted">{t('workAgreement.signWarning', { defaultValue: 'Your drawn signature is binding. A new version requires signing again.' })}</p>
                  <SignaturePad onChange={setSignatureData} />
                  <div className="wa-row">
                    <button type="button" className="wa-primary" onClick={sign} disabled={!signatureData || signing}>
                      {signing ? t('workAgreement.signing', { defaultValue: 'Signing…' }) : t('workAgreement.signSubmit', { defaultValue: 'Sign' })}
                    </button>
                    <button type="button" className="wa-btn" onClick={() => { setSignOpen(false); setSignatureData(null); }}>
                      <XCircle size={14} aria-hidden="true" /> {t('workAgreement.cancel', { defaultValue: 'Cancel' })}
                    </button>
                  </div>
                </div>
              </div>
            )}

            {coSignOpen && coPending && (
              <div className="wa-modal" role="dialog" aria-modal="true" aria-label={t('workAgreement.coSignTitle', { defaultValue: 'Sign the change order' })}>
                <div className="wa-modal__box">
                  <h2>{t('workAgreement.coSignTitle', { defaultValue: 'Sign the change order' })}</h2>
                  <p className="wa-muted">{t('workAgreement.coSignWarning', { defaultValue: 'Your drawn signature is required. Change orders are binding once both parties sign.' })}</p>
                  <SignaturePad onChange={setCoSignatureData} />
                  <div className="wa-row">
                    <button type="button" className="wa-primary"
                      onClick={coPending.type === 'propose' ? submitChangeOrderProposal : submitChangeOrderDecision}
                      disabled={!coSignatureData}>
                      {t('workAgreement.coSignSubmit', { defaultValue: 'Sign and submit' })}
                    </button>
                    <button type="button" className="wa-btn" onClick={() => { setCoSignOpen(false); setCoSignatureData(null); setCoPending(null); }}>
                      <XCircle size={14} aria-hidden="true" /> {t('workAgreement.cancel', { defaultValue: 'Cancel' })}
                    </button>
                  </div>
                </div>
              </div>
            )}
          </>
        )}
      </main>
    </PageShell>
  );
}
