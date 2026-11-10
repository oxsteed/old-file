import { useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { useTranslation } from 'react-i18next';
import { getOpeningScreeners, saveOpeningScreeners } from '../../../api/careers';
import { Check, Field, Loading, Notice, useCareerErrors, useLoad } from '../ui';
import { SCREENER_PRESETS } from '../../../features/careers/marketplaceModel';

const EDU = SCREENER_PRESETS.education.choices;

function expectedEditor(q, set, t) {
  const preset = SCREENER_PRESETS[q.preset_code];
  if (!preset) return null;
  if (preset.answer_type === 'yes_no') {
    return <Check id={`sq-exp-${q.key}`} label={t('careers.mk.screener.mustBeYes')} checked={q.expected?.answer !== undefined ? q.expected.answer : false} onChange={(v) => set({ expected: v ? { answer: true } : null })} />;
  }
  if (preset.answer_type === 'number') {
    return (
      <Field label={t('careers.mk.screener.minYears')} htmlFor={`sq-exp-${q.key}`}>
        <input id={`sq-exp-${q.key}`} type="number" min="0" max="60" value={q.expected?.min ?? ''} onChange={(e) => set({ expected: e.target.value === '' ? null : { min: Number(e.target.value) } })} />
      </Field>
    );
  }
  if (q.preset_code === 'education') {
    return (
      <Field label={t('careers.mk.screener.minEducation')} htmlFor={`sq-exp-${q.key}`}>
        <select id={`sq-exp-${q.key}`} value={q.expected?.min || ''} onChange={(e) => set({ expected: e.target.value ? { min: e.target.value } : null })}>
          <option value="">{t('careers.common.none')}</option>
          {EDU.map((c) => <option key={c} value={c}>{t(`careers.mk.screener.choice.${c}`)}</option>)}
        </select>
      </Field>
    );
  }
  const any = q.expected?.any_of || [];
  return (
    <fieldset className="ox-careers-yesno">
      <legend>{t('careers.mk.screener.acceptAny')}</legend>
      {preset.choices.map((c) => (
        <Check key={c} id={`sq-exp-${q.key}-${c}`} label={t(`careers.mk.screener.choice.${c}`)} checked={any.includes(c)} onChange={(v) => {
          const next = v ? [...any, c] : any.filter((x) => x !== c);
          set({ expected: next.length ? { any_of: next } : null });
        }}
        />
      ))}
    </fieldset>
  );
}

/**
 * Screener questions for an opening: lawful preset questions (which may be
 * deal-breakers with the answer you need) and custom questions (never
 * deal-breakers; prompts about protected characteristics are refused).
 */
export default function ScreenersEditor({ openingId }) {
  const { t } = useTranslation();
  const errorText = useCareerErrors();
  const data = useLoad(() => getOpeningScreeners(openingId), [openingId]);
  const [questions, setQuestions] = useState([]);
  const [autoReject, setAutoReject] = useState(false);
  const [errors, setErrors] = useState({});
  useEffect(() => {
    if (!data.data) return;
    setQuestions((data.data.questions || []).map((q, i) => ({ ...q, key: `q${q.id || i}`, detail: q.kind === 'preset' && q.prompt !== q.preset_code ? q.prompt : '' })));
    setAutoReject(Boolean(data.data.auto_reject));
  }, [data.data]);
  if (data.loading && !data.data) return <Loading />;
  const set = (i) => (patch) => setQuestions((qs) => qs.map((q, j) => (j === i ? { ...q, ...patch } : q)));
  const used = new Set(questions.map((q) => q.preset_code).filter(Boolean));
  const save = async () => {
    setErrors({});
    try {
      const payload = questions.map((q) => (q.kind === 'preset'
        ? { preset_code: q.preset_code, detail: q.detail || undefined, required: q.required !== false, dealbreaker: Boolean(q.dealbreaker), expected: q.expected || null }
        : { prompt: q.prompt, answer_type: q.answer_type, choices: q.answer_type === 'choice' ? String(q.choicesText ?? (q.choices || []).join(', ')).split(',').map((c) => c.trim()).filter(Boolean) : [], required: q.required !== false }));
      const r = await saveOpeningScreeners(openingId, { questions: payload, auto_reject: autoReject });
      data.setData({ questions: r.questions, auto_reject: r.auto_reject ?? autoReject });
      toast.success(t('careers.mk.screener.saved'));
    } catch (err) { setErrors(err?.response?.data?.fields || {}); toast.error(errorText(err)); }
  };
  return (
    <fieldset className="ox-careers-section">
      <legend>{t('careers.mk.screener.editorTitle')}</legend>
      <p className="ox-careers-subtle">{t('careers.mk.screener.editorHint')}</p>
      {questions.map((q, i) => (
        <div key={q.key} className="ox-careers-app">
          <div className="ox-careers-row">
            <strong>{q.kind === 'preset' ? t(`careers.mk.screener.preset.${q.preset_code}`) : t('careers.mk.screener.custom')}</strong>
            <button type="button" className="ox-careers-btn" onClick={() => setQuestions((qs) => qs.filter((_, j) => j !== i))}>{t('careers.mk.scheduling.remove')}</button>
          </div>
          {q.kind === 'preset' ? (
            <>
              {['certification', 'language', 'lift_weight', 'commute', 'start_date'].includes(q.preset_code) ? (
                <Field label={t('careers.mk.screener.detail')} htmlFor={`sq-d-${q.key}`} hint={t(`careers.mk.screener.detailHint.${q.preset_code}`)}>
                  <input id={`sq-d-${q.key}`} maxLength={300} value={q.detail || ''} onChange={(e) => set(i)({ detail: e.target.value })} />
                </Field>
              ) : null}
              {expectedEditor(q, set(i), t)}
              <Check id={`sq-db-${q.key}`} label={t('careers.mk.screener.dealbreakerLabel')} checked={Boolean(q.dealbreaker)} onChange={(v) => set(i)({ dealbreaker: v })} />
            </>
          ) : (
            <div className="ox-careers-form-grid">
              <Field label={t('careers.mk.screener.question')} htmlFor={`sq-p-${q.key}`}><input id={`sq-p-${q.key}`} maxLength={300} value={q.prompt || ''} onChange={(e) => set(i)({ prompt: e.target.value })} /></Field>
              <Field label={t('careers.mk.screener.answerType')} htmlFor={`sq-t-${q.key}`}>
                <select id={`sq-t-${q.key}`} value={q.answer_type || 'text'} onChange={(e) => set(i)({ answer_type: e.target.value })}>
                  {['yes_no', 'number', 'choice', 'text'].map((a) => <option key={a} value={a}>{t(`careers.mk.screener.types.${a}`)}</option>)}
                </select>
              </Field>
              {q.answer_type === 'choice' ? (
                <Field label={t('careers.mk.screener.choices')} htmlFor={`sq-c-${q.key}`} hint={t('careers.profile.commaHint')}>
                  <input id={`sq-c-${q.key}`} value={q.choicesText ?? (q.choices || []).join(', ')} onChange={(e) => set(i)({ choicesText: e.target.value })} />
                </Field>
              ) : null}
            </div>
          )}
          <Check id={`sq-req-${q.key}`} label={t('careers.mk.screener.required')} checked={q.required !== false} onChange={(v) => set(i)({ required: v })} />
          {errors[`questions.${i}`] ? <p className="ox-careers-error" role="alert">{errors[`questions.${i}`]}</p> : null}
        </div>
      ))}
      {questions.length < 10 ? (
        <div className="ox-careers-actions">
          <select aria-label={t('careers.mk.screener.addPreset')} value="" onChange={(e) => {
            if (!e.target.value) return;
            setQuestions((qs) => [...qs, { key: `n${Date.now()}`, kind: 'preset', preset_code: e.target.value, required: true, dealbreaker: false, expected: null }]);
          }}
          >
            <option value="">{t('careers.mk.screener.addPreset')}</option>
            {Object.keys(SCREENER_PRESETS).filter((c) => !used.has(c)).map((c) => <option key={c} value={c}>{t(`careers.mk.screener.preset.${c}`)}</option>)}
          </select>
          <button type="button" className="ox-careers-btn" onClick={() => setQuestions((qs) => [...qs, { key: `n${Date.now()}`, kind: 'custom', prompt: '', answer_type: 'yes_no', required: true }])}>{t('careers.mk.screener.addCustom')}</button>
        </div>
      ) : null}
      <Check id="sq-auto" label={t('careers.mk.screener.autoReject')} checked={autoReject} onChange={setAutoReject} />
      {autoReject ? <Notice>{t('careers.mk.screener.autoRejectHint')}</Notice> : null}
      <button type="button" className="ox-careers-btn primary" onClick={save}>{t('careers.mk.screener.save')}</button>
    </fieldset>
  );
}
