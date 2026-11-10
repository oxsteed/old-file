import { useState } from 'react';
import toast from 'react-hot-toast';
import { useTranslation } from 'react-i18next';
import {
  addProfileEntry, deleteProfileEntry, downloadResumePdf, getStructuredProfile, importParsedResume, parseCareerResume, updateProfileEntry,
} from '../../../api/careers';
import { ActionButton, Check, Empty, Field, Loading, LoadError, Notice, useCareerErrors, useLoad } from '../ui';
import { saveBlob } from './shared';

const FIELDS = {
  work: [
    ['employer_name', 'text', true], ['title', 'text', true], ['city', 'text'], ['start_month', 'month', true], ['end_month', 'month'], ['is_current', 'check'], ['description', 'textarea'],
  ],
  education: [['school', 'text', true], ['credential', 'text'], ['field_of_study', 'text'], ['start_year', 'year'], ['end_year', 'year']],
  licenses: [['name', 'text', true], ['issuer', 'text'], ['region', 'text'], ['issued_on', 'date'], ['expires_on', 'date']],
};
const PDF_LANGS = ['en', 'es', 'fr', 'ht', 'ar'];

function EntryForm({ kind, initial = {}, onSave, onCancel }) {
  const { t } = useTranslation();
  const errorText = useCareerErrors();
  const [form, setForm] = useState(initial);
  const [errors, setErrors] = useState({});
  const [busy, setBusy] = useState(false);
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));
  const prefix = kind === 'licenses' ? 'license' : kind;
  return (
    <form className="ox-careers-panel" onSubmit={async (e) => {
      e.preventDefault();
      setBusy(true); setErrors({});
      try { await onSave(form); } catch (err) {
        const fields = err?.response?.data?.fields || err?.response?.data?.details || {};
        setErrors(fields);
        toast.error(errorText(err));
      } finally { setBusy(false); }
    }} data-track="ui.1e6a1cedf2.1"
    >
      <div className="ox-careers-form-grid">
        {FIELDS[kind].map(([key, type, required]) => {
          const id = `${kind}-${initial.id || 'new'}-${key}`;
          const label = `${t(`careers.mk.resume.fields.${key}`)}${required ? ' *' : ''}`;
          const err = errors[`${prefix}.${key}`];
          if (type === 'check') return <Check key={key} id={id} label={label} checked={Boolean(form[key])} onChange={(v) => set(key, v)} />;
          if (type === 'month' && key === 'end_month' && form.is_current) return null;
          return (
            <Field key={key} label={label} htmlFor={id} error={err}>
              {type === 'textarea'
                ? <textarea id={id} rows={3} maxLength={2000} value={form[key] || ''} onChange={(e) => set(key, e.target.value)} />
                : <input id={id} type={type === 'year' ? 'number' : type} min={type === 'year' ? 1940 : undefined} max={type === 'year' ? 2100 : undefined} maxLength={160} value={form[key] ?? ''} onChange={(e) => set(key, e.target.value)} required={Boolean(required)} />}
            </Field>
          );
        })}
      </div>
      <div className="ox-careers-actions">
        <button type="submit" className="ox-careers-btn primary" disabled={busy} data-track="ui.1e6a1cedf2.2">{t('careers.mk.common.save')}</button>
        <button type="button" className="ox-careers-btn" onClick={onCancel} data-track="ui.1e6a1cedf2.3">{t('careers.common.cancel')}</button>
      </div>
    </form>
  );
}

function summaryLine(kind, e, t) {
  if (kind === 'work') return `${e.title} · ${e.employer_name} · ${e.start_month} – ${e.is_current ? t('careers.mk.resume.present') : (e.end_month || '')}`;
  if (kind === 'education') return [e.credential, e.field_of_study, e.school, [e.start_year, e.end_year].filter(Boolean).join('–')].filter(Boolean).join(' · ');
  return [e.name, e.issuer, e.region, e.expires_on ? t('careers.mk.resume.expires', { date: e.expires_on }) : null].filter(Boolean).join(' · ');
}

