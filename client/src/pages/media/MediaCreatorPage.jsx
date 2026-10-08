import React, { useEffect, useState } from 'react';
import { Briefcase, CheckCircle2, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { acceptCreatorSponsorship, applyToCreatorGig, createCreatorGig, createCreatorSponsorship, createCreatorTip, getCreatorGigs, getCreatorSponsorships, settleCreatorTip } from '../../api/media';
import { useAuth } from '../../context/AuthContext';

export default function MediaCreatorPage() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const [gigs, setGigs] = useState([]);
  const [sponsorships, setSponsorships] = useState([]);
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

  const load = () => {
    setLoading(true);
    setError('');
    Promise.all([
      getCreatorGigs(),
      user ? getCreatorSponsorships() : Promise.resolve({ sponsorships: [] }),
    ]).then(([gigData, sponsorshipData]) => { setGigs(gigData.gigs || []); setSponsorships(sponsorshipData.sponsorships || []); })
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
          </div>}
        </article>
      ))}
      {!loading && user && sponsorships.length > 0 && <section className="media-creator-offers" aria-labelledby="creator-offers-title">
        <h2 id="creator-offers-title">{t('media.creator.offers')}</h2>
        {sponsorships.map((offer) => <article className="media-card media-creator-gig" key={offer.id}>
          <div className="media-creator-gig-heading"><div><h3>{offer.brief}</h3><p>{offer.creator_name || offer.creator_handle}</p></div><strong>{offer.amount_cents} {offer.currency_code}</strong></div>
          <p>{offer.status === 'accepted' ? t('media.creator.accepted') : offer.status === 'pending_credit' ? t('media.creator.pendingAcceptance') : offer.status}</p>
          {String(offer.creator_user_id) === String(user.id) && offer.status === 'pending_credit' && <button type="button" className="media-primary-button" onClick={() => acceptOffer(offer.id)} disabled={submitting}>{t('media.creator.accept')}</button>}
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
    </section>
  );
}
