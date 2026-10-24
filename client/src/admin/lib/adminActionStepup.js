// The server binds each single-use challenge to the actor and action type.
export async function collectAdminActionStepup(api, endpoint, t) {
  const { data } = await api.post(endpoint, {});
  const code = window.prompt(t('adminOpsAudit.stepupPrompt'));
  if (!code?.trim()) throw new Error(t('adminOpsAudit.stepupRequired'));
  return { stepupChallengeId: data.challenge.id, stepupCode: code.trim() };
}
