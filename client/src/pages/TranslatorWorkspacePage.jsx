import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';

import Navbar from '../components/Navbar';
import Footer from '../components/Footer';
import PageMeta from '../components/PageMeta';
import { useAuth } from '../hooks/useAuth';
import TranslationResultCard from '../features/translator/components/TranslationResultCard';
import BatchJobCard from '../features/translator/components/BatchJobCard';
import LanguageSwitcherCard from '../features/settings/language-switcher/LanguageSwitcherCard';
import {
  createBatchTranslationJob,
  getTranslationHistory,
  getTranslationJob,
  getTranslationLanguages,
  listGlossaries,
  translateText,
} from '../features/translator/api/translationPlatform';
import '../styles/TranslatorWorkspacePage.css';

const TONES = ['default', 'formal', 'friendly', 'technical'];

function splitBatchSections(value) {
  return String(value || '')
    .split(/\n\s*\n/g)
    .map((section) => section.trim())
    .filter(Boolean);
}

export default function TranslatorWorkspacePage() {
  const { t } = useTranslation(['translator', 'common']);
  const { user } = useAuth();
  const [text, setText] = useState('');
  const [sourceLang, setSourceLang] = useState('auto');
  const [targetLang, setTargetLang] = useState('fr');
  const [tone, setTone] = useState('default');
  const [glossaryId, setGlossaryId] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState(null);
  const [activeJobId, setActiveJobId] = useState('');

  const { data: languages = [] } = useQuery({
    queryKey: ['translation-languages'],
    queryFn: getTranslationLanguages,
  });

  const { data: glossaryResponse } = useQuery({
    queryKey: ['translation-glossaries'],
    queryFn: listGlossaries,
    enabled: Boolean(user),
    retry: false,
  });

  const { data: historyResponse } = useQuery({
    queryKey: ['translation-history'],
    queryFn: () => getTranslationHistory(8),
    enabled: Boolean(user),
    retry: false,
  });

  const { data: activeJob } = useQuery({
    queryKey: ['translation-job', activeJobId],
    queryFn: () => getTranslationJob(activeJobId),
    enabled: Boolean(activeJobId),
    refetchInterval: (query) => {
      const status = query.state.data?.status;
      return status && ['completed', 'failed', 'partial'].includes(status) ? false : 1500;
    },
  });

  const glossaries = glossaryResponse?.items || [];
  const history = historyResponse?.items || [];
  const batchSections = useMemo(() => splitBatchSections(text), [text]);

  const handleTranslate = async () => {
    setSubmitting(true);
    try {
      const response = await translateText({
        text,
        sourceLang,
        targetLang,
        tone: tone === 'default' ? undefined : tone,
        glossaryId: glossaryId || undefined,
      });
      setResult(response);
    } catch (err) {
      toast.error(err?.response?.data?.message || t('translator:errors.generic'));
    } finally {
      setSubmitting(false);
    }
  };

  const handleCreateBatch = async () => {
    if (batchSections.length < 2) {
      toast.error(t('translator:errors.batchRequiresBreaks'));
      return;
    }
    setSubmitting(true);
    try {
      const response = await createBatchTranslationJob({
        texts: batchSections,
        sourceLang,
        targetLang,
        tone: tone === 'default' ? undefined : tone,
        glossaryId: glossaryId || undefined,
      });
      setActiveJobId(response.id);
    } catch (err) {
      toast.error(err?.response?.data?.message || t('translator:errors.generic'));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <>
      <PageMeta title={t('translator:page.shellTitle')} description={t('translator:page.subtitle')} />
      <Navbar />
      <main className="translator-page-shell">
        <section className="translator-hero">
          <span className="translator-eyebrow">{t('translator:page.eyebrow')}</span>
          <h1>{t('translator:page.title')}</h1>
          <p>{t('translator:page.subtitle')}</p>
        </section>

        <section className="translator-layout">
          <div className="translator-column translator-column-main">
            <section className="translator-card">
              <div className="translator-card-header">
                <h2>{t('translator:form.input')}</h2>
              </div>

              <div className="translator-form-grid">
                <label>
                  <span>{t('translator:form.sourceLanguage')}</span>
                  <select value={sourceLang} onChange={(event) => setSourceLang(event.target.value)}>
                    <option value="auto">{t('common:languages.autoDetect')}</option>
                    {languages.map((language) => (
                      <option key={language.code} value={language.code}>{language.name || language.displayName || language.code}</option>
                    ))}
                  </select>
                </label>
                <label>
                  <span>{t('translator:form.targetLanguage')}</span>
                  <select value={targetLang} onChange={(event) => setTargetLang(event.target.value)}>
                    {languages.map((language) => (
                      <option key={language.code} value={language.code}>{language.name || language.displayName || language.code}</option>
                    ))}
                  </select>
                </label>
                <label>
                  <span>{t('translator:form.tone')}</span>
                  <select value={tone} onChange={(event) => setTone(event.target.value)}>
                    {TONES.map((toneOption) => (
                      <option key={toneOption} value={toneOption}>
                        {t(`translator:form.tone${toneOption.charAt(0).toUpperCase()}${toneOption.slice(1)}`)}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  <span>{t('translator:form.glossary')}</span>
                  <select value={glossaryId} onChange={(event) => setGlossaryId(event.target.value)} disabled={!user}>
                    <option value="">{t('translator:glossary.none')}</option>
                    {glossaries.map((glossary) => (
                      <option key={glossary.id} value={glossary.id}>{glossary.name}</option>
                    ))}
                  </select>
                </label>
              </div>

              <textarea
                className="translator-textarea"
                value={text}
                onChange={(event) => setText(event.target.value)}
                placeholder={t('translator:form.placeholder')}
                rows={12}
              />

              <div className="translator-actions">
                <button type="button" className="translator-primary-button" onClick={handleTranslate} disabled={submitting || !text.trim()}>
                  {submitting ? `${t('common:actions.loading')}...` : t('translator:form.translateNow')}
                </button>
                <button type="button" className="translator-secondary-button" onClick={handleCreateBatch} disabled={submitting || batchSections.length < 2}>
                  {t('translator:form.createBatchJob')}
                </button>
              </div>
              <p className="translator-muted">{t('translator:form.batchHint')}</p>
            </section>

            <TranslationResultCard result={result} />
            <BatchJobCard job={activeJob || null} />
          </div>

          <aside className="translator-column translator-column-side">
            <LanguageSwitcherCard />
            <section className="translator-card">
              <div className="translator-card-header">
                <h2>{t('translator:history.title')}</h2>
              </div>
              {history.length ? (
                <div className="translator-history-list">
                  {history.map((item) => (
                    <article className="translator-history-item" key={item.id}>
                      <strong>{item.targetLanguage?.toUpperCase()}</strong>
                      <p>{item.sourceText || t('translator:history.noSource')}</p>
                      <small>{item.status} · {item.cached ? t('translator:history.cached') : t('translator:history.fresh')}</small>
                    </article>
                  ))}
                </div>
              ) : (
                <p className="translator-muted">{t('translator:history.empty')}</p>
              )}
            </section>
          </aside>
        </section>
      </main>
      <Footer />
    </>
  );
}
