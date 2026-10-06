import { useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { ArrowLeft, ArrowRight, FileText, ShieldCheck } from 'lucide-react';
import PageMeta from '../components/PageMeta';
import PageShell from '../components/PageShell';
import useAuth from '../hooks/useAuth';
import api from '../api/axios';

export default function NewWorkAgreementPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const { user } = useAuth();
  const jobId = params.get('jobId');

  const [job, setJob] = useState(null);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState('');
  const [warrantyMonths, setWarrantyMonths] = useState(6);
  const [warrantyTerms, setWarrantyTerms] = useState('');
  const [reimbursementTerms, setReimbursementTerms] = useState('');

  useEffect(() => {
    if (!jobId) { setLoading(false); return; }
    api.get(`/api/jobs/${jobId}`)
      .then((r) => setJob(r.data?.job || r.data))
      .catch(() => setError(t('workAgreement.jobLoadError', { defaultValue: 'Could not load the job.' })))
      .finally(() => setLoading(false));
  }, [jobId, t]);

  const create = async () => {
    setCreating(true);
    setError('');
    try {
      const { data } = await api.post('/api/work-agreements', {
        jobId,
        warrantyMonths: Number(warrantyMonths) || 6,
        warrantyTerms: warrantyTerms.trim() || undefined,
        reimbursementTerms: reimbursementTerms.trim() || undefined,
      });
      navigate(`/agreements/${data.id}`);
    } catch (e) {
      setError(e.response?.data?.error || t('workAgreement.createError', { defaultValue: 'Could not create the agreement.' }));
    } finally {
      setCreating(false);
    }
  };

  return (
    <PageShell>
      <PageMeta
        title={t('workAgreement.newTitle', { defaultValue: 'New Work Agreement | OxSteed' })}
        description={t('workAgreement.newDescription', { defaultValue: 'Create a bilateral work agreement with drawn signatures.' })}
        url="/agreements/new"
      />
      <main className="wa-new">
        <Link to={jobId ? `/jobs/${jobId}` : '/jobs'} className="wa-back">
          <ArrowLeft size={16} aria-hidden="true" />
          {t('workAgreement.backToJob', { defaultValue: 'Back to job' })}
        </Link>
        <h1>{t('workAgreement.newHeading', { defaultValue: 'New work agreement' })}</h1>
        <p className="wa-records-note">
          <ShieldCheck size={16} aria-hidden="true" />
          {t('workAgreement.recordsNote', { defaultValue: 'OxSteed keeps the records. You and the other party decide the terms.' })}
        </p>

        {loading && <p>{t('workAgreement.loading', { defaultValue: 'Loading…' })}</p>}
        {!loading && !jobId && (
          <p className="wa-error">{t('workAgreement.noJob', { defaultValue: 'An agreement starts from a job. Pick a job first.' })}</p>
        )}
        {!loading && job && (
          <section className="wa-card">
            <h2><FileText size={18} aria-hidden="true" /> {job.title || t('workAgreement.job', { defaultValue: 'Job' })}</h2>
            {job.description && <p className="wa-muted">{String(job.description).slice(0, 300)}</p>}

            <label className="wa-field">
              <span>{t('workAgreement.warrantyMonths', { defaultValue: 'Warranty (months)' })}</span>
              <input type="number" min="0" max="60" value={warrantyMonths}
                onChange={(e) => setWarrantyMonths(e.target.value)} />
            </label>
            <label className="wa-field">
              <span>{t('workAgreement.warrantyTermsLabel', { defaultValue: 'Warranty terms' })}</span>
              <textarea rows={3} value={warrantyTerms} onChange={(e) => setWarrantyTerms(e.target.value)}
                placeholder={t('workAgreement.warrantyTermsPh', { defaultValue: 'e.g. Six months on the repair. If the leak returns, the helper returns to fix it.' })} />
            </label>
            <label className="wa-field">
              <span>{t('workAgreement.reimbursementLabel', { defaultValue: 'Reimbursement terms' })}</span>
              <textarea rows={3} value={reimbursementTerms} onChange={(e) => setReimbursementTerms(e.target.value)}
                placeholder={t('workAgreement.reimbursementPh', { defaultValue: 'e.g. Damage caused by a failed repair is reimbursed up to the job price.' })} />
            </label>

            {error && <p className="wa-error" role="alert">{error}</p>}
            <button type="button" className="wa-primary" onClick={create} disabled={creating || !user}>
              {creating
                ? t('workAgreement.creating', { defaultValue: 'Creating…' })
                : t('workAgreement.createCta', { defaultValue: 'Create agreement' })}
              <ArrowRight size={16} aria-hidden="true" />
            </button>
            {!user && <p className="wa-muted">{t('workAgreement.signInRequired', { defaultValue: 'Sign in to create an agreement.' })}</p>}
          </section>
        )}
      </main>
    </PageShell>
  );
}