/** Structured résumé (work, education, licences), AI import, and PDF. */
export default function ResumeBuilderTab() {
  const { t, i18n } = useTranslation();
  const errorText = useCareerErrors();
  const data = useLoad(() => getStructuredProfile(), []);
  const [editing, setEditing] = useState(null); // `${kind}:${id|'new'}`
  const [paste, setPaste] = useState('');
  const [parsed, setParsed] = useState(null);
  const [keep, setKeep] = useState({});
  const [pdfLang, setPdfLang] = useState(PDF_LANGS.includes(i18n.language?.slice(0, 2)) ? i18n.language.slice(0, 2) : 'en');
  const [withContact, setWithContact] = useState(false);

  const runParse = async (text) => {
    try {
      const r = await parseCareerResume(text || null);
      if (!r.available) { toast.error(t(r.reason === 'unreadable_file' ? 'careers.mk.resume.parseFail.unreadable_file' : 'careers.mk.resume.parseFail.model_unavailable')); return; }
      setParsed(r.suggestions);
      const k = {};
      for (const kind of ['work_history', 'education', 'licenses']) (r.suggestions[kind] || []).forEach((_, i) => { k[`${kind}:${i}`] = true; });
      setKeep(k);
    } catch (err) { toast.error(errorText(err)); }
  };
  const importKept = async () => {
    const pick = (kind) => (parsed[kind] || []).filter((_, i) => keep[`${kind}:${i}`]);
    const r = await importParsedResume({ work_history: pick('work_history'), education: pick('education'), licenses: pick('licenses') });
    toast.success(t('careers.mk.resume.imported', { count: r.saved.work + r.saved.education + r.saved.licenses }));
    setParsed(null); data.reload();
  };

  if (data.loading && !data.data) return <Loading />;
  if (data.error) return <LoadError error={data.error} onRetry={data.reload} />;
  return (
    <div className="ox-careers-grid">
      <Notice>{t('careers.mk.resume.selfReported')}</Notice>
      {['work', 'education', 'licenses'].map((kind) => (
        <section key={kind} className="ox-careers-section">
          <div className="ox-careers-row">
            <h2>{t(`careers.mk.resume.${kind}`)}</h2>
            <button type="button" className="ox-careers-btn" onClick={() => setEditing(`${kind}:new`)} data-track="ui.1e6a1cedf2.4">{t('careers.mk.resume.add')}</button>
          </div>
          {editing === `${kind}:new` ? (
            <EntryForm kind={kind} onCancel={() => setEditing(null)} onSave={async (f) => { await addProfileEntry(kind, f); setEditing(null); data.reload(); }} />
          ) : null}
          {!(data.data?.[kind] || []).length ? <Empty>{t('careers.mk.resume.emptyKind')}</Empty> : null}
          {(data.data?.[kind] || []).map((e) => (editing === `${kind}:${e.id}` ? (
            <EntryForm key={e.id} kind={kind} initial={e} onCancel={() => setEditing(null)} onSave={async (f) => { await updateProfileEntry(kind, e.id, f); setEditing(null); data.reload(); }} />
          ) : (
            <div key={e.id} className="ox-careers-row ox-careers-app">
              <div>
                <p>{summaryLine(kind, e, t)}</p>
                <span className="ox-careers-chip">{t('careers.mk.resume.unverified')}</span>
                {e.source === 'resume_parse' ? <span className="ox-careers-chip">{t('careers.mk.resume.fromImport')}</span> : null}
              </div>
              <div className="ox-careers-actions">
                <button type="button" className="ox-careers-btn" onClick={() => setEditing(`${kind}:${e.id}`)} data-track="ui.1e6a1cedf2.5">{t('careers.mk.common.edit')}</button>
                <ActionButton danger confirm={t('careers.mk.resume.deleteConfirm')} onClick={async () => { await deleteProfileEntry(kind, e.id); data.reload(); }}>{t('careers.mk.resume.delete')}</ActionButton>
              </div>
            </div>
          )))}
        </section>
      ))}
      <section className="ox-careers-section">
        <h2>{t('careers.mk.resume.importTitle')}</h2>
        <p className="ox-careers-subtle">{t('careers.mk.resume.importHint')}</p>
        <div className="ox-careers-actions">
          <ActionButton onClick={() => runParse(null)}>{t('careers.mk.resume.fromUpload')}</ActionButton>
        </div>
        <Field label={t('careers.mk.resume.pasteLabel')} htmlFor="resume-paste">
          <textarea id="resume-paste" rows={6} maxLength={30000} value={paste} onChange={(e) => setPaste(e.target.value)} />
        </Field>
        <ActionButton disabled={paste.trim().length < 80} onClick={() => runParse(paste)}>{t('careers.mk.resume.fromPaste')}</ActionButton>
        {parsed ? (
          <div className="ox-careers-panel">
            <h3>{t('careers.mk.resume.review')}</h3>
            <p className="ox-careers-subtle">{t('careers.mk.resume.reviewHint')}</p>
            {[['work_history', 'work'], ['education', 'education'], ['licenses', 'licenses']].map(([key, kind]) => (parsed[key] || []).map((e, i) => (
              <Check key={`${key}:${i}`} id={`keep-${key}-${i}`} label={summaryLine(kind, e, t)} checked={Boolean(keep[`${key}:${i}`])} onChange={(v) => setKeep((k) => ({ ...k, [`${key}:${i}`]: v }))} />
            )))}
            {parsed.skills?.length ? <p className="ox-careers-subtle">{t('careers.mk.resume.skillsFound', { skills: parsed.skills.join(', ') })}</p> : null}
            <div className="ox-careers-actions">
              <ActionButton primary onClick={importKept}>{t('careers.mk.resume.importSelected')}</ActionButton>
              <button type="button" className="ox-careers-btn" onClick={() => setParsed(null)} data-track="ui.1e6a1cedf2.6">{t('careers.common.cancel')}</button>
            </div>
          </div>
        ) : null}
      </section>
      <section className="ox-careers-section">
        <h2>{t('careers.mk.resume.pdfTitle')}</h2>
        <p className="ox-careers-subtle">{t('careers.mk.resume.pdfHint')}</p>
        <div className="ox-careers-form-grid">
          <Field label={t('careers.mk.resume.pdfLanguage')} htmlFor="pdf-lang">
            <select id="pdf-lang" value={pdfLang} onChange={(e) => setPdfLang(e.target.value)}>
              {PDF_LANGS.map((l) => <option key={l} value={l}>{t(`careers.mk.lang.${l}`)}</option>)}
            </select>
          </Field>
          <Check id="pdf-contact" label={t('careers.mk.resume.includeContact')} checked={withContact} onChange={setWithContact} />
        </div>
        <ActionButton primary onClick={async () => saveBlob(await downloadResumePdf(pdfLang, withContact), 'resume.pdf')}>{t('careers.mk.resume.download')}</ActionButton>
      </section>
    </div>
  );
}
