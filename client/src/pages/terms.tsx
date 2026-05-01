import { FileText } from 'lucide-react';
import enTerms from '../locales/terms/en.content.json';
import LegalPolicyPage, { type LegalContentFile } from './LegalPolicyPage';

const SECTION_IDS = [
  1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20,
] as const;

export default function TermsOfService() {
  return (
    <LegalPolicyPage
      HeroIcon={FileText}
      contentKey="termsContent"
      fallbackContent={enTerms as LegalContentFile}
      sectionIds={SECTION_IDS}
      sectionAnchorPrefix="terms-section"
      i18nPrefix="termsPage"
    />
  );
}
