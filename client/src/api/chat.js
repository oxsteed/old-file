import api from './axios';

/**
 * Send a message to the general chat AI
 */
export async function sendChatMessage(messages, pageContext, language = 'en') {
  const response = await api.post('/chat/message', {
    messages,
    pageContext,
    language,
  });
  return response.data;
}

/**
 * Send a message to the financial advisor AI
 * Requires authentication
 * @param {Array} messages - Message history
 * @param {string} window - Analysis window: 1m, 3m, 6m, 1y (default: 1m)
 * @param {string} language - Language code
 */
export async function getFinancialAdvice(messages, window = '1m', language = 'en') {
  const response = await api.post('/chat/financial-advisor', {
    messages,
    window,
    language,
  });
  return response.data;
}

/**
 * Send a message from a helper's profile page
 */
export async function sendProfileChatMessage(
  helperId,
  messages,
  destination = 'helper',
  threadId = null,
  language = 'en'
) {
  const response = await api.post('/chat/profile-message', {
    helperId,
    messages,
    destination,
    threadId,
    language,
  });
  return response.data;
}

/**
 * Log chat feedback (thumbs up/down)
 */
export async function logChatFeedback(value, messageContent, pageContext) {
  await api.post('/chat/feedback', {
    value,
    messageContent,
    pageContext,
  });
}

/**
 * Upload a file/image attachment for a conversation message.
 * Returns { url, key, name, size, mimeType }
 * @param {string} conversationId
 * @param {File} file
 */
export async function uploadMessageAttachment(conversationId, file) {
  const form = new FormData();
  form.append('file', file);
  const response = await api.post(
    `/messages/conversations/${conversationId}/attachments`,
    form,
    { headers: { 'Content-Type': 'multipart/form-data' } }
  );
  return response.data;
}
