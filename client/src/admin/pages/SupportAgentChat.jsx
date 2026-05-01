import { useState, useEffect, useCallback } from 'react';
import { useParams } from 'react-router-dom';
import adminApi from '../../lib/adminApi';
import { MessageSquare, Send, RefreshCw, Search } from 'lucide-react';

export default function SupportAgentChat() {
  const { businessId } = useParams();
  const [conversations, setConversations] = useState([]);
  const [selectedConv, setSelectedConv] = useState(null);
  const [messages, setMessages] = useState([]);
  const [messageText, setMessageText] = useState('');
  const [loading, setLoading] = useState(true);

  const loadConversations = useCallback(async () => {
    setLoading(true);
    try {
      const res = await adminApi.get('/support/conversations', {
        params: { business_id: businessId },
      });
      setConversations(res.data.conversations || []);
    } catch (err) {
      console.error('Failed to load conversations:', err);
    }
    setLoading(false);
  }, [businessId]);

  useEffect(() => {
    loadConversations();
  }, [loadConversations]);

  useEffect(() => {
    if (selectedConv) {
      setMessages(selectedConv.messages || []);
    }
  }, [selectedConv]);

  const handleSendMessage = async () => {
    if (!messageText.trim()) return;
    try {
      await adminApi.post(`/support/conversations/${selectedConv.id}/message`, {
        message: messageText,
      });
      setMessageText('');
      loadConversations();
    } catch (err) {
      console.error('Failed to send message:', err);
    }
  };

  return (
    <div className="p-6 max-w-7xl mx-auto h-[calc(100vh-100px)]">
      <h1 className="text-white font-bold text-3xl mb-6">Agent Chat</h1>

      <div className="flex gap-6 h-full">
        {/* Conversations List */}
        <div className="w-80 bg-gray-800 border border-gray-700 rounded-xl flex flex-col">
          <div className="p-4 border-b border-gray-700">
            <div className="relative">
              <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
              <input
                type="text"
                placeholder="Search conversations..."
                className="w-full pl-9 pr-4 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white text-sm focus:outline-none focus:border-orange-500"
              />
            </div>
          </div>

          <div className="flex-1 overflow-y-auto space-y-2 p-4">
            {conversations.length === 0 ? (
              <p className="text-gray-400 text-sm text-center py-8">No conversations</p>
            ) : (
              conversations.map(conv => (
                <button
                  key={conv.id}
                  onClick={() => setSelectedConv(conv)}
                  className={`w-full text-left p-3 rounded-lg transition ${
                    selectedConv?.id === conv.id
                      ? 'bg-orange-600'
                      : 'bg-gray-700 hover:bg-gray-700/80'
                  }`}
                >
                  <p className="text-white font-medium text-sm">{conv.customer_name}</p>
                  <p className="text-gray-300 text-xs truncate">{conv.last_message}</p>
                  <p className="text-gray-500 text-xs mt-1">{conv.created_at}</p>
                </button>
              ))
            )}
          </div>
        </div>

        {/* Chat Area */}
        {selectedConv ? (
          <div className="flex-1 bg-gray-800 border border-gray-700 rounded-xl flex flex-col">
            <div className="border-b border-gray-700 p-4 flex items-center justify-between">
              <div>
                <h2 className="text-white font-bold">{selectedConv.customer_name}</h2>
                <p className="text-gray-400 text-sm">{selectedConv.customer_email}</p>
              </div>
              <button onClick={loadConversations} className="p-2 hover:bg-gray-700 rounded transition">
                <RefreshCw size={16} className="text-gray-400" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-4 space-y-4">
              {messages.map((msg, idx) => (
                <div key={idx} className={`flex ${msg.is_from_agent ? 'justify-end' : 'justify-start'}`}>
                  <div
                    className={`max-w-xs rounded-lg px-4 py-2 ${
                      msg.is_from_agent
                        ? 'bg-orange-600 text-white'
                        : 'bg-gray-700 text-gray-200'
                    }`}
                  >
                    <p className="text-sm">{msg.text}</p>
                    <p className={`text-xs mt-1 ${msg.is_from_agent ? 'text-orange-100' : 'text-gray-400'}`}>
                      {msg.created_at}
                    </p>
                  </div>
                </div>
              ))}
            </div>

            <div className="border-t border-gray-700 p-4">
              <div className="flex gap-3">
                <input
                  type="text"
                  value={messageText}
                  onChange={e => setMessageText(e.target.value)}
                  onKeyPress={e => e.key === 'Enter' && handleSendMessage()}
                  placeholder="Type a message..."
                  className="flex-1 px-4 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white focus:outline-none focus:border-orange-500"
                />
                <button
                  onClick={handleSendMessage}
                  className="p-2 bg-orange-600 hover:bg-orange-700 text-white rounded-lg transition"
                >
                  <Send size={18} />
                </button>
              </div>
            </div>
          </div>
        ) : (
          <div className="flex-1 bg-gray-800 border border-gray-700 rounded-xl flex items-center justify-center">
            <div className="text-center">
              <MessageSquare size={40} className="mx-auto mb-3 text-gray-600" />
              <p className="text-gray-400">Select a conversation to start chatting</p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
