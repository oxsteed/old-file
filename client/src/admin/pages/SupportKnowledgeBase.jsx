import { useState, useEffect, useCallback } from 'react';
import { useParams } from 'react-router-dom';
import adminApi from '../../lib/adminApi';
import { BookOpen, Plus, Edit2, Trash2, Search, RefreshCw, Eye, ThumbsUp } from 'lucide-react';

export default function SupportKnowledgeBase() {
  const { businessId } = useParams();
  const [articles, setArticles] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [selectedArticle, setSelectedArticle] = useState(null);
  const [formData, setFormData] = useState({
    title: '',
    content: '',
    category: 'general',
    tags: [],
  });

  const categories = ['general', 'billing', 'technical', 'account', 'shipping'];

  const loadArticles = useCallback(async () => {
    setLoading(true);
    try {
      const res = await adminApi.get(`/api/support/kb`, {
        params: { business_id: businessId, search, category },
      });
      setArticles(res.data.articles || []);
    } catch (err) {
      console.error('Failed to load KB articles:', err);
    }
    setLoading(false);
  }, [businessId, search, category]);

  useEffect(() => {
    loadArticles();
  }, [loadArticles]);

  const handleSave = async () => {
    try {
      if (selectedArticle) {
        await adminApi.patch(`/api/support/kb/${selectedArticle.id}`, {
          ...formData,
          business_id: businessId,
        });
      } else {
        await adminApi.post(`/api/support/kb`, {
          ...formData,
          business_id: businessId,
        });
      }
      setShowForm(false);
      setSelectedArticle(null);
      setFormData({ title: '', content: '', category: 'general', tags: [] });
      loadArticles();
    } catch (err) {
      console.error('Failed to save article:', err);
    }
  };

  const handleDelete = async (articleId) => {
    if (!window.confirm('Delete this article?')) return;
    try {
      await adminApi.delete(`/api/support/kb/${articleId}`);
      loadArticles();
    } catch (err) {
      console.error('Failed to delete article:', err);
    }
  };

  const handleEdit = (article) => {
    setSelectedArticle(article);
    setFormData({
      title: article.title,
      content: article.content,
      category: article.category,
      tags: article.tags || [],
    });
    setShowForm(true);
  };

  return (
    <div className="p-6 max-w-7xl mx-auto">
      <div className="flex items-start justify-between mb-8">
        <div>
          <h1 className="text-white font-bold text-3xl mb-2">Knowledge Base</h1>
          <p className="text-gray-400 text-sm">Create and manage support articles.</p>
        </div>
        <div className="flex gap-3">
          <button
            onClick={loadArticles}
            disabled={loading}
            className="p-2.5 bg-gray-700 border border-gray-600 text-gray-400 rounded-lg hover:text-white transition"
          >
            <RefreshCw size={18} className={loading ? 'animate-spin' : ''} />
          </button>
          <button
            onClick={() => {
              setSelectedArticle(null);
              setFormData({ title: '', content: '', category: 'general', tags: [] });
              setShowForm(true);
            }}
            className="flex items-center gap-2 px-4 py-2.5 bg-orange-600 hover:bg-orange-700 text-white rounded-lg font-medium transition"
          >
            <Plus size={18} />
            New Article
          </button>
        </div>
      </div>

      <div className="mb-8 space-y-4">
        <div className="relative">
          <Search size={18} className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-500" />
          <input
            type="text"
            placeholder="Search articles..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="w-full pl-12 pr-4 py-3 bg-gray-800 border border-gray-700 rounded-lg text-white focus:outline-none focus:border-orange-500"
          />
        </div>
        <div className="flex gap-3">
          {categories.map(cat => (
            <button
              key={cat}
              onClick={() => setCategory(category === cat ? '' : cat)}
              className={`px-4 py-2 rounded-lg font-medium transition capitalize ${
                category === cat
                  ? 'bg-orange-600 text-white'
                  : 'bg-gray-700 text-gray-400 hover:text-white'
              }`}
            >
              {cat}
            </button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4">
        {articles.length === 0 ? (
          <div className="text-center py-12 bg-gray-800 border border-gray-700 rounded-xl">
            <BookOpen size={40} className="mx-auto mb-3 text-gray-600" />
            <p className="text-gray-400">No articles found</p>
          </div>
        ) : (
          articles.map(article => (
            <div key={article.id} className="bg-gray-800 border border-gray-700 rounded-xl p-6">
              <div className="flex items-start justify-between">
                <div className="flex-1">
                  <h3 className="text-white font-bold text-lg mb-2">{article.title}</h3>
                  <p className="text-gray-400 text-sm mb-3 line-clamp-2">{article.content}</p>
                  <div className="flex items-center gap-4 text-sm text-gray-500">
                    <span className="flex items-center gap-1">
                      <Eye size={14} />
                      {article.views || 0} views
                    </span>
                    <span className="flex items-center gap-1">
                      <ThumbsUp size={14} />
                      {article.helpful_count || 0} helpful
                    </span>
                    <span className="px-2 py-1 bg-gray-700 rounded text-xs capitalize">
                      {article.category}
                    </span>
                  </div>
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={() => handleEdit(article)}
                    className="p-2 hover:bg-gray-700 rounded transition"
                  >
                    <Edit2 size={16} className="text-gray-400" />
                  </button>
                  <button
                    onClick={() => handleDelete(article.id)}
                    className="p-2 hover:bg-red-900/30 rounded transition"
                  >
                    <Trash2 size={16} className="text-red-400" />
                  </button>
                </div>
              </div>
            </div>
          ))
        )}
      </div>

      {showForm && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-gray-800 border border-gray-700 rounded-xl max-w-2xl w-full max-h-[90vh] overflow-y-auto">
            <div className="border-b border-gray-700 p-6 flex items-center justify-between sticky top-0 bg-gray-800">
              <h2 className="text-white font-bold text-xl">
                {selectedArticle ? 'Edit Article' : 'New Article'}
              </h2>
              <button
                onClick={() => setShowForm(false)}
                className="text-gray-500 hover:text-white text-2xl"
              >
                ×
              </button>
            </div>
            <div className="p-6 space-y-4">
              <div>
                <label className="block text-gray-400 text-sm mb-2">Title</label>
                <input
                  type="text"
                  value={formData.title}
                  onChange={e => setFormData({ ...formData, title: e.target.value })}
                  className="w-full px-4 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white focus:outline-none focus:border-orange-500"
                  placeholder="Article title..."
                />
              </div>
              <div>
                <label className="block text-gray-400 text-sm mb-2">Category</label>
                <select
                  value={formData.category}
                  onChange={e => setFormData({ ...formData, category: e.target.value })}
                  className="w-full px-4 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white focus:outline-none focus:border-orange-500"
                >
                  {categories.map(cat => (
                    <option key={cat} value={cat} className="capitalize">
                      {cat.charAt(0).toUpperCase() + cat.slice(1)}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-gray-400 text-sm mb-2">Content</label>
                <textarea
                  value={formData.content}
                  onChange={e => setFormData({ ...formData, content: e.target.value })}
                  className="w-full px-4 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white focus:outline-none focus:border-orange-500 h-48"
                  placeholder="Article content..."
                />
              </div>
              <div className="flex gap-3 pt-4 border-t border-gray-700">
                <button
                  onClick={() => setShowForm(false)}
                  className="flex-1 px-4 py-2 bg-gray-700 hover:bg-gray-600 text-white rounded-lg transition"
                >
                  Cancel
                </button>
                <button
                  onClick={handleSave}
                  className="flex-1 px-4 py-2 bg-orange-600 hover:bg-orange-700 text-white rounded-lg transition font-medium"
                >
                  {selectedArticle ? 'Update Article' : 'Create Article'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
