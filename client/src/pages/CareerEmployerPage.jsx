import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import toast from 'react-hot-toast';
import { useTranslation } from 'react-i18next';
import PageMeta from '../components/PageMeta';
import PageShell from '../components/PageShell';
import { useAuth } from '../context/AuthContext';
import {
  answerEmployerQuestion, askEmployerQuestion, followCareerEmployer, getCareerEmployer, listEmployerQuestions, listEmployerReviews,
  listPublicCareerOpenings, reportEmployerReview, submitEmployerReview, submitEmployerSalary, unfollowCareerEmployer,
} from '../api/careers';
import { ActionButton, Empty, Field, Loading, LoadError, Notice, Tabs, useCareerErrors, useLoad } from '../components/careers/ui';
import OpeningCard from '../components/careers/OpeningCard';
import { ReportForm, StarInput, Stars } from '../components/careers/marketplace/shared';
import { REVIEW_CATEGORIES, REVIEW_REPORT_REASONS } from '../features/careers/marketplaceModel';
import { formatDate, PAY_PERIODS } from '../features/careers/careersModel';
import '../styles/CareerSystem.css';

function ReviewForm({ slug, onDone }) {
  const { t } = useTranslation();
  const errorText = useCareerErrors();
  const [f, setF] = useState({ overall: null, headline: '', pros: '', cons: '', job_title: '' });
  const [errors, setErrors] = useState({});
  const set = (k) => (v) => setF((x) => ({ ...x, [k]: v }));
  return (
    <form className="ox-careers-panel" onSubmit={async (e) => {
      e.preventDefault(); setErrors({});
      try {
        const r = await submitEmployerReview(slug, f);
        toast.success(r.review?.status === 'pending' ? t('careers.mk.reviews.pending') : t('careers.mk.reviews.thanks'));
        onDone();
      } catch (err) { setErrors(err?.response?.data?.fields || {}); toast.error(errorText(err)); }
    }} data-track="ui.20fe092b14.1"
    >
      <h3>{t('careers.mk.reviews.write')}</h3>
      <p className="ox-careers-subtle">{t('careers.mk.reviews.rules')}</p>
      <StarInput name="rv-overall" label={t('careers.mk.reviews.overall')} value={f.overall} onChange={set('overall')} required />
      {errors.overall ? <p className="ox-careers-error" role="alert">{errors.overall}</p> : null}
      {REVIEW_CATEGORIES.map((c) => <StarInput key={c} name={`rv-${c}`} label={t(`careers.mk.reviews.categories.${c}`)} value={f[c]} onChange={set(c)} />)}
      <Field label={t('careers.mk.reviews.jobTitle')} htmlFor="rv-title"><input id="rv-title" maxLength={120} value={f.job_title} onChange={(e) => set('job_title')(e.target.value)} /></Field>
      <Field label={`${t('careers.mk.reviews.headline')} *`} htmlFor="rv-headline" error={errors.headline}><input id="rv-headline" maxLength={140} value={f.headline} onChange={(e) => set('headline')(e.target.value)} /></Field>
      <Field label={t('careers.mk.reviews.pros')} htmlFor="rv-pros" error={errors.pros}><textarea id="rv-pros" rows={3} maxLength={2000} value={f.pros} onChange={(e) => set('pros')(e.target.value)} /></Field>
      <Field label={t('careers.mk.reviews.cons')} htmlFor="rv-cons"><textarea id="rv-cons" rows={3} maxLength={2000} value={f.cons} onChange={(e) => set('cons')(e.target.value)} /></Field>
      <button type="submit" className="ox-careers-btn primary" disabled={!f.overall} data-track="ui.20fe092b14.2">{t('careers.mk.reviews.submit')}</button>
    </form>
  );
}

