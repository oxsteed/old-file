import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import toast from 'react-hot-toast';
import CountrySelect from '../CountrySelect';
import {
  changeCareerStage,
  createCareerOffer,
  createCareerOpening,
  listCareerApplications,
  listEmployerCareerOpenings,
  scheduleCareerInterview,
  updateCareerOpening,
} from '../../api/careers';
import '../../styles/CareerSystem.css';

const EMPTY_FORM = {
  title: '',
  department: 'operations',
  employment_type: 'full_time',
  workplace_type: 'hybrid',
  country_code: '',
  region: '',
  city: '',
  timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
  currency_code: 'USD',
  compensation_min: '',
  compensation_max: '',
  compensation_period: 'yearly',
  work_authorization: 'local_authorized',
  languages: 'en',
  description: '',
  requirements: '',
  benefits: '',
  team_role: 'employee',
  status: 'open',
};

const ACTIVE_STAGES = ['received', 'screening', 'interview', 'assessment', 'offer'];

export default function HiringPipelineBoard({ employerType = 'business', businessId = null }) {
  const { t } = useTranslation();
  const [catalog, setCatalog] = useState(null);
  const [openings, setOpenings] = useState([]);
  const [selectedId, setSelectedId] = useState(null);
  const [applications, setApplications] = useState([]);
  const [form, setForm] = useState(EMPTY_FORM);
  const [editingId, setEditingId] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const loadOpenings = useCallback(async () => {
    setLoading(true);
    try {
      const data = await listEmployerCareerOpenings(
        employerType === 'business' ? { business_id: businessId } : {}
      );
      setOpenings(data.openings || []);
      setCatalog(data.catalog || null);
      setSelectedId((current) => {
        if (current && (data.openings || []).some((row) => String(row.id) === String(current))) return current;
        return data.openings?.[0]?.id || null;
      });
    } catch (err) {
      toast.error(err?.response?.data?.error || t('careers.employer.loadError'));
    } finally {
      setLoading(false);
    }
  }, [businessId, employerType, t]);

  useEffect(() => { loadOpenings(); }, [loadOpenings]);

  const loadApps = useCallback(async () => {
    if (!selectedId) {
      setApplications([]);
      return;
    }
    try {
      const data = await listCareerApplications(selectedId);
      setApplications(data.applications || []);
    } catch (err) {
      toast.error(err?.response?.data?.error || t('careers.employer.loadError'));
    }
  }, [selectedId, t]);

  useEffect(() => { loadApps(); }, [loadApps]);

  const selected = useMemo(
    () => openings.find((row) => String(row.id) === String(selectedId)) || null,
    [openings, selectedId]
  );

  function patchForm(key, value) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  function startEdit(row) {
    setEditingId(row.id);
    setForm({
      ...EMPTY_FORM,
      ...row,
      languages: Array.isArray(row.languages) ? row.languages.join(', ') : (row.languages || 'en'),
      compensation_min: row.compensation_min ?? '',
      compensation_max: row.compensation_max ?? '',
      country_code: row.country_code || '',
    });
  }

  async function saveOpening(event) {
    event.preventDefault();
    setSaving(true);
    try {
      const payload = {
        ...form,
        employer_type: employerType,
        business_id: businessId,
        languages: String(form.languages || 'en').split(',').map((item) => item.trim()).filter(Boolean),
      };
      if (editingId) await updateCareerOpening(editingId, payload);
      else await createCareerOpening(payload);
      toast.success(t('careers.employer.saved'));
      setEditingId(null);
      setForm(EMPTY_FORM);
      await loadOpenings();
    } catch (err) {
      toast.error(err?.response?.data?.error || t('careers.employer.saveError'));
    } finally {
      setSaving(false);
    }
  }

  async function moveStage(application, stage) {
    try {
      await changeCareerStage(application.id, { stage, close_opening: stage === 'hired' });
      toast.success(t('careers.employer.stageUpdated'));
      await loadApps();
      if (stage === 'hired') await loadOpenings();
    } catch (err) {
      toast.error(err?.response?.data?.error || t('careers.employer.stageError'));
    }
  }

  async function bookInterview(application) {
    const when = window.prompt(t('careers.employer.interviewWhen'));
    if (!when) return;
    try {
      await scheduleCareerInterview(application.id, {
        scheduled_at: new Date(when).toISOString(),
        timezone: form.timezone || 'UTC',
        mode: 'video',
      });
      toast.success(t('careers.employer.interviewBooked'));
      await loadApps();
    } catch (err) {
      toast.error(err?.response?.data?.error || t('careers.employer.saveError'));
    }
  }

  async function sendOffer(application) {
    try {
      await createCareerOffer(application.id, {
        title: selected?.title,
        currency_code: selected?.currency_code || 'USD',
        team_role: selected?.team_role || 'employee',
      });
      toast.success(t('careers.employer.offerCreated'));
      await loadApps();
    } catch (err) {
      toast.error(err?.response?.data?.error || t('careers.employer.saveError'));
    }
  }

  const grouped = ACTIVE_STAGES.map((stage) => ({
    stage,
    items: applications.filter((row) => row.stage === stage),
  }));

  return (
    <div className="ox-careers" style={{ padding: 0 }}>
      <p className="ox-careers-kicker">{t('careers.employer.kicker')}</p>
      <h2>{t('careers.employer.title')}</h2>
      <p className="ox-careers-lead">
        {employerType === 'platform' ? t('careers.employer.platformHelp') : t('careers.employer.businessHelp')}
      </p>

      <form className="ox-careers-panel" onSubmit={saveOpening}>
        <h3>{editingId ? t('careers.employer.editRole') : t('careers.employer.newRole')}</h3>
        <div className="ox-careers-form-grid">
          <div>
            <label>{t('careers.fields.title')}</label>
            <input value={form.title} onChange={(e) => patchForm('title', e.target.value)} required />
          </div>
          <div>
            <label>{t('careers.fields.department')}</label>
            <select value={form.department} onChange={(e) => patchForm('department', e.target.value)}>
              {(catalog?.departments || ['operations']).map((item) => (
                <option key={item} value={item}>{t(`careers.departments.${item}`, item)}</option>
              ))}
            </select>
          </div>
          <div>
            <label>{t('careers.fields.employment')}</label>
            <select value={form.employment_type} onChange={(e) => patchForm('employment_type', e.target.value)}>
              {(catalog?.employmentTypes || ['full_time']).map((item) => (
                <option key={item} value={item}>{t(`careers.employment.${item}`)}</option>
              ))}
            </select>
          </div>
          <div>
            <label>{t('careers.fields.workplace')}</label>
            <select value={form.workplace_type} onChange={(e) => patchForm('workplace_type', e.target.value)}>
              {(catalog?.workplaceTypes || ['hybrid']).map((item) => (
                <option key={item} value={item}>{t(`careers.workplace.${item}`)}</option>
              ))}
            </select>
          </div>
          <div>
            <label>{t('careers.fields.country')}</label>
            <CountrySelect value={form.country_code} onChange={(code) => patchForm('country_code', code)} />
          </div>
          <div>
            <label>{t('careers.fields.city')}</label>
            <input value={form.city} onChange={(e) => patchForm('city', e.target.value)} />
          </div>
          <div>
            <label>{t('careers.fields.timezone')}</label>
            <input value={form.timezone} onChange={(e) => patchForm('timezone', e.target.value)} />
          </div>
          <div>
            <label>{t('careers.fields.currency')}</label>
            <input value={form.currency_code} onChange={(e) => patchForm('currency_code', e.target.value.toUpperCase())} maxLength={3} />
          </div>
          <div>
            <label>{t('careers.fields.payMin')}</label>
            <input type="number" min="0" value={form.compensation_min} onChange={(e) => patchForm('compensation_min', e.target.value)} />
          </div>
          <div>
            <label>{t('careers.fields.payMax')}</label>
            <input type="number" min="0" value={form.compensation_max} onChange={(e) => patchForm('compensation_max', e.target.value)} />
          </div>
          <div>
            <label>{t('careers.fields.authorization')}</label>
            <select value={form.work_authorization} onChange={(e) => patchForm('work_authorization', e.target.value)}>
              {(catalog?.workAuthorization || []).map((item) => (
                <option key={item} value={item}>{t(`careers.authorization.${item}`)}</option>
              ))}
            </select>
          </div>
          <div>
            <label>{t('careers.fields.languages')}</label>
            <input value={form.languages} onChange={(e) => patchForm('languages', e.target.value)} placeholder="en, es, ht" />
          </div>
          {employerType === 'business' && (
            <div>
              <label>{t('careers.fields.teamRole')}</label>
              <select value={form.team_role} onChange={(e) => patchForm('team_role', e.target.value)}>
                {(catalog?.teamRoles || ['employee']).map((item) => (
                  <option key={item} value={item}>{t(`careers.teamRoles.${item}`)}</option>
                ))}
              </select>
            </div>
          )}
          <div>
            <label>{t('careers.fields.status')}</label>
            <select value={form.status} onChange={(e) => patchForm('status', e.target.value)}>
              {(catalog?.openingStatuses || ['open']).map((item) => (
                <option key={item} value={item}>{t(`careers.openingStatus.${item}`)}</option>
              ))}
            </select>
          </div>
        </div>
        <div style={{ marginTop: '0.8rem' }}>
          <label>{t('careers.fields.description')}</label>
          <textarea rows={4} value={form.description} onChange={(e) => patchForm('description', e.target.value)} />
        </div>
        <div className="ox-careers-form-grid" style={{ marginTop: '0.8rem' }}>
          <div>
            <label>{t('careers.fields.requirements')}</label>
            <textarea rows={3} value={form.requirements} onChange={(e) => patchForm('requirements', e.target.value)} />
          </div>
          <div>
            <label>{t('careers.fields.benefits')}</label>
            <textarea rows={3} value={form.benefits} onChange={(e) => patchForm('benefits', e.target.value)} />
          </div>
        </div>
        <div className="ox-careers-actions">
          <button className="ox-careers-btn primary" type="submit" disabled={saving}>
            {saving ? t('careers.employer.saving') : t('careers.employer.saveRole')}
          </button>
          {editingId && (
            <button type="button" className="ox-careers-btn" onClick={() => { setEditingId(null); setForm(EMPTY_FORM); }}>
              {t('careers.employer.cancelEdit')}
            </button>
          )}
        </div>
      </form>

      {loading ? <p>{t('careers.loading')}</p> : (
        <div className="ox-careers-grid" style={{ marginTop: '1.25rem' }}>
          {openings.map((row) => (
            <button
              type="button"
              key={row.id}
              className="ox-careers-card"
              onClick={() => setSelectedId(row.id)}
              style={{ textAlign: 'left', cursor: 'pointer', outline: String(row.id) === String(selectedId) ? '2px solid #ea580c' : 'none' }}
            >
              <strong>{row.title}</strong>
              <div className="ox-careers-meta">
                <span className="ox-careers-chip">{t(`careers.openingStatus.${row.status}`)}</span>
                <span className="ox-careers-chip">{t(`careers.workplace.${row.workplace_type}`)}</span>
                <span className="ox-careers-chip">{row.new_count || 0} {t('careers.employer.newApplicants')}</span>
              </div>
              <div className="ox-careers-actions">
                <span className="ox-careers-btn" onClick={(e) => { e.stopPropagation(); startEdit(row); }}>{t('careers.employer.editRole')}</span>
              </div>
            </button>
          ))}
        </div>
      )}

      {selected && (
        <section style={{ marginTop: '1.5rem' }}>
          <h3>{t('careers.employer.pipelineFor', { title: selected.title })}</h3>
          <div className="ox-careers-kanban">
            {grouped.map((column) => (
              <div key={column.stage} className="ox-careers-panel ox-careers-column">
                <h3>{t(`careers.stage.${column.stage}`)} ({column.items.length})</h3>
                {column.items.map((app) => (
                  <div key={app.id} className="ox-careers-app">
                    <strong>{app.first_name} {app.last_name}</strong>
                    <p>{app.applicant_email}</p>
                    <p>{[app.city, app.country_code].filter(Boolean).join(', ') || t('careers.remoteWorldwide')}</p>
                    <p>{t(`careers.authorization.${app.work_authorization_status}`)}</p>
                    <div className="ox-careers-actions">
                      {column.stage === 'received' && <button type="button" className="ox-careers-btn" onClick={() => moveStage(app, 'screening')}>{t('careers.stage.screening')}</button>}
                      {column.stage === 'screening' && <button type="button" className="ox-careers-btn" onClick={() => moveStage(app, 'interview')}>{t('careers.stage.interview')}</button>}
                      {column.stage === 'interview' && <button type="button" className="ox-careers-btn" onClick={() => moveStage(app, 'assessment')}>{t('careers.stage.assessment')}</button>}
                      {['received', 'screening'].includes(column.stage) && <button type="button" className="ox-careers-btn" onClick={() => bookInterview(app)}>{t('careers.employer.interview')}</button>}
                      {['interview', 'assessment'].includes(column.stage) && <button type="button" className="ox-careers-btn" onClick={() => sendOffer(app)}>{t('careers.employer.offer')}</button>}
                      {column.stage === 'offer' && <button type="button" className="ox-careers-btn primary" onClick={() => moveStage(app, 'hired')}>{t('careers.employer.hire')}</button>}
                      <button type="button" className="ox-careers-btn" onClick={() => moveStage(app, 'rejected')}>{t('careers.stage.rejected')}</button>
                    </div>
                  </div>
                ))}
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
