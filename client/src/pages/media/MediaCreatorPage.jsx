import React, { useEffect, useRef, useState } from 'react';
import { Briefcase, CheckCircle2, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { acceptCreatorSponsorship, applyToCreatorGig, awardCreatorApplication, cancelCreatorGig, cancelCreatorSponsorship, createCreatorGig, createCreatorSponsorship, createCreatorTip, getCreatorApplications, getCreatorGigs, getCreatorPayments, getCreatorSponsorships, getFeed, getMyCreatorApplications, openCreatorDispute, reviewCreatorDeliverable, settleCreatorSponsorship, settleCreatorTip, submitCreatorDeliverable, submitCreatorSponsorshipDeliverable } from '../../api/media';
import { useAuth } from '../../context/AuthContext';
import { acceptCreatorApplication, declineCreatorApplication, cancelCreatorBoost, getCreatorWorkReviews, getMyCreatorGigs, requestCreatorSponsorshipChanges } from '../../api/media';
import { DEFAULT_CREDIT_CURRENCIES, getCreditMinorUnits, parseCreditMajorAmount } from '../../lib/creditCurrency';
import { trapMediaDialogFocus } from './mediaDialogFocus';

export default function MediaCreatorPage() {
  const { t, i18n } = useTranslation();
  const { user } = useAuth();
  const [gigs, setGigs] = useState([]);
  const [ownedGigs, setOwnedGigs] = useState([]);
  const [sponsorships, setSponsorships] = useState([]);
  const [payments, setPayments] = useState([]);
  const [workReviews, setWorkReviews] = useState([]);
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
  const [gigCurrency, setGigCurrency] = useState('USD');
  const [gigIdempotencyKey, setGigIdempotencyKey] = useState('');
  const [supportTarget, setSupportTarget] = useState(null);
  const [supportMode, setSupportMode] = useState('tip');
  const [supportAmount, setSupportAmount] = useState('');
  const [supportBrief, setSupportBrief] = useState('');
  const [supportIdempotencyKey, setSupportIdempotencyKey] = useState('');
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
  const [revisionTarget, setRevisionTarget] = useState(null);
  const [revisionReason, setRevisionReason] = useState('');
  const marketplaceRef = useRef(null);
  const loadGeneration = useRef(0);
  const activeDialog = selected || createOpen || supportTarget || applicationsGig || deliverableTarget || sponsorshipDeliverableTarget || disputeTarget || revisionTarget;
  const amountText = (minor, currency = 'USD') => new Intl.NumberFormat(i18n.language || 'en', { style: 'currency', currency }).format(Number(minor || 0) / 10 ** getCreditMinorUnits(currency));
  const majorText = (minor, currency = 'USD') => (Number(minor || 0) / 10 ** getCreditMinorUnits(currency)).toFixed(getCreditMinorUnits(currency));
  const openReview = (kind, id) => workReviews.some(review => review.kind === kind && String(review.reference_id) === String(id) && review.status === 'open');
  const rememberReview = (review) => { if (review) { setWorkReviews(items => [...items.filter(item => item.id !== review.id), review]); setActionMessage(t('media.creator.workReviewNotice')); } };

  useEffect(() => {
    if (!activeDialog) return undefined;
    const previousFocus = document.activeElement, previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const dialog = () => [...(marketplaceRef.current?.querySelectorAll('[role="dialog"]') || [])].at(-1);
    const focusHandle = requestAnimationFrame(() => dialog()?.querySelector('button, input, textarea, select')?.focus());
    const onKeyDown = event => {
      if (event.key === 'Escape') { setSelected(null); setCreateOpen(false); setSupportTarget(null); setApplicationsGig(null); setDeliverableTarget(null); setSponsorshipDeliverableTarget(null); setDisputeTarget(null); setRevisionTarget(null); }
      trapMediaDialogFocus(event, dialog());
    };
    document.addEventListener('keydown', onKeyDown);
    return () => { cancelAnimationFrame(focusHandle); document.removeEventListener('keydown', onKeyDown); document.body.style.overflow = previousOverflow; requestAnimationFrame(() => previousFocus?.focus?.()); };
  }, [activeDialog]);
  const statusLabel = (status) => t(`media.creator.status.${status}`, { defaultValue: status });
  const disputeStatusLabel = (status) => t(`media.creator.disputeStates.${status}`, { defaultValue: status });
  const paymentLabel = (kind) => kind === 'tip' ? t('media.creator.tip') : kind === 'sponsorship' ? t('media.creator.sponsor') : kind === 'gig' ? t('media.creator.myGigs') : t('media.post.boost');
  const gigGroups = [{ key: 'opportunities', items: gigs.filter(gig => String(gig.owner_user_id) !== String(user?.id)) }, { key: 'myGigs', items: ownedGigs }];

  const load = () => {
    const request = ++loadGeneration.current;
    setLoading(true);
    setError('');
    Promise.all([
      getCreatorGigs(),
      user ? getCreatorSponsorships() : Promise.resolve({ sponsorships: [] }),
      user ? getCreatorPayments() : Promise.resolve({ payments: [] }),
      user ? getMyCreatorApplications() : Promise.resolve({ applications: [] }),
      user ? getFeed({ tab: 'mine', limit: 50 }) : Promise.resolve({ posts: [] }),
      user ? getCreatorWorkReviews() : Promise.resolve({ workReviews: [] }),
      user ? getMyCreatorGigs() : Promise.resolve({ gigs: [] }),
    ]).then(([gigData, sponsorshipData, paymentData, applicationData, postData, reviewData, ownGigData]) => {
      if (request !== loadGeneration.current) return;
      setGigs(gigData.gigs || []); setSponsorships(sponsorshipData.sponsorships || []);
      setPayments(paymentData.payments || []);
      setMyApplications(applicationData.applications || []); setMyPosts(postData.posts || []);
      setWorkReviews(reviewData.workReviews || []);
      setOwnedGigs(ownGigData.gigs || []);
    })
      .catch(() => { if (request === loadGeneration.current) setError(t('media.creator.loadError')); })
      .finally(() => { if (request === loadGeneration.current) setLoading(false); });
  };

  const createGig = async (event) => {
    event.preventDefault();
    setSubmitting(true);
    setError('');
    try {
      const budgetCents = parseCreditMajorAmount(gigBudget, gigCurrency);
      if (budgetCents === null) throw { response: { data: { error: t('media.creator.invalidAmount') } } };
      await createCreatorGig({ title: gigTitle, brief: gigBrief, budgetCents, currencyCode: gigCurrency, idempotencyKey: gigIdempotencyKey });
      setCreateOpen(false); setGigTitle(''); setGigBrief(''); setGigBudget(''); load();
    } catch (err) { setError(err.response?.data?.error || t('media.creator.loadError')); }
    finally { setSubmitting(false); }
  };
  useEffect(() => { load(); return () => { loadGeneration.current += 1; }; }, [t, user?.id]);

  const submit = async (event) => {
    event.preventDefault();
    if (!selected || !user) return;
    setSubmitting(true);
    setError('');
    try {
      const amount = parseCreditMajorAmount(proposedCents, selected.currency_code || 'USD');
      if (amount === null) throw { response: { data: { error: t('media.creator.invalidAmount') } } };
      await applyToCreatorGig(selected.id, { pitch, proposedCents: amount });
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
      const currencyCode = supportTarget.currency_code || 'USD';
      const amountCents = parseCreditMajorAmount(supportAmount, currencyCode);
      if (amountCents === null) throw { response: { data: { error: t('media.creator.invalidAmount') } } };
      if (supportMode === 'tip') {
        const created = await createCreatorTip({
          actorId: supportTarget.owner_actor_id,
          amountCents, currencyCode,
          idempotencyKey: supportIdempotencyKey,
        });
        await settleCreatorTip(created.tip.id);
        setSupportMessage(t('media.creator.tipSent'));
      } else {
        await createCreatorSponsorship({
          actorId: supportTarget.owner_actor_id,
          amountCents, currencyCode,
          brief: supportBrief,
          idempotencyKey: supportIdempotencyKey,
        });
        setSupportMessage(t('media.creator.sponsorshipSent'));
      }
    } catch (err) {
      setError(err.response?.data?.error || t('media.creator.paymentError'));
    } finally { setSubmitting(false); }
  };

  const openSupport = (gig, mode) => {
    setSupportTarget(gig); setSupportMode(mode); setSupportAmount(majorText(gig.budget_cents, gig.currency_code));
    setSupportBrief(''); setSupportMessage(''); setError('');
    setSupportIdempotencyKey(`media-${mode}-${gig.id}-${Date.now()}-${Math.random().toString(16).slice(2)}`);
  };

  const acceptOffer = async (sponsorshipId) => {
    setSubmitting(true); setError('');
    try { await acceptCreatorSponsorship(sponsorshipId); setSponsorships((items) => items.map((item) => item.id === sponsorshipId ? { ...item, status: 'accepted' } : item)); }
    catch (err) { setError(err.response?.data?.error || t('media.creator.paymentError')); }
    finally { setSubmitting(false); }
  };

  const cancelOffer = async (sponsorshipId) => {
    setSubmitting(true); setError('');
    try { const data = await cancelCreatorSponsorship(sponsorshipId); if (data.workReview) rememberReview(data.workReview); else setSponsorships((items) => items.map((item) => item.id === sponsorshipId ? { ...item, status: 'cancelled' } : item)); }
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
    try { await awardCreatorApplication(applicationId); setApplications((items) => items.map((item) => item.id === applicationId ? { ...item, status: 'awarded' } : { ...item, status: item.status === 'submitted' ? 'rejected' : item.status })); setOwnedGigs(items => items.map(item => item.id === applicationsGig?.id ? { ...item, status: 'awarded' } : item)); setApplicationsGig((gig) => gig ? { ...gig, status: 'awarded' } : gig); }
    catch (err) { setError(err.response?.data?.error || t('media.creator.loadError')); }
    finally { setSubmitting(false); }
  };

  const cancelGig = async (gigId) => {
    setSubmitting(true); setError('');
    try {
      const data = await cancelCreatorGig(gigId);
      if (data.workReview) { rememberReview(data.workReview); return; }
      setGigs((items) => items.map((item) => item.id === gigId ? { ...item, status: 'cancelled' } : item));
      setOwnedGigs((items) => items.map((item) => item.id === gigId ? { ...item, status: 'cancelled' } : item));
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
    try { const data = await reviewCreatorDeliverable(application.deliverable_id, status); if (data.workReview) rememberReview(data.workReview); else setApplications((items) => items.map((item) => item.id === application.id ? { ...item, status: status === 'approved' ? 'approved' : item.status, deliverable_status: status } : item)); }
    catch (err) { setError(err.response?.data?.error || t('media.creator.loadError')); }
    finally { setSubmitting(false); }
  };

  const acceptWork = async application => {
    setSubmitting(true); setError('');
    try { const data = await acceptCreatorApplication(application.id); setMyApplications(items => items.map(item => item.id === application.id ? { ...item, ...data.application } : item)); }
    catch { setError(t('media.creator.loadError')); } finally { setSubmitting(false); }
  };
  const declineWork = async application => {
    setSubmitting(true); setError('');
    try { await declineCreatorApplication(application.id); load(); }
    catch { setError(t('media.creator.loadError')); } finally { setSubmitting(false); }
  };
  const cancelPendingBoost = async payment => {
    setSubmitting(true); setError('');
    try { const data = await cancelCreatorBoost(payment.id); setPayments(items => items.map(item => item.kind === 'boost' && item.id === payment.id ? { ...item, status: data.boost.status } : item)); }
    catch { setError(t('media.creator.paymentError')); } finally { setSubmitting(false); }
  };
  const requestRevision = async event => {
    event.preventDefault(); if (!revisionTarget || !revisionReason.trim()) return;
    setSubmitting(true); setError('');
    try { const data = await requestCreatorSponsorshipChanges(revisionTarget.id, revisionReason.trim()); setSponsorships(items => items.map(item => item.id === revisionTarget.id ? { ...item, ...data.sponsorship } : item)); setRevisionTarget(null); }
    catch { setError(t('media.creator.paymentError')); } finally { setSubmitting(false); }
  };

  return (
    <section ref={marketplaceRef} className="media-feed media-creator-page">
      <header className="media-timeline-header">
        <div>
          <p className="media-page-kicker"><Briefcase size={15} aria-hidden="true" />{t('media.creator.kicker')}</p>
          <h1>{t('media.creator.title')}</h1>
          <p>{t('media.creator.subtitle')}</p>
        </div>
        {user && <button type="button" className="media-primary-button" onClick={() => { setGigIdempotencyKey(`media-gig-${Date.now()}-${Math.random().toString(16).slice(2)}`); setCreateOpen(true); }}>{t('media.creator.createGig')}</button>}
      </header>
      {error && !activeDialog && <div className="media-error" role="alert"><p>{error}</p><button type="button" onClick={load}>{t('media.feed.refresh')}</button></div>}
      {actionMessage && <p className="media-status" role="status">{actionMessage}</p>}
      {loading && <div className="media-skeleton" role="status"><div className="skeleton-line" /><div className="skeleton-line" /></div>}
      {!loading && !error && !gigs.length && <div className="media-empty"><CheckCircle2 size={26} aria-hidden="true" /><h2>{t('media.creator.empty')}</h2></div>}
      {!loading && !error && gigGroups.map(group => group.items.length > 0 && <section key={group.key} className="media-creator-offers" aria-labelledby={`creator-group-${group.key}`}>
        <h2 id={`creator-group-${group.key}`}>{t(`media.creator.${group.key}`)}</h2>
        {group.items.map((gig) => (
        <article className="media-card media-creator-gig" key={gig.id}>
          <div className="media-creator-gig-heading"><div><h2>{gig.title}</h2><p>{gig.owner_name || gig.owner_handle}</p></div><strong>{amountText(gig.budget_cents, gig.currency_code)}</strong></div>
          <p>{gig.brief}</p>
          <p>{statusLabel(gig.status || 'open')}</p>
          {user && <div className="media-creator-actions">
            {String(gig.owner_user_id) !== String(user.id) && <button type="button" className="media-primary-button" onClick={() => { setSelected(gig); setPitch(''); setProposedCents(majorText(gig.budget_cents, gig.currency_code)); setSubmitted(false); }}>{t('media.creator.apply')}</button>}
            {String(gig.owner_user_id) !== String(user.id) && <><button type="button" className="media-secondary-button" onClick={() => openSupport(gig, 'tip')}>{t('media.creator.tip')}</button>
            <button type="button" className="media-secondary-button" onClick={() => openSupport(gig, 'sponsorship')}>{t('media.creator.sponsor')}</button></>}
            {String(gig.owner_user_id) === String(user.id) && <button type="button" className="media-secondary-button" onClick={() => openApplications(gig)}>{t('media.creator.reviewApplications')}</button>}
            {String(gig.owner_user_id) === String(user.id) && ['open', 'awarded', 'in_progress', 'submitted'].includes(gig.status) && <button type="button" className="media-secondary-button" onClick={() => cancelGig(gig.id)} disabled={submitting || openReview('gig', gig.id)}>{t('media.creator.cancel', { defaultValue: 'Cancel' })}</button>}
          </div>}
        </article>
      ))}</section>)}
      {!loading && user && sponsorships.length > 0 && <section className="media-creator-offers" aria-labelledby="creator-offers-title">

        <h2 id="creator-offers-title">{t('media.creator.offers')}</h2>
        {sponsorships.map((offer) => <article className="media-card media-creator-gig" key={offer.id}>
          <div className="media-creator-gig-heading"><div><h3>{offer.brief}</h3><p>{offer.creator_name || offer.creator_handle}</p></div><strong>{amountText(offer.amount_cents, offer.currency_code)}</strong></div>
          <p>{statusLabel(offer.status)}</p>
          {String(offer.creator_user_id) === String(user.id) && offer.status === 'pending_credit' && <button type="button" className="media-primary-button" onClick={() => acceptOffer(offer.id)} disabled={submitting}>{t('media.creator.accept')}</button>}
          {(String(offer.sponsor_user_id) === String(user.id) || String(offer.creator_user_id) === String(user.id)) && ['pending_credit', 'accepted', 'delivered'].includes(offer.status) && <button type="button" className="media-secondary-button" onClick={() => cancelOffer(offer.id)} disabled={submitting || openReview('sponsorship', offer.id)}>{t('media.creator.cancel')}</button>}
          {String(offer.creator_user_id) === String(user.id) && offer.status === 'accepted' && <button type="button" className="media-primary-button" onClick={() => { setSponsorshipDeliverableTarget(offer); setSponsorshipDeliverablePostId(''); setSponsorshipDeliverableNote(''); }}>{t('media.creator.submitDeliverable')}</button>}
          {offer.review_note && <p>{offer.review_note}</p>}
          {String(offer.sponsor_user_id) === String(user.id) && offer.status === 'delivered' && <>
            <button type="button" className="media-primary-button" onClick={() => settleOffer(offer.id)} disabled={submitting || openReview('sponsorship', offer.id)}>{t('media.creator.settle')}</button>
            <button type="button" className="media-secondary-button" onClick={() => { setRevisionTarget(offer); setRevisionReason(''); }} disabled={submitting || openReview('sponsorship', offer.id)}>{t('media.creator.requestChanges')}</button>
          </>}
          {String(offer.sponsor_user_id) === String(user.id) && offer.status === 'completed' && <button type="button" className="media-secondary-button" onClick={() => { setDisputeTarget({ ...offer, kind: 'sponsorship' }); setDisputeDescription(''); }} disabled={submitting}>{t('media.creator.dispute')}</button>}
        </article>)}
      </section>}
      {!loading && user && payments.length > 0 && <section className="media-creator-offers" aria-labelledby="creator-payments-title">

        <h2 id="creator-payments-title">{t('media.creator.paymentHistory')}</h2>
        {payments.map((payment) => <article className="media-card media-creator-gig" key={`${payment.kind}-${payment.id}`}>
          <div className="media-creator-gig-heading"><div><h3>{paymentLabel(payment.kind)}</h3><p>{statusLabel(payment.status)}</p></div><strong>{amountText(payment.amount_cents, payment.currency_code)}</strong></div>
          {payment.dispute_status && <p className="media-form-hint" role="status">{t('media.creator.disputeStatus', { status: disputeStatusLabel(payment.dispute_status) })}{payment.dispute_resolution ? ` · ${payment.dispute_resolution}` : ''}</p>}
          {payment.kind === 'boost' && payment.status === 'pending_credit' && <button type="button" className="media-secondary-button" onClick={() => cancelPendingBoost(payment)} disabled={submitting}>{t('media.creator.cancel')}</button>}
          {payment.credit_transaction_id && !payment.dispute_status && ['completed', 'posted', 'active', 'scheduled'].includes(payment.status) && <button type="button" className="media-secondary-button" onClick={() => { setDisputeTarget(payment); setDisputeDescription(''); }} disabled={submitting}>{t('media.creator.dispute')}</button>}
        </article>)}
      </section>}
      {!loading && user && myApplications.length > 0 && <section className="media-creator-offers" aria-labelledby="creator-my-applications-title">

        <h2 id="creator-my-applications-title">{t('media.creator.myApplications')}</h2>
        {myApplications.map((application) => <article className="media-card media-creator-gig" key={application.id}>
          <div className="media-creator-gig-heading"><div><h3>{application.gig_title}</h3><p>{statusLabel(application.status)}</p></div><strong>{amountText(application.proposed_cents, application.currency_code)}</strong></div>
          <p>{application.gig_brief}</p>
          {application.status === 'awarded' && !application.accepted_at && <div className="media-creator-actions"><button type="button" className="media-primary-button" onClick={() => acceptWork(application)} disabled={submitting}>{t('media.creator.acceptWork')}</button><button type="button" className="media-secondary-button" onClick={() => declineWork(application)} disabled={submitting}>{t('media.creator.declineWork')}</button></div>}
          {['awarded', 'delivered'].includes(application.status) && application.accepted_at && (!application.deliverable_id || application.deliverable_status === 'changes_requested') && <button type="button" className="media-primary-button" onClick={() => { setDeliverableTarget(application); setDeliverablePostId(application.deliverable_post_id || ''); setDeliverableNote(''); }} disabled={openReview('gig', application.gig_id)}>{t('media.creator.submitDeliverable')}</button>}
          {application.deliverable_status && <p>{t('media.creator.deliverableStatus')}: {statusLabel(application.deliverable_status)}</p>}
        </article>)}
      </section>}
      {!loading && user && workReviews.length > 0 && <section className="media-creator-offers" aria-labelledby="creator-work-reviews-title">

        <h2 id="creator-work-reviews-title">{t('media.creator.workReviews')}</h2>
        {workReviews.map(review => <article className="media-card media-creator-gig" key={review.id}>
          <h3>{t(`media.creator.reviewStates.${review.status}`)}</h3><p>{review.reason}</p>
          {review.status === 'open' && <p>{t('media.creator.workReviewNotice')}</p>}
          {review.decision_reason && <p>{review.decision_reason}</p>}
        </article>)}
      </section>}
      {selected && <div className="media-verification-dialog" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setSelected(null); }}>
        <form className="media-verification-form" onSubmit={submit} role="dialog" aria-modal="true" aria-labelledby="creator-apply-title">
          {error && <p className="media-error" role="alert">{error}</p>}
          <button type="button" className="media-dialog-close" onClick={() => setSelected(null)} aria-label={t('media.shell.close')}><X size={18} /></button>
          <h2 id="creator-apply-title">{selected.title}</h2>
          {submitted ? <p role="status">{t('media.creator.submitted')}</p> : <>
            <label htmlFor="creator-pitch">{t('media.creator.pitch')}</label><textarea id="creator-pitch" value={pitch} onChange={(event) => setPitch(event.target.value)} rows={5} required />
            <label htmlFor="creator-budget">{t('media.creator.amountCurrency', { currency: selected.currency_code || 'USD' })}</label><input id="creator-budget" inputMode="decimal" value={proposedCents} onChange={(event) => setProposedCents(event.target.value)} required />
            <button type="submit" className="media-primary-button" disabled={submitting}>{submitting ? t('media.compose.posting') : t('media.creator.submit')}</button>
          </>}
        </form>
      </div>}
      {createOpen && <div className="media-verification-dialog" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setCreateOpen(false); }}>
        <form className="media-verification-form" onSubmit={createGig} role="dialog" aria-modal="true" aria-labelledby="creator-gig-title">
          {error && <p className="media-error" role="alert">{error}</p>}
          <button type="button" className="media-dialog-close" onClick={() => setCreateOpen(false)} aria-label={t('media.shell.close')}><X size={18} /></button>
          <h2 id="creator-gig-title">{t('media.creator.createGig')}</h2>
          <label htmlFor="creator-gig-name">{t('media.creator.gigTitle')}</label><input id="creator-gig-name" value={gigTitle} onChange={(event) => setGigTitle(event.target.value)} maxLength={160} required />
          <label htmlFor="creator-gig-brief">{t('media.creator.gigBrief')}</label><textarea id="creator-gig-brief" value={gigBrief} onChange={(event) => setGigBrief(event.target.value)} maxLength={5000} rows={5} required />
          <label htmlFor="creator-gig-currency">{t('media.creator.currency')}</label><select id="creator-gig-currency" value={gigCurrency} onChange={event => setGigCurrency(event.target.value)}>{DEFAULT_CREDIT_CURRENCIES.map(currency => <option key={currency} value={currency}>{currency}</option>)}</select>
          <label htmlFor="creator-gig-budget">{t('media.creator.amountCurrency', { currency: gigCurrency })}</label><input id="creator-gig-budget" inputMode="decimal" value={gigBudget} onChange={(event) => setGigBudget(event.target.value)} required />
          <button type="submit" className="media-primary-button" disabled={submitting}>{submitting ? t('media.compose.posting') : t('media.creator.submit')}</button>
        </form>
      </div>}
      {supportTarget && <div className="media-verification-dialog" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setSupportTarget(null); }}>
        <form className="media-verification-form" onSubmit={submitSupport} role="dialog" aria-modal="true" aria-labelledby="creator-support-title">
          {error && <p className="media-error" role="alert">{error}</p>}
          <button type="button" className="media-dialog-close" onClick={() => setSupportTarget(null)} aria-label={t('media.shell.close')}><X size={18} /></button>
          <h2 id="creator-support-title">{supportMode === 'tip' ? t('media.creator.tip') : t('media.creator.sponsor')} · {supportTarget.owner_name || supportTarget.owner_handle}</h2>
          {supportMessage ? <p role="status">{supportMessage}</p> : <>
            <label htmlFor="creator-support-amount">{t('media.creator.amountCurrency', { currency: supportTarget.currency_code || 'USD' })}</label>
            <input id="creator-support-amount" inputMode="decimal" value={supportAmount} onChange={(event) => setSupportAmount(event.target.value)} required />
            {supportMode === 'sponsorship' && <><label htmlFor="creator-support-brief">{t('media.creator.brief')}</label><textarea id="creator-support-brief" value={supportBrief} onChange={(event) => setSupportBrief(event.target.value)} rows={4} required /></>}
            <p className="media-form-hint">{t('media.creator.creditNotice')}</p>
            <button type="submit" className="media-primary-button" disabled={submitting}>{submitting ? t('media.compose.posting') : t('media.creator.send')}</button>
          </>}
        </form>
      </div>}
      {applicationsGig && <div className="media-verification-dialog" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setApplicationsGig(null); }}>
        <div className="media-verification-form" role="dialog" aria-modal="true" aria-labelledby="creator-applications-title">
          {error && <p className="media-error" role="alert">{error}</p>}
          <button type="button" className="media-dialog-close" onClick={() => setApplicationsGig(null)} aria-label={t('media.shell.close')}><X size={18} /></button>
          <h2 id="creator-applications-title">{t('media.creator.applications')}</h2>
          {applicationsLoading ? <p role="status">{t('media.compose.posting')}</p> : applications.length === 0 ? <p>{t('media.creator.noApplications')}</p> : applications.map((application) => <article className="media-creator-application" key={application.id}>
            <strong>{application.applicant_name || application.applicant_handle}</strong>
            <p>{application.pitch}</p>
            <span>{amountText(application.proposed_cents, application.currency_code)} · {statusLabel(application.status)}</span>
            {application.status === 'submitted' && <button type="button" className="media-primary-button" onClick={() => awardApplication(application.id)} disabled={submitting}>{t('media.creator.award')}</button>}
            {application.deliverable_status === 'submitted' && <div className="media-creator-actions"><button type="button" className="media-primary-button" onClick={() => reviewDeliverable(application, 'approved')} disabled={submitting}>{t('media.creator.approveDeliverable')}</button><button type="button" className="media-secondary-button" onClick={() => reviewDeliverable(application, 'changes_requested')} disabled={submitting}>{t('media.creator.requestChanges')}</button></div>}
          </article>)}
        </div>
      </div>}
      {deliverableTarget && <div className="media-verification-dialog" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setDeliverableTarget(null); }}>
        <form className="media-verification-form" onSubmit={submitDeliverableForApplication} role="dialog" aria-modal="true" aria-labelledby="creator-deliverable-title">
          {error && <p className="media-error" role="alert">{error}</p>}
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
          {error && <p className="media-error" role="alert">{error}</p>}
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
          {error && <p className="media-error" role="alert">{error}</p>}
          <button type="button" className="media-dialog-close" onClick={() => setDisputeTarget(null)} aria-label={t('media.shell.close')}><X size={18} /></button>
          <h2 id="creator-dispute-title">{t('media.creator.dispute')}</h2>
          <label htmlFor="creator-dispute-description">{t('media.creator.disputeDescription')}</label>
          <textarea id="creator-dispute-description" value={disputeDescription} onChange={(event) => setDisputeDescription(event.target.value)} rows={5} maxLength={4000} required />
          <p className="media-form-hint">{t('media.creator.disputeHint')}</p>
          <button type="submit" className="media-primary-button" disabled={submitting}>{submitting ? t('media.creator.settling') : t('media.creator.submitDispute')}</button>
        </form>
      </div>}
      {revisionTarget && <div className="media-verification-dialog" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget) setRevisionTarget(null); }}>
        <form className="media-verification-form" onSubmit={requestRevision} role="dialog" aria-modal="true" aria-labelledby="creator-revision-title">
          {error && <p className="media-error" role="alert">{error}</p>}
          <button type="button" className="media-dialog-close" onClick={() => setRevisionTarget(null)} aria-label={t('media.shell.close')}><X size={18} /></button>
          <h2 id="creator-revision-title">{t('media.creator.requestChanges')}</h2>
          <label htmlFor="creator-revision-reason">{t('media.creator.revisionReason')}</label><textarea id="creator-revision-reason" value={revisionReason} onChange={event => setRevisionReason(event.target.value)} rows={4} maxLength={2000} required />
          <button type="submit" className="media-primary-button" disabled={submitting}>{t('media.creator.requestChanges')}</button>
        </form>
      </div>}
    </section>
  );
}