function SalaryForm({ slug, onDone }) {
  const { t } = useTranslation();
  const errorText = useCareerErrors();
  const [f, setF] = useState({ job_title: '', pay_amount: '', pay_period: 'hourly', currency_code: 'USD' });
  const [errors, setErrors] = useState({});
  return (
    <form className="ox-careers-panel" onSubmit={async (e) => {
      e.preventDefault(); setErrors({});
      try { await submitEmployerSalary(slug, f); toast.success(t('careers.mk.salaries.thanks')); onDone(); } catch (err) { setErrors(err?.response?.data?.fields || {}); toast.error(errorText(err)); }
    }} data-track="ui.20fe092b14.3"
    >
      <h3>{t('careers.mk.salaries.share')}</h3>
      <p className="ox-careers-subtle">{t('careers.mk.salaries.shareHint')}</p>
      <div className="ox-careers-form-grid">
        <Field label={t('careers.mk.salaries.jobTitle')} htmlFor="sr-title" error={errors.job_title}><input id="sr-title" maxLength={120} value={f.job_title} onChange={(e) => setF((x) => ({ ...x, job_title: e.target.value }))} /></Field>
        <Field label={t('careers.mk.salaries.amount')} htmlFor="sr-amount" error={errors.pay_amount}><input id="sr-amount" type="number" min="0" step="0.01" inputMode="decimal" value={f.pay_amount} onChange={(e) => setF((x) => ({ ...x, pay_amount: e.target.value }))} /></Field>
        <Field label={t('careers.mk.search.payPeriod')} htmlFor="sr-period"><select id="sr-period" value={f.pay_period} onChange={(e) => setF((x) => ({ ...x, pay_period: e.target.value }))}>{PAY_PERIODS.map((p) => <option key={p} value={p}>{t(`careers.period.${p}`)}</option>)}</select></Field>
        <Field label={t('careers.mk.salaries.currency')} htmlFor="sr-cur" error={errors.currency_code}><input id="sr-cur" maxLength={3} dir="ltr" value={f.currency_code} onChange={(e) => setF((x) => ({ ...x, currency_code: e.target.value.toUpperCase() }))} /></Field>
      </div>
      <button type="submit" className="ox-careers-btn primary" data-track="ui.20fe092b14.4">{t('careers.mk.salaries.submit')}</button>
    </form>
  );
}

function Reviews({ slug, user }) {
  const { t, i18n } = useTranslation();
  const [sort, setSort] = useState('newest');
  const [writing, setWriting] = useState(false);
  const [reporting, setReporting] = useState(null);
  const data = useLoad(() => listEmployerReviews(slug, { sort }), [slug, sort]);
  const summary = data.data?.summary;
  return (
    <section className="ox-careers-section">
      {summary?.count ? (
        <div className="ox-careers-panel">
          <p><Stars value={summary.overall} /> · {t('careers.mk.reviews.count', { count: summary.count })}</p>
          <ul className="ox-careers-list">
            {REVIEW_CATEGORIES.map((c) => (summary.categories?.[c] != null ? <li key={c}>{t(`careers.mk.reviews.categories.${c}`)}: <Stars value={summary.categories[c]} /></li> : null))}
          </ul>
        </div>
      ) : null}
      <div className="ox-careers-actions">
        <select aria-label={t('careers.mk.search.sort')} value={sort} onChange={(e) => setSort(e.target.value)}>
          {['newest', 'highest', 'lowest'].map((s) => <option key={s} value={s}>{t(`careers.mk.reviews.sorts.${s}`)}</option>)}
        </select>
        {user ? <button type="button" className="ox-careers-btn" onClick={() => setWriting((v) => !v)} data-track="ui.20fe092b14.5">{t('careers.mk.reviews.write')}</button> : <Link className="ox-careers-btn" to={`/login?next=${encodeURIComponent(`/careers/employers/${slug}`)}`}>{t('careers.mk.reviews.write')}</Link>}
      </div>
      {writing ? <ReviewForm slug={slug} onDone={() => { setWriting(false); data.reload(); }} /> : null}
      {data.loading && !data.data ? <Loading /> : null}
      <LoadError error={data.error} onRetry={data.reload} />
      {data.data && !data.data.reviews.length ? <Empty>{t('careers.mk.reviews.none')}</Empty> : null}
      {(data.data?.reviews || []).map((r) => (
        <article key={r.id} className="ox-careers-panel">
          <p><Stars value={r.overall} /> · <strong>{r.headline}</strong></p>
          <p className="ox-careers-subtle">{t(`careers.mk.reviews.relationship.${r.relationship}`)}{r.job_title ? ` · ${r.job_title}` : ''} · {formatDate(r.created_at, i18n.language)}</p>
          {r.pros ? <p className="ox-careers-prose"><strong>{t('careers.mk.reviews.pros')}:</strong> {r.pros}</p> : null}
          {r.cons ? <p className="ox-careers-prose"><strong>{t('careers.mk.reviews.cons')}:</strong> {r.cons}</p> : null}
          {r.employer_response ? <Notice><strong>{t('careers.mk.reviews.employerResponse')}:</strong> {r.employer_response}</Notice> : null}
          {user ? <button type="button" className="ox-careers-link" onClick={() => setReporting(r.id)} data-track="ui.20fe092b14.6">{t('careers.mk.actions.report')}</button> : null}
          {reporting === r.id ? (
            <ReportForm idPrefix={`rv-${r.id}`} reasons={REVIEW_REPORT_REASONS} reasonKey="careers.mk.report.reviewReasons" onCancel={() => setReporting(null)} onSubmit={async ({ reason }) => { await reportEmployerReview(r.id, reason); setReporting(null); }} />
          ) : null}
        </article>
      ))}
    </section>
  );
}

