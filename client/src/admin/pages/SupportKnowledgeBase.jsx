import { useState, useEffect, useCallback } from 'react';
import { useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import useDestructiveConfirm from '../hooks/useDestructiveConfirm';
import adminApi from '../../lib/adminApi';
import toast from 'react-hot-toast';
import {
  BookOpen,
  Plus,
  Edit2,
  Trash2,
  Search,
  RefreshCw,
  Eye,
  ThumbsUp,
  LibraryBig,
} from 'lucide-react';
import {
  SupportPageShell,
  SupportHero,
  SupportPanel,
  SupportEmptyState,
  SupportActionButton,
  SupportTag,
} from '../components/support/SupportPageChrome';

const categories = ['general', 'billing', 'technical', 'account', 'shipping'];
const NS = 'adminSupportKnowledgeBase';

export default function SupportKnowledgeBase() {
  const { t } = useTranslation();
  const { confirmDestructive, dialog: confirmDialog } = useDestructiveConfirm();
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

  const loadArticles = useCallback(async () => {
    setLoading(true);
    try {
      const res = await adminApi.get('/support/kb', {
        params: { business_id: businessId, search, category },
      });
      setArticles(res.data.articles || []);
    } catch (err) {
      console.error('Failed to load KB articles:', err);
      setArticles([]);
    } finally {
      setLoading(false);
    }
  }, [businessId, search, category]);

  useEffect(() => {
    loadArticles();
  }, [loadArticles]);

  const handleSave = async () => {
    if (!formData.title.trim()) {
      toast.error(t(`${NS}.toastTitleRequired`, { defaultValue: 'Article title is required' }));
      return;
    }
    if (!formData.content.trim()) {
      toast.error(t(`${NS}.toastContentRequired`, { defaultValue: 'Article content is required' }));
      return;
    }
    try {
      if (selectedArticle) {
        await adminApi.patch(`/support/kb/${selectedArticle.id}`, {
          ...formData,
          business_id: businessId,
        });
      } else {
        await adminApi.post('/support/kb', {
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
      toast.error(err?.response?.data?.error || t(`${NS}.toastSaveFailed`, { defaultValue: 'Failed to save article' }));
    }
  };

  const handleDelete = async (articleId) => {
    // E12: destructive action goes through the shared confirm dialog.
    const ok = await confirmDestructive({ description: t('supportAdmin.knowledgeBase.confirmDeleteArticle') });
    if (!ok) return;
    try {
      await adminApi.delete(`/support/kb/${articleId}`);
      toast.success(t(`${NS}.toastDeleted`, { defaultValue: 'Article deleted.' }));
      loadArticles();
    } catch (err) {
      console.error('Failed to delete article:', err);
      toast.error(err?.response?.data?.error || t(`${NS}.toastDeleteFailed`, { defaultValue: 'Failed to delete the article.' }));
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

  const totalViews = articles.reduce((sum, article) => sum + Number(article.views || 0), 0);
  const totalHelpful = articles.reduce((sum, article) => sum + Number(article.helpful_count || 0), 0);

  return (
    <>
      {confirmDialog}
    <SupportPageShell>
      <SupportHero
        icon={LibraryBig}
        eyebrow={t(`${NS}.eyebrow`, { defaultValue: 'Knowledge System' })}
        title={t(`${NS}.title`, { defaultValue: 'Support knowledge base' })}
        description={t(`${NS}.description`, { defaultValue: 'Organize reusable answers, troubleshooting guides, and policy references so agents can resolve issues faster and more consistently.' })}
        actions={(
          <>
            <SupportActionButton icon={RefreshCw} onClick={loadArticles} tone="secondary">
              {t('common.refresh')}
            </SupportActionButton>
            <SupportActionButton
              icon={Plus}
              onClick={() => {
                setSelectedArticle(null);
                setFormData({ title: '', content: '', category: 'general', tags: [] });
                setShowForm(true);
              }}
              tone="primary"
            >
              {t(`${NS}.newArticle`, { defaultValue: 'New article' })}
            </SupportActionButton>
          </>
        )}
        stats={[
          {
            icon: BookOpen,
            label: t(`${NS}.statArticles`, { defaultValue: 'Articles' }),
            value: articles.length,
            detail: t(`${NS}.statArticlesDetail`, { defaultValue: 'Published or draft support articles in this view.' }),
          },
          {
            icon: Eye,
            label: t(`${NS}.statViews`, { defaultValue: 'Views' }),
            value: totalViews,
            detail: t(`${NS}.statViewsDetail`, { defaultValue: 'Total recorded views across the current result set.' }),
            tone: 'text-blue-300',
          },
          {
            icon: ThumbsUp,
            label: t(`${NS}.statHelpful`, { defaultValue: 'Helpful' }),
            value: totalHelpful,
            detail: t(`${NS}.statHelpfulDetail`, { defaultValue: 'Helpful votes visible in the current result set.' }),
            tone: 'text-green-300',
          },
          {
            icon: Search,
            label: t(`${NS}.statCategory`, { defaultValue: 'Category' }),
            value: category ? t(`${NS}.category.${category}`, { defaultValue: category }) : t(`${NS}.allCategories`, { defaultValue: 'All' }),
            detail: category
              ? t(`${NS}.statCategoryFiltered`, { defaultValue: 'Filtering to {{category}}.', category: t(`${NS}.category.${category}`, { defaultValue: category }) })
              : t(`${NS}.statCategoryAll`, { defaultValue: 'Browsing every support category.' }),
            tone: 'text-orange-300',
          },
        ]}
      />

      <SupportPanel
        title={t(`${NS}.libraryTitle`, { defaultValue: 'Article library' })}
        subtitle={t(`${NS}.librarySubtitle`, { defaultValue: 'Search by content or narrow the library by category to find the right playbook fast.' })}
      >
        <div className="mb-5 space-y-4">
          <div className="relative">
            <Search size={16} className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-500" />
            <input
              type="text"
              placeholder={t(`${NS}.searchPlaceholder`, { defaultValue: 'Search articles...' })}
              aria-label={t(`${NS}.searchPlaceholder`, { defaultValue: 'Search articles...' })}
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              className="w-full rounded-2xl border border-gray-700 bg-gray-900 py-3 pl-11 pr-4 text-white focus:border-orange-500 focus:outline-none"
            />
          </div>
          <div className="flex flex-wrap gap-2">
            {categories.map((cat) => (
              <button
                key={cat}
                onClick={() => setCategory(category === cat ? '' : cat)}
                aria-pressed={category === cat}
                className={`rounded-full border px-3 py-2 text-sm font-medium capitalize transition ${
                  category === cat
                    ? 'border-orange-500/30 bg-orange-500/10 text-orange-300'
                    : 'border-gray-700 bg-gray-950 text-gray-400 hover:border-gray-600'
                }`}
              >
                {t(`${NS}.category.${cat}`, { defaultValue: cat })}
              </button>
            ))}
          </div>
        </div>

        {articles.length === 0 ? (
          <SupportEmptyState
            icon={BookOpen}
            title={t(`${NS}.emptyTitle`, { defaultValue: 'No knowledge base articles found' })}
            body={t(`${NS}.emptyBody`, { defaultValue: 'Create an article or widen the search criteria to rebuild the support library view.' })}
          />
        ) : (
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            {articles.map((article) => (
              <div key={article.id} className="rounded-[24px] border border-gray-800 bg-gray-900/70 p-5">
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0 flex-1">
                    <div className="text-lg font-semibold text-white">{article.title}</div>
                    <div className="mt-3 max-h-[4.2rem] overflow-hidden text-sm leading-6 text-gray-400">
                      {article.content}
                    </div>
                    <div className="mt-4 flex flex-wrap items-center gap-2">
                      <SupportTag>{t(`${NS}.category.${article.category}`, { defaultValue: article.category })}</SupportTag>
                      <SupportTag tone="blue">{t(`${NS}.viewsCount`, { defaultValue: '{{count}} views', count: article.views || 0 })}</SupportTag>
                      <SupportTag tone="green">{t(`${NS}.helpfulCount`, { defaultValue: '{{count}} helpful', count: article.helpful_count || 0 })}</SupportTag>
                      {(article.tags || []).map((tag) => (
                        <SupportTag key={tag}>{tag}</SupportTag>
                      ))}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => handleEdit(article)}
                      aria-label={t(`${NS}.editArticleAria`, { defaultValue: 'Edit article: {{title}}', title: article.title })}
                      title={t(`${NS}.editArticleAria`, { defaultValue: 'Edit article: {{title}}', title: article.title })}
                      className="rounded-xl border border-gray-700 bg-gray-900 p-2 text-gray-400 transition hover:text-white"
                    >
                      <Edit2 size={15} />
                    </button>
                    <button
                      onClick={() => handleDelete(article.id)}
                      aria-label={t(`${NS}.deleteArticleAria`, { defaultValue: 'Delete article: {{title}}', title: article.title })}
                      title={t(`${NS}.deleteArticleAria`, { defaultValue: 'Delete article: {{title}}', title: article.title })}
                      className="rounded-xl border border-red-900/40 bg-red-950/30 p-2 text-red-400 transition hover:bg-red-900/30"
                    >
                      <Trash2 size={15} />
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </SupportPanel>

      {showForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="max-h-[90vh] w-full max-w-3xl overflow-y-auto rounded-[28px] border border-gray-700 bg-gray-900 shadow-2xl">
            <div className="sticky top-0 flex items-center justify-between border-b border-gray-800 bg-gray-900 px-6 py-5">
              <div>
                <div className="text-xl font-semibold text-white">
                  {selectedArticle ? t(`${NS}.modalEditTitle`, { defaultValue: 'Edit article' }) : t(`${NS}.modalNewTitle`, { defaultValue: 'New article' })}
                </div>
                <div className="mt-1 text-sm text-gray-500">{t(`${NS}.modalSubtitle`, { defaultValue: 'Build reusable answers the whole support team can rely on.' })}</div>
              </div>
              <button onClick={() => setShowForm(false)} aria-label={t('common.close')} className="text-2xl text-gray-500 hover:text-white">x</button>
            </div>

            <div className="space-y-5 px-6 py-6">
              <div>
                <label className="mb-2 block text-sm text-gray-400">{t(`${NS}.labelTitle`, { defaultValue: 'Title' })}</label>
                <input
                  type="text"
                  value={formData.title}
                  onChange={(event) => setFormData({ ...formData, title: event.target.value })}
                  className="w-full rounded-2xl border border-gray-700 bg-gray-950 px-4 py-3 text-white focus:border-orange-500 focus:outline-none"
                  placeholder={t(`${NS}.titlePlaceholder`, { defaultValue: 'Article title...' })}
                />
              </div>

              <div>
                <label className="mb-2 block text-sm text-gray-400">{t(`${NS}.labelCategory`, { defaultValue: 'Category' })}</label>
                <select
                  value={formData.category}
                  onChange={(event) => setFormData({ ...formData, category: event.target.value })}
                  className="w-full rounded-2xl border border-gray-700 bg-gray-950 px-4 py-3 text-white focus:border-orange-500 focus:outline-none"
                >
                  {categories.map((cat) => (
                    <option key={cat} value={cat}>
                      {t(`${NS}.category.${cat}`, { defaultValue: cat.charAt(0).toUpperCase() + cat.slice(1) })}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="mb-2 block text-sm text-gray-400">{t(`${NS}.labelTags`, { defaultValue: 'Tags' })}</label>
                <input
                  type="text"
                  value={(formData.tags || []).join(', ')}
                  onChange={(event) => setFormData({ ...formData, tags: event.target.value.split(',').map((tag) => tag.trim()).filter(Boolean) })}
                  className="w-full rounded-2xl border border-gray-700 bg-gray-950 px-4 py-3 text-white focus:border-orange-500 focus:outline-none"
                  placeholder={t(`${NS}.tagsPlaceholder`, { defaultValue: 'billing, troubleshooting (comma separated)' })}
                />
              </div>

              <div>
                <label className="mb-2 block text-sm text-gray-400">{t(`${NS}.labelContent`, { defaultValue: 'Content' })}</label>
                <textarea
                  value={formData.content}
                  onChange={(event) => setFormData({ ...formData, content: event.target.value })}
                  className="h-56 w-full rounded-2xl border border-gray-700 bg-gray-950 px-4 py-3 text-white focus:border-orange-500 focus:outline-none"
                  placeholder={t(`${NS}.contentPlaceholder`, { defaultValue: 'Article content...' })}
                />
              </div>

              <div className="flex gap-3 border-t border-gray-800 pt-5">
                <SupportActionButton tone="secondary" onClick={() => setShowForm(false)}>
                  {t('common.cancel')}
                </SupportActionButton>
                <SupportActionButton tone="primary" onClick={handleSave}>
                  {selectedArticle ? t(`${NS}.updateArticle`, { defaultValue: 'Update article' }) : t(`${NS}.createArticle`, { defaultValue: 'Create article' })}
                </SupportActionButton>
              </div>
            </div>
          </div>
        </div>
      )}
    </SupportPageShell>
    </>
  );
}
