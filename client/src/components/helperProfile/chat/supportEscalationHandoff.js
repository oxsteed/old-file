/**
 * Build a real handoff from profile-messenger OxSteed AI → /support/escalation.
 * Query params survive refresh; location.state carries optional message summary.
 */

const MAX_SUMMARY_MESSAGES = 6;
const MAX_SUMMARY_CHARS = 1200;

/**
 * @param {object} opts
 * @param {string} [opts.helperId]
 * @param {string} [opts.businessId]
 * @param {string} [opts.helperName]
 * @param {string} [opts.returnTo] absolute path+search, e.g. /helpers/uuid
 * @param {Array<{ itemType?: string, authorType?: string, content?: string }>} [opts.timeline]
 * @returns {{ pathname: string, search: string, state: object }}
 */
export function buildSupportEscalationHandoff({
  helperId,
  businessId,
  helperName,
  returnTo,
  timeline = [],
} = {}) {
  const params = new URLSearchParams();
  params.set('from', 'profile');
  if (helperId) params.set('helperId', String(helperId));
  if (businessId) params.set('businessId', String(businessId));
  if (helperName) params.set('helperName', String(helperName).slice(0, 120));
  if (returnTo && typeof returnTo === 'string' && returnTo.startsWith('/')) {
    params.set('returnTo', returnTo.slice(0, 500));
  }

  const summary = summarizeTimeline(timeline);
  const contextLines = [];
  if (helperName) contextLines.push(`Profile: ${helperName}`);
  if (helperId) contextLines.push(`helperId: ${helperId}`);
  if (businessId) contextLines.push(`businessId: ${businessId}`);
  if (returnTo) contextLines.push(`returnTo: ${returnTo}`);

  let prefillMessage = '';
  if (contextLines.length || summary) {
    const parts = ['[From profile OxSteed AI chat — requesting human support]'];
    if (contextLines.length) parts.push(contextLines.join('\n'));
    if (summary) parts.push('', 'Recent messages:', summary);
    prefillMessage = parts.join('\n').slice(0, 5000);
  }

  return {
    pathname: '/support/escalation',
    search: `?${params.toString()}`,
    state: {
      from: 'profile',
      helperId: helperId || null,
      businessId: businessId || null,
      helperName: helperName || null,
      returnTo: returnTo && returnTo.startsWith('/') ? returnTo : null,
      prefillMessage: prefillMessage || null,
      messageSummary: summary || null,
    },
  };
}

function summarizeTimeline(timeline) {
  if (!Array.isArray(timeline) || timeline.length === 0) return '';
  const messages = timeline
    .filter((item) => item && item.itemType === 'message' && typeof item.content === 'string' && item.content.trim())
    .slice(-MAX_SUMMARY_MESSAGES);

  if (!messages.length) return '';

  const lines = messages.map((item) => {
    const role =
      item.authorType === 'visitor' || item.authorType === 'user' || item.authorType === 'customer'
        ? 'Visitor'
        : item.authorType === 'helper' || item.authorType === 'business'
          ? 'Helper'
          : 'OxSteed AI';
    const content = String(item.content).replace(/\s+/g, ' ').trim().slice(0, 280);
    return `${role}: ${content}`;
  });

  return lines.join('\n').slice(0, MAX_SUMMARY_CHARS);
}

/**
 * Read handoff context from location.search + location.state (state wins for prefill).
 * @param {{ search?: string, state?: object | null }} location
 */
export function readSupportEscalationHandoff(location = {}) {
  const params = new URLSearchParams(location.search || '');
  const state = location.state && typeof location.state === 'object' ? location.state : {};

  const from = state.from || params.get('from') || null;
  const helperId = state.helperId || params.get('helperId') || null;
  const businessId = state.businessId || params.get('businessId') || null;
  const helperName = state.helperName || params.get('helperName') || null;
  let returnTo = state.returnTo || params.get('returnTo') || null;
  if (returnTo && !String(returnTo).startsWith('/')) returnTo = null;

  const prefillMessage = state.prefillMessage || null;
  const messageSummary = state.messageSummary || null;
  const isFromProfile = from === 'profile' || Boolean(helperId || businessId);

  return {
    from,
    helperId,
    businessId,
    helperName,
    returnTo,
    prefillMessage,
    messageSummary,
    isFromProfile,
  };
}
