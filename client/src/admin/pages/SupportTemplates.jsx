import { useState, useEffect, useCallback } from 'react';
import { useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import adminApi from '../../lib/adminApi';
import toast from 'react-hot-toast';
import { MessageSquare, Plus, Edit2, Trash2, Search, RefreshCw, Copy, TrendingUp } from 'lucide-react';
import SupportSubNav from '../components/SupportSubNav';

export default function SupportTemplates() {
  const { t } = useTranslation();
  const { businessId } = useParams();
  const [templates, setTemplates] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [selectedTemplate, setSelectedTemplate] = useState(null);
  const [formData, setFormData] = useState({
    name: '',
    content: '',
    category: 'general',
    shortcut: '',
  });
  const [copiedId, setCopiedId] = useState(null);

  const categories = [
    { value: 'general', label: t('adminSupportTemplates.categoryGeneral') },
    { value: 'greeting', label: t('adminSupportTemplates.categoryGreeting') },
    { value: 'farewell', label: t('adminSupportTemplates.categoryFarewell') },
    { value: 'troubleshooting', label: t('adminSupportTemplates.categoryTroubleshooting') },
    { value: 'escalation', label: t('adminSupportTemplates.categoryEscalation') },
  ];

  const loadTemplates = useCallback(async () => {
    setLoading(true);
    try {
      const res = await adminApi.get('/support/templates', {
        params: { business_id: businessId, search },
      });
      setTemplates(res.data.templates || []);
    } catch (err) {
      console.error('Failed to load templates:', err);
    }
    setLoading(false);
  }, [businessId, search]);

  useEffect(() => {
    loadTemplates();
  }, [loadTemplates]);

  const handleSave = async () => {
    if (!formData.name.trim()) {
      toast.error(t('adminSupportTemplates.toastNameRequired'));
      return;
    }
    if (!formData.content.trim()) {
      toast.error(t('adminSupportTemplates.toastContentRequired'));
      return;
    }
    try {
      if (selectedTemplate) {
        await adminApi.patch(`/support/templates/${selectedTemplate.id}`, {
          ...formData,
          business_id: businessId,
        });
      } else {
        await adminApi.post('/support/templates', {
          ...formData,
          business_id: businessId,
        });
      }
      setShowForm(false);
      setSelectedTemplate(null);
      setFormData({ name: '', content: '', category: 'general', shortcut: '' });
      loadTemplates();
    } catch (err) {
      console.error('Failed to save template:', err);
      toast.error(err?.response?.data?.error || t('adminSupportTemplates.toastSaveFailed'));
    }
  };

  const handleDelete = async (templateId) => {
    if (!window.confirm(t('adminSupportTemplates.confirmDelete'))) return;
    try {
      await adminApi.delete(`/support/templates/${templateId}`);
      loadTemplates();
    } catch (err) {
      console.error('Failed to delete template:', err);
    }
  };

  const handleEdit = (template) => {
    setSelectedTemplate(template);
    setFormData({
      name: template.name,
      content: template.content,
      category: template.category,
      shortcut: template.shortcut || '',
    });
    setShowForm(true);
  };

  const handleCopy = async (content, id) => {
    try {
      await navigator.clipboard.writeText(content);
      setCopiedId(id);
      setTimeout(() => setCopiedId(null), 2000);
    } catch (err) {
      console.error('Failed to copy template:', err);
      toast.error(t('adminSupportTemplates.toastCopyFailed'));
    }
  };

  return (
    <div className="p-6 max-w-7xl mx-auto">
      <SupportSubNav />
      <div className="flex items-start justify-between mb-8">
        <div>
          <h1 className="text-white font-bold text-3xl mb-2">{t('adminSupportTemplates.title')}</h1>
          <p className="text-gray-400 text-sm">{t('adminSupportTemplates.description')}</p>
        </div>
        <div className="flex gap-3">
          <button
            onClick={loadTemplates}
            disabled={loading}
            className="p-2.5 bg-gray-700 border border-gray-600 text-gray-400 rounded-lg hover:text-white transition"
          >
            <RefreshCw size={18} className={loading ? 'animate-spin' : ''} />
          </button>
          <button
            onClick={() => {
              setSelectedTemplate(null);
              setFormData({ name: '', content: '', category: 'general', shortcut: '' });
              setShowForm(true);
            }}
            className="flex items-center gap-2 px-4 py-2.5 bg-orange-600 hover:bg-orange-700 text-white rounded-lg font-medium transition"
          >
            <Plus size={18} />
            {t('adminSupportTemplates.newTemplate')}
          </button>
        </div>
      </div>

      <div className="mb-8">
        <div className="relative">
          <Search size={18} className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-500" />
          <input
            type="text"
            placeholder={t('adminSupportTemplates.searchPlaceholder')}
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="w-full pl-12 pr-4 py-3 bg-gray-800 border border-gray-700 rounded-lg text-white focus:outline-none focus:border-orange-500"
          />
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4">
        {templates.length === 0 ? (
          <div className="text-center py-12 bg-gray-800 border border-gray-700 rounded-xl">
            <MessageSquare size={40} className="mx-auto mb-3 text-gray-600" />
            <p className="text-gray-400">{t('adminSupportTemplates.emptyTemplates')}</p>
          </div>
        ) : (
          templates.map(template => (
            <div key={template.id} className="bg-gray-800 border border-gray-700 rounded-xl p-6">
              <div className="flex items-start justify-between mb-4">
                <div className="flex-1">
                  <div className="flex items-center gap-3 mb-2">
                    <h3 className="text-white font-bold text-lg">{template.name}</h3>
                    {template.shortcut && (
                      <span className="px-2 py-1 bg-blue-900/30 text-blue-300 rounded text-xs font-mono">
                        {template.shortcut}
                      </span>
                    )}
                  </div>
                  <span className="px-2 py-1 bg-gray-700 rounded text-xs text-gray-300 capitalize">
                    {categories.find((cat) => cat.value === template.category)?.label || template.category}
                  </span>
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={() => handleCopy(template.content, template.id)}
                    className="p-2 hover:bg-gray-700 rounded transition"
                    title={t('adminSupportTemplates.copyTitle')}
                    aria-label={t('adminSupportTemplates.copyTitle')}
                  >
                    <Copy
                      size={16}
                      className={
                        copiedId === template.id ? 'text-green-400' : 'text-gray-400'
                      }
                    />
                  </button>
                  <button
                    onClick={() => handleEdit(template)}
                    className="p-2 hover:bg-gray-700 rounded transition"
                    title={t('adminSupportTemplates.editTemplateAria', { defaultValue: 'Edit template: {{name}}', name: template.name })}
                    aria-label={t('adminSupportTemplates.editTemplateAria', { defaultValue: 'Edit template: {{name}}', name: template.name })}
                  >
                    <Edit2 size={16} className="text-gray-400" />
                  </button>
                  <button
                    onClick={() => handleDelete(template.id)}
                    className="p-2 hover:bg-red-900/30 rounded transition"
                    title={t('adminSupportTemplates.deleteTemplateAria', { defaultValue: 'Delete template: {{name}}', name: template.name })}
                    aria-label={t('adminSupportTemplates.deleteTemplateAria', { defaultValue: 'Delete template: {{name}}', name: template.name })}
                  >
                    <Trash2 size={16} className="text-red-400" />
                  </button>
                </div>
              </div>
              <p className="text-gray-300 text-sm bg-gray-700/30 rounded p-3 line-clamp-3">
                {template.content}
              </p>
              {template.usage_count && (
                <div className="mt-3 flex items-center gap-1 text-gray-500 text-xs">
                  <TrendingUp size={12} />
                  {t('adminSupportTemplates.usesCount', { count: template.usage_count })}
                </div>
              )}
            </div>
          ))
        )}
      </div>

      {showForm && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-gray-800 border border-gray-700 rounded-xl max-w-2xl w-full max-h-[90vh] overflow-y-auto">
            <div className="border-b border-gray-700 p-6 flex items-center justify-between sticky top-0 bg-gray-800">
              <h2 className="text-white font-bold text-xl">
                {selectedTemplate ? t('adminSupportTemplates.modalEditTitle') : t('adminSupportTemplates.modalNewTitle')}
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
                <label className="block text-gray-400 text-sm mb-2">{t('adminSupportTemplates.labelName')}</label>
                <input
                  type="text"
                  value={formData.name}
                  onChange={e => setFormData({ ...formData, name: e.target.value })}
                  className="w-full px-4 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white focus:outline-none focus:border-orange-500"
                  placeholder={t('adminSupportTemplates.namePlaceholder')}
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-gray-400 text-sm mb-2">{t('adminSupportTemplates.labelCategory')}</label>
                  <select
                    value={formData.category}
                    onChange={e => setFormData({ ...formData, category: e.target.value })}
                    className="w-full px-4 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white focus:outline-none focus:border-orange-500"
                  >
                    {categories.map(cat => (
                      <option key={cat.value} value={cat.value} className="capitalize">
                        {cat.label}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-gray-400 text-sm mb-2">{t('adminSupportTemplates.labelShortcut')}</label>
                  <input
                    type="text"
                    value={formData.shortcut}
                    onChange={e => setFormData({ ...formData, shortcut: e.target.value })}
                    className="w-full px-4 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white focus:outline-none focus:border-orange-500"
                    placeholder="/wm"
                  />
                </div>
              </div>
              <div>
                <label className="block text-gray-400 text-sm mb-2">{t('adminSupportTemplates.labelContent')}</label>
                <textarea
                  value={formData.content}
                  onChange={e => setFormData({ ...formData, content: e.target.value })}
                  className="w-full px-4 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white focus:outline-none focus:border-orange-500 h-48"
                  placeholder={t('adminSupportTemplates.contentPlaceholder')}
                />
              </div>
              <div className="flex gap-3 pt-4 border-t border-gray-700">
                <button
                  onClick={() => setShowForm(false)}
                  className="flex-1 px-4 py-2 bg-gray-700 hover:bg-gray-600 text-white rounded-lg transition"
                >
                  {t('common.cancel')}
                </button>
                <button
                  onClick={handleSave}
                  className="flex-1 px-4 py-2 bg-orange-600 hover:bg-orange-700 text-white rounded-lg transition font-medium"
                >
                  {selectedTemplate ? t('adminSupportTemplates.updateTemplate') : t('adminSupportTemplates.createTemplate')}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
