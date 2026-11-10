import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import toast from 'react-hot-toast';
import { useTranslation } from 'react-i18next';
import { answerAsEmployer, getCompanyPage, listEmployerQuestions, listEmployerReviews, respondToEmployerReview, updateCompanyPage } from '../../../api/careers';
import { Check, Empty, Field, Loading, LoadError, useCareerErrors, useLoad } from '../ui';
import { Stars } from './shared';

/** The business's public careers page: about text, contact choices, and replies to reviews and questions. */
export default function CompanyPagePanel({ ctx }) {
  const { t } = useTranslation();
  const errorText = useCareerErrors();
  const profile = useLoad(() => getCompanyPage(ctx.businessId), [ctx.businessId]);
  const [f, setF] = useState(null);
  const slug = profile.data?.slug || `b-${ctx.businessId}`;
  const reviews = useLoad(() => listEmployerReviews(slug).catch(() => null), [slug]);
  const questions = useLoad(() => listEmployerQuestions(slug).catch(() => null), [slug]);
  const [replies, setReplies] = useState({});
  useEffect(() => { if (profile.data) setF(profile.data); }, [profile.data]);
  if (profile.loading && !profile.data) return <Loading />;
  if (profile.error) return <LoadError error={profile.error} onRetry={profile.reload} />;
  if (!f) return null;
  const reply = async (kind, id) => {
    try {
      if (kind === 'review') await respondToEmployerReview(ctx.businessId, id, replies[`r${id}`]);
      else await answerAsEmployer(ctx.businessId, id, replies[`q${id}`]);
      toast.success(t('careers.mk.company.replied'));
      setReplies((r) => ({ ...r, [`${kind === 'review' ? 'r' : 'q'}${id}`]: '' }));
      if (kind === 'review') reviews.reload(); else questions.reload();
    } catch (err) { toast.error(errorText(err)); }
  };
  return (
    <div className="ox-careers-grid">
      <form className="ox-careers-panel" onSubmit={async (e) => {
        e.preventDefault();
        try { profile.setData(await updateCompanyPage(ctx.businessId, { about: f.about, why_join: f.why_join, show_phone: f.show_phone, show_map: f.show_map, same_day_hiring: f.same_day_hiring })); toast.success(t('careers.mk.settings.saved')); } catch (err) { toast.error(errorText(err)); }
      }} data-track="ui.09feefa35a.1"
      >
        <div className="ox-careers-row">
          <h3>{t('careers.mk.company.title')}</h3>
          <Link className="ox-careers-btn" to={`/careers/employers/${encodeURIComponent(slug)}`}>{t('careers.mk.company.view')}</Link>
        </div>
        <Field label={t('careers.mk.company.about')} htmlFor="cp-about"><textarea id="cp-about" rows={5} maxLength={4000} value={f.about || ''} onChange={(e) => setF((x) => ({ ...x, about: e.target.value }))} /></Field>
        <Field label={t('careers.mk.employers.whyJoin')} htmlFor="cp-why"><textarea id="cp-why" rows={4} maxLength={4000} value={f.why_join || ''} onChange={(e) => setF((x) => ({ ...x, why_join: e.target.value }))} /></Field>
        <Check id="cp-phone" label={t('careers.mk.company.showPhone')} checked={f.show_phone} onChange={(v) => setF((x) => ({ ...x, show_phone: v }))} />
        <Check id="cp-map" label={t('careers.mk.company.showMap')} checked={f.show_map} onChange={(v) => setF((x) => ({ ...x, show_map: v }))} />
        <Check id="cp-sameday" label={t('careers.mk.company.sameDay')} checked={f.same_day_hiring} onChange={(v) => setF((x) => ({ ...x, same_day_hiring: v }))} />
        <button type="submit" className="ox-careers-btn primary" data-track="ui.09feefa35a.2">{t('careers.mk.common.save')}</button>
      </form>
      <section className="ox-careers-section">
        <h3>{t('careers.mk.employers.tabs.reviews')}</h3>
        {reviews.data && !reviews.data.reviews.length ? <Empty>{t('careers.mk.reviews.none')}</Empty> : null}
        {(reviews.data?.reviews || []).map((r) => (
          <article key={r.id} className="ox-careers-app">
            <p><Stars value={r.overall} /> · <strong>{r.headline}</strong></p>
            {r.employer_response ? <p className="ox-careers-subtle">{t('careers.mk.reviews.employerResponse')}: {r.employer_response}</p> : (
              <div>
                <label className="ox-careers-field" htmlFor={`cp-r-${r.id}`}><span>{t('careers.mk.company.respond')}</span>
                  <textarea id={`cp-r-${r.id}`} rows={2} maxLength={2000} value={replies[`r${r.id}`] || ''} onChange={(e) => setReplies((x) => ({ ...x, [`r${r.id}`]: e.target.value }))} />
                </label>
                <button type="button" className="ox-careers-btn" disabled={!(replies[`r${r.id}`] || '').trim()} onClick={() => reply('review', r.id)} data-track="ui.09feefa35a.3">{t('careers.mk.qa.reply')}</button>
              </div>
            )}
          </article>
        ))}
      </section>
      <section className="ox-careers-section">
        <h3>{t('careers.mk.employers.tabs.questions')}</h3>
        {questions.data && !questions.data.questions.length ? <Empty>{t('careers.mk.qa.none')}</Empty> : null}
        {(questions.data?.questions || []).map((q) => (
          <article key={q.id} className="ox-careers-app">
            <p><strong>{q.body}</strong></p>
            {q.answers.filter((a) => a.as_employer).map((a) => <p key={a.id} className="ox-careers-subtle">{a.body}</p>)}
            <label className="ox-careers-field" htmlFor={`cp-q-${q.id}`}><span>{t('careers.mk.qa.answer')}</span>
              <textarea id={`cp-q-${q.id}`} rows={2} maxLength={1500} value={replies[`q${q.id}`] || ''} onChange={(e) => setReplies((x) => ({ ...x, [`q${q.id}`]: e.target.value }))} />
            </label>
            <button type="button" className="ox-careers-btn" disabled={!(replies[`q${q.id}`] || '').trim()} onClick={() => reply('question', q.id)} data-track="ui.09feefa35a.4">{t('careers.mk.qa.reply')}</button>
          </article>
        ))}
      </section>
    </div>
  );
}
