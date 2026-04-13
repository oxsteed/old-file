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

  const { user } = useAuth();
  const { socket, connected, joinConversation, leaveConversation } = useSocket();

  // ── Initial load ─────────────────────────────────────────────
  const fetchMessages = useCallback(async () => {
    try {
      const res = await api.get(`/messages/conversations/${conversationId}`);
      const data = Array.isArray(res.data) ? res.data : [];
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
    if (!socket || !connected || !conversationId) return;
    joinConversation(conversationId);
    return () => leaveConversation(conversationId);
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

  // ── Real-time events ─────────────────────────────────────────
  useEffect(() => {
    if (!socket) return;

    const onMessageNew = ({ conversationId: cid, message }) => {
      if (String(cid) !== String(conversationId)) return;
      // Only clear "other typing" when the message is from the other party.
      // Our own message echoes would incorrectly hide their typing indicator.
      if (message.sender_id !== user?.id) {
        clearOtherTyping();
        markConversationRead();
      }
      setMessages(prev => {
        if (prev.some(m => m.id === message.id)) return prev;
        return [...prev, message];
      });
      if (message.sender_id !== user?.id && message.sender_name) {
        setOtherName((prev) => prev || message.sender_name);
      }
    };

    const onProfileChatNew = ({ conversationId: cid, message, senderName }) => {
      if (String(cid) !== String(conversationId)) return;
      const enriched =
        senderName && !message.sender_name ? { ...message, sender_name: senderName } : message;
      if (enriched.sender_id !== user?.id) {
        clearOtherTyping();
        markConversationRead();
      }
      setMessages((prev) => {
        if (prev.some((m) => m.id === enriched.id)) return prev;
        return [...prev, enriched];
      });
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

    socket.on('message:new', onMessageNew);
    socket.on('user:typing', onTyping);
    socket.on('user:stopped_typing', onStoppedTyping);
    socket.on('messages:read', onMessagesRead);
    if (listenProfileChat) {
      socket.on('profile_chat:new_message', onProfileChatNew);
    }

    for (const [event, handler] of extraSocketEvents) {
      socket.on(event, handler);
    }

    return () => {
      socket.off('message:new', onMessageNew);
      socket.off('user:typing', onTyping);
      socket.off('user:stopped_typing', onStoppedTyping);
      socket.off('messages:read', onMessagesRead);
      if (listenProfileChat) {
        socket.off('profile_chat:new_message', onProfileChatNew);
      }
      for (const [event, handler] of extraSocketEvents) {
        socket.off(event, handler);
      }
    };
  }, [socket, conversationId, user?.id, clearOtherTyping, markConversationRead, listenProfileChat]); // eslint-disable-line react-hooks/exhaustive-deps -- extraSocketEvents intentionally omitted (often new [] per render)

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
  const handleSend = async (e) => {
    e?.preventDefault();
    const content = newMessage.trim();
    if (!content || sending) return;
    stopTypingEmit();
    setSending(true);
    setNewMessage('');
    try {
      const res = await api.post(`/messages/conversations/${conversationId}`, { content });
      setMessages(prev => {
        if (prev.some(m => m.id === res.data.id)) return prev;
        return [...prev, res.data];
      });
    } catch (err) {
      console.error('[useConversationChat] send error:', err);
      setNewMessage(content);
    } finally {
      setSending(false);
      inputRef.current?.focus();
    }
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  // ── Derived: "Seen" indicator ─────────────────────────────────
  const lastSentByMe = [...messages].reverse().find(m => m.sender_id === user?.id);
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
    // Auth
    user,
  };
}
