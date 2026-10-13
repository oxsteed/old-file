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
import PaymentReauthorizationBanner from '../components/PaymentReauthorizationBanner';
import '../components/SignaturePad.css';
import api from '../api/axios';
import './WorkAgreementPage.css';
import { safeHttpUrl } from '../utils/safeHref';

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
  const [evFile, setEvFile] = useState(null);
  const [evUrl, setEvUrl] = useState('');
  const [evDesc, setEvDesc] = useState('');
  const [docFile, setDocFile] = useState(null);
  const [docUrl, setDocUrl] = useState('');
  const [fileInputKey, setFileInputKey] = useState(0);
  const [docName, setDocName] = useState('');
  const [claimDesc, setClaimDesc] = useState('');
  const [claimOpen, setClaimOpen] = useState(false);
  const [claimNotes, setClaimNotes] = useState({});

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data: d } = await api.get(`/work-agreements/${id}`);
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
      await api.post(`/work-agreements/${id}/sign`, {
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

  // Review P1-164: each party confirms; the agreement completes once both have.
  const [completing, setCompleting] = useState(false);
  const confirmComplete = async () => {
    setCompleting(true);
    try {
      await api.post(`/work-agreements/${id}/complete`);
      load();
    } catch (e) {
      setError(e.response?.data?.error || t('workAgreement.completeError', { defaultValue: 'Could not confirm completion.' }));
    } finally {
      setCompleting(false);
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
      await api.post(`/work-agreements/${id}/change-orders`, {
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
      await api.post(`/work-agreements/${id}/change-orders/${coPending.coId}/${coPending.decision}`, {
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
      // Review P3-912: upload the file itself (stored privately, served via a
      // short-lived signed URL). A pasted https link stays as a fallback.
      const form = new FormData();
      form.append('type', evType);
      form.append('description', evDesc.trim());
      if (evFile) form.append('file', evFile);
      else form.append('fileUrl', evUrl.trim());
      await api.post(`/work-agreements/${id}/evidence`, form);
      setEvFile(null); setEvUrl(''); setEvDesc(''); setFileInputKey((k) => k + 1); load();
    } catch (e) {
      setError(e.response?.data?.error || t('workAgreement.evidenceError', { defaultValue: 'Could not add evidence.' }));
    }
  };

  const addDocument = async () => {
    try {
      const form = new FormData();
      form.append('fileName', docName.trim() || docFile?.name || '');
      if (docFile) form.append('file', docFile);
      else form.append('fileUrl', docUrl.trim());
      await api.post(`/work-agreements/${id}/documents`, form);
      setDocFile(null); setDocUrl(''); setDocName(''); setFileInputKey((k) => k + 1); load();
    } catch (e) {
      setError(e.response?.data?.error || t('workAgreement.docError', { defaultValue: 'Could not add the document.' }));
    }
  };

  const fileClaim = async () => {
    try {
      await api.post(`/work-agreements/${id}/warranty-claims`, { description: claimDesc.trim() });
      setClaimOpen(false); setClaimDesc(''); load();
    } catch (e) {
      setError(e.response?.data?.error || t('workAgreement.claimError', { defaultValue: 'Could not file the claim.' }));
    }
  };

  const resolveClaim = async (claimId, decision) => {
    try {
      await api.post(`/work-agreements/${id}/warranty-claims/${claimId}/resolve`, {
        decision,
        note: (claimNotes[claimId] || '').trim() || undefined,
      });
      setClaimNotes((prev) => ({ ...prev, [claimId]: '' }));
      load();
    } catch (e) {
      setError(e.response?.data?.error || t('workAgreement.claimResolveError', { defaultValue: 'Could not update the claim.' }));
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
  const agreementRow = data?.agreement;
  const iConfirmed = myRole && Boolean(agreementRow?.[`${myRole}_completed_at`]);
  const jobLink = data?.jobLink;

  return (
    <PageShell>
      <PageMeta
        title={t('workAgreement.detailTitle', { defaultValue: 'Work Agreement | OxSteed' })}
        description={t('workAgreement.detailDescription', { defaultValue: 'Signed work agreement, versions, change orders, evidence and warranty.' })}
        url={`/agreements/${id}`}
      />
      <main className="wa-page">
        <Link to={data?.agreement?.job_id ? `/jobs/${data.agreement.job_id}` : '/jobs'} className="wa-back"><ArrowLeft size={16} aria-hidden="true" /> {t('workAgreement.back', { defaultValue: 'Back' })}</Link>
        {agreement?.job_id && <PaymentReauthorizationBanner key={(data?.changeOrders || []).filter((co) => co.status === 'approved').length} jobId={agreement.job_id} alwaysCheck />}
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
              {myRole && !iSigned && version && agreement.status !== 'completed' && (
                <button type="button" className="wa-primary" onClick={() => setSignOpen(true)}>
                  <PenLine size={16} aria-hidden="true" />
                  {t('workAgreement.signCta', { defaultValue: 'Sign this version' })}
                </button>
              )}
            </header>
            {jobLink && (
              <p className="wa-records-note" role="status">
                {t('workAgreement.jobLinkSummary', {
                  defaultValue: 'Job: {{job}} · Payment: {{payment}}',
                  job: jobLink.job_status?.replaceAll('_', ' ') || '—',
                  payment: jobLink.payment_status?.replaceAll('_', ' ') || t('workAgreement.noPayment', { defaultValue: 'none recorded' }),
                })}
                {jobLink.dispute_open ? ` · ${t('workAgreement.disputeOpen', { defaultValue: 'A dispute is open on this job' })}` : ''}
              </p>
            )}
            {agreement.status === 'active' && myRole && (
              <div className="wa-issue-banner" role="note">
                <CheckCircle2 size={18} aria-hidden="true" />
                <div>
                  <strong>{t('workAgreement.completeTitle', { defaultValue: 'Work finished?' })}</strong>
                  <p>{iConfirmed
                    ? t('workAgreement.awaitingCounterparty', { defaultValue: 'You confirmed. Waiting for the other party to confirm.' })
                    : t('workAgreement.completeBody', { defaultValue: 'Both of you confirm before the agreement is marked complete.' })}</p>
                </div>
                {!iConfirmed && (
                  <button type="button" className="wa-btn" onClick={confirmComplete} disabled={completing}>
                    {t('workAgreement.confirmComplete', { defaultValue: 'Confirm complete' })}
                  </button>
                )}
              </div>
            )}
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
                  <dl className="wa-terms">
                    {[
                      ['title', 'termTitle', 'Title'],
                      ['scope', 'scopeLabel', 'Scope of work'],
                      ['timeline', 'timelineLabel', 'Timeline'],
                      ['terms', 'extraTermsLabel', 'Other terms'],
                    ].filter(([key]) => version.content[key]).map(([key, label, fallback]) => (
                      <div key={key}>
                        <dt>{t(`workAgreement.${label}`, { defaultValue: fallback })}</dt>
                        <dd>{String(version.content[key])}</dd>
                      </div>
                    ))}
                    {Number.isInteger(version.content.priceCents) && (
                      <div>
                        <dt>{t('workAgreement.priceLabel', { defaultValue: 'Agreed price' })}</dt>
                        <dd dir="ltr">{(version.content.priceCents / 100).toFixed(2)}</dd>
                      </div>
                    )}
                  </dl>
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
                  {co.status === 'proposed' && user && String(co.proposed_by) === String(user.id) && (
                    <p className="wa-muted">{t('workAgreement.coAwaitingOther', { defaultValue: 'Waiting for the other party to decide.' })}</p>
                  )}
                  {co.status === 'proposed' && user && String(co.proposed_by) !== String(user.id) && (
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
                    {!safeHttpUrl(ev.file_url) ? (
                      <span className="wa-muted">{t('workAgreement.fileUnavailable', { defaultValue: 'File unavailable' })}</span>
                    ) : ev.evidence_type !== 'testing_record' ? (
                      <img src={safeHttpUrl(ev.file_url)} alt={ev.description || ev.evidence_type} loading="lazy" />
                    ) : (
                      <a href={safeHttpUrl(ev.file_url)} target="_blank" rel="noopener noreferrer" className="wa-ev__doc">{t('workAgreement.testingRecord', { defaultValue: 'Testing record' })}</a>
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
                <input key={`ev-${fileInputKey}`} type="file" accept={evType === 'testing_record' ? 'image/*,application/pdf' : 'image/*'}
                  onChange={(e) => setEvFile(e.target.files?.[0] || null)} aria-label={t('workAgreement.chooseFile', { defaultValue: 'Choose a file' })} />
                <input type="url" dir="ltr" value={evUrl} onChange={(e) => setEvUrl(e.target.value)} disabled={!!evFile}
                  placeholder={t('workAgreement.fileUrlOptional', { defaultValue: 'Or paste an https link' })} />
                <input value={evDesc} onChange={(e) => setEvDesc(e.target.value)} placeholder={t('workAgreement.description', { defaultValue: 'Description' })} />
                <button type="button" className="wa-btn" onClick={addEvidence} disabled={!evFile && !evUrl.trim()}><Upload size={14} aria-hidden="true" /> {t('workAgreement.add', { defaultValue: 'Add' })}</button>
              </div>
            </Section>

            <Section icon={FolderOpen} title={t('workAgreement.vault', { defaultValue: 'Document vault' })}>
              {(data.documents || []).length === 0 && <p className="wa-muted">{t('workAgreement.noDocuments', { defaultValue: 'No outside paperwork uploaded yet.' })}</p>}
              <ul className="wa-docs">
                {(data.documents || []).map((doc) => (
                  <li key={doc.id}>{safeHttpUrl(doc.file_url)
                    ? <a href={safeHttpUrl(doc.file_url)} target="_blank" rel="noopener noreferrer">{doc.file_name}</a>
                    : <span>{doc.file_name} <span className="wa-muted">({t('workAgreement.fileUnavailable', { defaultValue: 'File unavailable' })})</span></span>}</li>
                ))}
              </ul>
              <div className="wa-form wa-form--inline">
                <input key={`doc-${fileInputKey}`} type="file" accept="application/pdf,image/*"
                  onChange={(e) => setDocFile(e.target.files?.[0] || null)} aria-label={t('workAgreement.chooseFile', { defaultValue: 'Choose a file' })} />
                <input type="url" dir="ltr" value={docUrl} onChange={(e) => setDocUrl(e.target.value)} disabled={!!docFile}
                  placeholder={t('workAgreement.fileUrlOptional', { defaultValue: 'Or paste an https link' })} />
                <input value={docName} onChange={(e) => setDocName(e.target.value)} placeholder={t('workAgreement.fileName', { defaultValue: 'File name' })} />
                <button type="button" className="wa-btn" onClick={addDocument} disabled={(!docFile && !docUrl.trim()) || (!docFile && !docName.trim())}><Upload size={14} aria-hidden="true" /> {t('workAgreement.add', { defaultValue: 'Add' })}</button>
              </div>
            </Section>

            <Section id="wa-warranty" icon={ShieldCheck} title={t('workAgreement.warranty', { defaultValue: 'Warranty claims' })}
              action={<button type="button" className="wa-btn" onClick={() => setClaimOpen(true)}><Plus size={14} aria-hidden="true" /> {t('workAgreement.fileClaim', { defaultValue: 'File claim' })}</button>}>
              <div className="wa-warranty-terms">
                <p>
                  <strong>{t('workAgreement.warrantyMonths', { defaultValue: 'Warranty (months)' })}:</strong>{' '}
                  <span dir="ltr">{agreement.warranty_months ?? 0}</span>
                </p>
                {agreement.warranty_terms && (
                  <p><strong>{t('workAgreement.warrantyTermsLabel', { defaultValue: 'Warranty terms' })}:</strong> {agreement.warranty_terms}</p>
                )}
                {agreement.reimbursement_terms && (
                  <p><strong>{t('workAgreement.reimbursementLabel', { defaultValue: 'Reimbursement terms' })}:</strong> {agreement.reimbursement_terms}</p>
                )}
                {!agreement.warranty_terms && !agreement.reimbursement_terms && (
                  <p className="wa-muted">{t('workAgreement.noWarrantyTerms', { defaultValue: 'No written warranty terms were added.' })}</p>
                )}
              </div>
              <p className="wa-muted">{t('workAgreement.warrantyNote', { defaultValue: 'OxSteed records the claim. The parties resolve it between themselves.' })}</p>
              {(data.warrantyClaims || []).map((c) => {
                const open = ['filed', 'under_review'].includes(c.status);
                const iFiled = user && String(c.filed_by) === String(user.id);
                return (
                  <div key={c.id} className="wa-co">
                    <p>{c.description}</p>
                    <span className={`wa-pill wa-pill--${c.status}`}>{t(`workAgreement.claimStatus_${c.status}`, { defaultValue: c.status?.replaceAll('_', ' ') })}</span>
                    {c.resolution_note && <p className="wa-muted">{c.resolution_note}</p>}
                    {open && myRole && (
                      <div className="wa-form">
                        <label>{t('workAgreement.claimNote', { defaultValue: 'Note (optional)' })}
                          <textarea rows={2} value={claimNotes[c.id] || ''}
                            onChange={(e) => setClaimNotes((prev) => ({ ...prev, [c.id]: e.target.value }))} /></label>
                        <div className="wa-row">
                          {!iFiled && c.status === 'filed' && (
                            <button type="button" className="wa-btn" onClick={() => resolveClaim(c.id, 'under_review')}>
                              {t('reviewW11.reviewClaim')}
                            </button>
                          )}
                          <button type="button" className="wa-btn" onClick={() => resolveClaim(c.id, 'resolved')}>
                            {iFiled
                              ? t('workAgreement.claimWithdraw', { defaultValue: 'Mark resolved' })
                              : t('workAgreement.claimResolve', { defaultValue: 'Resolved' })}
                          </button>
                          {!iFiled && (
                            <button type="button" className="wa-btn wa-btn--danger" onClick={() => resolveClaim(c.id, 'denied')}>
                              {t('workAgreement.claimDeny', { defaultValue: 'Decline claim' })}
                            </button>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
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
