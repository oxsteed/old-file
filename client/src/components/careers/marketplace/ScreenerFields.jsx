import { useTranslation } from 'react-i18next';
import { Field, YesNo } from '../ui';

/**
 * The employer's screener questions on the apply form. Expected answers
 * and deal-breakers never reach the browser; this only collects answers.
 */
export default function ScreenerFields({ questions = [], answers, onChange, errors = {} }) {
  const { t } = useTranslation();
  if (!questions.length) return null;
  const set = (id) => (v) => onChange({ ...answers, [id]: v });
  const label = (q) => (q.kind === 'preset' ? t(`careers.mk.screener.preset.${q.preset_code}`) : q.prompt);
  return (
    <fieldset className="ox-careers-section">
      <legend>{t('careers.mk.screener.title')}</legend>
      <p className="ox-careers-subtle">{t('careers.mk.screener.hint')}</p>
      {questions.map((q) => {
        const err = errors[`screener_answers.${q.id}`];
        const text = `${label(q)}${q.kind === 'preset' && q.prompt && q.prompt !== q.preset_code ? ` (${q.prompt})` : ''}${q.required ? ' *' : ''}`;
        if (q.answer_type === 'yes_no') {
          return <YesNo key={q.id} name={`screener-${q.id}`} label={text} value={answers[q.id] ?? null} onChange={set(q.id)} error={err} />;
        }
        if (q.answer_type === 'number') {
          return (
            <Field key={q.id} label={text} htmlFor={`screener-${q.id}`} error={err}>
              <input id={`screener-${q.id}`} type="number" min="0" max="60" step="1" inputMode="numeric" value={answers[q.id] ?? ''} onChange={(e) => set(q.id)(e.target.value)} />
            </Field>
          );
        }
        if (q.answer_type === 'choice') {
          const multi = q.preset_code === 'shift_availability';
          const value = answers[q.id] ?? (multi ? [] : '');
          if (multi) {
            return (
              <fieldset key={q.id} className="ox-careers-yesno">
                <legend>{text}</legend>
                {q.choices.map((c) => (
                  <label key={c} className="ox-careers-check">
                    <input type="checkbox" checked={value.includes(c)} onChange={(e) => set(q.id)(e.target.checked ? [...value, c] : value.filter((x) => x !== c))} />
                    <span>{t(`careers.mk.screener.choice.${c}`)}</span>
                  </label>
                ))}
                {err ? <p className="ox-careers-error" role="alert">{err}</p> : null}
              </fieldset>
            );
          }
          return (
            <Field key={q.id} label={text} htmlFor={`screener-${q.id}`} error={err}>
              <select id={`screener-${q.id}`} value={value} onChange={(e) => set(q.id)(e.target.value)}>
                <option value="">{t('careers.mk.report.pick')}</option>
                {q.choices.map((c) => <option key={c} value={c}>{q.kind === 'preset' ? t(`careers.mk.screener.choice.${c}`) : c}</option>)}
              </select>
            </Field>
          );
        }
        return (
          <Field key={q.id} label={text} htmlFor={`screener-${q.id}`} error={err}>
            <textarea id={`screener-${q.id}`} rows={2} maxLength={1000} value={answers[q.id] ?? ''} onChange={(e) => set(q.id)(e.target.value)} />
          </Field>
        );
      })}
    </fieldset>
  );
}
