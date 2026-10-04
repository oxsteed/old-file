import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../hooks/useAuth';
import api from '../api/axios';
import toast from 'react-hot-toast';
import { ProgressBar, Btn, Input, Textarea, Select } from './dashboardUI';
import CoverImageUpload from './profile/CoverImageUpload';
import ProfileSlugField from './profile/ProfileSlugField';
import { helperProfilePath } from '../utils/profileUrls';
import ProfileStudioShell from './profileStudio/ProfileStudioShell';
import ProfilePreviewCard from './profileStudio/ProfilePreviewCard';
import HelperAvailabilityEditor from './HelperAvailabilityEditor';
import {
  applySectionCompleteness,
  buildHelperSectionCompleteness,
  formatHelperPlace,
  formatHelperPreviewMeta,
  formatHelperRateBits,
  isHelperCoreDirty,
  resolveHelperSaveBar,
  serializeHelperCore,
  shouldPromptLeaveStickySection,
} from '../utils/profileStudio';


// ── Main component ────────────────────────────────────────────────────────────
export default function EditProfileTab() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const [loading, setLoading] = useState(true);
  const [saving,  setSaving]  = useState(false);
  const [saveError, setSaveError] = useState(null);
  const [lastSavedAt, setLastSavedAt] = useState(null);
  const [uploadingImage, setUploadingImage] = useState(false);
  const [deletingId, setDeletingId] = useState(null); // row-level busy state for destructive deletes
  const [section, setSection] = useState('cover');

  const [visibility, setVisibility] = useState({
    show_services: true,
    show_faqs: true,
    show_policies: true,
    show_gallery: true,
    show_hours: true,
  });

  const [core, setCore] = useState({
    profile_headline: '', bio_long: '', hourly_rate_min: '', hourly_rate_max: '',
    service_radius_miles: 10, service_city: '', service_state: '',
    is_available_now: false,
  });
  // True weekly schedule lives in the ONE availability system (helper_availability
  // + availability_blocks); the editor below owns it and reports back here.
  const [hasSchedule, setHasSchedule] = useState(false);
  const [services,  setServices]  = useState([]);
  const [faqs,      setFaqs]      = useState([]);
  const [policies,  setPolicies]  = useState([]);
  const [gallery,   setGallery]   = useState([]);
  const [failedImages, setFailedImages] = useState({});

  const [newSvc, setNewSvc] = useState({ name:'', description:'', price:'', price_unit:'flat', duration:'', category:'General', popular:false });
  const [editingServiceId, setEditingServiceId] = useState(null);
  const [editSvc, setEditSvc] = useState({ name:'', description:'', price:'', price_unit:'flat', duration:'', category:'General', popular:false });
  const [newFaq, setNewFaq] = useState({ question:'', answer:'' });
  const [editingFaqId, setEditingFaqId] = useState(null);
  const [editFaq, setEditFaq] = useState({ question:'', answer:'' });
  const [newPol, setNewPol] = useState({ title:'', content:'', icon:'calendar-x' });
  const [editingPolicyId, setEditingPolicyId] = useState(null);
  const [editPol, setEditPol] = useState({ title:'', content:'', icon:'calendar-x' });
  const [newImg, setNewImg] = useState({ url:'', caption:'' });
  const [coverImageUrl, setCoverImageUrl] = useState(null);
  const [profileSlug, setProfileSlug] = useState(null);
  const [profileSlugUpdatedAt, setProfileSlugUpdatedAt] = useState(null);

  const coreBaselineRef = useRef('');
  const coreSnapRef = useRef(null);

  useEffect(() => {
    api.get('/helper-profile/me')
      .then(r => {
        const d = r.data;
        const nextCore = {
          profile_headline:     d.profile_headline     || '',
          bio_long:             d.bio_long              || '',
          hourly_rate_min:      d.hourly_rate_min       || '',
          hourly_rate_max:      d.hourly_rate_max       || '',
          service_radius_miles: d.service_radius_miles  || 10,
          service_city:         d.service_city          || '',
          service_state:        d.service_state         || '',
          is_available_now:     !!d.is_available_now,
        };
        setCore(nextCore);
        coreBaselineRef.current = serializeHelperCore(nextCore);
        coreSnapRef.current = { ...nextCore };
        setVisibility({
          show_services: d.show_services !== false,
          show_faqs: d.show_faqs !== false,
          show_policies: d.show_policies !== false,
          show_gallery: d.show_gallery !== false,
          show_hours: d.show_hours !== false,
        });
        setServices(d.services  || []);
        setFaqs(d.faqs          || []);
        setPolicies(d.policies  || []);
        setGallery(d.gallery    || []);
        setCoverImageUrl(d.cover_image_url || d.cover_photo_url || null);
        setProfileSlug(d.profile_slug || null);
        setProfileSlugUpdatedAt(d.profile_slug_updated_at || null);
      })
      .catch(() => toast.error(t('helperDashboard.failedLoadProfile')))
      .finally(() => setLoading(false));
  }, [t]);

  const coreDirty = isHelperCoreDirty(core, coreBaselineRef.current);

  // Leave-guard: warn on tab close / refresh when Basics/Hours core is dirty
  useEffect(() => {
    if (!coreDirty) return undefined;
    const onBefore = (e) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', onBefore);
    return () => window.removeEventListener('beforeunload', onBefore);
  }, [coreDirty]);

  const handleSectionChange = (next) => {
    if (shouldPromptLeaveStickySection(section, next, coreDirty)) {
      const ok = window.confirm(
        t('profileStudio.unsavedLeave'),
      );
      if (!ok) return;
    }
    setSection(next);
  };

  // ── Core save ───────────────────────────────────────────────────────────────
  const markSaved = () => {
    setLastSavedAt(Date.now());
    setSaveError(null);
  };

  const saveCore = async (e) => {
    e?.preventDefault();
    setSaving(true);
    setSaveError(null);
    try {
      await api.put('/helper-profile/core', core);
      coreBaselineRef.current = serializeHelperCore(core);
      coreSnapRef.current = { ...core };
      markSaved();
      toast.success(t('helperDashboard.profileSaved'));
    } catch (err) {
      const msg = err.response?.data?.error || t('helperDashboard.failedSave');
      setSaveError(msg);
      toast.error(msg);
    }
    setSaving(false);
  };

  const discardCore = () => {
    const snap = coreSnapRef.current;
    if (!snap) return;
    setCore({ ...snap });
  };

  // ── Services ────────────────────────────────────────────────────────────────
  const addService = async (e) => {
    e.preventDefault();
    try {
      const r = await api.post('/helper-profile/services', newSvc);
      setServices(p => [...p, r.data]);
      setNewSvc({ name:'', description:'', price:'', price_unit:'flat', duration:'', category:'General', popular:false });
      markSaved();
      toast.success(t('helperDashboard.serviceAdded'));
    } catch { toast.error(t('helperDashboard.failedAddService')); }
  };
  const deleteService = async (id) => {
    if (deletingId) return;
    if (!window.confirm(t('helperDashboard.confirmDelete'))) return;
    setDeletingId(id);
    try { await api.delete(`/helper-profile/services/${id}`); setServices(p => p.filter(s => s.id !== id)); markSaved(); }
    catch { toast.error(t('helperDashboard.failedDelete')); }
    finally { setDeletingId(null); }
  };
  const beginEditService = (s) => {
    setEditingServiceId(s.id);
    setEditSvc({
      name: s.name || '',
      description: s.description || '',
      price: s.price != null ? String(s.price) : '',
      price_unit: s.price_unit || 'flat',
      duration: s.duration || '',
      category: s.category || 'General',
      popular: !!s.popular,
    });
  };
  const cancelEditService = () => {
    setEditingServiceId(null);
    setEditSvc({ name:'', description:'', price:'', price_unit:'flat', duration:'', category:'General', popular:false });
  };
  const saveEditService = async (e) => {
    e?.preventDefault();
    if (!editingServiceId) return;
    try {
      const r = await api.put(`/helper-profile/services/${editingServiceId}`, {
        name: editSvc.name,
        description: editSvc.description || null,
        price: editSvc.price === '' ? null : parseFloat(editSvc.price),
        price_unit: editSvc.price_unit,
        duration: editSvc.duration || null,
        category: editSvc.category || 'General',
        popular: !!editSvc.popular,
      });
      setServices(p => p.map(s => (s.id === editingServiceId ? r.data : s)));
      cancelEditService();
      markSaved();
      toast.success(t('helperDashboard.serviceUpdated'));
    } catch {
      toast.error(t('helperDashboard.failedUpdateService'));
    }
  };

  // ── FAQs ────────────────────────────────────────────────────────────────────
  const addFaq = async (e) => {
    e.preventDefault();
    try {
      const r = await api.post('/helper-profile/faqs', newFaq);
      setFaqs(p => [...p, r.data]);
      setNewFaq({ question:'', answer:'' });
      markSaved();
      toast.success(t('helperDashboard.faqAdded'));
    } catch { toast.error(t('helperDashboard.failedAddFaq')); }
  };
  const deleteFaq = async (id) => {
    if (deletingId) return;
    if (!window.confirm(t('helperDashboard.confirmDelete'))) return;
    setDeletingId(id);
    try { await api.delete(`/helper-profile/faqs/${id}`); setFaqs(p => p.filter(f => f.id !== id)); markSaved(); }
    catch { toast.error(t('helperDashboard.failedDelete')); }
    finally { setDeletingId(null); }
  };
  const beginEditFaq = (f) => {
    setEditingFaqId(f.id);
    setEditFaq({ question: f.question || '', answer: f.answer || '' });
  };
  const cancelEditFaq = () => {
    setEditingFaqId(null);
    setEditFaq({ question:'', answer:'' });
  };
  const saveEditFaq = async (e) => {
    e?.preventDefault();
    if (!editingFaqId) return;
    try {
      const r = await api.put(`/helper-profile/faqs/${editingFaqId}`, {
        question: editFaq.question,
        answer: editFaq.answer,
      });
      setFaqs(p => p.map(f => (f.id === editingFaqId ? r.data : f)));
      cancelEditFaq();
      markSaved();
      toast.success(t('helperDashboard.faqUpdated'));
    } catch {
      toast.error(t('helperDashboard.failedUpdateFaq'));
    }
  };

  // ── Policies ────────────────────────────────────────────────────────────────
  const addPolicy = async (e) => {
    e.preventDefault();
    try {
      const r = await api.post('/helper-profile/policies', newPol);
      setPolicies(p => [...p, r.data]);
      setNewPol({ title:'', content:'', icon:'calendar-x' });
      markSaved();
      toast.success(t('helperDashboard.policyAdded'));
    } catch { toast.error(t('helperDashboard.failedAddPolicy')); }
  };
  const deletePolicy = async (id) => {
    if (deletingId) return;
    if (!window.confirm(t('helperDashboard.confirmDelete'))) return;
    setDeletingId(id);
    try { await api.delete(`/helper-profile/policies/${id}`); setPolicies(p => p.filter(pol => pol.id !== id)); markSaved(); }
    catch { toast.error(t('helperDashboard.failedDelete')); }
    finally { setDeletingId(null); }
  };
  const beginEditPolicy = (pol) => {
    setEditingPolicyId(pol.id);
    setEditPol({
      title: pol.title || '',
      content: pol.content || '',
      icon: pol.icon || 'calendar-x',
    });
  };
  const cancelEditPolicy = () => {
    setEditingPolicyId(null);
    setEditPol({ title:'', content:'', icon:'calendar-x' });
  };
  const saveEditPolicy = async (e) => {
    e?.preventDefault();
    if (!editingPolicyId) return;
    try {
      const r = await api.put(`/helper-profile/policies/${editingPolicyId}`, {
        title: editPol.title,
        content: editPol.content,
        icon: editPol.icon,
      });
      setPolicies(p => p.map(pol => (pol.id === editingPolicyId ? r.data : pol)));
      cancelEditPolicy();
      markSaved();
      toast.success(t('helperDashboard.policyUpdated'));
    } catch {
      toast.error(t('helperDashboard.failedUpdatePolicy'));
    }
  };

  // ── Gallery ─────────────────────────────────────────────────────────────────
  const addImage = async (e) => {
    e.preventDefault();
    setUploadingImage(true);
    try {
      const r = await api.post('/helper-profile/gallery', newImg);
      setGallery(p => [...p, r.data]);
      setNewImg({ url:'', caption:'' });
      markSaved();
      toast.success(t('helperDashboard.photoAdded'));
    } catch { toast.error(t('helperDashboard.failedAddPhoto')); }
    finally { setUploadingImage(false); }
  };
  const deleteImage = async (id) => {
    if (deletingId) return;
    if (!window.confirm(t('helperDashboard.confirmDelete'))) return;
    setDeletingId(id);
    try { await api.delete(`/helper-profile/gallery/${id}`); setGallery(p => p.filter(g => g.id !== id)); markSaved(); }
    catch { toast.error(t('helperDashboard.failedDelete')); }
    finally { setDeletingId(null); }
  };

  // ── Visibility save ───────────────────────────────────────────────────────────
  const saveVisibility = async (updates) => {
    try {
      const payload = { ...visibility, ...updates };
      await api.put('/helper-profile/visibility', payload);
      setVisibility(payload);
      markSaved();
      toast.success(t('helperDashboard.visibilitySaved'));
    } catch (err) {
      toast.error(err.response?.data?.error || t('helperDashboard.failedSave'));
    }
  };

  const toggleVisibility = (key) => {
    saveVisibility({ [key]: !visibility[key] });
  };

  // ── Profile completeness ─────────────────────────────────────────────────────
  const checks = [
    !!core.bio_long,
    !!core.profile_headline,
    !!core.hourly_rate_min,
    services.length > 0,
    faqs.length > 0,
    policies.length > 0,
    gallery.length > 0,
    hasSchedule,
  ];
  const pct = Math.round((checks.filter(Boolean).length / checks.length) * 100);

  const sectionFlags = useMemo(() => buildHelperSectionCompleteness({
    coverImageUrl,
    core,
    servicesCount: services.length,
    faqsCount: faqs.length,
    policiesCount: policies.length,
    galleryCount: gallery.length,
    hasSchedule,
  }), [coverImageUrl, core, services.length, faqs.length, policies.length, gallery.length, hasSchedule]);

  const SECTIONS = useMemo(() => applySectionCompleteness([
    { id: 'cover',      label: t('profileStudio.sectionCover') },
    { id: 'basics',     label: t('helperDashboard.sectionBasicInfo') },
    { id: 'hours',      label: t('helperDashboard.sectionAvailability') },
    { id: 'services',   label: t('helperDashboard.sectionServices') },
    { id: 'faqs',       label: t('helperDashboard.sectionFaqs') },
    { id: 'policies',   label: t('helperDashboard.sectionPolicies') },
    { id: 'gallery',    label: t('helperDashboard.sectionPhotos') },
    { id: 'visibility', label: t('helperDashboard.sectionVisibility') },
  ], sectionFlags), [t, sectionFlags]);

  const panelHints = {
    cover: t('helperDashboard.profileCoverHint'),
    basics: t('profileStudio.hintBasics'),
    hours: t('helperDashboard.hoursHint'),
    services: t('profileStudio.hintServices'),
    faqs: t('profileStudio.hintFaqs'),
    policies: t('profileStudio.hintPolicies'),
    gallery: t('helperDashboard.photosHint'),
    visibility: t('helperDashboard.visibilityHint'),
  };

  const saveBar = resolveHelperSaveBar({
    section,
    coreDirty,
    saving,
    error: saveError,
    lastSavedAt,
  });
  const dirty = saveBar.dirty;
  const showSaveActions = saveBar.showActions;
  const saveLabel = section === 'hours'
    ? (saving ? t('helperDashboard.saving') : t('helperDashboard.saveHours'))
    : (saving ? t('helperDashboard.saving') : t('helperDashboard.saveBasicInfo'));

  let statusMessage = t(saveBar.statusKey);
  if (saveBar.mode === 'error' && saveBar.error) {
    statusMessage = saveBar.error;
  } else if (saveBar.mode === 'auto' && lastSavedAt) {
    const time = new Date(lastSavedAt).toLocaleTimeString(undefined, {
      hour: 'numeric',
      minute: '2-digit',
    });
    statusMessage = t('profileStudio.savedAutomaticallyWithTime', { time });
  }
  const statusHint = saveBar.showShortcutHint
    ? t('profileStudio.saveShortcut')
    : (lastSavedAt && saveBar.mode === 'auto'
      ? t('profileStudio.autoSaveHint')
      : null);

  const place = formatHelperPlace(core);
  const rateBits = formatHelperRateBits(core);
  const rateLine = rateBits.length
    ? t('profileStudio.ratesMeta', { rates: rateBits.join(' – ') })
    : '';
  const radiusLine = core.service_radius_miles
    ? t('profileStudio.radiusMeta', { miles: core.service_radius_miles })
    : '';
  const meta = formatHelperPreviewMeta({ place, ratesLine: rateLine, radiusLine });

  const publicHref = user?.id ? helperProfilePath({ id: user.id, profileSlug }) : '';

  const preview = (
    <ProfilePreviewCard
      variant="helper"
      cover={coverImageUrl}
      avatar={user?.avatar_url || user?.profile_photo_url || null}
      name={user?.name || user?.full_name || ''}
      tagline={core.profile_headline || ''}
      meta={meta}
      about={core.bio_long || ''}
      availableNow={!!core.is_available_now}
      publicHref={publicHref}
      publicLabel={t('helperDashboard.viewPublicProfile')}
    />
  );

  const headerExtra = publicHref ? (
    <a
      href={publicHref}
      target="_blank"
      rel="noopener noreferrer"
      className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-orange-500/10 text-orange-400 hover:bg-orange-500/20 transition border border-orange-500/30 text-sm font-semibold whitespace-nowrap"
    >
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6"/><polyline points="15 3 21 3 21 9"/>
        <line x1="10" y1="14" x2="21" y2="3"/>
      </svg>
      {t('helperDashboard.viewPublicProfile')}
    </a>
  ) : null;

  if (loading) return <div className="py-16 text-center text-gray-500 text-sm">{t('helperDashboard.loadingProfile')}</div>;

  let sectionBody = null;

  if (section === 'cover') {
    sectionBody = (
      <CoverImageUpload
        embedded
        currentCoverUrl={coverImageUrl}
        onUploadSuccess={(url) => { setCoverImageUrl(url || null); markSaved(); }}
        onError={(msg) => {
          const s = typeof msg === 'string' ? msg : String(msg ?? '');
          if (s) toast.error(s);
        }}
      />
    );
  } else if (section === 'basics') {
    sectionBody = (
      <form
        id="ps-helper-basics"
        onSubmit={saveCore}
        className="space-y-4"
        onKeyDown={(e) => {
          if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 's') {
            e.preventDefault();
            if (!saving && coreDirty) saveCore();
          }
        }}
      >
        <Input label={t('helperDashboard.tagline')} value={core.profile_headline}
          onChange={e => setCore({ ...core, profile_headline: e.target.value })}
          placeholder={t('helperDashboard.taglinePlaceholder')} maxLength={280} />
        <Textarea label={t('helperDashboard.bio')} rows={5} value={core.bio_long}
          onChange={e => setCore({ ...core, bio_long: e.target.value })}
          placeholder={t('helperDashboard.bioPlaceholder')} maxLength={1500} />
        <div className="grid grid-cols-2 gap-3">
          <Input label={t('helperDashboard.minRate')} type="number" min="0" value={core.hourly_rate_min}
            onChange={e => setCore({ ...core, hourly_rate_min: e.target.value })} placeholder="45" />
          <Input label={t('helperDashboard.maxRate')} type="number" min="0" value={core.hourly_rate_max}
            onChange={e => setCore({ ...core, hourly_rate_max: e.target.value })} placeholder="85" />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Input label={t('helperDashboard.city')} value={core.service_city}
            onChange={e => setCore({ ...core, service_city: e.target.value })} placeholder="Austin" />
          <Input label={t('helperDashboard.state')} value={core.service_state}
            onChange={e => setCore({ ...core, service_state: e.target.value })} placeholder="TX" maxLength={2} />
        </div>
        <Input label={t('helperDashboard.serviceRadius')} type="number" min="1" max="100"
          value={core.service_radius_miles}
          onChange={e => setCore({ ...core, service_radius_miles: e.target.value })} />
        <div className="flex items-center gap-2">
          <input type="checkbox" id="avail-now" checked={!!core.is_available_now}
            onChange={e => setCore({ ...core, is_available_now: e.target.checked })}
            className="accent-orange-500" />
          <label htmlFor="avail-now" className="text-sm text-gray-300">{t('helperDashboard.availableNow')}</label>
        </div>
      </form>
    );
  } else if (section === 'hours') {
    // Single availability editor: weekly template + dated exceptions, all in
    // the one system. It saves itself; nothing here writes availability_json.
    sectionBody = (
      <HelperAvailabilityEditor
        onTemplateLoaded={(tpl) => setHasSchedule((tpl || []).length > 0)}
      />
    );
  } else if (section === 'services') {
    sectionBody = (
      <>
        {services.length === 0 && <p className="text-gray-600 text-sm mb-4">{t('helperDashboard.noServices')}</p>}
        <div className="space-y-2 mb-5">
          {services.map(s => (
            <div key={s.id} className="p-3 bg-gray-800 rounded-xl border border-gray-700">
              {editingServiceId === s.id ? (
                <form onSubmit={saveEditService} className="space-y-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="text-xs font-semibold text-orange-400 uppercase tracking-wider">{t('helperDashboard.editServiceHeader')}</p>
                    <div className="flex gap-2">
                      <Btn type="button" variant="secondary" onClick={cancelEditService}>{t('common.cancel')}</Btn>
                      <Btn type="submit">{t('common.save')}</Btn>
                    </div>
                  </div>
                  <Input label={t('helperDashboard.serviceName')} value={editSvc.name}
                    onChange={e => setEditSvc({ ...editSvc, name: e.target.value })}
                    placeholder={t('helperDashboard.serviceNamePlaceholder')} required />
                  <Textarea label={t('helperDashboard.serviceDesc')} rows={2} value={editSvc.description}
                    onChange={e => setEditSvc({ ...editSvc, description: e.target.value })}
                    placeholder={t('helperDashboard.serviceDescPlaceholder')} />
                  <div className="grid grid-cols-3 gap-3">
                    <Input label={t('helperDashboard.priceLabel')} type="number" min="0" value={editSvc.price}
                      onChange={e => setEditSvc({ ...editSvc, price: e.target.value })} />
                    <Select label={t('helperDashboard.priceUnit')} value={editSvc.price_unit}
                      onChange={e => setEditSvc({ ...editSvc, price_unit: e.target.value })}>
                      <option value="flat">{t('helperDashboard.unitFlat')}</option>
                      <option value="hour">{t('helperDashboard.unitHour')}</option>
                      <option value="starting_at">{t('helperDashboard.unitStartingAt')}</option>
                      <option value="quote">{t('helperDashboard.unitQuote')}</option>
                    </Select>
                    <Input label={t('helperDashboard.duration')} value={editSvc.duration}
                      onChange={e => setEditSvc({ ...editSvc, duration: e.target.value })} placeholder={t('helperDashboard.durationPlaceholder')} />
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <Input label={t('helperDashboard.category')} value={editSvc.category}
                      onChange={e => setEditSvc({ ...editSvc, category: e.target.value })} placeholder={t('helperDashboard.categoryPlaceholder')} />
                    <div className="flex items-center gap-2 pt-5">
                      <input type="checkbox" id={`popular-edit-${s.id}`} checked={editSvc.popular}
                        onChange={e => setEditSvc({ ...editSvc, popular: e.target.checked })} className="accent-orange-500" />
                      <label htmlFor={`popular-edit-${s.id}`} className="text-sm text-gray-300">{t('helperDashboard.markPopular')}</label>
                    </div>
                  </div>
                </form>
              ) : (
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold text-white">{s.name}</p>
                    <p className="text-xs text-gray-500">{s.category} · ${s.price} / {s.price_unit}</p>
                    {s.description && <p className="text-xs text-gray-400 mt-1">{s.description}</p>}
                  </div>
                  <div className="flex flex-shrink-0 gap-2">
                    <Btn variant="secondary" type="button" onClick={() => beginEditService(s)}>{t('common.edit')}</Btn>
                    <Btn variant="danger" type="button" onClick={() => deleteService(s.id)} disabled={deletingId === s.id}>{t('helperDashboard.delete')}</Btn>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
        <form onSubmit={addService} className="space-y-3 border-t border-gray-800 pt-4">
          <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider">{t('helperDashboard.addServiceHeader')}</p>
          <Input label={t('helperDashboard.serviceName')} value={newSvc.name}
            onChange={e => setNewSvc({ ...newSvc, name: e.target.value })}
            placeholder={t('helperDashboard.serviceNamePlaceholder')} required />
          <Textarea label={t('helperDashboard.serviceDesc')} rows={2} value={newSvc.description}
            onChange={e => setNewSvc({ ...newSvc, description: e.target.value })}
            placeholder={t('helperDashboard.serviceDescPlaceholder')} />
          <div className="grid grid-cols-3 gap-3">
            <Input label={t('helperDashboard.priceLabel')} type="number" min="0" value={newSvc.price}
              onChange={e => setNewSvc({ ...newSvc, price: e.target.value })} />
            <Select label={t('helperDashboard.priceUnit')} value={newSvc.price_unit}
              onChange={e => setNewSvc({ ...newSvc, price_unit: e.target.value })}>
              <option value="flat">{t('helperDashboard.unitFlat')}</option>
              <option value="hour">{t('helperDashboard.unitHour')}</option>
              <option value="starting_at">{t('helperDashboard.unitStartingAt')}</option>
              <option value="quote">{t('helperDashboard.unitQuote')}</option>
            </Select>
            <Input label={t('helperDashboard.duration')} value={newSvc.duration}
              onChange={e => setNewSvc({ ...newSvc, duration: e.target.value })} placeholder={t('helperDashboard.durationPlaceholder')} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Input label={t('helperDashboard.category')} value={newSvc.category}
              onChange={e => setNewSvc({ ...newSvc, category: e.target.value })} placeholder={t('helperDashboard.categoryPlaceholder')} />
            <div className="flex items-center gap-2 pt-5">
              <input type="checkbox" id="popular" checked={newSvc.popular}
                onChange={e => setNewSvc({ ...newSvc, popular: e.target.checked })} className="accent-orange-500" />
              <label htmlFor="popular" className="text-sm text-gray-300">{t('helperDashboard.markPopular')}</label>
            </div>
          </div>
          <Btn type="submit">{t('helperDashboard.addServiceBtn')}</Btn>
        </form>
      </>
    );
  } else if (section === 'faqs') {
    sectionBody = (
      <>
        {faqs.length === 0 && <p className="text-gray-600 text-sm mb-4">{t('helperDashboard.noFaqs')}</p>}
        <div className="space-y-2 mb-5">
          {faqs.map(f => (
            <div key={f.id} className="p-3 bg-gray-800 rounded-xl border border-gray-700">
              {editingFaqId === f.id ? (
                <form onSubmit={saveEditFaq} className="space-y-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="text-xs font-semibold text-orange-400 uppercase tracking-wider">{t('helperDashboard.editFaqHeader')}</p>
                    <div className="flex gap-2">
                      <Btn type="button" variant="secondary" onClick={cancelEditFaq}>{t('common.cancel')}</Btn>
                      <Btn type="submit">{t('common.save')}</Btn>
                    </div>
                  </div>
                  <Input label={t('helperDashboard.questionLabel')} value={editFaq.question}
                    onChange={e => setEditFaq({ ...editFaq, question: e.target.value })}
                    placeholder={t('helperDashboard.questionPlaceholder')} required />
                  <Textarea label={t('helperDashboard.answerLabel')} rows={3} value={editFaq.answer}
                    onChange={e => setEditFaq({ ...editFaq, answer: e.target.value })} required />
                </form>
              ) : (
                <>
                  <div className="flex justify-between items-start gap-2">
                    <p className="text-sm font-semibold text-white">{f.question}</p>
                    <div className="flex flex-shrink-0 gap-2">
                      <Btn variant="secondary" type="button" onClick={() => beginEditFaq(f)}>{t('common.edit')}</Btn>
                      <Btn variant="danger" type="button" onClick={() => deleteFaq(f.id)} disabled={deletingId === f.id}>{t('helperDashboard.delete')}</Btn>
                    </div>
                  </div>
                  <p className="text-xs text-gray-500 mt-1 leading-relaxed">{f.answer}</p>
                </>
              )}
            </div>
          ))}
        </div>
        <form onSubmit={addFaq} className="space-y-3 border-t border-gray-800 pt-4">
          <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider">{t('helperDashboard.addFaqHeader')}</p>
          <Input label={t('helperDashboard.questionLabel')} value={newFaq.question}
            onChange={e => setNewFaq({ ...newFaq, question: e.target.value })}
            placeholder={t('helperDashboard.questionPlaceholder')} required />
          <Textarea label={t('helperDashboard.answerLabel')} rows={3} value={newFaq.answer}
            onChange={e => setNewFaq({ ...newFaq, answer: e.target.value })} required />
          <Btn type="submit">{t('helperDashboard.addFaqBtn')}</Btn>
        </form>
      </>
    );
  } else if (section === 'policies') {
    sectionBody = (
      <>
        {policies.length === 0 && <p className="text-gray-600 text-sm mb-4">{t('helperDashboard.noPolicies')}</p>}
        <div className="space-y-2 mb-5">
          {policies.map(p => (
            <div key={p.id} className="p-3 bg-gray-800 rounded-xl border border-gray-700">
              {editingPolicyId === p.id ? (
                <form onSubmit={saveEditPolicy} className="space-y-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="text-xs font-semibold text-orange-400 uppercase tracking-wider">{t('helperDashboard.editPolicyHeader')}</p>
                    <div className="flex gap-2">
                      <Btn type="button" variant="secondary" onClick={cancelEditPolicy}>{t('common.cancel')}</Btn>
                      <Btn type="submit">{t('common.save')}</Btn>
                    </div>
                  </div>
                  <Input label={t('helperDashboard.policyTitle')} value={editPol.title}
                    onChange={e => setEditPol({ ...editPol, title: e.target.value })}
                    placeholder={t('helperDashboard.policyTitlePlaceholder')} required />
                  <Textarea label={t('helperDashboard.policyDetails')} rows={3} value={editPol.content}
                    onChange={e => setEditPol({ ...editPol, content: e.target.value })} required />
                  <Select label={t('helperDashboard.iconLabel')} value={editPol.icon}
                    onChange={e => setEditPol({ ...editPol, icon: e.target.value })}>
                    <option value="calendar-x">{t('helperDashboard.iconCancellation')}</option>
                    <option value="credit-card">{t('helperDashboard.iconPayment')}</option>
                    <option value="shield-check">{t('helperDashboard.iconSafetyGuarantee')}</option>
                    <option value="shield">{t('helperDashboard.iconGeneral')}</option>
                  </Select>
                </form>
              ) : (
                <>
                  <div className="flex justify-between items-start gap-2">
                    <p className="text-sm font-semibold text-white">{p.title}</p>
                    <div className="flex flex-shrink-0 gap-2">
                      <Btn variant="secondary" type="button" onClick={() => beginEditPolicy(p)}>{t('common.edit')}</Btn>
                      <Btn variant="danger" type="button" onClick={() => deletePolicy(p.id)} disabled={deletingId === p.id}>{t('helperDashboard.delete')}</Btn>
                    </div>
                  </div>
                  <p className="text-xs text-gray-500 mt-1 leading-relaxed">{p.content}</p>
                </>
              )}
            </div>
          ))}
        </div>
        <form onSubmit={addPolicy} className="space-y-3 border-t border-gray-800 pt-4">
          <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider">{t('helperDashboard.addPolicyHeader')}</p>
          <Input label={t('helperDashboard.policyTitle')} value={newPol.title}
            onChange={e => setNewPol({ ...newPol, title: e.target.value })}
            placeholder={t('helperDashboard.policyTitlePlaceholder')} required />
          <Textarea label={t('helperDashboard.policyDetails')} rows={3} value={newPol.content}
            onChange={e => setNewPol({ ...newPol, content: e.target.value })} required />
          <Select label={t('helperDashboard.iconLabel')} value={newPol.icon}
            onChange={e => setNewPol({ ...newPol, icon: e.target.value })}>
            <option value="calendar-x">{t('helperDashboard.iconCancellation')}</option>
            <option value="credit-card">{t('helperDashboard.iconPayment')}</option>
            <option value="shield-check">{t('helperDashboard.iconSafetyGuarantee')}</option>
            <option value="shield">{t('helperDashboard.iconGeneral')}</option>
          </Select>
          <Btn type="submit">{t('helperDashboard.addPolicyBtn')}</Btn>
        </form>
      </>
    );
  } else if (section === 'gallery') {
    sectionBody = (
      <>
        {gallery.length === 0 && <p className="text-gray-600 text-sm mb-4">{t('helperDashboard.noPhotos')}</p>}
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 mb-5">
          {gallery.map(g => (
            <div key={g.id} className="relative group rounded-xl overflow-hidden bg-gray-800 border border-gray-700 aspect-square flex items-center justify-center">
              {!failedImages[g.id] ? (
                <img src={g.url} alt={g.caption || 'Work photo'} className="w-full h-full object-cover"
                  onError={() => setFailedImages(p => ({ ...p, [g.id]: true }))} />
              ) : (
                <div className="absolute inset-0 flex items-center justify-center bg-gray-700 text-gray-400 text-xs text-center p-2">
                  <span>{t('helperDashboard.imageLoadError') || 'Image failed to load'}</span>
                </div>
              )}
              <button onClick={() => deleteImage(g.id)} disabled={deletingId === g.id}
                className="absolute top-1.5 end-1.5 opacity-0 group-hover:opacity-100 transition w-6 h-6 bg-red-500 rounded-full flex items-center justify-center text-white text-xs font-bold z-10 disabled:opacity-40">
                ×
              </button>
              {g.caption && (
                <p className="absolute bottom-0 inset-x-0 bg-black/50 text-white text-[10px] px-2 py-1 truncate">{g.caption}</p>
              )}
            </div>
          ))}
        </div>
        <form onSubmit={addImage} className="space-y-3 border-t border-gray-800 pt-4">
          <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider">{t('helperDashboard.addPhotoHeader')}</p>
          <Input label={t('helperDashboard.imageUrl')} type="url" value={newImg.url}
            onChange={e => setNewImg({ ...newImg, url: e.target.value })}
            placeholder={t('helperDashboard.imageUrlPlaceholder')} required disabled={uploadingImage} />
          <Input label={t('helperDashboard.captionLabel')} value={newImg.caption}
            onChange={e => setNewImg({ ...newImg, caption: e.target.value })}
            placeholder={t('helperDashboard.captionPlaceholder')} disabled={uploadingImage} />
          <Btn type="submit" disabled={uploadingImage}>{uploadingImage ? t('helperDashboard.uploading') || 'Uploading...' : t('helperDashboard.addPhotoBtn')}</Btn>
        </form>
      </>
    );
  } else if (section === 'visibility') {
    sectionBody = (
      <>
        <div className="mb-5 rounded-xl border border-gray-800 bg-gray-900/60 p-4">
          <ProfileSlugField
            type="helper"
            initialSlug={profileSlug}
            slugUpdatedAt={profileSlugUpdatedAt}
            onChanged={(s) => { setProfileSlug(s); setProfileSlugUpdatedAt(new Date().toISOString()); toast.success(t('profileSlug.saved', { defaultValue: 'Profile link saved!' })); }}
          />
        </div>
        <div className="mb-5 rounded-xl border border-gray-800 bg-gray-900/60 p-4">
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm font-semibold text-white">{t('helperDashboard.profileCompleteness')}</span>
            <span className={`text-sm font-bold ${pct === 100 ? 'text-emerald-400' : pct >= 60 ? 'text-orange-400' : 'text-red-400'}`}>{pct}%</span>
          </div>
          <ProgressBar pct={pct} color={pct === 100 ? 'bg-emerald-500' : pct >= 60 ? 'bg-orange-500' : 'bg-red-500'} />
        </div>
        <div className="space-y-2">
          {[
            { key: 'show_services', label: t('helperDashboard.sectionServices') },
            { key: 'show_faqs', label: t('helperDashboard.sectionFaqs') },
            { key: 'show_policies', label: t('helperDashboard.sectionPolicies') },
            { key: 'show_gallery', label: t('helperDashboard.sectionPhotos') },
            { key: 'show_hours', label: t('helperDashboard.sectionAvailability') },
          ].map(({ key, label }) => (
            <div key={key} className="flex items-center justify-between p-3 bg-gray-800/40 rounded-lg border border-gray-700/40">
              <label className="text-sm font-medium text-gray-300">{label}</label>
              <button
                type="button"
                onClick={() => toggleVisibility(key)}
                className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                  visibility[key] ? 'bg-emerald-600' : 'bg-gray-700'
                }`}
              >
                <span
                  className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                    visibility[key] ? 'translate-x-6' : 'translate-x-1'
                  }`}
                />
              </button>
            </div>
          ))}
        </div>
      </>
    );
  }

  return (
    <ProfileStudioShell
      title={t('helperDashboard.editProfile')}
      subtitle={t('helperDashboard.editProfileDesc')}
      sections={SECTIONS}
      activeSection={section}
      onSectionChange={handleSectionChange}
      dirty={dirty}
      saving={saving}
      onSave={() => saveCore()}
      onDiscard={discardCore}
      saveLabel={saveLabel}
      hideSave={false}
      showSaveActions={showSaveActions}
      statusMessage={statusMessage}
      statusHint={statusHint}
      preview={preview}
      headerExtra={headerExtra}
      readinessPill={{
        label: t('helperDashboard.profileCompleteness') + ` · ${pct}%`,
        ready: pct === 100,
      }}
      panelHint={panelHints[section]}
    >
      {sectionBody}
    </ProfileStudioShell>
  );
}
