export const CLIENT_INTAKE_MARKER = '[[OXS_CLIENT_INTAKE]]';
export const CLIENT_INTAKE_RESPONSE_MARKER = '[[OXS_CLIENT_INTAKE_RESPONSE]]';

function parseMarker(content, marker) {
  const text = String(content || '');
  if (!text.startsWith(marker)) return null;
  try {
    return JSON.parse(text.slice(marker.length));
  } catch {
    return null;
  }
}

export function parseClientIntakeMarker(content) {
  return parseMarker(content, CLIENT_INTAKE_MARKER);
}

export function parseClientIntakeResponseMarker(content) {
  return parseMarker(content, CLIENT_INTAKE_RESPONSE_MARKER);
}

export function stripClientIntakeMarkers(content) {
  return parseClientIntakeMarker(content) || parseClientIntakeResponseMarker(content) ? '' : content;
}
