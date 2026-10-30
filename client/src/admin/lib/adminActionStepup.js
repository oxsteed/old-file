// The server binds each single-use challenge to the actor and action type.
import { getCsrfToken } from '../../api/csrfToken';

// Pentest fix: this helper posts through the caller's raw axios instance,
// which bypasses the shared instance's CSRF interceptor, so it must
// attach the token itself for cookie sessions.
function csrfHeaders() {
  const token = getCsrfToken();
  return token ? { 'X-CSRF-Token': token } : {};
}

export async function collectAdminActionStepup(api, endpoint, t) {
  const { data } = await api.post(endpoint, {}, { headers: csrfHeaders() });
  const code = window.prompt(t('adminOpsAudit.stepupPrompt'));
  if (!code?.trim()) throw new Error(t('adminOpsAudit.stepupRequired'));
  return { stepupChallengeId: data.challenge.id, stepupCode: code.trim() };
}