function Questions({ slug, user }) {
  const { t } = useTranslation();
  const errorText = useCareerErrors();
  const data = useLoad(() => listEmployerQuestions(slug), [slug]);
  const [ask, setAsk] = useState('');
  const [answers, setAnswers] = useState({});
  return (
    <section className="ox-careers-section">
      <p className="ox-careers-subtle">{t('careers.mk.qa.hint')}</p>
      {user ? (
        <form className="ox-careers-panel" onSubmit={async (e) => {
          e.preventDefault();
          try { await askEmployerQuestion(slug, { body: ask }); setAsk(''); toast.success(t('careers.mk.qa.asked')); data.reload(); } catch (err) { toast.error(errorText(err)); }
        }} data-track="ui.20fe092b14.7"
        >
          <Field label={t('careers.mk.qa.ask')} htmlFor="qa-ask"><textarea id="qa-ask" rows={2} maxLength={500} value={ask} onChange={(e) => setAsk(e.target.value)} /></Field>
          <button type="submit" className="ox-careers-btn primary" disabled={ask.trim().length < 10} data-track="ui.20fe092b14.8">{t('careers.mk.qa.post')}</button>
        </form>
      ) : null}
      {data.data && !data.data.questions.length ? <Empty>{t('careers.mk.qa.none')}</Empty> : null}
      {(data.data?.questions || []).map((q) => (
        <article key={q.id} className="ox-careers-panel">
          <p><strong>{q.body}</strong></p>
          {q.answers.map((a) => <p key={a.id} className="ox-careers-prose">{a.as_employer ? <span className="ox-careers-chip ok">{t('careers.mk.qa.employer')}</span> : null} {a.body}</p>)}
          {user ? (
            <form onSubmit={async (e) => {
              e.preventDefault();
              try { await answerEmployerQuestion(slug, q.id, { body: answers[q.id] }); setAnswers((x) => ({ ...x, [q.id]: '' })); data.reload(); } catch (err) { toast.error(errorText(err)); }
            }} data-track="ui.20fe092b14.9"
            >
              <label className="ox-careers-field" htmlFor={`qa-${q.id}`}><span>{t('careers.mk.qa.answer')}</span>
                <textarea id={`qa-${q.id}`} rows={2} maxLength={1500} value={answers[q.id] || ''} onChange={(e) => setAnswers((x) => ({ ...x, [q.id]: e.target.value }))} />
              </label>
              <button type="submit" className="ox-careers-btn" disabled={!(answers[q.id] || '').trim()} data-track="ui.20fe092b14.10">{t('careers.mk.qa.reply')}</button>
            </form>
          ) : null}
        </article>
      ))}
    </section>
  );
}

