import { useCallback, useEffect, useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import toast from 'react-hot-toast';
import {
  Briefcase,
  CheckCircle2,
  DollarSign,
  FileText,
  MessageSquare,
  Send,
  X,
} from 'lucide-react';
import PageMeta from '../components/PageMeta';
import PageShell from '../components/PageShell';
import { getBusinessLeads, submitQuote, rejectLead, completeLead } from '../api/leads';
import './BusinessLeadsPage.css';

export default function BusinessLeadsPage() {
  const { businessId } = useParams();
  const { t } = useTranslation();
  const [leads, setLeads] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedTab, setSelectedTab] = useState('pending');
  const [selectedLead, setSelectedLead] = useState(null);
  const [quoteForm, setQuoteForm] = useState({ amount: '', description: '', timeline: '' });
  const [submittingQuote, setSubmittingQuote] = useState(false);

  const tabs = [
    { value: 'pending', label: t('leads.pending') },
    { value: 'quoted', label: t('leads.quoted') },
    { value: 'accepted', label: t('leads.accepted') },
    { value: 'completed', label: t('leads.completed') },
  ];

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

  const summary = useMemo(() => {
    const active = leads.filter((lead) => ['pending', 'quoted', 'accepted'].includes(lead.status)).length;
    const possibleValue = leads.reduce(
      (sum, lead) => sum + Number(lead.quote_amount || lead.budget_max || lead.budget_min || 0),
      0
    );
    return { active, possibleValue };
  }, [leads]);

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

  const selectedLabel = tabs.find((tab) => tab.value === selectedTab)?.label || selectedTab;

  return (
    <PageShell>
      <PageMeta title={t('leads.businessLeads')} description={t('leads.businessLeads')} noIndex />

      <main className="business-leads-page">
        <section className="business-leads-hero" aria-labelledby="business-leads-title">
          <div>
            <p className="business-leads-eyebrow">
              <Briefcase size={16} aria-hidden="true" />
              {t('leads.commandCenter')}
            </p>
            <h1 id="business-leads-title">{t('leads.businessLeads')}</h1>
            <p>{t('leads.heroBody')}</p>
          </div>
          <div className="business-leads-summary">
            <div>
              <span>{summary.active}</span>
              <p>{t('leads.activeLeads')}</p>
            </div>
            <div>
              <span>{leads.length}</span>
              <p>{selectedLabel}</p>
            </div>
            <div>
              <span>${summary.possibleValue.toLocaleString()}</span>
              <p>{t('leads.possibleValue')}</p>
            </div>
          </div>
        </section>

        <section className="business-leads-guide" aria-label={t('leads.workflowAria')}>
          <GuideCard
            icon={MessageSquare}
            title={t('leads.guide.readTitle')}
            text={t('leads.guide.readText')}
          />
          <GuideCard
            icon={DollarSign}
            title={t('leads.guide.quoteTitle')}
            text={t('leads.guide.quoteText')}
          />
          <GuideCard
            icon={CheckCircle2}
            title={t('leads.guide.closeTitle')}
            text={t('leads.guide.closeText')}
          />
        </section>

        <div className="business-leads-tabs">
          {tabs.map((tab) => (
            <button
              key={tab.value}
              onClick={() => {
                setSelectedTab(tab.value);
                setSelectedLead(null);
              }}
              className={`business-leads-tab ${selectedTab === tab.value ? 'active' : ''}`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {loading ? (
          <div className="business-leads-loading">
            <div className="business-leads-loader" aria-hidden="true" />
            <p>{t('common.loading')}</p>
          </div>
        ) : leads.length === 0 ? (
          <EmptyLeads selectedTab={selectedTab} label={selectedLabel} t={t} />
        ) : (
          <section className="business-leads-list" aria-label={t('leads.listAria', { status: selectedLabel })}>
            {leads.map((lead) => (
              <article key={lead.id} className="business-lead-card">
                <div className="business-lead-card-top">
                  <div className="business-lead-card-main">
                    <h2>{t('leads.leadNumber', { number: lead.lead_number })}</h2>
                    <p className="business-lead-customer">
                      {t('leads.fromCustomer', { name: lead.first_name })}
                    </p>
                    <p className="business-lead-description">{lead.description}</p>
                    {lead.budget_min && lead.budget_max && (
                      <p className="business-lead-budget">
                        {t('leads.budgetRange', {
                          min: lead.budget_min,
                          max: lead.budget_max,
                        })}
                      </p>
                    )}
                  </div>
                  <span className={`business-lead-status is-${lead.status}`}>
                    {lead.status}
                  </span>
                </div>

                <div className="business-lead-actions">
                  {selectedTab === 'pending' && (
                    <>
                      <button
                        onClick={() => setSelectedLead(lead)}
                        className="business-lead-action primary"
                      >
                        <Send size={15} aria-hidden="true" />
                        {t('leads.submitQuote')}
                      </button>
                      <button
                        onClick={() => handleRejectLead(lead.id)}
                        className="business-lead-action secondary"
                      >
                        {t('leads.rejectRequest')}
                      </button>
                    </>
                  )}
                  {selectedTab === 'accepted' && (
                    <button
                      onClick={() => handleCompleteLead(lead.id)}
                      className="business-lead-action success"
                    >
                      <CheckCircle2 size={15} aria-hidden="true" />
                      {t('leads.markComplete')}
                    </button>
                  )}
                </div>
              </article>
            ))}
          </section>
        )}

        {selectedLead && (
          <div className="business-leads-modal-overlay">
            <div className="business-leads-modal">
              <div className="business-leads-modal-header">
                <div>
                  <p>{t('leads.quoteRequest')}</p>
                  <h3>{t('leads.submitQuote')}</h3>
                </div>
                <button
                  onClick={() => setSelectedLead(null)}
                  className="business-leads-modal-close"
                  aria-label={t('common.close')}
                >
                  <X size={20} aria-hidden="true" />
                </button>
              </div>

              <form onSubmit={handleSubmitQuote} className="business-leads-quote-form">
                <div>
                  <label>{t('leads.quoteAmount')}</label>
                  <input
                    type="number"
                    value={quoteForm.amount}
                    onChange={(e) => setQuoteForm((f) => ({ ...f, amount: e.target.value }))}
                    placeholder="0.00"
                    min="0"
                    step="0.01"
                    required
                    className="business-leads-input"
                  />
                </div>

                <div>
                  <label>{t('leads.quoteDescription')}</label>
                  <textarea
                    value={quoteForm.description}
                    onChange={(e) => setQuoteForm((f) => ({ ...f, description: e.target.value }))}
                    placeholder={t('leads.placeholderQuoteDescription')}
                    rows={3}
                    className="business-leads-input"
                  />
                </div>

                <div>
                  <label>{t('leads.timeline')}</label>
                  <input
                    type="text"
                    value={quoteForm.timeline}
                    onChange={(e) => setQuoteForm((f) => ({ ...f, timeline: e.target.value }))}
                    placeholder={t('leads.placeholderTimeline')}
                    className="business-leads-input"
                  />
                </div>

                <div className="business-leads-modal-actions">
                  <button
                    type="button"
                    onClick={() => setSelectedLead(null)}
                    className="business-lead-action secondary"
                  >
                    {t('common.cancel')}
                  </button>
                  <button
                    type="submit"
                    disabled={submittingQuote}
                    className="business-lead-action primary"
                  >
                    {submittingQuote ? t('leads.sending') : t('leads.submitQuote')}
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}
      </main>
    </PageShell>
  );
}

function GuideCard({ icon: Icon, title, text }) {
  return (
    <article className="business-leads-guide-card">
      <Icon size={22} aria-hidden="true" />
      <h2>{title}</h2>
      <p>{text}</p>
    </article>
  );
}

function EmptyLeads({ selectedTab, label, t }) {
  return (
    <section className="business-leads-empty">
      <div className="business-leads-empty-main">
        <div className="business-leads-empty-icon">
          {selectedTab === 'completed' ? <CheckCircle2 size={32} aria-hidden="true" /> : <FileText size={32} aria-hidden="true" />}
        </div>
        <p className="business-leads-empty-kicker">
          {t('leads.empty.title', { status: label || selectedTab })}
        </p>
        <p>{t('leads.empty.body')}</p>
      </div>
      <div className="business-leads-empty-side">
        <strong>{t('leads.empty.sideTitle')}</strong>
        <ul>
          <li>{t('leads.empty.bullet1')}</li>
          <li>{t('leads.empty.bullet2')}</li>
          <li>{t('leads.empty.bullet3')}</li>
        </ul>
      </div>
    </section>
  );
}
