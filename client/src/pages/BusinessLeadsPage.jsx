import { useState, useEffect, useCallback } from 'react';
import { useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import toast from 'react-hot-toast';
import PageMeta from '../components/PageMeta';
import PageShell from '../components/PageShell';
import { getBusinessLeads, submitQuote, rejectLead, completeLead } from '../api/leads';

export default function BusinessLeadsPage() {
  const { businessId } = useParams();
  const { t } = useTranslation();
  const [leads, setLeads] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedTab, setSelectedTab] = useState('pending');
  const [selectedLead, setSelectedLead] = useState(null);
  const [quoteForm, setQuoteForm] = useState({ amount: '', description: '', timeline: '' });
  const [submittingQuote, setSubmittingQuote] = useState(false);

  const loadLeads = useCallback(async () => {
    setLoading(true);
    try {
      const data = await getBusinessLeads(businessId, selectedTab);
      setLeads(data.leads || []);
    } catch (err) {
      toast.error(t('leads.errorFetch'));
    } finally {
      setLoading(false);
    }
  }, [businessId, selectedTab, t]);

  useEffect(() => {
    loadLeads();
  }, [loadLeads]);

  const handleSubmitQuote = async (e) => {
    e.preventDefault();
    if (!quoteForm.amount || parseFloat(quoteForm.amount) <= 0) {
      toast.error(t('leads.quoteAmount'));
      return;
    }

    setSubmittingQuote(true);
    try {
      await submitQuote(selectedLead.id, {
        amount: parseFloat(quoteForm.amount),
        description: quoteForm.description || null,
        timeline: quoteForm.timeline || null,
      });
      toast.success(t('leads.successQuote'));
      setSelectedLead(null);
      setQuoteForm({ amount: '', description: '', timeline: '' });
      await loadLeads();
    } catch (err) {
      toast.error(err?.response?.data?.error || t('leads.errorQuote'));
    } finally {
      setSubmittingQuote(false);
    }
  };

  const handleRejectLead = async (leadId) => {
    if (!window.confirm(t('leads.rejectRequest'))) return;
    try {
      await rejectLead(leadId);
      toast.success(t('leads.successReject'));
      await loadLeads();
    } catch {
      toast.error(t('leads.errorReject'));
    }
  };

  const handleCompleteLead = async (leadId) => {
    try {
      await completeLead(leadId);
      toast.success(t('leads.successComplete'));
      await loadLeads();
    } catch {
      toast.error(t('leads.errorComplete'));
    }
  };

  const tabs = [
    { value: 'pending', label: t('leads.pending') },
    { value: 'quoted', label: t('leads.quoted') },
    { value: 'accepted', label: t('leads.accepted') },
    { value: 'completed', label: t('leads.completed') },
  ];

  return (
    <PageShell>
      <PageMeta title={t('leads.businessLeads')} description={t('leads.businessLeads')} />
      <div className="max-w-4xl mx-auto px-4 py-8">
        <h1 className="text-3xl font-bold text-white mb-8">{t('leads.businessLeads')}</h1>

        {/* Tabs */}
        <div className="flex gap-4 mb-8 border-b border-gray-800">
          {tabs.map(tab => (
            <button
              key={tab.value}
              onClick={() => {
                setSelectedTab(tab.value);
                setSelectedLead(null);
              }}
              className={`px-4 py-3 font-medium border-b-2 transition-colors ${
                selectedTab === tab.value
                  ? 'border-brand-500 text-white'
                  : 'border-transparent text-gray-400 hover:text-white'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* Leads List */}
        {loading ? (
          <p className="text-gray-400">{t('common.loading')}</p>
        ) : leads.length === 0 ? (
          <p className="text-gray-400 text-center py-12">{t('leads.noRequests')}</p>
        ) : (
          <div className="space-y-4">
            {leads.map(lead => (
              <div
                key={lead.id}
                className="bg-gray-900 border border-gray-800 rounded-lg p-4 hover:border-gray-700 transition-colors"
              >
                <div className="flex items-start justify-between">
                  <div className="flex-1">
                    <h3 className="font-bold text-white mb-2">
                      {t('leads.leadNumber', { number: lead.lead_number })}
                    </h3>
                    <p className="text-sm text-gray-400 mb-2">
                      {t('leads.fromCustomer', { name: lead.first_name })}
                    </p>
                    <p className="text-gray-300 text-sm mb-3">{lead.description}</p>
                    {lead.budget_min && lead.budget_max && (
                      <p className="text-sm text-gray-400">
                        Budget: ${lead.budget_min} - ${lead.budget_max}
                      </p>
                    )}
                  </div>
                  <div className="ml-4 text-right">
                    <span className="inline-block px-3 py-1 bg-blue-900/20 text-blue-400 rounded-full text-xs font-medium">
                      {lead.status}
                    </span>
                  </div>
                </div>

                {/* Actions */}
                <div className="flex gap-2 mt-4 pt-4 border-t border-gray-800">
                  {selectedTab === 'pending' && (
                    <>
                      <button
                        onClick={() => setSelectedLead(lead)}
                        className="flex-1 px-4 py-2 bg-brand-500 hover:bg-brand-600 text-white rounded-lg text-sm font-medium transition-colors"
                      >
                        {t('leads.submitQuote')}
                      </button>
                      <button
                        onClick={() => handleRejectLead(lead.id)}
                        className="px-4 py-2 bg-gray-800 hover:bg-gray-700 text-gray-300 rounded-lg text-sm font-medium transition-colors"
                      >
                        {t('leads.rejectRequest')}
                      </button>
                    </>
                  )}
                  {selectedTab === 'accepted' && (
                    <button
                      onClick={() => handleCompleteLead(lead.id)}
                      className="flex-1 px-4 py-2 bg-green-600 hover:bg-green-700 text-white rounded-lg text-sm font-medium transition-colors"
                    >
                      {t('leads.markComplete')}
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Quote Form Modal */}
        {selectedLead && (
          <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
            <div className="bg-gray-900 border border-gray-800 rounded-2xl max-w-md w-full">
              <div className="px-6 py-4 border-b border-gray-800 flex items-center justify-between">
                <h3 className="text-lg font-bold text-white">{t('leads.submitQuote')}</h3>
                <button
                  onClick={() => setSelectedLead(null)}
                  className="text-gray-400 hover:text-white text-2xl"
                >
                  ×
                </button>
              </div>

              <form onSubmit={handleSubmitQuote} className="p-6 space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-300 mb-2">
                    {t('leads.quoteAmount')}
                  </label>
                  <input
                    type="number"
                    value={quoteForm.amount}
                    onChange={e => setQuoteForm(f => ({ ...f, amount: e.target.value }))}
                    placeholder="0.00"
                    min="0"
                    step="0.01"
                    required
                    className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-300 mb-2">
                    {t('leads.quoteDescription')}
                  </label>
                  <textarea
                    value={quoteForm.description}
                    onChange={e => setQuoteForm(f => ({ ...f, description: e.target.value }))}
                    placeholder={t('leads.placeholderQuoteDescription')}
                    rows={3}
                    className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-300 mb-2">
                    {t('leads.timeline')}
                  </label>
                  <input
                    type="text"
                    value={quoteForm.timeline}
                    onChange={e => setQuoteForm(f => ({ ...f, timeline: e.target.value }))}
                    placeholder={t('leads.placeholderTimeline')}
                    className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white"
                  />
                </div>

                <div className="flex gap-3 pt-4">
                  <button
                    type="button"
                    onClick={() => setSelectedLead(null)}
                    className="flex-1 px-4 py-2 bg-gray-800 hover:bg-gray-700 text-white rounded-lg"
                  >
                    {t('common.cancel')}
                  </button>
                  <button
                    type="submit"
                    disabled={submittingQuote}
                    className="flex-1 px-4 py-2 bg-brand-500 hover:bg-brand-600 disabled:bg-gray-700 text-white rounded-lg"
                  >
                    {submittingQuote ? t('leads.sending') : t('leads.submitQuote')}
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}
      </div>
    </PageShell>
  );
}