/** Public employer page: about, jobs, reviews, Q&A and salaries. */
export default function CareerEmployerPage() {
  const { t, i18n } = useTranslation();
  const { slug } = useParams();
  const { user } = useAuth();
  const [tab, setTab] = useState('jobs');
  const [sharing, setSharing] = useState(false);
  const page = useLoad(() => getCareerEmployer(slug), [slug, user?.id]);
  const e = page.data?.employer;
  const jobs = useLoad(() => (e ? listPublicCareerOpenings(e.is_platform ? { employer: 'platform' } : { employer: 'business', business_id: e.id }) : Promise.resolve(null)), [e?.id, e?.is_platform]);
  if (page.loading && !page.data) return <PageShell><div className="ox-careers"><Loading /></div></PageShell>;
  if (page.error) {
    return (
      <PageShell><div className="ox-careers">
        {page.error?.response?.status === 404 ? <Notice>{t('careers.mk.employers.notFound')}</Notice> : <LoadError error={page.error} onRetry={page.reload} />}
      </div></PageShell>
    );
  }
  const key = e.is_platform ? { employer: 'platform' } : { business_id: e.id };
  const tabs = ['jobs', 'about', ...(e.is_platform ? [] : ['reviews', 'questions', 'salaries'])];
  return (
    <PageShell>
      <PageMeta title={t('careers.mk.employers.pageTitle', { name: e.name })} description={e.headline || t('careers.mk.employers.metaDesc')} />
      <div className="ox-careers">
        <Link className="ox-careers-btn" to="/careers/employers">{t('careers.mk.employers.back')}</Link>
        <div className="ox-careers-row">
          {e.logo_url ? <img className="ox-careers-logo" src={e.logo_url} alt="" width="64" height="64" /> : null}
          <div>
            <h1>{e.name}</h1>
            {e.headline ? <p className="ox-careers-lead">{e.headline}</p> : null}
          </div>
        </div>
        <div className="ox-careers-meta">
          {e.verified ? <span className="ox-careers-chip">{t('careers.verifiedEmployer')}</span> : null}
          {e.same_day_hiring ? <span className="ox-careers-chip ok">{t('careers.mk.badges.sameDay')}</span> : null}
          <span className="ox-careers-chip ok">{t('careers.mk.employers.openJobs', { count: e.open_jobs })}</span>
          <span className="ox-careers-chip">{t('careers.mk.employers.followers', { count: e.followers })}</span>
          {e.response_speed ? <span className="ox-careers-chip ok">{t('careers.mk.badges.responds', { count: e.response_speed.days })}</span> : null}
          {page.data.ratings?.count ? <span className="ox-careers-chip"><Stars value={page.data.ratings.overall} /></span> : null}
        </div>
        <div className="ox-careers-actions">
          {user ? (
            <ActionButton primary={!e.following} onClick={async () => { if (e.following) await unfollowCareerEmployer(key); else await followCareerEmployer(key); page.reload(); }}>
              {e.following ? t('careers.mk.actions.unfollow') : t('careers.mk.actions.follow')}
            </ActionButton>
          ) : <Link className="ox-careers-btn primary" to={`/login?next=${encodeURIComponent(`/careers/employers/${slug}`)}`}>{t('careers.mk.actions.follow')}</Link>}
          {!e.is_platform && user ? <button type="button" className="ox-careers-btn" onClick={() => setSharing((v) => !v)} data-track="ui.20fe092b14.11">{t('careers.mk.salaries.share')}</button> : null}
        </div>
        {sharing ? <SalaryForm slug={slug} onDone={() => { setSharing(false); page.reload(); }} /> : null}
        <Tabs label={e.name} active={tab} onChange={setTab} tabs={tabs.map((id) => ({ id, label: t(`careers.mk.employers.tabs.${id}`) }))} />
        {tab === 'jobs' ? (
          jobs.loading && !jobs.data ? <Loading /> : (jobs.data?.openings || []).length
            ? <div className="ox-careers-grid">{jobs.data.openings.map((o) => <OpeningCard key={o.id} opening={o} />)}</div>
            : <Empty>{t('careers.mk.employers.noJobs')}</Empty>
        ) : null}
        {tab === 'about' ? (
          <section className="ox-careers-section">
            {e.about ? <p className="ox-careers-prose">{e.about}</p> : <Empty>{t('careers.mk.employers.noAbout')}</Empty>}
            {e.why_join ? <><h2>{t('careers.mk.employers.whyJoin')}</h2><p className="ox-careers-prose">{e.why_join}</p></> : null}
            <ul className="ox-careers-list">
              {e.website ? <li><a href={e.website} rel="noopener noreferrer nofollow" target="_blank" dir="ltr" data-track="ui.20fe092b14.12">{e.website}</a></li> : null}
              {e.phone ? <li><a href={`tel:${e.phone}`} dir="ltr" data-track="ui.20fe092b14.13">{e.phone}</a></li> : null}
              {e.address ? <li>{e.address}</li> : null}
              {e.map ? <li><a href={`https://www.openstreetmap.org/?mlat=${e.map.lat}&mlon=${e.map.lng}#map=15/${e.map.lat}/${e.map.lng}`} rel="noopener noreferrer" target="_blank" data-track="ui.20fe092b14.14">{t('careers.mk.employers.viewMap')}</a></li> : null}
            </ul>
          </section>
        ) : null}
        {tab === 'reviews' ? <Reviews slug={slug} user={user} /> : null}
        {tab === 'questions' ? <Questions slug={slug} user={user} /> : null}
        {tab === 'salaries' ? (
          <section className="ox-careers-section">
            {(page.data.salaries || []).length ? (
              <table className="ox-careers-table">
                <thead><tr><th scope="col">{t('careers.mk.salaries.jobTitle')}</th><th scope="col">{t('careers.mk.salaries.p.median')}</th><th scope="col">{t('careers.mk.salaries.range')}</th></tr></thead>
                <tbody>
                  {page.data.salaries.map((s) => {
                    const fmt = (v) => new Intl.NumberFormat(i18n.language, { style: 'currency', currency: s.currency_code }).format(v);
                    return <tr key={`${s.title}-${s.currency_code}`}><th scope="row">{s.title}</th><td>{fmt(s.median)} {t('careers.period.hourly')}</td><td>{fmt(s.low)} – {fmt(s.high)}</td></tr>;
                  })}
                </tbody>
              </table>
            ) : <Empty>{t('careers.mk.salaries.noneHere')}</Empty>}
          </section>
        ) : null}
      </div>
    </PageShell>
  );
}
