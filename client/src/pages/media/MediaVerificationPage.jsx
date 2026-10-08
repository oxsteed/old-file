import React, { useEffect, useMemo, useState } from 'react';
import { CheckCircle2, FileCheck2, ShieldCheck, Store, Utensils, UserRound } from 'lucide-react';
import { Link, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { getMediaVerification, submitMediaVerification } from '../../api/media';
import PageMeta from '../../components/PageMeta';
import { useAuth } from '../../context/AuthContext';

function statusKey(entity) {
  if (entity.is_verified) return 'approved';
  return entity.request_status || 'unavailable';
}

function safeReturnTo(value) {
  return typeof value === 'string' && value.startsWith('/') && !value.startsWith('//')
    ? value
    : '/media/verification';
}

export default function MediaVerificationPage() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const [params] = useSearchParams();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [formEntity, setFormEntity] = useState(null);
  const [notes, setNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState('');

  const returnTo = safeReturnTo(params.get('returnTo'));
  const diditHref = `/verify-identity?returnTo=${encodeURIComponent(returnTo)}`;
  const displayName = user?.display_name || user?.name || user?.email || '';

  const load = () => {
    setLoading(true);
    setLoadError('');
    getMediaVerification()
      .then(setData)
      .catch((err) => setLoadError(err.response?.data?.error || t('media.verification.loadError')))
      .finally(() => setLoading(false));
  };

  useEffect(() => { load(); }, []);

  const entityGroups = useMemo(() => ([
    { key: 'businesses', title: t('media.verification.businessesTitle'), icon: Store, empty: 'noBusiness', setup: '/business-hub' },
    { key: 'restaurants', title: t('media.verification.restaurantsTitle'), icon: Utensils, empty: 'noRestaurant', setup: '/restaurants/merchant' },
  ]), [t]);

  const beginRequest = (entity) => {
    setFormEntity(entity);
    setNotes(entity.request_details?.notes || '');
    setSubmitError('');
  };

  const submit = async (event) => {
    event.preventDefault();
    if (!formEntity) return;
    setSubmitting(true);
    setSubmitError('');
    try {
      await submitMediaVerification({
        entity_type: formEntity.entity_type,
        entity_id: formEntity.id,
        details: { notes },
      });
      setFormEntity(null);
      setNotes('');
      load();
    } catch (err) {
      setSubmitError(err.response?.data?.error || t('media.verification.requestError'));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="media-verification">
      <PageMeta title={t('media.verification.metaTitle')} description={t('media.verification.metaDescription')} noIndex />
      <header className="media-verification-header">
        <div>
          <p className="media-page-kicker"><ShieldCheck size={15} aria-hidden="true" />{t('media.verification.kicker')}</p>
          <h1>{t('media.verification.title')}</h1>
          <p>{t('media.verification.subtitle', { name: displayName })}</p>
        </div>
        <FileCheck2 size={34} aria-hidden="true" />
      </header>

      {loadError && <div className="media-error" role="alert"><p>{loadError}</p><button type="button" onClick={load}>{t('media.feed.refresh')}</button></div>}
      {loading && <div className="media-verification-loading" role="status">{t('media.verification.loading')}</div>}
      {!loading && data && (
        <>
          <section className="media-verification-card media-verification-helper">
            <div className="media-verification-card-icon"><UserRound size={22} aria-hidden="true" /></div>
            <div className="media-verification-card-copy">
              <h2>{t('media.verification.helperTitle')}</h2>
              <p>{t('media.verification.helperDescription')}</p>
              <span className={`media-verification-status ${data.helper?.is_verified ? 'approved' : ''}`}>
                {data.helper?.is_verified ? <CheckCircle2 size={15} aria-hidden="true" /> : null}
                {t(`media.verification.status.${data.helper?.is_verified ? 'approved' : data.helper?.didit_status || 'pending'}`, { defaultValue: data.helper?.didit_status || 'pending' })}
              </span>
            </div>
            {!data.helper?.is_verified && <Link className="media-primary-button" to={diditHref}>{t('media.verification.verifyIdentity')}</Link>}
          </section>

          <div className="media-verification-groups">
            {entityGroups.map(({ key, title, icon: Icon, empty, setup }) => (
              <section className="media-verification-section" key={key}>
                <div className="media-verification-section-heading"><div><h2>{title}</h2><p>{t(`media.verification.${key}Description`)}</p></div></div>
                {data[key]?.length ? data[key].map((entity) => {
                  const item = { ...entity, entity_type: key === 'businesses' ? 'business' : 'restaurant' };
                  const status = statusKey(item);
                  return (
                    <article className="media-verification-card" key={`${item.entity_type}-${item.id}`}>
                      <div className="media-verification-card-icon"><Icon size={22} aria-hidden="true" /></div>
                      <div className="media-verification-card-copy">
                        <h3>{item.business_name || item.display_name}</h3>
                        <span className={`media-verification-status ${status === 'approved' ? 'approved' : ''}`}>{t(`media.verification.status.${status}`, { defaultValue: status })}</span>
                        {item.reviewer_note && <p className="media-verification-review-note">{item.reviewer_note}</p>}
                      </div>
                      {(status === 'needs_changes' || status === 'rejected' || status === 'unavailable') && <button type="button" className="media-secondary-button" onClick={() => beginRequest(item)}>{status === 'needs_changes' ? t('media.verification.resubmit') : t('media.verification.request')}</button>}
                    </article>
                  );
                }) : (
                  <div className="media-verification-empty"><p>{t(`media.verification.${empty}`)}</p><Link className="media-text-link" to={setup}>{t(`media.verification.${key === 'businesses' ? 'openBusinessHub' : 'openRestaurantSetup'}`)}</Link></div>
                )}
              </section>
            ))}
          </div>
        </>
      )}

      {formEntity && (
        <div className="media-verification-dialog" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setFormEntity(null); }}>
          <form className="media-verification-form" onSubmit={submit} role="dialog" aria-modal="true" aria-labelledby="media-verification-form-title">
            <h2 id="media-verification-form-title">{t('media.verification.requestTitle')}</h2>
            <p>{t('media.verification.requestDescription', { name: formEntity.business_name || formEntity.display_name })}</p>
            <label htmlFor="media-verification-notes">{t('media.verification.notesLabel')}</label>
            <textarea id="media-verification-notes" value={notes} onChange={(event) => setNotes(event.target.value)} maxLength={4000} rows={5} placeholder={t('media.verification.notesPlaceholder')} />
            {submitError && <p className="media-verification-form-error" role="alert">{submitError}</p>}
            <div className="media-verification-form-actions"><button type="button" className="media-secondary-button" onClick={() => setFormEntity(null)}>{t('media.shell.close')}</button><button type="submit" className="media-primary-button" disabled={submitting}>{submitting ? t('media.verification.submitting') : t('media.verification.submit')}</button></div>
          </form>
        </div>
      )}
    </div>
  );
}
