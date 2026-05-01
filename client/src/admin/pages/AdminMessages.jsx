import { useState, useEffect, useRef, useCallback } from 'react';
import { useAuth } from '../../hooks/useAuth';
import { useSocket } from '../../hooks/useSocket';
import api from '../../api/axios';

const adminApi = (path, opts) => api(path.startsWith('/api') ? path : `/admin${path}`, opts);

function formatTime(ts) {
  if (!ts) return '';
  const d = new Date(ts);
  const now = new Date();
  const diffDays = Math.floor((now - d) / 86400000);
  if (diffDays === 0) return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  if (diffDays === 1) return 'Yesterday';
  if (diffDays < 7)  return d.toLocaleDateString([], { weekday: 'short' });
  return d.toLocaleDateString([], { month: 'short', day: 'numeric' });
}

export default function AdminMessages() {
  const { user }       = useAuth();
  const { socket }     = useSocket();
  const [conversations, setConversations] = useState([]);
  const [selected,      setSelected]      = useState(null); // { userId, user, conversation_id }
  const [thread,        setThread]        = useState([]);
  const [threadLoading, setThreadLoading] = useState(false);
  const [listLoading,   setListLoading]   = useState(true);
  const [message,       setMessage]       = useState('');
  const [sending,       setSending]       = useState(false);
  const [searchInput,   setSearchInput]   = useState('');
  const [newUserSearch, setNewUserSearch] = useState('');
  const [newUserResults,setNewUserResults]= useState([]);
  const [showNewModal,  setShowNewModal]  = useState(false);
  const bottomRef = useRef(null);
  const inputRef  = useRef(null);

  const loadConversations = useCallback(async (q = '') => {
    try {
      const { data } = await adminApi(`/messages/conversations?q=${encodeURIComponent(q)}&limit=100`);
      setConversations(data.conversations || []);
    } catch {
      // silent
    } finally {
      setListLoading(false);
    }
  }, []);

  useEffect(() => { loadConversations(); }, [loadConversations]);

  useEffect(() => {
    if (!socket) return;
    const handler = () => loadConversations(searchInput);
    socket.on('admin:message', handler);
    socket.on('message:new',   handler);
    return () => {
      socket.off('admin:message', handler);
      socket.off('message:new',   handler);
    };
  }, [socket, searchInput, loadConversations]);

  const openThread = async (conv) => {
    setSelected({ userId: conv.user_id, user: conv, conversation_id: conv.id });
    setThreadLoading(true);
    try {
      const { data } = await adminApi(`/messages/conversations/${conv.user_id}`);
      setThread(data.messages || []);
      // Mark as read in the list
      setConversations(prev => prev.map(c =>
        c.id === conv.id ? { ...c, unread_count: 0 } : c
      ));
    } catch {
      setThread([]);
    } finally {
      setThreadLoading(false);
      setTimeout(() => { bottomRef.current?.scrollIntoView({ behavior: 'instant' }); }, 50);
      inputRef.current?.focus();
    }
  };

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [thread]);

  const handleSend = async (e) => {
    e?.preventDefault();
    if (!selected || !message.trim() || sending) return;
    const content = message.trim();
    setMessage('');
    setSending(true);
    const optimistic = {
      id:              `opt-${Date.now()}`,
      sender_id:       user.id,
      content,
      message_type:    'system',
      created_at:      new Date().toISOString(),
      sender_first_name: user.first_name,
      sender_last_name:  user.last_name,
      sender_role:       user.role,
    };
    setThread(prev => [...prev, optimistic]);
    try {
      const { data } = await adminApi(`/messages/conversations/${selected.userId}/send`, {
        method: 'POST',
        data:   { content },
      });
      setThread(prev => prev.map(m =>
        m.id === optimistic.id ? { ...optimistic, id: data.message_id, created_at: data.created_at } : m
      ));
      loadConversations(searchInput);
    } catch {
      setThread(prev => prev.filter(m => m.id !== optimistic.id));
    } finally {
      setSending(false);
    }
  };

  const searchNewUser = async (q) => {
    setNewUserSearch(q);
    if (q.length < 2) { setNewUserResults([]); return; }
    try {
      const { data } = await adminApi(`/users?q=${encodeURIComponent(q)}&limit=10`);
      setNewUserResults(data.users || []);
    } catch { setNewUserResults([]); }
  };

  const startConversation = async (targetUser) => {
    setShowNewModal(false);
    setNewUserSearch('');
    setNewUserResults([]);
    // Open thread for this user (may have no messages yet)
    const fakeConv = {
      id: null,
      user_id:        targetUser.id,
      user_first_name: targetUser.first_name,
      user_last_name:  targetUser.last_name,
      user_email:      targetUser.email,
      user_role:       targetUser.role,
      last_message:    null,
      last_message_at: null,
      unread_count:    0,
    };
    setSelected({ userId: targetUser.id, user: fakeConv });
    setThreadLoading(true);
    try {
      const { data } = await adminApi(`/messages/conversations/${targetUser.id}`);
      setThread(data.messages || []);
    } catch { setThread([]); }
    finally { setThreadLoading(false); }
    setTimeout(() => inputRef.current?.focus(), 100);
  };

  return (
    <div className="h-[calc(100vh-64px)] flex bg-gray-900 text-white overflow-hidden">
      {/* Left pane - conversation list */}
      <div className={`w-full sm:w-80 flex-shrink-0 border-r border-gray-800 flex flex-col ${selected ? 'hidden sm:flex' : 'flex'}`}>
        <div className="p-4 border-b border-gray-800 flex items-center gap-2">
          <h1 className="text-base font-semibold flex-1">Admin Messages</h1>
          <button
            onClick={() => setShowNewModal(true)}
            className="px-3 py-1.5 rounded-lg bg-orange-500 hover:bg-orange-600 text-white text-xs font-medium transition"
          >
            + New
          </button>
        </div>
        <div className="px-3 py-2 border-b border-gray-800">
          <input
            type="text"
            value={searchInput}
            onChange={e => { setSearchInput(e.target.value); loadConversations(e.target.value); }}
            placeholder="Search by name or email…"
            className="w-full rounded-lg bg-gray-800 border border-gray-700 px-3 py-1.5 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-orange-500"
          />
        </div>
        <div className="flex-1 overflow-y-auto">
          {listLoading && (
            <p className="text-sm text-gray-500 text-center py-6">Loading…</p>
          )}
          {!listLoading && conversations.length === 0 && (
            <p className="text-sm text-gray-500 text-center py-6">No conversations yet.</p>
          )}
          {conversations.map(conv => (
            <button
              key={conv.id ?? conv.user_id}
              onClick={() => openThread(conv)}
              className={`w-full text-left px-4 py-3 border-b border-gray-800/50 hover:bg-gray-800 transition flex gap-3 items-start ${
                selected?.userId === conv.user_id ? 'bg-gray-800' : ''
              }`}
            >
              <div className="w-9 h-9 rounded-full bg-gray-700 flex items-center justify-center text-sm font-bold text-gray-300 flex-shrink-0">
                {(conv.user_first_name || '?').charAt(0).toUpperCase()}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between gap-1">
                  <span className="text-sm font-medium text-white truncate">
                    {conv.user_first_name} {conv.user_last_name}
                  </span>
                  {conv.last_message_at && (
                    <span className="text-[11px] text-gray-500 flex-shrink-0">{formatTime(conv.last_message_at)}</span>
                  )}
                </div>
                <p className="text-xs text-gray-500 truncate">{conv.user_email}</p>
                {conv.last_message && (
                  <p className="text-xs text-gray-400 truncate mt-0.5">{conv.last_message}</p>
                )}
              </div>
              {conv.unread_count > 0 && (
                <span className="flex-shrink-0 w-4 h-4 rounded-full bg-orange-500 text-white text-[10px] font-bold flex items-center justify-center">
                  {conv.unread_count}
                </span>
              )}
            </button>
          ))}
        </div>
      </div>

      {/* Right pane - thread */}
      <div className={`flex-1 flex flex-col ${selected ? 'flex' : 'hidden sm:flex'}`}>
        {!selected ? (
          <div className="flex-1 flex items-center justify-center text-gray-600 text-sm">
            Select a conversation or start a new one
          </div>
        ) : (
          <>
            {/* Thread header */}
            <div className="px-4 py-3 border-b border-gray-800 flex items-center gap-3">
              <button
                onClick={() => setSelected(null)}
                className="sm:hidden p-1 rounded text-gray-400 hover:text-white"
                aria-label="Back"
              >
                ←
              </button>
              <div className="w-8 h-8 rounded-full bg-gray-700 flex items-center justify-center text-xs font-bold text-gray-300">
                {(selected.user.user_first_name || '?').charAt(0).toUpperCase()}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-white truncate">
                  {selected.user.user_first_name} {selected.user.user_last_name}
                </p>
                <p className="text-xs text-gray-500 truncate">{selected.user.user_email}</p>
              </div>
              <span className="text-[11px] text-gray-600 bg-gray-800 px-2 py-0.5 rounded uppercase">
                {selected.user.user_role}
              </span>
            </div>

            {/* Notice */}
            <div className="px-4 py-2 bg-yellow-900/20 border-b border-yellow-800/30 text-xs text-yellow-300/80">
              ⚠️ Messages sent here are visible to the user in their inbox and logged to the audit trail.
            </div>

            {/* Messages */}
            <div className="flex-1 overflow-y-auto px-4 py-4 space-y-3">
              {threadLoading && <p className="text-center text-sm text-gray-500">Loading…</p>}
              {!threadLoading && thread.length === 0 && (
                <p className="text-center text-sm text-gray-600">No messages yet. Send the first message below.</p>
              )}
              {thread.map(msg => {
                const isAdmin = ['admin', 'super_admin'].includes(msg.sender_role);
                return (
                  <div key={msg.id} className={`flex ${isAdmin ? 'justify-end' : 'justify-start'}`}>
                    <div className={`max-w-[75%] px-3.5 py-2.5 rounded-2xl text-sm leading-relaxed ${
                      isAdmin
                        ? 'bg-orange-600 text-white rounded-br-sm'
                        : 'bg-gray-700/80 text-gray-100 rounded-bl-sm'
                    }`}>
                      {!isAdmin && (
                        <p className="text-[10px] font-medium text-gray-400 mb-1">
                          {msg.sender_first_name} {msg.sender_last_name}
                        </p>
                      )}
                      <p className="whitespace-pre-wrap">{msg.content}</p>
                      <p className={`text-[10px] mt-1 ${isAdmin ? 'text-orange-200/70' : 'text-gray-500'}`}>
                        {formatTime(msg.created_at)}
                        {isAdmin && (
                          <span className="ml-1.5">
                            - {msg.sender_first_name} ({msg.sender_role === 'super_admin' ? 'Super Admin' : 'Admin'})
                          </span>
                        )}
                      </p>
                    </div>
                  </div>
                );
              })}
              <div ref={bottomRef} />
            </div>

            {/* Compose */}
            <form onSubmit={handleSend} className="flex gap-2 px-4 py-3 border-t border-gray-800">
              <textarea
                ref={inputRef}
                value={message}
                onChange={e => setMessage(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); } }}
                placeholder="Type a message to the user…"
                maxLength={4000}
                disabled={sending}
                rows={2}
                className="flex-1 rounded-xl bg-gray-800 border border-gray-700 text-white placeholder-gray-500 text-sm px-3 py-2 resize-none focus:outline-none focus:ring-1 focus:ring-orange-500 disabled:opacity-50"
              />
              <button
                type="submit"
                disabled={!message.trim() || sending}
                className="flex-shrink-0 px-4 rounded-xl bg-orange-500 hover:bg-orange-600 disabled:bg-gray-700 disabled:text-gray-500 text-white text-sm font-semibold transition self-end pb-2 pt-2"
              >
                Send
              </button>
            </form>
          </>
        )}
      </div>

      {/* New conversation modal */}
      {showNewModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="bg-gray-900 border border-gray-700 rounded-2xl p-6 w-full max-w-md shadow-2xl">
            <h2 className="text-base font-semibold mb-4">New Conversation</h2>
            <input
              type="text"
              autoFocus
              value={newUserSearch}
              onChange={e => searchNewUser(e.target.value)}
              placeholder="Search user by name or email…"
              className="w-full rounded-xl bg-gray-800 border border-gray-700 px-3 py-2 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-orange-500 mb-3"
            />
            <div className="space-y-1 max-h-48 overflow-y-auto">
              {newUserResults.map(u => (
                <button
                  key={u.id}
                  onClick={() => startConversation(u)}
                  className="w-full text-left px-3 py-2 rounded-lg hover:bg-gray-800 transition flex items-center gap-2.5"
                >
                  <div className="w-7 h-7 rounded-full bg-gray-700 flex items-center justify-center text-xs font-bold text-gray-300 flex-shrink-0">
                    {(u.first_name || '?').charAt(0).toUpperCase()}
                  </div>
                  <div>
                    <p className="text-sm text-white">{u.first_name} {u.last_name}</p>
                    <p className="text-xs text-gray-500">{u.email} · {u.role}</p>
                  </div>
                </button>
              ))}
              {newUserSearch.length >= 2 && newUserResults.length === 0 && (
                <p className="text-xs text-gray-500 text-center py-2">No users found</p>
              )}
            </div>
            <button
              onClick={() => { setShowNewModal(false); setNewUserSearch(''); setNewUserResults([]); }}
              className="mt-4 w-full py-2 rounded-xl bg-gray-800 hover:bg-gray-700 text-sm text-gray-300 transition"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
