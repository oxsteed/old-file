// Group 11 Slice 2e: owner maintenance surfaces (591, 594, 595, 600).
// Maintenance calendar per tool, safety documents per listing,
// the return-to-availability checklist, and repeat-renter follow-up.
// All state lives on the server; the panel only renders and posts.
import { useEffect, useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import toast from 'react-hot-toast';
import { toolRentalsApi } from '../api/toolRentals';
import { formatDate } from '../lib/format';

const CHECKLIST_LABELS = {
  condition_report_filed: 'toolRentals.checklistConditionReport',
  no_unresolved_missing_accessories: 'toolRentals.checklistMissingAccessories',
  no_open_damage_claim: 'toolRentals.checklistDamageClaim',
  cleaning_confirmed: 'toolRentals.checklistCleaning',
};

export default function ToolOwnerMaintainPanel({ tools = [] }) {
  const { t } = useTranslation();
  const id = useId();
  const [selected, setSelected] = useState('');
  const [events, setEvents] = useState([]);
  const [docs, setDocs] = useState([]);
  const [checklist, setChecklist] = useState(null);
  const [cleaningConfirmed, setCleaningConfirmed] = useState(false);
  const [eventDraft, setEventDraft] = useState({ title: '', date: '', notes: '' });
  const [docTitle, setDocTitle] = useState('');
  const [docFile, setDocFile] = useState(null);
  const [repeatRenters, setRepeatRenters] = useState([]);
  const [followupDraft, setFollowupDraft] = useState({});
  const [loaded, setLoaded] = useState(false);

  const loadTool = async (toolId) => {
    if (!toolId) { setEvents([]); setDocs([]); setChecklist(null); return; }
    try {
      const [m, s, c] = await Promise.all([
        toolRentalsApi.getMaintenanceEvents(toolId).catch(() => ({ events: [] })),
        toolRentalsApi.getSafetyDocuments(toolId).catch(() => ({ documents: [] })),
        toolRentalsApi.getAvailabilityChecklist(toolId, false).catch(() => null),
      ]);
      setEvents(m.events || []);
      setDocs(s.documents || []);
      setChecklist(c);
    } catch { /* keep the previous state */ }
  };

  useEffect(() => {
    toolRentalsApi.getRepeatRenters().then((r) => setRepeatRenters(r.renters || [])).catch(() => {});
    setLoaded(true);
  }, []);

  useEffect(() => { if (selected) loadTool(selected); }, [selected]);

  const tool = tools.find((x) => String(x.id) === String(selected));
  const isAvailable = tool?.is_available === true;

  const handleCreateEvent = async () => {
    if (!eventDraft.title.trim() || !eventDraft.date) {
      toast.error(t('toolRentals.maintenanceInvalid') || 'Give the maintenance a title and a date.');
      return;
    }
    try {
      await toolRentalsApi.createMaintenanceEvent(selected, {
        title: eventDraft.title.trim(), scheduled_date: eventDraft.date, notes: eventDraft.notes.trim() || undefined,
      });
      setEventDraft({ title: '', date: '', notes: '' });
      toast.success(t('toolRentals.maintenanceCreated') || 'Maintenance scheduled');
      loadTool(selected);
    } catch (err) {
      toast.error(err?.response?.data?.error || t('toolRentals.maintenanceFailed') || 'Could not schedule maintenance');
    }
  };

  const handleCompleteEvent = async (event, withRepair) => {
    try {
      await toolRentalsApi.completeMaintenanceEvent(selected, event.id, {
        create_repair_record: withRepair,
        notes: withRepair ? (event.notes || 'Maintenance completed.') : undefined,
      });
      toast.success(t('toolRentals.maintenanceCompleted') || 'Maintenance completed');
      loadTool(selected);
    } catch (err) {
      toast.error(err?.response?.data?.error || t('toolRentals.maintenanceFailed') || 'Could not complete maintenance');
    }
  };

  const handleCancelEvent = async (event) => {
    try {
      await toolRentalsApi.cancelMaintenanceEvent(selected, event.id);
      loadTool(selected);
    } catch (err) {
      toast.error(err?.response?.data?.error || t('toolRentals.maintenanceFailed') || 'Could not cancel maintenance');
    }
  };

  const handleUploadDoc = async () => {
    if (!docFile || !docTitle.trim()) {
      toast.error(t('toolRentals.safetyDocInvalid') || 'Choose a PDF or image file and give it a title.');
      return;
    }
    try {
      await toolRentalsApi.uploadSafetyDocument(selected, docFile, docTitle.trim());
      setDocFile(null);
      setDocTitle('');
      toast.success(t('toolRentals.safetyDocUploaded') || 'Safety document uploaded');
      loadTool(selected);
    } catch (err) {
      toast.error(err?.response?.data?.error || t('toolRentals.safetyDocFailed') || 'Could not upload the safety document');
    }
  };

  const handleFlipAvailability = async () => {
    try {
      await toolRentalsApi.updateTool(selected, { is_available: true, cleaning_confirmed: cleaningConfirmed });
      toast.success(t('toolRentals.availabilityRestored') || 'Tool is available again');
      setCleaningConfirmed(false);
      loadTool(selected);
    } catch (err) {
      if (err?.response?.data?.code === 'availability_checklist_incomplete') {
        setChecklist(err.response.data.checks ? { checks: err.response.data.checks, complete: false } : checklist);
        toast.error(t('toolRentals.checklistIncomplete') || 'The return-to-availability checklist is not complete yet.');
      } else {
        toast.error(err?.response?.data?.error || t('toolRentals.availabilityFailed') || 'Could not change availability');
      }
    }
  };

  const handleFollowup = async (renter) => {
    const note = (followupDraft[renter.renter_id] || '').trim();
    if (!note) {
      toast.error(t('toolRentals.followupNoteRequired') || 'Write a follow-up note first.');
      return;
    }
    try {
      await toolRentalsApi.recordRenterFollowup({ renter_id: renter.renter_id, note });
      setFollowupDraft((prev) => ({ ...prev, [renter.renter_id]: '' }));
      toast.success(t('toolRentals.followupRecorded') || 'Follow-up recorded');
      const r = await toolRentalsApi.getRepeatRenters().catch(() => ({ renters: [] }));
      setRepeatRenters(r.renters || []);
    } catch (err) {
      toast.error(err?.response?.data?.error || t('toolRentals.followupFailed') || 'Could not record the follow-up');
    }
  };

  if (!loaded) return null;

  return (
    <section className="rounded-xl border" style={{ borderColor: 'var(--color-border)', background: 'var(--color-surface)' }}>
      <header className="px-5 pt-4 pb-2">
        <h3 className="text-sm font-semibold">{t('toolRentals.maintainTitle') || 'Maintain & review'}</h3>
        <p className="text-[11px]" style={{ color: 'var(--color-text-muted)' }}>
          {t('toolRentals.maintainSubtitle') || 'Maintenance schedule, safety documents, return-to-availability checks, and repeat renters.'}
        </p>
      </header>
      <div className="px-5 pb-5 flex flex-col gap-5">
        <div>
          <label htmlFor={`${id}-tool`}>{t('toolRentals.maintainChooseTool') || 'Tool'}</label>
          <select id={`${id}-tool`} value={selected} onChange={(e) => setSelected(e.target.value)}>
            <option value="">{t('toolRentals.maintainChooseToolOption') || 'Choose a tool'}</option>
            {tools.map((x) => <option key={x.id} value={x.id}>{x.name || x.title}</option>)}
          </select>
        </div>

        {selected && (
          <>
            <div>
              <h4 className="text-sm font-semibold">{t('toolRentals.maintenanceTitle') || 'Maintenance calendar'}</h4>
              {events.length === 0 ? (
                <p className="text-[11px]" style={{ color: 'var(--color-text-muted)' }}>{t('toolRentals.maintenanceEmpty') || 'No maintenance scheduled yet.'}</p>
              ) : (
                <ul className="divide-y">
                  {events.map((event) => (
                    <li key={event.id} className="py-2 flex items-center justify-between gap-3">
                      <div>
                        <div className="text-sm font-medium">{event.title}</div>
                        <div className="text-[11px]" style={{ color: 'var(--color-text-muted)' }}>
                          {formatDate(event.scheduled_date)} · {t(`toolRentals.maintenanceStatus_${event.status}`) || event.status}
                          {event.notes ? ` · ${event.notes}` : ''}
                        </div>
                      </div>
                      {event.status === 'scheduled' && (
                        <div className="flex gap-2">
                          <button type="button" onClick={() => handleCompleteEvent(event, false)} className="text-xs px-2.5 py-1.5 rounded-md bg-orange-500 hover:bg-orange-600 text-white font-semibold">
                            {t('toolRentals.maintenanceComplete') || 'Mark done'}
                          </button>
                          <button type="button" onClick={() => handleCompleteEvent(event, true)} className="text-xs px-2.5 py-1.5 rounded-md border font-semibold">
                            {t('toolRentals.maintenanceCompleteRepair') || 'Done + repair record'}
                          </button>
                          <button type="button" onClick={() => handleCancelEvent(event)} className="text-xs px-2.5 py-1.5 rounded-md border font-semibold">
                            {t('common.cancel') || 'Cancel'}
                          </button>
                        </div>
                      )}
                    </li>
                  ))}
                </ul>
              )}
              <div className="flex gap-2 flex-wrap mt-2">
                <input type="text" maxLength={200} placeholder={t('toolRentals.maintenanceTitlePlaceholder') || 'What needs doing?'} value={eventDraft.title} onChange={(e) => setEventDraft((prev) => ({ ...prev, title: e.target.value }))} />
                <input type="date" value={eventDraft.date} onChange={(e) => setEventDraft((prev) => ({ ...prev, date: e.target.value }))} />
                <input type="text" maxLength={2000} placeholder={t('toolRentals.maintenanceNotesPlaceholder') || 'Notes (optional)'} value={eventDraft.notes} onChange={(e) => setEventDraft((prev) => ({ ...prev, notes: e.target.value }))} />
                <button type="button" onClick={handleCreateEvent} className="text-xs px-2.5 py-1.5 rounded-md bg-orange-500 hover:bg-orange-600 text-white font-semibold">
                  {t('toolRentals.maintenanceSchedule') || 'Schedule maintenance'}
                </button>
              </div>
            </div>

            <div>
              <h4 className="text-sm font-semibold">{t('toolRentals.safetyDocsTitle') || 'Safety documentation'}</h4>
              {docs.length === 0 ? (
                <p className="text-[11px]" style={{ color: 'var(--color-text-muted)' }}>{t('toolRentals.safetyDocsEmpty') || 'No safety documents uploaded yet. Renters see these on the listing.'}</p>
              ) : (
                <ul>
                  {docs.map((doc) => (
                    <li key={doc.id} className="py-1 flex items-center justify-between gap-3">
                      <a href={doc.file_url} target="_blank" rel="noreferrer" className="text-sm text-orange-400 hover:text-orange-300">{doc.title}</a>
                      <button type="button" onClick={async () => { await toolRentalsApi.deleteSafetyDocument(selected, doc.id).catch(() => {}); loadTool(selected); }} className="text-xs px-2 py-1 rounded-md border">
                        {t('common.delete') || 'Delete'}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              <div className="flex gap-2 flex-wrap mt-2">
                <input type="text" maxLength={200} placeholder={t('toolRentals.safetyDocTitlePlaceholder') || 'Document title'} value={docTitle} onChange={(e) => setDocTitle(e.target.value)} />
                <input type="file" accept="application/pdf,image/*" onChange={(e) => setDocFile(e.target.files?.[0] || null)} />
                <button type="button" disabled={!docFile || !docTitle.trim()} onClick={handleUploadDoc} className="text-xs px-2.5 py-1.5 rounded-md bg-orange-500 hover:bg-orange-600 text-white font-semibold">
                  {t('toolRentals.safetyDocUpload') || 'Upload safety document'}
                </button>
              </div>
            </div>

            {!isAvailable && checklist && (
              <div>
                <h4 className="text-sm font-semibold">{t('toolRentals.checklistTitle') || 'Return to availability'}</h4>
                <ul className="mt-1 space-y-0.5 text-[11px]">
                  {Object.keys(CHECKLIST_LABELS).map((key) => (
                    <li key={key} className="flex items-center gap-1.5">
                      <span aria-hidden="true">{checklist.checks?.[key] ? '✓' : '—'}</span>
                      <span>{t(CHECKLIST_LABELS[key])}</span>
                    </li>
                  ))}
                </ul>
                <label className="flex items-center gap-2 mt-2 text-sm">
                  <input type="checkbox" checked={cleaningConfirmed} onChange={(e) => setCleaningConfirmed(e.target.checked)} />
                  {t('toolRentals.checklistCleaningConfirm') || 'I confirm the tool is cleaned and ready.'}
                </label>
                <button
                  type="button"
                  onClick={handleFlipAvailability}
                  className="mt-2 text-xs px-2.5 py-1.5 rounded-md bg-orange-500 hover:bg-orange-600 text-white font-semibold"
                >
                  {t('toolRentals.checklistRestore') || 'Make available again'}
                </button>
              </div>
            )}
          </>
        )}

        <div>
          <h4 className="text-sm font-semibold">{t('toolRentals.repeatRentersTitle') || 'Repeat renters'}</h4>
          {repeatRenters.length === 0 ? (
            <p className="text-[11px]" style={{ color: 'var(--color-text-muted)' }}>{t('toolRentals.repeatRentersEmpty') || 'No renter has completed two rentals with you yet.'}</p>
          ) : (
            <ul className="divide-y">
              {repeatRenters.map((renter) => (
                <li key={renter.renter_id} className="py-3">
                  <div className="text-sm font-medium">
                    {renter.first_name} {renter.last_name} · {t('toolRentals.repeatRentersCount', { count: renter.completed_bookings }) || `${renter.completed_bookings} completed rentals`}
                  </div>
                  {(renter.followups || []).map((f) => (
                    <p key={f.id} className="text-[11px]" style={{ color: 'var(--color-text-muted)' }}>
                      {formatDate(f.created_at)} · {f.note}
                    </p>
                  ))}
                  <div className="flex gap-2 flex-wrap mt-2">
                    <input
                      type="text" maxLength={2000}
                      placeholder={t('toolRentals.followupPlaceholder') || 'Follow-up note'}
                      value={followupDraft[renter.renter_id] || ''}
                      onChange={(e) => setFollowupDraft((prev) => ({ ...prev, [renter.renter_id]: e.target.value }))}
                    />
                    <button type="button" onClick={() => handleFollowup(renter)} className="text-xs px-2.5 py-1.5 rounded-md bg-orange-500 hover:bg-orange-600 text-white font-semibold">
                      {t('toolRentals.followupRecord') || 'Record follow-up'}
                    </button>
                    <Link to={`/messages?helperId=${encodeURIComponent(renter.renter_id)}`} className="text-xs px-2.5 py-1.5 rounded-md border font-semibold">
                      {t('toolRentals.followupMessage') || 'Message renter'}
                    </Link>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </section>
  );
}
