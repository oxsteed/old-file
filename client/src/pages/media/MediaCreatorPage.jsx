import React, { useEffect, useState } from 'react';
import { Briefcase, CheckCircle2, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { acceptCreatorSponsorship, applyToCreatorGig, awardCreatorApplication, cancelCreatorGig, cancelCreatorSponsorship, createCreatorGig, createCreatorSponsorship, createCreatorTip, getCreatorApplications, getCreatorGigs, getCreatorPayments, getCreatorSponsorships, getFeed, getMyCreatorApplications, openCreatorDispute, reviewCreatorDeliverable, settleCreatorSponsorship, settleCreatorTip, submitCreatorDeliverable, submitCreatorSponsorshipDeliverable } from '../../api/media';
import { useAuth } from '../../context/AuthContext';

export default function MediaCreatorPage() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const [gigs, setGigs] = useState([]);
  const [sponsorships, setSponsorships] = useState([]);
  const [payments, setPayments] = useState([]);
  const [myApplications, setMyApplications] = useState([]);
  const [myPosts, setMyPosts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [selected, setSelected] = useState(null);
  const [pitch, setPitch] = useState('');
  const [proposedCents, setProposedCents] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [gigTitle, setGigTitle] = useState('');
  const [gigBrief, setGigBrief] = useState('');
  const [gigBudget, setGigBudget] = useState('');
  const [supportTarget, setSupportTarget] = useState(null);
  const [supportMode, setSupportMode] = useState('tip');
  const [supportAmount, setSupportAmount] = useState('');
  const [supportBrief, setSupportBrief] = useState('');
  const [supportMessage, setSupportMessage] = useState('');
  const [actionMessage, setActionMessage] = useState('');
  const [applicationsGig, setApplicationsGig] = useState(null);
  const [applications, setApplications] = useState([]);
  const [applicationsLoading, setApplicationsLoading] = useState(false);
  const [deliverableTarget, setDeliverableTarget] = useState(null);
  const [deliverablePostId, setDeliverablePostId] = useState('');
  const [deliverableNote, setDeliverableNote] = useState('');
  const [sponsorshipDeliverableTarget, setSponsorshipDeliverableTarget] = useState(null);
  const [sponsorshipDeliverablePostId, setSponsorshipDeliverablePostId] = useState('');
  const [sponsorshipDeliverableNote, setSponsorshipDeliverableNote] = useState('');
  const [disputeTarget, setDisputeTarget] = useState(null);
  const [disputeDescription, setDisputeDescription] = useState('');
  const statusLabel = (status) => t(`media.creator.status.${status}`, { defaultValue: status });
  const disputeStatusLabel = (status) => t(`media.creator.disputeStates.${status}`, { defaultValue: status });
  const paymentLabel = (kind) => kind === 'tip' ? t('media.creator.tip') : kind === 'sponsorship' ? t('media.creator.sponsor') : t('media.post.boost');

  const load = () => {
    setLoading(true);
    setError('');
    Promise.all([
      getCreatorGigs(),
      user ? getCreatorSponsorships() : Promise.resolve({ sponsorships: [] }),
      user ? getCreatorPayments() : Promise.resolve({ payments: [] }),
      user ? getMyCreatorApplications() : Promise.resolve({ applications: [] }),
      user ? getFeed({ tab: 'mine', limit: 50 }) : Promise.resolve({ posts: [] }),
    ]).then(([gigData, sponsorshipData, paymentData, applicationData, postData]) => {
      setGigs(gigData.gigs || []); setSponsorships(sponsorshipData.sponsorships || []);
      setPayments(paymentData.payments || []);
      setMyApplications(applicationData.applications || []); setMyPosts(postData.posts || []);
    })
      .catch(() => setError(t('media.creator.loadError')))
      .finally(() => setLoading(false));
  };

  const createGig = async (event) => {
    event.preventDefault();
    setSubmitting(true);
    setError('');
    try {
      await createCreatorGig({ title: gigTitle, brief: gigBrief, budgetCents: Number(gigBudget) });
      setCreateOpen(false); setGigTitle(''); setGigBrief(''); setGigBudget(''); load();
    } catch (err) { setError(err.response?.data?.error || t('media.creator.loadError')); }
    finally { setSubmitting(false); }
  };
  useEffect(load, [t, user]);

  const submit = async (event) => {
    event.preventDefault();
    if (!selected || !user) return;
    setSubmitting(true);
    setError('');
    try {
      await applyToCreatorGig(selected.id, { pitch, proposedCents: Number(proposedCents) });
      setSubmitted(true);
    } catch (err) {
      setError(err.response?.data?.error || t('media.creator.loadError'));
    } finally { setSubmitting(false); }
  };

  const submitSupport = async (event) => {
    event.preventDefault();
    if (!supportTarget || !user) return;
    setSubmitting(true);
    setError('');
    setSupportMessage('');
    try {
      if (supportMode === 'tip') {
        const created = await createCreatorTip({
          actorId: supportTarget.owner_actor_id,
          amountCents: Number(supportAmount),
          idempotencyKey: `media-tip-${supportTarget.id}-${Date.now()}`,
        });
        await settleCreatorTip(created.tip.id);
        setSupportMessage(t('media.creator.tipSent'));
      } else {
        await createCreatorSponsorship({
          actorId: supportTarget.owner_actor_id,
          amountCents: Number(supportAmount),
          brief: supportBrief,
        });
        setSupportMessage(t('media.creator.sponsorshipSent'));
      }
    } catch (err) {
      setError(err.response?.data?.error || t('media.creator.paymentError'));
    } finally { setSubmitting(false); }
  };

  const openSupport = (gig, mode) => {
    setSupportTarget(gig); setSupportMode(mode); setSupportAmount(String(gig.budget_cents || ''));
    setSupportBrief(''); setSupportMessage(''); setError('');
  };

  const acceptOffer = async (sponsorshipId) => {
    setSubmitting(true); setError('');
    try { await acceptCreatorSponsorship(sponsorshipId); setSponsorships((items) => items.map((item) => item.id === sponsorshipId ? { ...item, status: 'accepted' } : item)); }
    catch (err) { setError(err.response?.data?.error || t('media.creator.paymentError')); }
    finally { setSubmitting(false); }
  };

  const cancelOffer = async (sponsorshipId) => {
    setSubmitting(true); setError('');
    try { await cancelCreatorSponsorship(sponsorshipId); setSponsorships((items) => items.map((item) => item.id === sponsorshipId ? { ...item, status: 'cancelled' } : item)); }
    catch (err) { setError(err.response?.data?.error || t('media.creator.paymentError')); }
    finally { setSubmitting(false); }
  };

  const settleOffer = async (sponsorshipId) => {
    setSubmitting(true); setError('');
    try { await settleCreatorSponsorship(sponsorshipId); setSponsorships((items) => items.map((item) => item.id === sponsorshipId ? { ...item, status: 'completed' } : item)); }
    catch (err) { setError(err.response?.data?.error || t('media.creator.paymentError')); }
    finally { setSubmitting(false); }
  };

  const submitSponsorshipDeliverable = async (event) => {
    event.preventDefault();
    if (!sponsorshipDeliverableTarget || !sponsorshipDeliverablePostId) return;
    setSubmitting(true); setError('');
    try {
      const data = await submitCreatorSponsorshipDeliverable(sponsorshipDeliverableTarget.id, {
        postId: sponsorshipDeliverablePostId,
        note: sponsorshipDeliverableNote,
      });
      setSponsorships((items) => items.map((item) => item.id === sponsorshipDeliverableTarget.id
        ? { ...item, status: 'delivered', delivery_post_id: sponsorshipDeliverablePostId, delivery_note: data.sponsorship?.delivery_note || sponsorshipDeliverableNote }
        : item));
      setSponsorshipDeliverableTarget(null);
    } catch (err) { setError(err.response?.data?.error || t('media.creator.paymentError')); }
    finally { setSubmitting(false); }
  };

  const submitDispute = async (event) => {
    event.preventDefault();
    if (!disputeTarget || !disputeDescription.trim()) return;
    setSubmitting(true); setError('');
    try {
      await openCreatorDispute(disputeTarget.kind, disputeTarget.id, { description: disputeDescription.trim() }, `media-dispute-${disputeTarget.kind}-${disputeTarget.id}-${Date.now()}`);
      setDisputeTarget(null); setDisputeDescription(''); setActionMessage(t('media.creator.disputeSubmitted'));
    } catch (err) { setError(err.response?.data?.error || t('media.creator.paymentError')); }
    finally { setSubmitting(false); }
  };

  const openApplications = async (gig) => {
    setApplicationsGig(gig); setApplications([]); setApplicationsLoading(true); setError('');
    try { const data = await getCreatorApplications(gig.id); setApplications(data.applications || []); }
    catch (err) { setError(err.response?.data?.error || t('media.creator.loadError')); }
    finally { setApplicationsLoading(false); }
  };

  const awardApplication = async (applicationId) => {
    setSubmitting(true); setError('');
    try { await awardCreatorApplication(applicationId); setApplications((items) => items.map((item) => item.id === applicationId ? { ...item, status: 'awarded' } : { ...item, status: item.status === 'submitted' ? 'rejected' : item.status })); setApplicationsGig((gig) => gig ? { ...gig, status: 'awarded' } : gig); }
    catch (err) { setError(err.response?.data?.error || t('media.creator.loadError')); }
    finally { setSubmitting(false); }
  };

  const cancelGig = async (gigId) => {
    setSubmitting(true); setError('');
    try {
      await cancelCreatorGig(gigId);
      setGigs((items) => items.map((item) => item.id === gigId ? { ...item, status: 'cancelled' } : item));
      setApplicationsGig((gig) => gig?.id === gigId ? { ...gig, status: 'cancelled' } : gig);
    } catch (err) { setError(err.response?.data?.error || t('media.creator.loadError')); }
    finally { setSubmitting(false); }
  };

  const submitDeliverableForApplication = async (event) => {
    event.preventDefault();
    if (!deliverableTarget || !deliverablePostId) return;
    setSubmitting(true); setError('');
    try {
      const data = await submitCreatorDeliverable(deliverableTarget.id, { postId: deliverablePostId, note: deliverableNote });
      setMyApplications((items) => items.map((item) => item.id === deliverableTarget.id ? { ...item, status: 'delivered', deliverable_id: data.deliverable?.id, deliverable_post_id: deliverablePostId, deliverable_status: 'submitted' } : item));
      setDeliverableTarget(null);
    } catch (err) { setError(err.response?.data?.error || t('media.creator.loadError')); }
    finally { setSubmitting(false); }
  };

  const reviewDeliverable = async (application, status) => {
    if (!application.deliverable_id) return;
    setSubmitting(true); setError('');
    try { await reviewCreatorDeliverable(application.deliverable_id, status); setApplications((items) => items.map((item) => item.id === application.id ? { ...item, status: status === 'approved' ? 'approved' : item.status, deliverable_status: status } : item)); }
    catch (err) { setError(err.response?.data?.error || t('media.creator.loadError')); }
    finally { setSubmitting(false); }
  };

  return (
    <section className="media-feed media-creator-page">
      <header className="media-timeline-header">
        <div>
          <p className="media-page-kicker"><Briefcase size={15} aria-hidden="true" />{t('media.creator.kicker')}</p>
          <h1>{t('media.creator.title')}</h1>
          <p>{t('media.creator.subtitle')}</p>
        </div>
        {user && <button type="button" className="media-primary-button" onClick={() => setCreateOpen(true)}>{t('media.creator.createGig')}</button>}
      </header>
      {error && <div className="media-error" role="alert"><p>{error}</p><button type="button" onClick={load}>{t('media.feed.refresh')}</button></div>}
      {actionMessage && <p className="media-status" role="status">{actionMessage}</p>}
      {loading && <div className="media-skeleton" role="status"><div className="skeleton-line" /><div className="skeleton-line" /></div>}
      {!loading && !error && !gigs.length && <div className="media-empty"><CheckCircle2 size={26} aria-hidden="true" /><h2>{t('media.creator.empty')}</h2></div>}
      {!loading && !error && gigs.map((gig) => (
        <article className="media-card media-creator-gig" key={gig.id}>
          <div className="media-creator-gig-heading"><div><h2>{gig.title}</h2><p>{gig.owner_name || gig.owner_handle}</p></div><strong>{gig.budget_cents} {gig.currency_code}</strong></div>
          <p>{gig.brief}</p>
          {user && <div className="media-creator-actions">
            <button type="button" className="media-primary-button" onClick={() => { setSelected(gig); setPitch(''); setProposedCents(gig.budget_cents); setSubmitted(false); }}>{t('media.creator.apply')}</button>
            <button type="button" className="media-secondary-button" onClick={() => openSupport(gig, 'tip')}>{t('media.creator.tip')}</button>
            <button type="button" className="media-secondary-button" onClick={() => openSupport(gig, 'sponsorship')}>{t('media.creator.sponsor')}</button>
            {String(gig.owner_user_id) === String(user.id) && <button type="button" className="media-secondary-button" onClick={() => openApplications(gig)}>{t('media.creator.reviewApplications')}</button>}
            {String(gig.owner_user_id) === String(user.id) && ['open', 'awarded', 'in_progress', 'submitted'].includes(gig.status) && <button type="button" className="media-secondary-button" onClick={() => cancelGig(gig.id)} disabled={submitting}>{t('media.creator.cancel', { defaultValue: 'Cancel' })}</button>}
          </div>}
        </article>
      ))}
      {!loading && user && sponsorships.length > 0 && <section className="media-creator-offers" aria-labelledby="creator-offers-title">
        <h2 id="creator-offers-title">{t('media.creator.offers')}</h2>
        {sponsorships.map((offer) => <article className="media-card media-creator-gig" key={offer.id}>
          <div className="media-creator-gig-heading"><div><h3>{offer.brief}</h3><p>{offer.creator_name || offer.creator_handle}</p></div><strong>{offer.amount_cents} {offer.currency_code}</strong></div>
          <p>{statusLabel(offer.status)}</p>
          {String(offer.creator_user_id) === String(user.id) && offer.status === 'pending_credit' && <button type="button" className="media-primary-button" onClick={() => acceptOffer(offer.id)} disabled={submitting}>{t('media.creator.accept')}</button>}
          {(String(offer.sponsor_user_id) === String(user.id) || String(offer.creator_user_id) === String(user.id)) && ['pending_credit', 'accepted', 'delivered'].includes(offer.status) && <button type="button" className="media-secondary-button" onClick={() => cancelOffer(offer.id)} disabled={submitting}>{t('media.creator.cancel')}</button>}
          {String(offer.creator_user_id) === String(user.id) && offer.status === 'accepted' && <button type="button" className="media-primary-button" onClick={() => { setSponsorshipDeliverableTarget(offer); setSponsorshipDeliverablePostId(''); setSponsorshipDeliverableNote(''); }}>{t('media.creator.submitDeliverable')}</button>}
          {String(offer.sponsor_user_id) === String(user.id) && offer.status === 'delivered' && <button type="button" className="media-primary-button" onClick={() => settleOffer(offer.id)} disabled={submitting}>{t('media.creator.settle')}</button>}
          {String(offer.sponsor_user_id) === String(user.id) && offer.status === 'completed' && <button type="button" className="media-secondary-button" onClick={() => { setDisputeTarget(offer); setDisputeDescription(''); }} disabled={submitting}>{t('media.creator.dispute')}</button>}
        </article>)}
      </section>}
      {!loading && user && payments.length > 0 && <section className="media-creator-offers" aria-labelledby="creator-payments-title">
        <h2 id="creator-payments-title">{t('media.creator.paymentHistory')}</h2>
        {payments.map((payment) => <article className="media-card media-creator-gig" key={`${payment.kind}-${payment.id}`}>
          <div className="media-creator-gig-heading"><div><h3>{paymentLabel(payment.kind)}</h3><p>{statusLabel(payment.status)}</p></div><strong>{payment.amount_cents} {payment.currency_code}</strong></div>
          {payment.dispute_status && <p className="media-form-hint" role="status">{t('media.creator.disputeStatus', { status: disputeStatusLabel(payment.dispute_status) })}{payment.dispute_resolution ? ` · ${payment.dispute_resolution}` : ''}</p>}
          {payment.credit_transaction_id && !payment.dispute_status && ['completed', 'posted', 'active', 'scheduled'].includes(payment.status) && <button type="button" className="media-secondary-button" onClick={() => { setDisputeTarget(payment); setDisputeDescription(''); }} disabled={submitting}>{t('media.creator.dispute')}</button>}
        </article>)}
      </section>}
      {!loading && user && myApplications.length > 0 && <section className="media-creator-offers" aria-labelledby="creator-applications-title">
        <h2 id="creator-applications-title">{t('media.creator.myApplications')}</h2>
        {myApplications.map((application) => <article className="media-card media-creator-gig" key={application.id}>
          <div className="media-creator-gig-heading"><div><h3>{application.gig_title}</h3><p>{statusLabel(application.status)}</p></div><strong>{application.proposed_cents} {application.currency_code || 'USD'}</strong></div>
          <p>{application.gig_brief}</p>
          {application.status === 'awarded' && !application.deliverable_id && <button type="button" className="media-primary-button" onClick={() => { setDeliverableTarget(application); setDeliverablePostId(''); setDeliverableNote(''); }}>{t('media.creator.submitDeliverable')}</button>}
          {application.deliverable_status && <p>{t('media.creator.deliverableStatus')}: {statusLabel(application.deliverable_status)}</p>}
        </article>)}
      </section>}
      {selected && <div className="media-verification-dialog" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setSelected(null); }}>
        <form className="media-verification-form" onSubmit={submit} role="dialog" aria-modal="true" aria-labelledby="creator-apply-title">
          <button type="button" className="media-dialog-close" onClick={() => setSelected(null)} aria-label={t('media.shell.close')}><X size={18} /></button>
          <h2 id="creator-apply-title">{selected.title}</h2>
          {submitted ? <p role="status">{t('media.creator.submitted')}</p> : <>
            <label htmlFor="creator-pitch">{t('media.creator.pitch')}</label><textarea id="creator-pitch" value={pitch} onChange={(event) => setPitch(event.target.value)} rows={5} required />
            <label htmlFor="creator-budget">{t('media.creator.proposed')}</label><input id="creator-budget" type="number" min="1" step="1" value={proposedCents} onChange={(event) => setProposedCents(event.target.value)} required />
            <button type="submit" className="media-primary-button" disabled={submitting}>{submitting ? t('media.compose.posting') : t('media.creator.submit')}</button>
          </>}
        </form>
      </div>}
      {createOpen && <div className="media-verification-dialog" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setCreateOpen(false); }}>
        <form className="media-verification-form" onSubmit={createGig} role="dialog" aria-modal="true" aria-labelledby="creator-gig-title">
          <button type="button" className="media-dialog-close" onClick={() => setCreateOpen(false)} aria-label={t('media.shell.close')}><X size={18} /></button>
          <h2 id="creator-gig-title">{t('media.creator.createGig')}</h2>
          <label htmlFor="creator-gig-name">{t('media.creator.gigTitle')}</label><input id="creator-gig-name" value={gigTitle} onChange={(event) => setGigTitle(event.target.value)} maxLength={160} required />
          <label htmlFor="creator-gig-brief">{t('media.creator.gigBrief')}</label><textarea id="creator-gig-brief" value={gigBrief} onChange={(event) => setGigBrief(event.target.value)} maxLength={5000} rows={5} required />
          <label htmlFor="creator-gig-budget">{t('media.creator.budget')}</label><input id="creator-gig-budget" type="number" min="1" step="1" value={gigBudget} onChange={(event) => setGigBudget(event.target.value)} required />
          <button type="submit" className="media-primary-button" disabled={submitting}>{submitting ? t('media.compose.posting') : t('media.creator.submit')}</button>
        </form>
      </div>}
      {supportTarget && <div className="media-verification-dialog" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setSupportTarget(null); }}>
        <form className="media-verification-form" onSubmit={submitSupport} role="dialog" aria-modal="true" aria-labelledby="creator-support-title">
          <button type="button" className="media-dialog-close" onClick={() => setSupportTarget(null)} aria-label={t('media.shell.close')}><X size={18} /></button>
          <h2 id="creator-support-title">{supportMode === 'tip' ? t('media.creator.tip') : t('media.creator.sponsor')} · {supportTarget.owner_name || supportTarget.owner_handle}</h2>
          {supportMessage ? <p role="status">{supportMessage}</p> : <>
            <label htmlFor="creator-support-amount">{t('media.creator.amount')}</label>
            <input id="creator-support-amount" type="number" min="1" step="1" value={supportAmount} onChange={(event) => setSupportAmount(event.target.value)} required />
            {supportMode === 'sponsorship' && <><label htmlFor="creator-support-brief">{t('media.creator.brief')}</label><textarea id="creator-support-brief" value={supportBrief} onChange={(event) => setSupportBrief(event.target.value)} rows={4} required /></>}
            <p className="media-form-hint">{t('media.creator.creditNotice')}</p>
            <button type="submit" className="media-primary-button" disabled={submitting}>{submitting ? t('media.compose.posting') : t('media.creator.send')}</button>
          </>}
        </form>
      </div>}
      {applicationsGig && <div className="media-verification-dialog" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setApplicationsGig(null); }}>
        <div className="media-verification-form" role="dialog" aria-modal="true" aria-labelledby="creator-applications-title">
          <button type="button" className="media-dialog-close" onClick={() => setApplicationsGig(null)} aria-label={t('media.shell.close')}><X size={18} /></button>
          <h2 id="creator-applications-title">{t('media.creator.applications')}</h2>
          {applicationsLoading ? <p role="status">{t('media.compose.posting')}</p> : applications.length === 0 ? <p>{t('media.creator.noApplications')}</p> : applications.map((application) => <article className="media-creator-application" key={application.id}>
            <strong>{application.applicant_name || application.applicant_handle}</strong>
            <p>{application.pitch}</p>
            <span>{application.proposed_cents} {application.currency_code || 'USD'} · {statusLabel(application.status)}</span>
            {application.status === 'submitted' && <button type="button" className="media-primary-button" onClick={() => awardApplication(application.id)} disabled={submitting}>{t('media.creator.award')}</button>}
            {application.deliverable_status === 'submitted' && <div className="media-creator-actions"><button type="button" className="media-primary-button" onClick={() => reviewDeliverable(application, 'approved')} disabled={submitting}>{t('media.creator.approveDeliverable')}</button><button type="button" className="media-secondary-button" onClick={() => reviewDeliverable(application, 'changes_requested')} disabled={submitting}>{t('media.creator.requestChanges')}</button></div>}
          </article>)}
        </div>
      </div>}
      {deliverableTarget && <div className="media-verification-dialog" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setDeliverableTarget(null); }}>
        <form className="media-verification-form" onSubmit={submitDeliverableForApplication} role="dialog" aria-modal="true" aria-labelledby="creator-deliverable-title">
          <button type="button" className="media-dialog-close" onClick={() => setDeliverableTarget(null)} aria-label={t('media.shell.close')}><X size={18} /></button>
          <h2 id="creator-deliverable-title">{t('media.creator.submitDeliverable')}</h2>
          <label htmlFor="creator-deliverable-post">{t('media.creator.choosePost')}</label>
          <select id="creator-deliverable-post" value={deliverablePostId} onChange={(event) => setDeliverablePostId(event.target.value)} required>
            <option value="">{t('media.creator.choosePost')}</option>
            {myPosts.map((post) => <option key={post.id} value={post.id}>{post.body?.slice(0, 80) || post.id}</option>)}
          </select>
          <label htmlFor="creator-deliverable-note">{t('media.creator.deliverableNote')}</label><textarea id="creator-deliverable-note" value={deliverableNote} onChange={(event) => setDeliverableNote(event.target.value)} rows={4} />
          <button type="submit" className="media-primary-button" disabled={submitting}>{submitting ? t('media.compose.posting') : t('media.creator.submit')}</button>
        </form>
      </div>}
      {sponsorshipDeliverableTarget && <div className="media-verification-dialog" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setSponsorshipDeliverableTarget(null); }}>
        <form className="media-verification-form" onSubmit={submitSponsorshipDeliverable} role="dialog" aria-modal="true" aria-labelledby="creator-sponsorship-deliverable-title">
          <button type="button" className="media-dialog-close" onClick={() => setSponsorshipDeliverableTarget(null)} aria-label={t('media.shell.close')}><X size={18} /></button>
          <h2 id="creator-sponsorship-deliverable-title">{t('media.creator.submitDeliverable')}</h2>
          <label htmlFor="creator-sponsorship-deliverable-post">{t('media.creator.choosePost')}</label>
          <select id="creator-sponsorship-deliverable-post" value={sponsorshipDeliverablePostId} onChange={(event) => setSponsorshipDeliverablePostId(event.target.value)} required>
            <option value="">{t('media.creator.choosePost')}</option>
            {myPosts.map((post) => <option key={post.id} value={post.id}>{post.body?.slice(0, 80) || post.id}</option>)}
          </select>
          <label htmlFor="creator-sponsorship-deliverable-note">{t('media.creator.deliverableNote')}</label><textarea id="creator-sponsorship-deliverable-note" value={sponsorshipDeliverableNote} onChange={(event) => setSponsorshipDeliverableNote(event.target.value)} rows={4} />
          <button type="submit" className="media-primary-button" disabled={submitting}>{submitting ? t('media.compose.posting') : t('media.creator.submit')}</button>
        </form>
      </div>}
      {disputeTarget && <div className="media-verification-dialog" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setDisputeTarget(null); }}>
        <form className="media-verification-form" onSubmit={submitDispute} role="dialog" aria-modal="true" aria-labelledby="creator-dispute-title">
          <button type="button" className="media-dialog-close" onClick={() => setDisputeTarget(null)} aria-label={t('media.shell.close')}><X size={18} /></button>
          <h2 id="creator-dispute-title">{t('media.creator.dispute')}</h2>
          <label htmlFor="creator-dispute-description">{t('media.creator.disputeDescription')}</label>
          <textarea id="creator-dispute-description" value={disputeDescription} onChange={(event) => setDisputeDescription(event.target.value)} rows={5} maxLength={4000} required />
          <p className="media-form-hint">{t('media.creator.disputeHint')}</p>
          <button type="submit" className="media-primary-button" disabled={submitting}>{submitting ? t('media.creator.settling') : t('media.creator.submitDispute')}</button>
        </form>
      </div>}
    </section>
  );
}
