/**
 * Owner-edited text used as profile AI context (helper or business).
 */
import { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import toast from 'react-hot-toast';
import api from '../api/axios';

const IcoCheck = ({ size = 16, cls = '' }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className={cls}>
    <polyline points="20 6 9 17 4 12" />
  </svg>
);
const IcoSave = ({ size = 16, cls = '' }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className={cls}>
    <path d="M19 21H5a2 2 0 01-2-2V5a2 2 0 012-2h11l5 5v11a2 2 0 01-2 2z" />
    <polyline points="17 21 17 13 7 13 7 21" />
    <polyline points="7 3 7 8 15 8" />
  </svg>
);
const IcoLightbulb = ({ size = 16, cls = '' }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className={cls}>
    <path d="M9 18h6M10 22h4M12 2a7 7 0 017 7c0 2.38-1.19 4.47-3 5.74V17h-8v-2.26C5.19 13.47 4 11.38 4 9a7 7 0 017-7z" />
  </svg>
);

const MAX = 8000;

export default function AIKnowledgeTab({ profileType, profileId }) {
  const { t } = useTranslation();
  const [text, setText] = useState('');
  const [initial, setInitial] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [savedFlash, setSavedFlash] = useState(false);
  const [error, setError] = useState('');

  const dirty = text !== initial;
  const charCount = text.length;

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      if (profileType === 'helper') {
        const { data } = await api.get('/helper-profile/me');
        const v = data.ai_knowledge || '';
        setText(v);
        setInitial(v);
      } else {
        const { data } = await api.get(`/businesses/${profileId}/profile-edit`);
        const v = data.business?.ai_knowledge || '';
        setText(v);
        setInitial(v);
      }
    } catch (e) {
      setError(t('aiKnowledge.saveError'));
    } finally {
      setLoading(false);
    }
  }, [profileType, profileId, t]);

  useEffect(() => { load(); }, [load]);

  async function save() {
    if (charCount > MAX) {
      toast.error(t('aiKnowledge.saveError'));
      return;
    }
    setSaving(true);
    setError('');
    try {
      if (profileType === 'helper') {
        await api.put('/helper-profile/core', { ai_knowledge: text });
      } else {
        await api.put(`/businesses/${profileId}`, { ai_knowledge: text });
      }
      setInitial(text);
      setSavedFlash(true);
      setTimeout(() => setSavedFlash(false), 2000);
      toast.success(t('aiKnowledge.saved'));
    } catch (e) {
      setError(t('aiKnowledge.saveError'));
      toast.error(t('aiKnowledge.saveError'));
    } finally {
      setSaving(false);
    }
  }

  const previewPath = profileType === 'helper'
    ? '/dashboard/ai-preview'
    : `/business/${profileId}/ai-preview`;

  if (loading) {
    return (
      <div className="text-gray-400 text-sm py-8">{t('common.loading')}</div>
    );
  }

  return (
    <div className="max-w-3xl space-y-6">
      <div>
        <h2 className="text-xl font-bold text-white">{t('aiKnowledge.heading')}</h2>
        <p className="text-sm text-gray-400 mt-1">{t('aiKnowledge.subheading')}</p>
      </div>

      <div>
        <label htmlFor="ai-knowledge-text" className="block text-sm font-medium text-gray-300 mb-2">
          {t('aiKnowledge.label')}
        </label>
        <textarea
          id="ai-knowledge-text"
          value={text}
          onChange={e => setText(e.target.value)}
          rows={12}
          maxLength={MAX}
          placeholder={t('aiKnowledge.placeholder')}
          className="w-full rounded-xl bg-gray-900 border border-gray-700 text-gray-100 p-4 text-sm focus:ring-2 focus:ring-orange-500/40 focus:border-orange-500/50"
          aria-label={t('aiKnowledge.label')}
        />
        <div className="flex justify-between items-center mt-2">
          <span className="text-xs text-gray-500" aria-live="polite" aria-atomic="true" aria-label={t('aiKnowledge.charCountAria', { count: charCount })}>
            {t('aiKnowledge.charCount', { count: charCount })}
          </span>
          <button
            type="button"
            onClick={save}
            disabled={saving || !dirty}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-orange-500 text-white text-sm font-semibold disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {savedFlash
              ? <><IcoCheck size={14} className="text-green-800" /> {t('aiKnowledge.saved')}</>
              : saving
                ? <span>{t('aiKnowledge.saving')}</span>
                : <><IcoSave size={14} /> {t('aiKnowledge.save')}</>}
          </button>
        </div>
      </div>

      <Link
        to={previewPath}
        className="inline-flex text-sm text-orange-400 hover:text-orange-300 underline"
      >
        {t('aiKnowledge.previewBtn')}
      </Link>

      {error && <p className="text-sm text-red-400" role="alert">{error}</p>}

      <div className="bg-gray-900/40 border border-gray-700/30 rounded-xl p-5">
        <div className="flex items-center gap-2 mb-3">
          <IcoLightbulb size={14} className="text-orange-400" />
          <span className="text-xs font-semibold uppercase tracking-widest text-gray-500">{t('aiKnowledge.tips')}</span>
        </div>
        <ul className="space-y-1.5">
          {['tip1', 'tip2', 'tip3', 'tip4'].map(tip => (
            <li key={tip} className="flex gap-2 text-sm text-gray-400">
              <span className="text-orange-500 mt-0.5 flex-shrink-0">·</span>
              {t(`aiKnowledge.${tip}`)}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
