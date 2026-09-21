import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import toast from 'react-hot-toast';
import PageMeta from '../components/PageMeta';
import PageShell from '../components/PageShell';
import CountrySelect from '../components/CountrySelect';
import { useAuth } from '../context/AuthContext';
import { applyToCareerOpening, getPublicCareerOpening } from '../api/careers';
import '../styles/CareerSystem.css';

export default function CareerOpeningPage() {
  const { t } = useTranslation();
  const { id } = useParams();
  const { user } = useAuth();
  const [opening, setOpening] = useState(null);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    first_name: user?.first_name || '',
    last_name: user?.last_name || '',
    email: user?.email || '',
    phone: '',
    country_code: user?.country || '',
    city: '',
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || '',
    resume_url: '',
    cover_letter: '',
    work_authorization_status: 'local_authorized',
    willing_to_relocate: false,
    languages: 'en',
  });

  useEffect(() => {
    getPublicCareerOpening(id)
      .then(setOpening)
      .catch(() => setError(t('careers.opening.notFound')));
  }, [id, t]);

  async function submit(event) {
    event.preventDefault();
    setSaving(true);
    try {
      await applyToCareerOpening(id, {
        ...form,
        languages: String(form.languages).split(',').map((item) => item.trim()).filter(Boolean),
      });
      toast.success(t('careers.apply.submitted'));
      setForm((prev) => ({ ...prev, cover_letter: '' }));
    } catch (err) {
      toast.error(err?.response?.data?.error || t('careers.apply.error'));
    } finally {
      setSaving(false);
    }
  }

  return (
    <PageShell>
      <PageMeta title={opening?.title || t('careers.metaTitle')} description={t('careers.metaDesc')} />
      <div className="ox-careers">
        <Link to="/careers">{t('careers.back')}</Link>
        {error && <p className="ox-careers-error">{error}</p>}
        {opening && (
          <>
            <p className="ox-careers-kicker">{opening.employer_name}</p>
            <h1>{opening.title}</h1>
            <div className="ox-careers-meta">
              <span className="ox-careers-chip">{t(`careers.workplace.${opening.workplace_type}`)}</span>
              <span className="ox-careers-chip">{t(`careers.employment.${opening.employment_type}`)}</span>
              <span className="ox-careers-chip">{t(`careers.authorization.${opening.work_authorization}`)}</span>
              <span className="ox-careers-chip">{opening.city || opening.country_code || t('careers.remoteWorldwide')}</span>
              {(opening.compensation_min || opening.compensation_max) && (
                <span className="ox-careers-chip">
                  {opening.currency_code} {opening.compensation_min || '—'}
                  {opening.compensation_max ? `–${opening.compensation_max}` : ''}
                  {' '}{t(`careers.period.${opening.compensation_period}`)}
                </span>
              )}
            </div>
            <div className="ox-careers-panel">
              <h2>{t('careers.fields.description')}</h2>
              <p className="ox-careers-prose">{opening.description || t('careers.opening.noDescription')}</p>
            </div>
            {opening.requirements && (
              <div className="ox-careers-panel" style={{ marginTop: '1rem' }}>
                <h2>{t('careers.fields.requirements')}</h2>
                <p className="ox-careers-prose">{opening.requirements}</p>
              </div>
            )}
            {opening.benefits && (
              <div className="ox-careers-panel" style={{ marginTop: '1rem' }}>
                <h2>{t('careers.fields.benefits')}</h2>
                <p className="ox-careers-prose">{opening.benefits}</p>
              </div>
            )}
            <form className="ox-careers-panel" style={{ marginTop: '1.25rem' }} onSubmit={submit}>
              <h2>{t('careers.apply.title')}</h2>
              <p className="ox-careers-lead">{t('careers.apply.eeo')}</p>
              <div className="ox-careers-form-grid">
                <div>
                  <label>{t('careers.fields.firstName')}</label>
                  <input value={form.first_name} onChange={(e) => setForm((p) => ({ ...p, first_name: e.target.value }))} required />
                </div>
                <div>
                  <label>{t('careers.fields.lastName')}</label>
                  <input value={form.last_name} onChange={(e) => setForm((p) => ({ ...p, last_name: e.target.value }))} required />
                </div>
                <div>
                  <label>{t('careers.fields.email')}</label>
                  <input type="email" value={form.email} onChange={(e) => setForm((p) => ({ ...p, email: e.target.value }))} required />
                </div>
                <div>
                  <label>{t('careers.fields.phone')}</label>
                  <input value={form.phone} onChange={(e) => setForm((p) => ({ ...p, phone: e.target.value }))} />
                </div>
                <div>
                  <label>{t('careers.fields.country')}</label>
                  <CountrySelect value={form.country_code} onChange={(country_code) => setForm((p) => ({ ...p, country_code }))} />
                </div>
                <div>
                  <label>{t('careers.fields.city')}</label>
                  <input value={form.city} onChange={(e) => setForm((p) => ({ ...p, city: e.target.value }))} />
                </div>
                <div>
                  <label>{t('careers.fields.timezone')}</label>
                  <input value={form.timezone} onChange={(e) => setForm((p) => ({ ...p, timezone: e.target.value }))} />
                </div>
                <div>
                  <label>{t('careers.fields.languages')}</label>
                  <input value={form.languages} onChange={(e) => setForm((p) => ({ ...p, languages: e.target.value }))} placeholder="en, es, ht" />
                </div>
                <div>
                  <label>{t('careers.fields.authorization')}</label>
                  <select value={form.work_authorization_status} onChange={(e) => setForm((p) => ({ ...p, work_authorization_status: e.target.value }))}>
                    <option value="local_authorized">{t('careers.authorization.local_authorized')}</option>
                    <option value="visa_sponsorship">{t('careers.authorization.visa_sponsorship')}</option>
                    <option value="any">{t('careers.authorization.any')}</option>
                  </select>
                </div>
                <div>
                  <label>{t('careers.fields.resumeUrl')}</label>
                  <input value={form.resume_url} onChange={(e) => setForm((p) => ({ ...p, resume_url: e.target.value }))} placeholder="https://" />
                </div>
              </div>
              <div style={{ marginTop: '0.8rem' }}>
                <label>{t('careers.fields.coverLetter')}</label>
                <textarea rows={5} value={form.cover_letter} onChange={(e) => setForm((p) => ({ ...p, cover_letter: e.target.value }))} required />
              </div>
              <label style={{ marginTop: '0.8rem' }}>
                <input type="checkbox" checked={form.willing_to_relocate} onChange={(e) => setForm((p) => ({ ...p, willing_to_relocate: e.target.checked }))} />
                {' '}{t('careers.fields.relocate')}
              </label>
              <div className="ox-careers-actions">
                <button className="ox-careers-btn primary" type="submit" disabled={saving}>
                  {saving ? t('careers.apply.sending') : t('careers.apply.submit')}
                </button>
                {user && <Link className="ox-careers-btn" to="/careers/me">{t('careers.myApplications')}</Link>}
              </div>
            </form>
          </>
        )}
      </div>
    </PageShell>
  );
}
