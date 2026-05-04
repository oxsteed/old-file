import { useState, useEffect, useRef, useCallback } from 'react';
import api from '../api/axios';
import { useAuth } from '../context/AuthContext';
import { useSocket } from './useSocket';

const TYPING_EMIT_COOLDOWN = 2000;
const TYPING_AUTO_CLEAR_MS = 5000; // clear indicator if no stop event received (e.g. disconnect)

/**
 * Shared logic for ConversationPage and HelperConversationPage.
 *
 * @param {string|undefined} conversationId
 * @param {{ extraSocketEvents?: Array<[string, Function]>, listenProfileChat?: boolean }} options
 *   extraSocketEvents: additional [event, handler] pairs
 *   listenProfileChat: when true, handle profile_chat:new_message (job-less profile threads; no message:new from server)
 */
export function useConversationChat(conversationId, { extraSocketEvents = [], listenProfileChat = false } = {}) {
  const [messages, setMessages] = useState([]);
  const [otherName, setOtherName] = useState('');
  const [helperBusiness, setHelperBusiness] = useState('');
  const [jobTitle, setJobTitle] = useState('');
  const [newMessage, setNewMessage] = useState('');
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [notFound, setNotFound] = useState(false);
  const [otherTyping, setOtherTyping] = useState(false);
  const [lastReadAt, setLastReadAt] = useState(null);

  const messagesEndRef = useRef(null);
  const inputRef = useRef(null);
  const typingTimerRef = useRef(null);
  const typingAutoClearRef = useRef(null);
  const isTypingRef = useRef(false);
  const messageIdsRef = useRef(new Set());
  // Tracks temp IDs for in-flight optimistic messages (FIFO Set). When the
  // socket echo of our own message arrives, we swap the oldest temp bubble out.
  const pendingTempRef = useRef(new Set());

  const { user } = useAuth();
  const { socket, connected, joinConversation, leaveConversation } = useSocket();

  // ── Initial load ─────────────────────────────────────────────
  const fetchMessages = useCallback(async () => {
    try {
      const res = await api.get(`/messages/conversations/${conversationId}`);
      const data = Array.isArray(res.data) ? res.data : [];
      messageIdsRef.current = new Set(data.map((m) => m.id));
      setMessages(data);
      const other = data.find(m => m.sender_id !== user?.id);
      if (other?.sender_name) setOtherName(other.sender_name);
    } catch (err) {
      if (err.response?.status === 403 || err.response?.status === 404) {
        setNotFound(true);
      }
      console.error('[useConversationChat] fetch error:', err);
    } finally {
      setLoading(false);
    }
  }, [conversationId, user?.id]);

  useEffect(() => { fetchMessages(); }, [fetchMessages]);

  // Load conversation metadata for the header
  useEffect(() => {
    api.get(`/messages/conversations/${conversationId}/meta`)
      .then(res => {
        if (res.data.other_user_name) setOtherName(res.data.other_user_name);
        if (res.data.helper_business_name) setHelperBusiness(res.data.helper_business_name);
        if (res.data.job_title) setJobTitle(res.data.job_title);
      })
      .catch(() => {});
  }, [conversationId]);

  // ── Join / leave socket room ──────────────────────────────────
  useEffect(() => {
    if (!socket || !connected || !conversationId) {
      console.log('[useConversationChat] Skipping room join:', {
        hasSocket: !!socket,
        connected,
        conversationId,
      });
      return;
    }
    console.log('[useConversationChat] Joining conversation room:', conversationId);
    joinConversation(conversationId);
    return () => {
      console.log('[useConversationChat] Leaving conversation room:', conversationId);
      leaveConversation(conversationId);
    };
  }, [socket, connected, conversationId]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Auto-scroll ───────────────────────────────────────────────
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, otherTyping]);

  // Helper: clear typing indicator + auto-clear timer
  const clearOtherTyping = useCallback(() => {
    clearTimeout(typingAutoClearRef.current);
    setOtherTyping(false);
  }, []);

  const markConversationRead = useCallback(async () => {
    try {
      await api.get(`/messages/conversations/${conversationId}`);
    } catch (_err) {
      // Best effort: read state will be synced on next successful fetch.
    }
  }, [conversationId]);

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
      console.log('[useConversationChat] No socket available, skipping listener setup');
      return;
    }

    console.log('[useConversationChat] Setting up socket listeners for conversation:', conversationId, { listenProfileChat });

    const onMessageNew = ({ conversationId: cid, message }) => {
      console.log('[useConversationChat] Received message:new event:', { cid, conversationId, messageId: message?.id });
      if (String(cid) !== String(conversationId)) {
        console.log('[useConversationChat] Ignoring message:new - conversation ID mismatch');
        return;
      }

      // If this is our own message echoed back from the server (via socket broadcast),
      // and we already have a pending optimistic bubble for it, swap it out cleanly.
      if (message.sender_id === user?.id) {
        const hasTempForThis = pendingTempRef.current.size > 0;
        if (hasTempForThis) {
          // Find the oldest pending temp message (FIFO) and replace it.
          const [tempId] = pendingTempRef.current;
          pendingTempRef.current.delete(tempId);
          replaceTempMessage(tempId, message);
          return;
        }
      }

      const appended = appendMessageIfNew(message);
      console.log('[useConversationChat] Message appended:', appended, message?.content?.substring(0, 50));
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
      console.log('[useConversationChat] Received profile_chat:new_message event:', { cid, conversationId, messageId: message?.id, senderName });
      if (String(cid) !== String(conversationId)) {
        console.log('[useConversationChat] Ignoring profile_chat:new_message - conversation ID mismatch');
        return;
      }
      const enriched =
        senderName && !message.sender_name ? { ...message, sender_name: senderName } : message;
      const appended = appendMessageIfNew(enriched);
      console.log('[useConversationChat] Profile chat message appended:', appended, message?.content?.substring(0, 50));
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

    console.log('[useConversationChat] Attaching socket listeners');
    socket.on('message:new', onMessageNew);
    socket.on('user:typing', onTyping);
    socket.on('user:stopped_typing', onStoppedTyping);
    socket.on('messages:read', onMessagesRead);
    socket.on('message:deleted', onMessageDeleted);
    socket.on('message:updated', onMessageUpdated);
    if (listenProfileChat) {
      console.log('[useConversationChat] Attaching profile_chat:new_message listener');
      socket.on('profile_chat:new_message', onProfileChatNew);
    }

    for (const [event, handler] of extraSocketEvents) {
      socket.on(event, handler);
    }

    return () => {
      console.log('[useConversationChat] Detaching socket listeners for conversation:', conversationId);
      socket.off('message:new', onMessageNew);
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
  }, [socket, conversationId, user?.id, clearOtherTyping, markConversationRead, appendMessageIfNew, listenProfileChat]); // eslint-disable-line react-hooks/exhaustive-deps -- extraSocketEvents intentionally omitted (often new [] per render)

  // ── Typing indicator emit ─────────────────────────────────────
  const handleInputChange = (e) => {
    setNewMessage(e.target.value);
    if (!socket) return;
    if (!isTypingRef.current) {
      socket.emit('typing:start', conversationId);
      isTypingRef.current = true;
    }
    clearTimeout(typingTimerRef.current);
    typingTimerRef.current = setTimeout(() => {
      socket.emit('typing:stop', conversationId);
      isTypingRef.current = false;
    }, TYPING_EMIT_COOLDOWN);
  };

  const stopTypingEmit = useCallback(() => {
    if (isTypingRef.current && socket) {
      clearTimeout(typingTimerRef.current);
      socket.emit('typing:stop', conversationId);
      isTypingRef.current = false;
    }
  }, [socket, conversationId]);

  const handleBlur = () => stopTypingEmit();

  // ── Send ──────────────────────────────────────────────────────
  // Core send logic shared by handleSend and retryMessage.
  const sendContent = useCallback(async (content, tempId) => {
    try {
      const res = await api.post(`/messages/conversations/${conversationId}`, { content });
      console.log('[useConversationChat] Message sent successfully, ID:', res.data?.id);
      // Remove from pending set; socket echo may or may not have already swapped it.
      pendingTempRef.current.delete(tempId);
      replaceTempMessage(tempId, res.data);
    } catch (err) {
      console.error('[useConversationChat] send error:', err);
      pendingTempRef.current.delete(tempId);
      // Mark the optimistic bubble as failed so the user can retry.
      setMessages((prev) =>
        prev.map((m) => (m.id === tempId ? { ...m, _pending: false, _failed: true } : m))
      );
    }
  }, [conversationId, replaceTempMessage]);

  const handleSend = useCallback(async (e) => {
    e?.preventDefault();
    const content = newMessage.trim();
    if (!content || sending) return;
    console.log('[useConversationChat] Sending message:', { conversationId, contentLength: content.length });
    stopTypingEmit();
    setSending(true);
    setNewMessage('');

    // Optimistic: show the message immediately before the server responds.
    const tempId = `temp_${Date.now()}_${Math.random().toString(36).slice(2)}`;
    const optimisticMsg = {
      id: tempId,
      content,
      sender_id: user?.id,
      sender_name: `${user?.first_name || ''} ${user?.last_name || ''}`.trim() || user?.name || '',
      created_at: new Date().toISOString(),
      _pending: true,
      _failed: false,
    };
    messageIdsRef.current.add(tempId);
    pendingTempRef.current.add(tempId);
    setMessages((prev) => [...prev, optimisticMsg]);
    setSending(false);
    inputRef.current?.focus();

    await sendContent(content, tempId);
  }, [newMessage, sending, stopTypingEmit, conversationId, user, sendContent]);

  // Retry a previously failed optimistic message.
  const retryMessage = useCallback(async (tempId) => {
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
    if (msg?.content) {
      await sendContent(msg.content, tempId);
    }
  }, [sendContent]);

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  // ── Derived: "Seen" indicator ─────────────────────────────────
  // Exclude optimistic/pending messages - only show "Seen" for server-confirmed ones.
  const lastSentByMe = [...messages].reverse().find(m => m.sender_id === user?.id && !m._pending && !m._failed);
  const showSeen = lastReadAt && lastSentByMe &&
    new Date(lastReadAt) >= new Date(lastSentByMe.created_at);

  return {
    // State
    messages,
    otherName,
    helperBusiness,
    jobTitle,
    newMessage,
    loading,
    sending,
    notFound,
    otherTyping,
    showSeen,
    lastSentByMe,
    // Refs
    messagesEndRef,
    inputRef,
    // Handlers
    handleInputChange,
    handleBlur,
    handleSend,
    handleKeyDown,
    retryMessage,
    // Auth
    user,
  };
}
