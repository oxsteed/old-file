import { Shield } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import enPrivacy from '../locales/privacy/en.content.json';
import LegalPolicyPage, { type LegalContentFile } from './LegalPolicyPage';

const SECTION_IDS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13] as const;

const nextPolicies = import.meta.glob('../locales/privacy/next/*.content.json');
export default function PrivacyPolicy({ embedded = false, upcoming = false }: { embedded?: boolean; upcoming?: boolean }) {
  const { t, i18n } = useTranslation();
  const [policy, setPolicy] = useState<{state:string; effective_at?:string; planned_effective_at?:string} | null>(null);
  const [content, setContent] = useState<LegalContentFile | null>(null);
  useEffect(()=>{
    const locale=new URLSearchParams(window.location.search).get('lang');
    if(locale&&nextPolicies[`../locales/privacy/next/${locale}.content.json`])void i18n.changeLanguage(locale);
  },[i18n]);
  useEffect(() => {
    let active = true;
    fetch('/api/activity/policy', {credentials:'same-origin',cache:'no-store'})
      .then(r=>r.ok?r.json():null).then(value=>{if(active)setPolicy(value);}).catch(()=>{});
    return ()=>{active=false;};
  }, []);
  const showNext = policy?.state !== 'draft' && Boolean(policy) && (upcoming || (Boolean(policy?.effective_at) && new Date(policy!.effective_at!).getTime()<=Date.now()));
  useEffect(() => {
    let active = true;setContent(null);
    if(!showNext)return;
    const lang=(i18n.resolvedLanguage||'en').split('-')[0];
    const loader=nextPolicies[`../locales/privacy/next/${lang}.content.json`]||nextPolicies['../locales/privacy/next/en.content.json'];
    loader().then(module=>{if(active)setContent((module as {default:LegalContentFile}).default);});
    return ()=>{active=false;};
  },[showNext,i18n.resolvedLanguage]);
  if(upcoming&&!showNext)return <main className="mx-auto max-w-3xl p-6"><h1>{t('growthInsights.upcoming')}</h1><p>{policy?t('growthInsights.noPolicy'):t('growthInsights.loading')}</p></main>;
  if(showNext&&!content)return <p role="status" className="p-6">{t('growthInsights.loading')}</p>;
  const date=policy?.effective_at||policy?.planned_effective_at;
  return (
    <LegalPolicyPage
      HeroIcon={Shield}
      contentKey="privacyContent"
      fallbackContent={enPrivacy as LegalContentFile}
      sectionIds={showNext?[...SECTION_IDS,14]:SECTION_IDS}
      sectionAnchorPrefix="privacy-section"
      i18nPrefix="privacyPage"
      embedded={embedded}
      contentOverride={content}
      updatedLabel={showNext&&date?t(upcoming?'growthInsights.changesOn':'growthInsights.changedOn',{date:new Date(date).toLocaleDateString(i18n.resolvedLanguage)}):null}
    />
  );
}
