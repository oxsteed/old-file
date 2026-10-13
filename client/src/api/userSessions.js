// User session management API client
// OxSteed v2 - review P3-14-F03: user-facing active-session list and revocation.
import api from './axios';

export const userSessionsAPI = {
  // List the signed-in user's active sessions (current session flagged).
  listSessions: () => api.get('/users/me/sessions'),
  // Revoke one session by id. The current session cannot be revoked this way.
  revokeSession: (sessionId) => api.delete(`/users/me/sessions/${sessionId}`),
};

export default userSessionsAPI;
