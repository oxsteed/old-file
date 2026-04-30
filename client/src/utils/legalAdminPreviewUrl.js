import { legalDocumentBasePath } from '../constants/legalPublicRoutes';

/** Full URL for admin preview of a draft/unpublished document */
export function legalAdminPreviewUrl(categoryKey, documentId) {
  const base = legalDocumentBasePath(categoryKey);
  const qs = new URLSearchParams({ preview: documentId }).toString();
  return `${base}?${qs}`;
}
