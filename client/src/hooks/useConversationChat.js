import { useState, useEffect, useRef, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import toast from 'react-hot-toast';
import api from '../api/axios';
import { useAuth } from '../context/AuthContext';
import { useSocket } from './useSocket';
import { loadMessageDraft, saveMessageDraft, clearMessageDraft } from '../utils/messageDrafts';
import { toStoredAttachment } from '../utils/messageAttachments';
import { createMessageRequestId } from '../lib/messageRequestId';
import { sendBusinessMessage } from '../api/businessMessaging';
import { resolveSendErrorState } from '../components/messaging/messengerShellState';

const TYPING_EMIT_COOLDOWN = 2000;
const TYPING_AUTO_CLEAR_MS = 5000; // clear indicator if no stop event received (e.g. disconnect)
const NEAR_BOTTOM_PX = 96;
const MESSAGE_PAGE_SIZE = 50;

// Normalize business message attachments to the shape the thread renders.
const mapBusinessMessages = (list) => (Array.isArray(list) ? list : []).map((message) => ({
  ...message,
  attachments: (Array.isArray(message.attachments) ? message.attachments : []).map((attachment) => ({
    url: attachment.url || attachment.file_url,
    filename: attachment.filename || attachment.file_name,
    type: attachment.type || attachment.file_type,
    size: attachment.size || attachment.file_size_bytes,
  })),
}));

/**
 * Shared logic for ConversationPage and HelperConversationPage.
 *
 * @param {string|undefined} conversationId
 * @param {{ extraSocketEvents?: Array<[string, Function]>, listenProfileChat?: boolean, businessId?: string|number }} options
 *   extraSocketEvents: additional [event, handler] pairs
 *   listenProfileChat: when true, handle profile_chat:new_message (job-less profile threads; no message:new from server)
 */
export function useConversationChat(
  conversationId,
  { extraSocketEvents = [], listenProfileChat = false, businessId: workspaceBusinessId = null } = {},
) {
  const [messages, setMessages] = useState([]);
  const [otherName, setOtherName] = useState('');
  const [helperBusiness, setHelperBusiness] = useState('');
  const [businessId, setBusinessId] = useState(null);
  const [jobTitle, setJobTitle] = useState('');
  const [otherUserId, setOtherUserId] = useState(null);
  const [jobId, setJobId] = useState(null);
  const [helperId, setHelperId] = useState(null);
  const [legacyConversationId, setLegacyConversationId] = useState(null);
  const [businessConversationType, setBusinessConversationType] = useState(null);
  const [newMessage, setNewMessage] = useState('');
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [sending, setSending] = useState(false);
  const [notFound, setNotFound] = useState(false);
  const [otherTyping, setOtherTyping] = useState(false);
  const [lastReadAt, setLastReadAt] = useState(null);
  const [isArchived, setIsArchived] = useState(false);
  const [stickToBottom, setStickToBottom] = useState(true);
  // Terminal send states: the composer stays disabled until the thread changes.
  const [sendBlocked, setSendBlocked] = useState(false);
  const [counterpartInactive, setCounterpartInactive] = useState(false);
  // Message history pagination (server limit/offset).
  const [olderLoading, setOlderLoading] = useState(false);
  const [hasMoreMessages, setHasMoreMessages] = useState(false);

  const messagesEndRef = useRef(null);
  const threadRef = useRef(null);
  const inputRef = useRef(null);
  const typingTimerRef = useRef(null);
  const typingAutoClearRef = useRef(null);
  const isTypingRef = useRef(false);
  const messageIdsRef = useRef(new Set());
  const stickToBottomRef = useRef(true);
  // Tracks temp IDs for in-flight optimistic messages (FIFO Set). When the
  // socket echo of our own message arrives, we swap the oldest temp bubble out.
  const pendingTempRef = useRef(new Set());
  const pendingClientMessageRef = useRef(new Map());
  // Server message ordering for pagination: 'asc' (oldest first) or 'desc'
  // (newest first). Detected from the first page so load-more merges correctly
  // whichever way the endpoint orders rows.
  const serverOrderRef = useRef('asc');

  const { user } = useAuth();
  const { socket, connected, joinConversation, leaveConversation } = useSocket();
  const { t } = useTranslation();

  useEffect(() => {
    setLoading(true);
    setLoadError(false);
    setNotFound(false);
    setMessages([]);
    setOtherName('');
    setHelperBusiness('');
    setBusinessId(null);
    setJobTitle('');
    setOtherUserId(null);
    setJobId(null);
    setHelperId(null);
    setLegacyConversationId(null);
    setBusinessConversationType(null);
    setLastReadAt(null);
    setIsArchived(false);
    setOtherTyping(false);
    setStickToBottom(true);
    stickToBottomRef.current = true;
    messageIdsRef.current = new Set();
    pendingTempRef.current = new Set();
    pendingClientMessageRef.current = new Map();
    serverOrderRef.current = 'asc';
    setSendBlocked(false);
    setCounterpartInactive(false);
    setOlderLoading(false);
    setHasMoreMessages(false);
    setNewMessage(loadMessageDraft(conversationId));
  }, [conversationId, workspaceBusinessId]);

  useEffect(() => {
    if (!conversationId) return undefined;
    const timer = setTimeout(() => saveMessageDraft(conversationId, newMessage), 250);
    return () => clearTimeout(timer);
  }, [conversationId, newMessage]);

  // ── Initial load ─────────────────────────────────────────────
  // options.markRead: pass true only when the thread is open AND the tab is
  // visible. Background refetches (socket events) must not mark messages read.
  const fetchMessages = useCallback(async (options = {}) => {
    if (!conversationId) {
      setLoading(false);
      return;
    }
    try {
      setLoadError(false);
      const tabVisible = typeof document === 'undefined' || document.visibilityState === 'visible';
      const params = { limit: MESSAGE_PAGE_SIZE, offset: 0 };
      if (options.markRead ?? tabVisible) params.markRead = true;
      const res = workspaceBusinessId
        ? (await api.get(`/businesses/${workspaceBusinessId}/messages/${conversationId}`, { params })).data
        : await api.get(`/messages/conversations/${conversationId}`, { params }).then((response) => response.data);
      const data = workspaceBusinessId
        ? mapBusinessMessages(res?.messages)
        : (Array.isArray(res) ? res : []);
      messageIdsRef.current = new Set(data.map((m) => m.id));
      // Detect the server's row ordering so load-more merges on the right end.
      if (data.length > 1) {
        const first = new Date(data[0]?.created_at).getTime();
        const last = new Date(data[data.length - 1]?.created_at).getTime();
        serverOrderRef.current = first > last ? 'desc' : 'asc';
      }
      setHasMoreMessages(data.length >= MESSAGE_PAGE_SIZE);
      setMessages(data);
      const other = data.find(m => m.sender_id !== user?.id);
      if (other?.sender_name) setOtherName(other.sender_name);
      if (workspaceBusinessId) {
        setBusinessId(workspaceBusinessId);
        setIsArchived(res?.status === 'archived');
        setLegacyConversationId(res?.legacy_conversation_id || null);
        setBusinessConversationType(res?.conversation_type || null);
        setOtherName(res?.customer_name || res?.subject || 'Business conversation');
        setOtherUserId(res?.customer_id || null);
        setJobTitle(res?.subject || '');
      }
    } catch (err) {
      if (resolveSendErrorState(err) === 'recipient_inactive') {
        setCounterpartInactive(true);
      } else if (err.response?.status === 403 || err.response?.status === 404 || err.response?.status === 410) {
        setNotFound(true);
      } else {
        setLoadError(true);
      }
      console.error('[useConversationChat] fetch error:', err);
    } finally {
      setLoading(false);
    }
  }, [conversationId, user?.id, workspaceBusinessId]);

  useEffect(() => { fetchMessages(); }, [fetchMessages]);

  // ── History pagination: next page via the server's limit/offset params ──
  // Prepends when the server orders newest-first, appends when oldest-first;
  // the merged list is always chronological. Scroll position is preserved when
  // older history is prepended above the viewport.
  const loadMoreMessages = useCallback(async () => {
    if (!conversationId || olderLoading || !hasMoreMessages) return;
    const el = threadRef.current;
    const prevHeight = el ? el.scrollHeight : 0;
    const prevTop = el ? el.scrollTop : 0;
    const prepend = serverOrderRef.current === 'desc';
    setOlderLoading(true);
    try {
      const offset = messages.filter((m) => !String(m.id).startsWith('temp_')).length;
      const params = { limit: MESSAGE_PAGE_SIZE, offset };
      // User-initiated and therefore foreground: read receipts follow the
      // same visibility rule as the initial load.
      if (typeof document === 'undefined' || document.visibilityState === 'visible') {
        params.markRead = true;
      }
      const res = workspaceBusinessId
        ? (await api.get(`/businesses/${workspaceBusinessId}/messages/${conversationId}`, { params })).data
        : await api.get(`/messages/conversations/${conversationId}`, { params }).then((response) => response.data);
      const incoming = workspaceBusinessId
        ? mapBusinessMessages(res?.messages)
        : (Array.isArray(res) ? res : []);
      const fresh = incoming.filter((m) => m && !messageIdsRef.current.has(m.id));
      fresh.forEach((m) => messageIdsRef.current.add(m.id));
      if (fresh.length > 0) {
        setMessages((prev) => {
          const merged = prepend ? [...fresh, ...prev] : [...prev, ...fresh];
          merged.sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
          return merged;
        });
        if (prepend && el) {
          requestAnimationFrame(() => {
            el.scrollTop = el.scrollHeight - prevHeight + prevTop;
          });
        }
      }
      if (incoming.length < MESSAGE_PAGE_SIZE) setHasMoreMessages(false);
    } catch (err) {
      console.error('[useConversationChat] load more error:', err);
    } finally {
      setOlderLoading(false);
    }
  }, [conversationId, workspaceBusinessId, olderLoading, hasMoreMessages, messages]);

  // Load conversation metadata for the header
  useEffect(() => {
    if (!conversationId || workspaceBusinessId) return undefined;
    api.get(`/messages/conversations/${conversationId}/meta`)
      .then(res => {
        if (res.data.other_user_name) setOtherName(res.data.other_user_name);
        if (res.data.helper_business_name) setHelperBusiness(res.data.helper_business_name);
        if (res.data.job_title) setJobTitle(res.data.job_title);
        if (res.data.other_user_id) setOtherUserId(res.data.other_user_id);
        if (res.data.job_id) setJobId(res.data.job_id);
        if (res.data.helper_id) setHelperId(res.data.helper_id);
        if (res.data.business_id != null) setBusinessId(res.data.business_id);
        setIsArchived(res.data.status === 'archived' || Boolean(res.data.archived_at));
      })
      .catch(() => {});
  }, [conversationId, workspaceBusinessId]);

  // ── Join / leave socket room ──────────────────────────────────
  useEffect(() => {
    if (!socket || !connected || !conversationId || workspaceBusinessId) {
      return;
    }
    joinConversation(conversationId);
    return () => {
      leaveConversation(conversationId);
    };
  }, [socket, connected, conversationId, workspaceBusinessId]); // eslint-disable-line react-hooks/exhaustive-deps

  const scrollToLatest = useCallback((behavior = 'smooth') => {
    stickToBottomRef.current = true;
    setStickToBottom(true);
    messagesEndRef.current?.scrollIntoView({ behavior, block: 'end' });
  }, []);

  const handleThreadScroll = useCallback(() => {
    const el = threadRef.current;
    if (!el) return;
    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < NEAR_BOTTOM_PX;
    stickToBottomRef.current = nearBottom;
    setStickToBottom(nearBottom);
  }, []);

  // ── Auto-scroll only when the reader is already at the latest messages
  useEffect(() => {
    if (!stickToBottomRef.current) return;
    messagesEndRef.current?.scrollIntoView({ behavior: loading ? 'auto' : 'smooth', block: 'end' });
  }, [messages, otherTyping, loading]);

  // Helper: clear typing indicator + auto-clear timer
  const clearOtherTyping = useCallback(() => {
    clearTimeout(typingAutoClearRef.current);
    setOtherTyping(false);
  }, []);

  // Read receipts fire only when the thread is open AND the tab is visible.
  // Background callers (socket events, hidden tabs) must not mark read.
  const markConversationRead = useCallback(async () => {
    if (typeof document !== 'undefined' && document.visibilityState !== 'visible') return;
    try {
      const params = { markRead: true, limit: 1 };
      if (workspaceBusinessId) {
        await api.get(`/businesses/${workspaceBusinessId}/messages/${conversationId}`, { params });
      } else {
        await api.get(`/messages/conversations/${conversationId}`, { params });
      }
    } catch (_err) {
      // Best effort: read state will be synced on next successful fetch.
    }
  }, [conversationId, workspaceBusinessId]);

  const appendMessageIfNew = useCallback((incomingMessage) => {
    if (!incomingMessage || messageIdsRef.current.has(incomingMessage.id)) {
      return false;
    }
    messageIdsRef.current.add(incomingMessage.id);
    setMessages((prev) => [...prev, incomingMessage]);
    return true;
  }, []);

  // Replace a temp (optimistic) message with the real server-confirmed one.
  // Also removes the tempId from the dedup set so the real message can be added.
  const replaceTempMessage = useCallback((tempId, realMessage) => {
    for (const [clientMessageId, pendingTempId] of pendingClientMessageRef.current.entries()) {
      if (pendingTempId === tempId) pendingClientMessageRef.current.delete(clientMessageId);
    }
    messageIdsRef.current.delete(tempId);
    if (realMessage && !messageIdsRef.current.has(realMessage.id)) {
      messageIdsRef.current.add(realMessage.id);
    }
    setMessages((prev) =>
      prev.map((m) => (m.id === tempId ? (realMessage || m) : m))
    );
  }, []);

  // ── Real-time events ─────────────────────────────────────────
  useEffect(() => {
    if (!socket) {
      return;
    }

    const onMessageNew = ({ conversationId: cid, message }) => {
      if (String(cid) !== String(conversationId)) {
        return;
      }

      // If this is our own message echoed back from the server (via socket broadcast),
      // and we already have a pending optimistic bubble for it, swap it out cleanly.
      if (message.sender_id === user?.id) {
        const clientMessageId = message.client_message_id || message.clientMessageId;
        const mappedTempId = clientMessageId
          ? pendingClientMessageRef.current.get(clientMessageId)
          : null;
        const hasTempForThis = mappedTempId || pendingTempRef.current.size > 0;
        if (hasTempForThis) {
          // Prefer the durable client ID; retain FIFO only for older clients.
          const [tempId] = mappedTempId ? [mappedTempId] : pendingTempRef.current;
          pendingTempRef.current.delete(tempId);
          replaceTempMessage(tempId, message);
          return;
        }
      }

      const appended = appendMessageIfNew(message);
      if (!appended) return;
      // Only clear "other typing" when the message is from the other party.
      // Our own message echoes would incorrectly hide their typing indicator.
      if (message.sender_id !== user?.id) {
        clearOtherTyping();
        markConversationRead();
      }
      if (message.sender_id !== user?.id && message.sender_name) {
        setOtherName((prev) => prev || message.sender_name);
      }
    };

    const onProfileChatNew = ({ conversationId: cid, message, senderName }) => {
      if (String(cid) !== String(conversationId)) {
        return;
      }
      const enriched =
        senderName && !message.sender_name ? { ...message, sender_name: senderName } : message;
      const appended = appendMessageIfNew(enriched);
      if (!appended) return;
      if (enriched.sender_id !== user?.id) {
        clearOtherTyping();
        markConversationRead();
      }
      if (enriched.sender_id !== user?.id && enriched.sender_name) {
        setOtherName((prev) => prev || enriched.sender_name);
      }
    };

    const onTyping = ({ conversationId: cid, userId }) => {
      if (String(cid) !== String(conversationId)) return;
      if (String(userId) === String(user?.id)) return;
      setOtherTyping(true);
      // Auto-clear safety net: if typing:stop never arrives (e.g. user
      // disconnects mid-typing), clear the indicator after TYPING_AUTO_CLEAR_MS.
      clearTimeout(typingAutoClearRef.current);
      typingAutoClearRef.current = setTimeout(() => {
        setOtherTyping(false);
      }, TYPING_AUTO_CLEAR_MS);
    };

    const onStoppedTyping = ({ conversationId: cid, userId }) => {
      if (String(cid) !== String(conversationId)) return;
      if (String(userId) === String(user?.id)) return;
      clearOtherTyping();
    };

    const onMessagesRead = ({ conversationId: cid, readBy, readAt }) => {
      if (String(cid) !== String(conversationId)) return;
      if (String(readBy) === String(user?.id)) return;
      setLastReadAt(readAt);
    };

    const onMessageDeleted = ({ conversationId: cid, messageId }) => {
      if (String(cid) !== String(conversationId)) return;
      setMessages((prev) => prev.filter((m) => m.id !== messageId));
      messageIdsRef.current.delete(messageId);
    };

    const onMessageUpdated = ({ conversationId: cid, message }) => {
      if (String(cid) !== String(conversationId)) return;
      setMessages((prev) =>
        prev.map((m) => (m.id === message.id ? message : m))
      );
    };


    const onBookingChatUpdated = (payload) => {
      try {
        if (typeof window !== 'undefined') {
          window.dispatchEvent(new CustomEvent('oxs:booking-chat-updated', { detail: payload }));
        }
      } catch { /* ignore */ }
      // Refresh thread so status system messages appear. This is a background
      // refetch: it must not mark messages read.
      fetchMessages({ markRead: false });
    };

    socket.on('message:new', onMessageNew);
    const onBusinessInboxMessage = ({ conversation_id: cid }) => {
      if (workspaceBusinessId && String(cid) === String(conversationId)) fetchMessages({ markRead: false });
    };
    const onBusinessTyping = ({ businessId: bid, conversationId: cid, userId }) => {
      if (!workspaceBusinessId || String(bid) !== String(workspaceBusinessId) || String(cid) !== String(conversationId)) return;
      if (String(userId) === String(user?.id)) return;
      setOtherTyping(true);
      clearTimeout(typingAutoClearRef.current);
      typingAutoClearRef.current = setTimeout(() => setOtherTyping(false), TYPING_AUTO_CLEAR_MS);
    };
    const onBusinessStoppedTyping = ({ businessId: bid, conversationId: cid, userId }) => {
      if (!workspaceBusinessId || String(bid) !== String(workspaceBusinessId) || String(cid) !== String(conversationId)) return;
      if (String(userId) === String(user?.id)) return;
      clearOtherTyping();
    };
    if (workspaceBusinessId) socket.on('business_inbox:message', onBusinessInboxMessage);
    if (workspaceBusinessId) {
      socket.on('business:user:typing', onBusinessTyping);
      socket.on('business:user:stopped_typing', onBusinessStoppedTyping);
    }
    socket.on('booking:chat_updated', onBookingChatUpdated);
    socket.on('user:typing', onTyping);
    socket.on('user:stopped_typing', onStoppedTyping);
    socket.on('messages:read', onMessagesRead);
    socket.on('message:deleted', onMessageDeleted);
    socket.on('message:updated', onMessageUpdated);
    if (listenProfileChat) {
      socket.on('profile_chat:new_message', onProfileChatNew);
    }

    for (const [event, handler] of extraSocketEvents) {
      socket.on(event, handler);
    }

    return () => {
      socket.off('message:new', onMessageNew);
      if (workspaceBusinessId) socket.off('business_inbox:message', onBusinessInboxMessage);
      if (workspaceBusinessId) {
        socket.off('business:user:typing', onBusinessTyping);
        socket.off('business:user:stopped_typing', onBusinessStoppedTyping);
      }
      socket.off('booking:chat_updated', onBookingChatUpdated);
      socket.off('user:typing', onTyping);
      socket.off('user:stopped_typing', onStoppedTyping);
      socket.off('messages:read', onMessagesRead);
      socket.off('message:deleted', onMessageDeleted);
      socket.off('message:updated', onMessageUpdated);
      if (listenProfileChat) {
        socket.off('profile_chat:new_message', onProfileChatNew);
      }
      for (const [event, handler] of extraSocketEvents) {
        socket.off(event, handler);
      }
    };
  }, [socket, conversationId, user?.id, clearOtherTyping, markConversationRead, appendMessageIfNew, listenProfileChat, workspaceBusinessId, fetchMessages]); // eslint-disable-line react-hooks/exhaustive-deps -- extraSocketEvents intentionally omitted (often new [] per render)

  // ── Typing indicator emit ─────────────────────────────────────
  const handleInputChange = (e) => {
    setNewMessage(e.target.value);
    if (!socket) return;
    if (!isTypingRef.current) {
      socket.emit(
        workspaceBusinessId ? 'business:typing:start' : 'typing:start',
        workspaceBusinessId ? { businessId: workspaceBusinessId, conversationId } : conversationId,
      );
      isTypingRef.current = true;
    }
    clearTimeout(typingTimerRef.current);
    typingTimerRef.current = setTimeout(() => {
      socket.emit(
        workspaceBusinessId ? 'business:typing:stop' : 'typing:stop',
        workspaceBusinessId ? { businessId: workspaceBusinessId, conversationId } : conversationId,
      );
      isTypingRef.current = false;
    }, TYPING_EMIT_COOLDOWN);
  };

  const stopTypingEmit = useCallback(() => {
    if (isTypingRef.current && socket) {
      clearTimeout(typingTimerRef.current);
      socket.emit(
        workspaceBusinessId ? 'business:typing:stop' : 'typing:stop',
        workspaceBusinessId ? { businessId: workspaceBusinessId, conversationId } : conversationId,
      );
      isTypingRef.current = false;
    }
  }, [socket, conversationId, workspaceBusinessId]);

  const handleBlur = () => stopTypingEmit();

  // ── Send ──────────────────────────────────────────────────────
  const sendContent = useCallback(async (content, tempId, attachments = [], clientMessageId) => {
    try {
      const businessAttachments = attachments.map((attachment) => ({
        file_url: attachment.url,
        file_name: attachment.filename || attachment.name || 'Attachment',
        file_size_bytes: attachment.size || attachment.file_size_bytes || null,
        file_type: attachment.type || attachment.mimeType || attachment.file_type || null,
      }));
      const res = workspaceBusinessId
        ? await sendBusinessMessage(workspaceBusinessId, conversationId, {
          content,
          attachments: businessAttachments,
          clientMessageId,
        })
        : await api.post(`/messages/conversations/${conversationId}`, {
          content,
          attachments,
          clientMessageId,
        }).then((response) => response.data);
      pendingTempRef.current.delete(tempId);
      replaceTempMessage(tempId, workspaceBusinessId
        ? { ...res, attachments }
        : res);
      // Contact deterrence: calm, non-accusatory notice to the sender.
      const warnings = res?.warnings;
      if (Array.isArray(warnings) && warnings.includes('off_platform_contact')) {
        toast(t('messages.offPlatformWarning'), { icon: 'i', duration: 6000 });
      }
    } catch (err) {
      const terminalState = resolveSendErrorState(err);
      if (terminalState === 'blocked_by_user') {
        // The viewer was blocked: terminal state, composer stays disabled,
        // and no retry loop is offered.
        setSendBlocked(true);
        pendingTempRef.current.delete(tempId);
        setMessages((prev) =>
          prev.map((m) => (m.id === tempId ? { ...m, _pending: false, _failed: true } : m))
        );
        toast.error(t('messages.blockedSendText'));
        return;
      }
      if (terminalState === 'recipient_inactive') {
        setCounterpartInactive(true);
        pendingTempRef.current.delete(tempId);
        setMessages((prev) =>
          prev.map((m) => (m.id === tempId ? { ...m, _pending: false, _failed: true } : m))
        );
        toast.error(t('messages.recipientInactiveText'));
        return;
      }
      console.error('[useConversationChat] send error:', err);
      pendingTempRef.current.delete(tempId);
      setMessages((prev) =>
        prev.map((m) => (m.id === tempId ? { ...m, _pending: false, _failed: true } : m))
      );
    }
  }, [conversationId, replaceTempMessage, workspaceBusinessId, t]);

  const sendMessage = useCallback(async ({ content, attachments } = {}) => {
    // Terminal states: the composer is disabled, so never attempt a send.
    if (sendBlocked || counterpartInactive) return;
    const storedAttachments = (attachments || []).map(toStoredAttachment).filter(Boolean);
    const text = (content ?? newMessage).trim();
    if ((!text && storedAttachments.length === 0) || sending || !conversationId) return;

    stopTypingEmit();
    setSending(true);
    setNewMessage('');
    clearMessageDraft(conversationId);
    stickToBottomRef.current = true;
    setStickToBottom(true);

    const tempId = `temp_${Date.now()}_${Math.random().toString(36).slice(2)}`;
    const clientMessageId = createMessageRequestId();
    const optimisticMsg = {
      id: tempId,
      content: text,
      attachments: storedAttachments,
      sender_id: user?.id,
      sender_name: `${user?.first_name || ''} ${user?.last_name || ''}`.trim() || user?.name || '',
      created_at: new Date().toISOString(),
      _pending: true,
      _failed: false,
      _clientMessageId: clientMessageId,
    };
    messageIdsRef.current.add(tempId);
    pendingTempRef.current.add(tempId);
    pendingClientMessageRef.current.set(clientMessageId, tempId);
    setMessages((prev) => [...prev, optimisticMsg]);
    setSending(false);
    inputRef.current?.focus();

    await sendContent(text, tempId, storedAttachments, clientMessageId);
  }, [newMessage, sending, stopTypingEmit, conversationId, user, sendContent, sendBlocked, counterpartInactive]);

  const handleSend = useCallback(async (e) => {
    e?.preventDefault?.();
    await sendMessage();
  }, [sendMessage]);

  const retryMessage = useCallback(async (tempId) => {
    if (sendBlocked || counterpartInactive) return;
    setMessages((prev) =>
      prev.map((m) => (m.id === tempId ? { ...m, _pending: true, _failed: false } : m))
    );
    pendingTempRef.current.add(tempId);
    const msg = await new Promise((resolve) => {
      setMessages((prev) => {
        const found = prev.find((m) => m.id === tempId);
        resolve(found);
        return prev;
      });
    });
    if (msg?.content || (msg?.attachments || []).length) {
      const clientMessageId = msg._clientMessageId || createMessageRequestId();
      if (!msg._clientMessageId) {
        setMessages((prev) => prev.map((item) => item.id === tempId
          ? { ...item, _clientMessageId: clientMessageId }
          : item));
      }
      pendingClientMessageRef.current.set(clientMessageId, tempId);
      await sendContent(msg.content || '', tempId, msg.attachments || [], clientMessageId);
    }
  }, [sendContent, sendBlocked, counterpartInactive]);

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  // ── Derived: "Seen" indicator ─────────────────────────────────
  const lastSentByMe = [...messages].reverse().find(m => m.sender_id === user?.id && !m._pending && !m._failed);
  const showSeen = lastReadAt && lastSentByMe &&
    new Date(lastReadAt) >= new Date(lastSentByMe.created_at);

  return {
    messages,
    fetchMessages,
    loadMoreMessages,
    hasMoreMessages,
    olderLoading,
    otherName,
    helperBusiness,
    jobTitle,
    otherUserId,
    jobId,
    helperId,
    legacyConversationId,
    businessConversationType,
    businessId,
    newMessage,
    loading,
    loadError,
    sending,
    notFound,
    sendBlocked,
    counterpartInactive,
    otherTyping,
    showSeen,
    lastSentByMe,
    stickToBottom,
    isArchived,
    isBusinessConversation: Boolean(workspaceBusinessId),
    messagesEndRef,
    threadRef,
    inputRef,
    handleInputChange,
    handleBlur,
    handleSend,
    handleKeyDown,
    sendMessage,
    retryMessage,
    handleThreadScroll,
    scrollToLatest,
    setNewMessage,
    user,
  };
}
