import { useEffect, useState, useCallback } from 'react';
import { Shield, Search, AlertTriangle, CheckCircle, XCircle, Eye } from 'lucide-react';
import { useAuth } from '../../hooks/useAuth';
import adminApi from '../../lib/adminApi';

const TABS = ['pending', 'approved', 'flagged', 'removed'];

export default function Moderation() {
  const { user: me } = useAuth();
  const [activeTab, setActiveTab] = useState('pending');
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [total, setTotal] = useState(0);

  const fetchItems = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await adminApi.get('/admin/moderation', {
        params: { status: activeTab }
      });
      setItems(data.items || []);
      setTotal(data.total || 0);
    } catch (err) {
      console.error('Failed to fetch moderation items:', err);
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, [activeTab]);

  useEffect(() => { fetchItems(); }, [fetchItems]);

  const handleAction = async (itemId, action) => {
    try {
      await adminApi.post(`/admin/moderation/${itemId}/${action}`);
      fetchItems();
    } catch (err) {
      console.error(`Moderation action failed:`, err);
    }
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-white">Content Moderation</h1>
          <p className="text-gray-400 text-sm">{total} items in queue</p>
        </div>
      </div>

      <div className="flex gap-2 mb-6">
        {TABS.map(tab => (
          <button key={tab} onClick={() => setActiveTab(tab)}
            className={`px-4 py-2 rounded-full text-sm font-medium capitalize transition-colors ${
              activeTab === tab
                ? 'bg-orange-500 text-white'
                : 'bg-slate-800 text-gray-400 hover:text-white border border-slate-700'
            }`}>
            {tab}
          </button>
        ))}
      </div>

      <div className="bg-slate-800/50 border border-slate-700 rounded-xl">
        {loading ? (
          <div className="text-center text-gray-400 py-16">Loading...</div>
        ) : items.length === 0 ? (
          <div className="text-center py-16">
            <CheckCircle className="mx-auto mb-3 text-green-400" size={48} />
            <p className="text-gray-400">No {activeTab} items. Queue is clear.</p>
          </div>
        ) : (
          <div className="divide-y divide-slate-700">
            {items.map(item => (
              <div key={item._id} className="p-4 hover:bg-slate-700/30 flex items-center justify-between">
                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-white font-medium">{item.type || 'Content'}</span>
                    <span className="text-xs text-gray-500">by {item.user?.name || 'Unknown'}</span>
                  </div>
                  <p className="text-gray-400 text-sm line-clamp-2">{item.content || item.reason || 'No description'}</p>
                  <p className="text-gray-500 text-xs mt-1">
                    {item.createdAt ? new Date(item.createdAt).toLocaleString() : ''}
                  </p>
                </div>
                {activeTab === 'pending' && (
                  <div className="flex gap-2 ml-4">
                    <button onClick={() => handleAction(item._id, 'approve')}
                      className="p-2 bg-green-500/20 text-green-400 rounded-lg hover:bg-green-500/30" title="Approve">
                      <CheckCircle size={18} />
                    </button>
                    <button onClick={() => handleAction(item._id, 'flag')}
                      className="p-2 bg-yellow-500/20 text-yellow-400 rounded-lg hover:bg-yellow-500/30" title="Flag">
                      <AlertTriangle size={18} />
                    </button>
                    <button onClick={() => handleAction(item._id, 'remove')}
                      className="p-2 bg-red-500/20 text-red-400 rounded-lg hover:bg-red-500/30" title="Remove">
                      <XCircle size={18} />
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
