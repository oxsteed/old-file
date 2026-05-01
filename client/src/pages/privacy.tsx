import { Shield } from 'lucide-react';
import enPrivacy from '../locales/privacy/en.content.json';
import LegalPolicyPage, { type LegalContentFile } from './LegalPolicyPage';

const SECTION_IDS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13] as const;

export default function PrivacyPolicy() {
  return (
    <LegalPolicyPage
      HeroIcon={Shield}
      contentKey="privacyContent"
      fallbackContent={enPrivacy as LegalContentFile}
      sectionIds={SECTION_IDS}
      sectionAnchorPrefix="privacy-section"
      i18nPrefix="privacyPage"
    />
  );
}
