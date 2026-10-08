import React, { useEffect, useState } from 'react';
import { Briefcase, CheckCircle2, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { applyToCreatorGig, getCreatorGigs } from '../../api/media';
import { useAuth } from '../../context/AuthContext';

export default function MediaCreatorPage() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const [gigs, setGigs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [selected, setSelected] = useState(null);
  const [pitch, setPitch] = useState('');
  const [proposedCents, setProposedCents] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  const load = () => {
    setLoading(true);
    setError('');
    getCreatorGigs().then((data) => setGigs(data.gigs || []))
      .catch(() => setError(t('media.creator.loadError')))
      .finally(() => setLoading(false));
  };
  useEffect(load, [t]);

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

  return (
    <section className="media-feed media-creator-page">
      <header className="media-timeline-header">
        <div>
          <p className="media-page-kicker"><Briefcase size={15} aria-hidden="true" />{t('media.creator.kicker')}</p>
          <h1>{t('media.creator.title')}</h1>
          <p>{t('media.creator.subtitle')}</p>
        </div>
      </header>
      {error && <div className="media-error" role="alert"><p>{error}</p><button type="button" onClick={load}>{t('media.feed.refresh')}</button></div>}
      {loading && <div className="media-skeleton" role="status"><div className="skeleton-line" /><div className="skeleton-line" /></div>}
      {!loading && !error && !gigs.length && <div className="media-empty"><CheckCircle2 size={26} aria-hidden="true" /><h2>{t('media.creator.empty')}</h2></div>}
      {!loading && !error && gigs.map((gig) => (
        <article className="media-card media-creator-gig" key={gig.id}>
          <div className="media-creator-gig-heading"><div><h2>{gig.title}</h2><p>{gig.owner_name || gig.owner_handle}</p></div><strong>{gig.budget_cents} {gig.currency_code}</strong></div>
          <p>{gig.brief}</p>
          {user && <button type="button" className="media-primary-button" onClick={() => { setSelected(gig); setPitch(''); setProposedCents(gig.budget_cents); setSubmitted(false); }}>{t('media.creator.apply')}</button>}
        </article>
      ))}
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
    </section>
  );
}
