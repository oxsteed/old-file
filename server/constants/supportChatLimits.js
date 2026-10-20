'use strict';

/**
 * Size limits for the AI support chat (POST /api/chat/message).
 *
 * The widget lets a user attach one PNG/JPEG/WebP image up to 2 MB. It is
 * sent as a base64 data URL inside the JSON body, which inflates it by 4/3,
 * so the chat route needs its own JSON body limit: the global 1 MB parser
 * would reject any image over ~750 KB with a 413 before the handler runs.
 *
 * Keep MAX_IMAGE_BYTES in sync with SUPPORT_CHAT_MAX_IMAGE_BYTES in
 * client/src/components/SupportWidget.jsx.
 */

const MAX_IMAGE_BYTES = 2 * 1024 * 1024;
// Base64 length of a MAX_IMAGE_BYTES payload (excluding the data: prefix).
const MAX_IMAGE_BASE64_CHARS = Math.ceil(MAX_IMAGE_BYTES / 3) * 4;
// One image + 12 history turns of ≤1500 chars + page context, with headroom.
const CHAT_MESSAGE_JSON_LIMIT = '4mb';

module.exports = { MAX_IMAGE_BYTES, MAX_IMAGE_BASE64_CHARS, CHAT_MESSAGE_JSON_LIMIT };
