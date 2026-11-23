import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import api from '../api/axios';

// Group 4 rest, item 194: the customer of a completed job endorses the
// helper's listed skills, once per skill (server-enforced).
export default function JobSkillEndorsements({ jobId }) {
  const { t } = useTranslation();
  const c = (key, opts) => t(`helperG4.endorsements.${key}`, opts);
  const [skills, setSkills] = useState(null);
  const [busy, setBusy] = useState(null);
  const [error, setError] = useState('');
  const base = `/helpers/me/endorsements/jobs/${encodeURIComponent(jobId)}`;

  useEffect(() => {
    const controller = new AbortController();
    api.get(base, { signal: controller.signal })
      .then(({ data }) => { if (!controller.signal.aborted) setSkills(data.skills || []); })
      .catch(() => { if (!controller.signal.aborted) setSkills(null); });
    return () => controller.abort();
  }, [base]);

  async function toggle(skill) {
    setBusy(skill.helperSkillId);
    setError('');
    try {
      if (skill.endorsementId) {
        await api.delete(`/helpers/me/endorsements/${encodeURIComponent(skill.endorsementId)}`);
        setSkills((list) => list.map((s) => (s.helperSkillId === skill.helperSkillId ? { ...s, endorsementId: null } : s)));
      } else {
        const { data } = await api.post(base, { helperSkillId: skill.helperSkillId });
        setSkills((list) => list.map((s) => (s.helperSkillId === skill.helperSkillId ? { ...s, endorsementId: data.endorsement.id } : s)));
      }
    } catch {
      setError(c('failed'));
    } finally {
      setBusy(null);
    }
  }

  if (skills === null) return null;
  return <section className="jdp-secondary-action" aria-labelledby={`job-endorse-${jobId}`}>
    <h3 id={`job-endorse-${jobId}`}>{c('title')}</h3>
    <p>{c('hint')}</p>
    {skills.length === 0 ? <p>{c('none')}</p> : <ul>
      {skills.map((s) => <li key={s.helperSkillId}>
        <span>{s.skill}</span>{' '}
        <button type="button" className="jdp-btn-ghost" aria-pressed={!!s.endorsementId} disabled={busy === s.helperSkillId}
          onClick={() => toggle(s)} data-track="ui.helperG4.endorsements.toggle">
          {s.endorsementId ? c('withdraw') : c('endorse')}
        </button>
      </li>)}
    </ul>}
    {error && <p role="alert">{error}</p>}
  </section>;
}
