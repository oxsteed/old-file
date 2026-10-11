import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../../context/AuthContext';
import { getCreditMinorUnits } from '../../lib/creditCurrency';
import {
  AlertTriangle, ArrowDown, ArrowUp, Check, ChevronRight, CircleUserRound,
  FileText, Image as ImageIcon, Link2, Loader2, MapPin, Paperclip,
  Plus, RefreshCw, Save, ShieldCheck, Smile, Trash2, Upload, Video,
} from 'lucide-react';
import {
  createPost, deletePost, getCommunities, getDraft, getDrafts, getMediaVerification,
  linkAsset, publishPost, removeMediaAsset, reorderMediaAssets, searchMediaEntities,
  updateDraft, updateMediaAsset, uploadMediaCaption, uploadPhoto, uploadVideo,
} from '../../api/media';

const LINK_TYPES = ['restaurant', 'food_item', 'helper', 'business', 'job', 'tool_rental', 'direct_catalog', 'logistics_campaign'];
const EMOJIS = ['😀', '❤️', '👍', '🎉', '📍', '🏡', '🍽️', '🛠️'];
const DRAFT_STORAGE_KEY = 'oxsteed.media.compose.draft';
const REQUEST_STORAGE_KEY = 'oxsteed.media.compose.request';

function readPendingCreation(key) {
  try {
    const value = JSON.parse(window.localStorage.getItem(key));
    return value?.draft === true && value.client_request_id ? value : null;
  } catch { return null; }
}

function newRequestId() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  const bytes = new Uint8Array(16);
  globalThis.crypto?.getRandomValues?.(bytes);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = [...bytes].map(value => value.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function assetState(asset) {
  if (asset.processing_status === 'blocked' || asset.csam_status === 'flagged') return 'blocked';
  if (asset.processing_status === 'failed') return 'failed';
  if (asset.csam_status === 'unavailable' || asset.processing_status === 'waiting_configuration') return 'waiting';
  if (asset.processing_status === 'quarantine' || asset.csam_status === 'pending') return 'scanning';
  if (asset.processing_status && asset.processing_status !== 'ready') return 'processing';
  return 'ready';
}

function attachmentIcon(asset) {
  if (asset.asset_type === 'image') return ImageIcon;
  if (asset.asset_type === 'video') return Video;
  return Link2;
}

export default function MediaComposePage() {
  const { t, i18n } = useTranslation();
  const { user } = useAuth();
  const navigate = useNavigate();
  const draftStorageKey = `${DRAFT_STORAGE_KEY}:${user?.id || 'anonymous'}`;
  const requestStorageKey = `${REQUEST_STORAGE_KEY}:${user?.id || 'anonymous'}`;
  const recoveredCreation = useRef(readPendingCreation(requestStorageKey));
  const [body, setBody] = useState(recoveredCreation.current?.body || '');
  const [links, setLinks] = useState(recoveredCreation.current?.links || []);
  const [contentWarningEnabled, setContentWarningEnabled] = useState(Boolean(recoveredCreation.current?.content_warning));
  const [contentWarning, setContentWarning] = useState(recoveredCreation.current?.content_warning || '');
  const [destination, setDestination] = useState(recoveredCreation.current?.destination || 'main');
  const [communityId, setCommunityId] = useState(recoveredCreation.current?.community_id || '');
  const [communities, setCommunities] = useState([]);
  const [publishers, setPublishers] = useState([]);
  const [publisherKey, setPublisherKey] = useState('');
  const [publisherStatus, setPublisherStatus] = useState('loading');
  const [drafts, setDrafts] = useState([]);
  const [draftCursor, setDraftCursor] = useState(null);
  const [draftId, setDraftId] = useState('');
  const [assets, setAssets] = useState([]);
  const [uploads, setUploads] = useState([]);
  const [saveState, setSaveState] = useState('idle');
  const [dirty, setDirty] = useState(Boolean(recoveredCreation.current));
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [errorCode, setErrorCode] = useState('');
  const [emojiOpen, setEmojiOpen] = useState(false);
  const [externalUrl, setExternalUrl] = useState('');
  const [linkType, setLinkType] = useState('restaurant');
  const [linkQuery, setLinkQuery] = useState('');
  const [entitySuggestions, setEntitySuggestions] = useState([]);
  const [searchingEntities, setSearchingEntities] = useState(false);
  const [replaceAssetId, setReplaceAssetId] = useState(null);
  const [dragActive, setDragActive] = useState(false);
  const [loadedDraft, setLoadedDraft] = useState(null);
  const [processingNotice, setProcessingNotice] = useState('');
  const [processingStatus, setProcessingStatus] = useState('');
  const fileInputRef = useRef(null);
  const bodyRef = useRef(null);
  const publishersRef = useRef([]);
  const creatingRef = useRef(null);
  const creationPayloadRef = useRef(recoveredCreation.current);
  const requestIdRef = useRef(recoveredCreation.current?.client_request_id || newRequestId());
  const draftIdRef = useRef('');
  const saveQueueRef = useRef(Promise.resolve());
  const sessionRef = useRef(0);
  const [transitioning, setTransitioning] = useState(false);
  const uploadBusyRef = useRef(false);
  const assetRevisionRef = useRef(0);
  const [attachmentBusy, setAttachmentBusy] = useState(false);
  const metadataRef = useRef(new Map());

  const selectedPublisher = publishers.find(item => item.key === publisherKey) || null;
  const locationLabel = loadedDraft
    ? [loadedDraft.location_city, loadedDraft.location_region].filter(Boolean).join(', ')
    : [selectedPublisher?.location?.city, selectedPublisher?.location?.region].filter(Boolean).join(', ');
  const pendingUpload = attachmentBusy || uploads.some(item => item.state === 'uploading');
  const attachmentCount = assets.length + uploads.filter(item => item.state === 'uploading').length;
  const pollingProcessing = assets.some(asset => ['scanning', 'processing', 'waiting'].includes(assetState(asset)));

  const payload = useCallback(() => ({
    body,
    links,
    community_id: destination === 'space' ? communityId || null : null,
    destination,
    content_warning: contentWarningEnabled ? contentWarning : null,
  }), [body, links, communityId, destination, contentWarningEnabled, contentWarning]);
  const latestPayloadRef = useRef(payload());
  latestPayloadRef.current = payload();
  const latestAssetsRef = useRef(assets);
  latestAssetsRef.current = assets;
  const dirtyRef = useRef(dirty);
  dirtyRef.current = dirty;

  const publisherPayload = useCallback(() => {
    if (!selectedPublisher) return {};
    return {
      publisher_type: selectedPublisher.actor_type,
      actor_id: selectedPublisher.actor_id || undefined,
      ...(selectedPublisher.actor_type === 'business' ? { business_id: selectedPublisher.entity_id } : {}),
      ...(selectedPublisher.actor_type === 'restaurant' ? { restaurant_id: selectedPublisher.entity_id } : {}),
    };
  }, [selectedPublisher]);

  const applyDraft = useCallback((draft) => {
    if (!draft) return;
    setLoadedDraft(draft);
    draftIdRef.current = draft.id;
    setDraftId(draft.id);
    setBody(draft.body || '');
    setLinks(draft.links || []);
    setAssets(draft.assets || []);
    setDestination(draft.destination || (draft.community_id ? 'space' : 'main'));
    setCommunityId(draft.community_id || '');
    setContentWarningEnabled(Boolean(draft.content_warning));
    setContentWarning(draft.content_warning || '');
    setPublisherKey(current => {
      const match = publishersRef.current.find(item => item.actor_type === draft.actor_type
        && (!draft.actor_id || String(item.actor_id || '') === String(draft.actor_id)));
      return match?.key || `unavailable:${draft.actor_id}`;
    });
    setDirty(false);
    setSaveState('saved');
    window.localStorage.setItem(draftStorageKey, draft.id);
  }, [draftStorageKey]);

  const refreshDrafts = useCallback(async (append = false, cursor = null) => {
    const data = await getDrafts({ limit: 12, ...(cursor ? { cursor } : {}) });
    setDrafts(current => append ? [...current, ...(data.drafts || []).filter(draft => !current.some(item => item.id === draft.id))] : (data.drafts || []));
    setDraftCursor(data.has_more ? data.next_cursor : null);
    return data.drafts || [];
  }, []);

  useEffect(() => {
    let cancelled = false;
    Promise.all([getCommunities(), getMediaVerification(), getDrafts({ limit: 12 })]).then(([spaceData, verification, draftData]) => {
      if (cancelled) return;
      setCommunities(spaceData.communities || []);
      const options = verification.publishers || [];
      publishersRef.current = options;
      setPublishers(options);
      const pending = creationPayloadRef.current;
      const pendingPublisher = pending && options.find(option => option.actor_type === pending.publisher_type
        && (!pending.actor_id || String(option.actor_id) === String(pending.actor_id))
        && (!pending.business_id || String(option.entity_id) === String(pending.business_id))
        && (!pending.restaurant_id || String(option.entity_id) === String(pending.restaurant_id)));
      setPublisherKey(current => current || (pending ? pendingPublisher?.key || 'unavailable:pending' : options[0]?.key) || '');
      setPublisherStatus('ready');
      setDrafts(draftData.drafts || []);
      setDraftCursor(draftData.has_more ? draftData.next_cursor : null);
      const storedId = window.localStorage.getItem(draftStorageKey);
      const stored = (draftData.drafts || []).find(item => item.id === storedId);
      if (stored) applyDraft(stored);
      else if (storedId) getDraft(storedId).then(data => { if (!cancelled) applyDraft(data.draft); }).catch(() => { if (!cancelled) window.localStorage.removeItem(draftStorageKey); });
    }).catch(() => { if (!cancelled) setPublisherStatus('error'); });
    return () => { cancelled = true; };
  }, [applyDraft, draftStorageKey]);

  useEffect(() => {
    let cancelled = false;
    if (!linkQuery.trim()) { setEntitySuggestions([]); return undefined; }
    const timer = window.setTimeout(() => {
      setSearchingEntities(true);
      searchMediaEntities({ type: linkType, q: linkQuery.trim() })
        .then(data => { if (!cancelled) setEntitySuggestions(data.entities || []); })
        .catch(() => { if (!cancelled) setEntitySuggestions([]); })
        .finally(() => { if (!cancelled) setSearchingEntities(false); });
    }, 250);
    return () => { cancelled = true; window.clearTimeout(timer); };
  }, [linkQuery, linkType]);

  useEffect(() => {
    const offline = () => setSaveState('offline');
    const online = () => setSaveState(dirty ? 'error' : 'saved');
    window.addEventListener('offline', offline); window.addEventListener('online', online);
    return () => { window.removeEventListener('offline', offline); window.removeEventListener('online', online); };
  }, [dirty]);

  useEffect(() => {
    const warn = event => {
      if (!dirty && !uploads.length && !pendingUpload) return;
      event.preventDefault(); event.returnValue = '';
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty, uploads.length, pendingUpload]);

  useEffect(() => {
    const warnLinkNavigation = event => {
      if ((!dirtyRef.current && !uploads.length && !pendingUpload) || event.defaultPrevented || event.button !== 0) return;
      const link = event.target.closest?.('a[href]');
      if (!link || link.hasAttribute('download')) return;
      const target = new URL(link.href, window.location.href);
      if (target.origin === window.location.origin && target.pathname === window.location.pathname && target.search === window.location.search) return;
      if (!window.confirm(t('media.compose.switchDraftConfirm'))) {
        event.preventDefault(); event.stopImmediatePropagation();
      }
    };
    document.addEventListener('click', warnLinkNavigation, true);
    return () => document.removeEventListener('click', warnLinkNavigation, true);
  }, [pendingUpload, uploads.length, t]);

  useEffect(() => {
    if (!draftId || !pollingProcessing) {
      if (!pollingProcessing) {
        setProcessingNotice('');
        setProcessingStatus('');
      }
      return undefined;
    }
    let cancelled = false;
    let pollCount = 0;
    let timer;
    const refreshProcessingDraft = async () => {
      pollCount += 1;
      if (pollCount > 90) {
        setProcessingNotice(t('media.compose.processingDelayed'));
        setProcessingStatus('delayed');
        window.clearInterval(timer);
        return;
      }
      try {
        const revision = assetRevisionRef.current;
        const data = await getDraft(draftId);
        if (cancelled || !data.draft || uploadBusyRef.current || revision !== assetRevisionRef.current) return;
        const nextAssets = data.draft.assets || [];
        setAssets(nextAssets.map(asset => metadataRef.current.has(asset.id) ? { ...asset, alt_text: metadataRef.current.get(asset.id) } : asset));
        setLoadedDraft(data.draft);
        const stillProcessing = nextAssets.some(item => ['scanning', 'processing', 'waiting'].includes(assetState(item)));
        if (!stillProcessing) {
          setProcessingNotice(t('media.compose.processingReady'));
          setProcessingStatus('ready');
          window.clearInterval(timer);
        } else if (nextAssets.some(item => ['failed', 'blocked'].includes(assetState(item)))) {
          setProcessingStatus('failed');
          window.clearInterval(timer);
        }
      } catch {
        // Keep the current private-draft status visible through transient polls.
      }
    };
    timer = window.setInterval(refreshProcessingDraft, 4000);
    refreshProcessingDraft();
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [draftId, pollingProcessing, t]);

  const ensureDraft = useCallback(async () => {
    if (publisherStatus !== 'ready' || !selectedPublisher) {
      setError(t(publisherStatus === 'loading' ? 'media.compose.publisherLoading' : 'media.compose.publisherUnavailable'));
      setErrorCode('media_publisher_unavailable');
      throw new Error('media_publisher_unavailable');
    }
    if (draftIdRef.current) return draftIdRef.current;
    if (creatingRef.current) return creatingRef.current;
    if (!creationPayloadRef.current) creationPayloadRef.current = { ...payload(), draft: true, client_request_id: requestIdRef.current, ...publisherPayload() };
    // Persist the exact initial request, not just its ID: after a lost response
    // and reload, replay must match the server's creation hash.
    window.localStorage.setItem(requestStorageKey, JSON.stringify(creationPayloadRef.current));
    setSaveState(navigator.onLine ? 'saving' : 'offline');
    creatingRef.current = createPost(creationPayloadRef.current).then(async data => {
      const id = data.post.id;
      draftIdRef.current = id;
      setDraftId(id); setLoadedDraft(data.post); setAssets(data.post.assets || []);
      window.localStorage.setItem(draftStorageKey, id);
      creationPayloadRef.current = null;
      recoveredCreation.current = null;
      window.localStorage.removeItem(requestStorageKey);
      return id;
    }).catch(err => {
      setSaveState(navigator.onLine ? 'error' : 'offline');
      throw err;
    }).finally(() => { creatingRef.current = null; });
    return creatingRef.current;
  }, [draftStorageKey, requestStorageKey, payload, publisherPayload, publisherStatus, selectedPublisher, t]);

  const saveDraft = useCallback(({ createIfNeeded = true } = {}) => {
    const session = sessionRef.current;
    // Autosave, explicit save and publish all share this queue. An earlier
    // response must never acknowledge (or overwrite) a later edit.
    const operation = saveQueueRef.current.then(async () => {
      if (session !== sessionRef.current) return null;
      setError(''); setErrorCode('');
      try {
        const current = latestPayloadRef.current;
        const hasMeaning = current.body.trim() || current.links.length || latestAssetsRef.current.length || current.content_warning?.trim() || creationPayloadRef.current;
        if (!draftIdRef.current && (!createIfNeeded || !hasMeaning)) return null;
        setSaveState(navigator.onLine ? 'saving' : 'offline');
        const id = draftIdRef.current || await ensureDraft();
        const snapshot = latestPayloadRef.current;
        const data = await updateDraft(id, snapshot);
        if (session !== sessionRef.current) return null;
        setLoadedDraft(data.post);
        for (const [assetId, value] of [...metadataRef.current]) {
          await updateMediaAsset(id, assetId, { alt_text: value });
          if (metadataRef.current.get(assetId) === value) metadataRef.current.delete(assetId);
        }
        const acknowledged = JSON.stringify(snapshot) === JSON.stringify(latestPayloadRef.current) && metadataRef.current.size === 0;
        dirtyRef.current = !acknowledged;
        setDirty(!acknowledged); setSaveState(acknowledged ? 'saved' : 'idle');
        setDrafts(currentDrafts => [data.post, ...currentDrafts.filter(item => item.id !== data.post.id)]);
        return id;
      } catch (err) {
        setSaveState(navigator.onLine ? 'error' : 'offline');
        setError(err.response?.data?.error || t('media.compose.saveFailed'));
        setErrorCode(err.response?.data?.code || '');
        return null;
      }
    });
    saveQueueRef.current = operation.then(() => undefined);
    return operation;
  }, [ensureDraft, t]);

  useEffect(() => {
    if (!dirty || submitting || pendingUpload || publisherStatus !== 'ready' || saveState === 'error' || saveState === 'offline' || saveState === 'saving') return undefined;
    const timer = window.setTimeout(() => { void saveDraft(); }, 1100);
    return () => window.clearTimeout(timer);
  }, [dirty, pendingUpload, publisherStatus, saveDraft, saveState, submitting]);

  const change = setter => value => { setter(value); setDirty(true); setSaveState(navigator.onLine ? 'idle' : 'offline'); };

  const uploadFiles = async (files, targetAssetId = null, retryId = null) => {
    if (uploadBusyRef.current || transitioning || submitting) return;
    const allowed = Array.from(files || []).filter(file => file.type.startsWith('image/') || file.type.startsWith('video/'));
    if (!allowed.length) { setError(t('media.compose.fileTypeError')); return; }
    const available = Math.max(0, 4 - assets.length + (targetAssetId ? 1 : 0));
    if (allowed.length > available) { setError(t('media.compose.maxAttachments', { count: 4 })); return; }
    uploadBusyRef.current = true; assetRevisionRef.current += 1; setAttachmentBusy(true);
    try { for (let index = 0; index < allowed.length; index += 1) {
      const file = allowed[index];
      const localId = retryId || `${file.name}-${file.lastModified}-${index}`;
      setUploads(current => [...current.filter(item => item.id !== localId), { id: localId, name: file.name, type: file.type, progress: 0, state: 'uploading', file, replaceAssetId: targetAssetId }]);
      let id;
      let fileDigest;
      try {
        id = await ensureDraft();
        if (globalThis.crypto?.subtle) {
          const digest = await globalThis.crypto.subtle.digest('SHA-256', await file.arrayBuffer());
          fileDigest = [...new Uint8Array(digest)].map(value => value.toString(16).padStart(2, '0')).join('');
        }
        const progress = event => setUploads(current => current.map(item => item.id === localId ? { ...item, progress: event.total ? Math.round(event.loaded / event.total * 100) : item.progress } : item));
        const options = targetAssetId && index === 0 ? { replaceAssetId: targetAssetId } : {};
        const result = file.type.startsWith('video/') ? await uploadVideo(id, file, progress, options) : await uploadPhoto(id, file, progress, options);
        setAssets(current => [...current.filter(asset => asset.id !== result.asset.id && !(targetAssetId && index === 0 && asset.id === targetAssetId)), result.asset].sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0)));
        setUploads(current => current.filter(item => item.id !== localId));
        setSaveState(dirtyRef.current ? 'idle' : 'saved');
      } catch (err) {
        setUploads(current => current.map(item => item.id === localId ? { ...item, state: 'failed', error: err.response?.data?.error || t('media.compose.uploadFailed') } : item));
        if (id) try {
          const data = await getDraft(id);
          const durable = data.draft?.assets || [];
          setAssets(durable.map(asset => metadataRef.current.has(asset.id) ? { ...asset, alt_text: metadataRef.current.get(asset.id) } : asset));
          if (fileDigest && durable.some(asset => asset.content_sha256 === fileDigest)
              && (!targetAssetId || !durable.some(asset => asset.id === targetAssetId && asset.content_sha256 !== fileDigest))) {
            setUploads(current => current.filter(item => item.id !== localId));
            setSaveState(dirtyRef.current ? 'idle' : 'saved');
          }
        } catch { /* persistence is unknown; keep the explicit retry state */ }
      }
    } } finally { uploadBusyRef.current = false; assetRevisionRef.current += 1; setAttachmentBusy(false); }
    setReplaceAssetId(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
    await refreshDrafts().catch(() => {});
  };

  const addExternalVideo = async () => {
    if (uploadBusyRef.current || transitioning || submitting) return;
    if (!externalUrl.trim()) return;
    if (assets.length >= 4) { setError(t('media.compose.maxAttachments', { count: 4 })); return; }
    uploadBusyRef.current = true; assetRevisionRef.current += 1; setAttachmentBusy(true);
    try {
      const id = await ensureDraft();
      const result = await linkAsset(id, externalUrl.trim());
      setAssets(current => [...current.filter(asset => asset.id !== result.asset.id), result.asset]);
      setExternalUrl(''); setSaveState(dirtyRef.current ? 'idle' : 'saved'); await refreshDrafts().catch(() => {});
    } catch (err) { setError(err.response?.data?.error || t('media.compose.attachFailed')); }
    finally { uploadBusyRef.current = false; assetRevisionRef.current += 1; setAttachmentBusy(false); }
  };

  const removeAsset = async asset => {
    if (assetState(asset) === 'blocked' || uploadBusyRef.current || transitioning || submitting) return;
    uploadBusyRef.current = true; assetRevisionRef.current += 1; setAttachmentBusy(true);
    try {
      await removeMediaAsset(draftId, asset.id);
      metadataRef.current.delete(asset.id);
      setAssets(current => current.filter(item => item.id !== asset.id));
      setSaveState(dirtyRef.current ? 'idle' : 'saved'); await refreshDrafts();
    } catch (err) { setError(err.response?.data?.error || t('media.compose.removeFailed')); }
    finally { uploadBusyRef.current = false; assetRevisionRef.current += 1; setAttachmentBusy(false); }
  };

  const moveAsset = async (assetId, delta) => {
    if (uploadBusyRef.current || transitioning || submitting) return;
    const from = assets.findIndex(item => item.id === assetId);
    const to = from + delta;
    if (from < 0 || to < 0 || to >= assets.length) return;
    uploadBusyRef.current = true; assetRevisionRef.current += 1; setAttachmentBusy(true);
    const next = [...assets]; [next[from], next[to]] = [next[to], next[from]];
    setAssets(next);
    try { await reorderMediaAssets(draftId, next.map(item => item.id)); }
    catch (err) { setAssets(assets); setError(err.response?.data?.error || t('media.compose.reorderFailed')); }
    finally { uploadBusyRef.current = false; assetRevisionRef.current += 1; setAttachmentBusy(false); }
  };

  const updateAltText = async (asset, value) => {
    metadataRef.current.set(asset.id, value);
    await saveDraft();
  };

  const attachCaption = async (asset, file) => {
    if (!file || uploadBusyRef.current || transitioning || submitting) return;
    uploadBusyRef.current = true; assetRevisionRef.current += 1; setAttachmentBusy(true);
    try {
      const result = await uploadMediaCaption(draftId, asset.id, file, i18n.language?.split('-')[0] || 'en');
      setAssets(current => current.map(item => item.id === asset.id ? result.asset : item));
    } catch (err) { setError(err.response?.data?.error || t('media.compose.captionFailed')); }
    finally { uploadBusyRef.current = false; assetRevisionRef.current += 1; setAttachmentBusy(false); }
  };

  const addEntity = entity => {
    if (links.length >= 5) { setError(t('media.compose.maxLinks')); return; }
    if (links.some(link => link.link_type === linkType && String(link.target_id) === String(entity.target_id))) return;
    setLinks(current => [...current, {
      link_type: linkType, target_id: entity.target_id, name_snapshot: entity.name,
      price_snapshot_cents: entity.price_snapshot_cents, currency_code: entity.currency_code,
      thumbnail_url: entity.thumbnail_url,
    }]);
    setLinkQuery(''); setEntitySuggestions([]); setDirty(true);
  };

  const money = (cents, currency) => {
    if (cents == null || !currency) return '';
    const units = getCreditMinorUnits(currency);
    const amount = Number(cents) / (10 ** units);
    try { return new Intl.NumberFormat(i18n.language, { style: 'currency', currency }).format(amount); }
    catch { return `${currency} ${amount.toFixed(units)}`; }
  };

  const resetDraft = () => {
    sessionRef.current += 1; draftIdRef.current = ''; dirtyRef.current = false;
    metadataRef.current.clear();
    setBody(''); setLinks([]); setAssets([]); setUploads([]); setCommunityId(''); setDestination('main');
    setContentWarning(''); setContentWarningEnabled(false); setDraftId(''); setLoadedDraft(null); setDirty(false); setError(''); setSaveState('idle');
    requestIdRef.current = newRequestId(); creationPayloadRef.current = null;
    window.localStorage.removeItem(draftStorageKey); window.localStorage.removeItem(requestStorageKey);
    bodyRef.current?.focus();
  };

  const startNew = async () => {
    if (pendingUpload || submitting || transitioning) return;
    if (uploads.length && !window.confirm(t('media.compose.switchDraftConfirm'))) return;
    setTransitioning(true);
    try {
      if ((dirty || creatingRef.current) && (!await saveDraft() || dirtyRef.current)
          && !window.confirm(t('media.compose.switchDraftConfirm'))) return;
      await saveQueueRef.current;
      resetDraft();
    } finally { setTransitioning(false); }
  };

  const discard = async () => {
    if (!draftId || pendingUpload || transitioning || !window.confirm(t('media.compose.discardConfirm'))) return;
    setTransitioning(true);
    try { await saveQueueRef.current; await deletePost(draftId); resetDraft(); await refreshDrafts(); }
    catch (err) { setError(err.response?.data?.error || t('media.compose.discardFailed')); }
    finally { setTransitioning(false); }
  };

  const selectDraft = async id => {
    if (pendingUpload || submitting || transitioning) return;
    if ((dirty || uploads.length) && !window.confirm(t('media.compose.switchDraftConfirm'))) return;
    setTransitioning(true);
    try {
      await saveQueueRef.current;
      const data = await getDraft(id);
      sessionRef.current += 1;
      metadataRef.current.clear();
      creationPayloadRef.current = null;
      window.localStorage.removeItem(requestStorageKey);
      applyDraft(data.draft); setUploads([]); setError('');
    }
    catch (err) { setError(err.response?.data?.error || t('media.compose.draftLoadFailed')); }
    finally { setTransitioning(false); }
  };

  const submit = async event => {
    event.preventDefault(); setError(''); setErrorCode('');
    if (submitting || transitioning) return;
    if (publisherStatus !== 'ready') {
      setError(t(publisherStatus === 'loading' ? 'media.compose.publisherLoading' : 'media.compose.publisherUnavailable'));
      setErrorCode('media_publisher_unavailable');
      return;
    }
    if (!body.trim() && !assets.length && !links.length) { setError(t('media.compose.contentRequired')); bodyRef.current?.focus(); return; }
    if (pendingUpload || uploads.length) { setError(t('media.compose.uploadsPending')); return; }
    if (destination === 'nearby' && !locationLabel) { setError(t('media.compose.locationRequired')); return; }
    setSubmitting(true);
    try {
      const id = await saveDraft();
      if (!id || dirtyRef.current) return;
      const result = await publishPost(id);
      window.localStorage.removeItem(draftStorageKey); window.localStorage.removeItem(requestStorageKey);
      navigate(`/media/post/${result.post.id}`);
    } catch (err) {
      const details = err.response?.data || {};
      setError(details.error || t('media.compose.createError')); setErrorCode(details.code || '');
      if (details.code === 'media_safety_pending') setSaveState('saved');
    } finally { setSubmitting(false); }
  };

  const stateText = saveState === 'saving' ? t('media.compose.saving')
    : saveState === 'saved' ? t('media.compose.saved')
      : saveState === 'offline' ? t('media.compose.offline')
        : saveState === 'error' ? t('media.compose.saveRetry') : t('media.compose.draftPrivate');
  const publisherLocation = locationLabel || t('media.compose.noLocation');
  const canVideo = selectedPublisher?.eligibility?.video === true;

  return (
    <div className="media-compose-page">
      <header className="media-compose-page-heading">
        <div><p className="media-page-kicker">{t('media.compose.kicker')}</p><h1>{t('media.compose.title')}</h1><p>{t('media.compose.subtitle')}</p></div>
        <button type="button" className="media-icon-button" onClick={() => refreshDrafts()} aria-label={t('media.compose.refreshDrafts')}><RefreshCw size={19} /></button>
      </header>
      <div className="media-compose-workspace">
        <aside className="media-drafts-panel" aria-label={t('media.compose.yourDrafts')}>
          <div className="media-drafts-heading"><div><h2>{t('media.compose.yourDrafts')}</h2><span>{drafts.length}</span></div><button type="button" onClick={startNew}><Plus size={17} />{t('media.compose.newDraft')}</button></div>
          <div className="media-drafts-list">
            {drafts.map(draft => <button type="button" key={draft.id} className={draft.id === draftId ? 'active' : ''} onClick={() => selectDraft(draft.id)}><span className="media-draft-icon"><FileText size={17} /></span><span><strong>{draft.body?.trim() || t('media.compose.untitledDraft')}</strong><small>{draft.display_name} · {draft.destination || 'main'} · {draft.assets?.length || 0} {t('media.compose.attachments')}</small><time>{new Intl.DateTimeFormat(i18n.language, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(draft.updated_at || draft.created_at))}</time></span></button>)}
            {!drafts.length && <p>{t('media.compose.noDrafts')}</p>}
          </div>
          {draftCursor && <button type="button" className="media-drafts-more" onClick={() => refreshDrafts(true, draftCursor)}>{t('media.compose.loadOlder')}</button>}
        </aside>

        <form className="media-compose-card" onSubmit={submit} noValidate>
          <fieldset className="media-compose-fields" disabled={submitting || transitioning} aria-label={t('media.compose.title')}>
          <section className="media-publisher-row">
            <span className="media-publisher-avatar">{selectedPublisher?.avatar_url ? <img src={selectedPublisher.avatar_url} alt="" /> : <CircleUserRound size={27} />}</span>
            <div><span>{t('media.compose.postingAs')}</span><strong>{selectedPublisher?.display_name || t('media.compose.loadingPublisher')}</strong><small><MapPin size={13} />{publisherLocation}</small></div>
            {selectedPublisher?.verified && <ShieldCheck className="media-publisher-verified" size={20} aria-label={t('media.compose.verifiedPublisher')} />}
            <select aria-label={t('media.compose.publisherLabel')} value={publisherKey} disabled={Boolean(draftId) || Boolean(creationPayloadRef.current) || publisherStatus !== 'ready'} onChange={event => setPublisherKey(event.target.value)}>{!selectedPublisher && <option value={publisherKey}>{t('media.compose.publisherUnavailable')}</option>}{publishers.map(publisher => <option key={publisher.key} value={publisher.key}>{publisher.display_name} · {publisher.actor_type}</option>)}</select>
          </section>

          <section className="media-compose-editor">
            <label htmlFor="media-compose-body" className="sr-only">{t('media.compose.placeholder')}</label>
            <textarea id="media-compose-body" ref={bodyRef} value={body} onChange={event => change(setBody)(event.target.value)} placeholder={t('media.compose.placeholder')} maxLength={2000} rows={5} />
            <div className="media-editor-toolbar"><div className="media-emoji-control"><button type="button" aria-expanded={emojiOpen} onClick={() => setEmojiOpen(value => !value)}><Smile size={19} /><span className="sr-only">{t('media.compose.emoji')}</span></button>{emojiOpen && <div className="media-emoji-picker" role="group" aria-label={t('media.compose.emoji')}>{EMOJIS.map(emoji => <button type="button" key={emoji} onClick={() => { setBody(value => `${value}${emoji}`.slice(0, 2000)); setDirty(true); setEmojiOpen(false); bodyRef.current?.focus(); }}>{emoji}</button>)}</div>}</div><button type="button" onClick={() => { setReplaceAssetId(null); fileInputRef.current?.click(); }}><Paperclip size={19} /><span className="sr-only">{t('media.compose.addAttachment')}</span></button><span>{body.length}/2000</span></div>
          </section>

          <section className="media-compose-section">
            <div className="media-compose-section-heading"><div><h2>{t('media.compose.photosVideos')}</h2><p>{t('media.compose.uploadHint')}</p></div><span>{attachmentCount}/4</span></div>
            <div className={`media-drop-zone ${dragActive ? 'active' : ''}`} onDragOver={event => { event.preventDefault(); setDragActive(true); }} onDragLeave={() => setDragActive(false)} onDrop={event => { event.preventDefault(); setDragActive(false); void uploadFiles(event.dataTransfer.files); }}><Upload size={27} /><strong>{t('media.compose.dropFiles')}</strong><span>{t('media.compose.browseFiles')}</span><button type="button" onClick={() => { setReplaceAssetId(null); fileInputRef.current?.click(); }}>{t('media.compose.chooseFiles')}</button><input ref={fileInputRef} className="sr-only" type="file" aria-label={t('media.compose.chooseFiles')} multiple accept="image/jpeg,image/png,image/webp,video/mp4,video/webm,video/quicktime" onChange={event => void uploadFiles(event.target.files, replaceAssetId)} /></div>
            <p className="media-safety-note"><ShieldCheck size={15} />{t('media.compose.safetyNote')}</p>
            {(assets.length > 0 || uploads.length > 0) && <div className="media-attachment-list" aria-live="polite">
              {assets.map((asset, index) => { const Icon = attachmentIcon(asset); const state = assetState(asset); return <article key={asset.id} className={`media-attachment-card state-${state}`}><div className="media-attachment-preview">{asset.asset_type === 'image' && (asset.thumbnail_url || asset.url) ? <img src={asset.thumbnail_url || asset.url} alt="" /> : <Icon size={24} />}</div><div className="media-attachment-details"><strong>{asset.asset_type === 'video_link' ? asset.provider : t(`media.compose.assetTypes.${asset.asset_type}`)}</strong><span className="media-asset-state">{state === 'ready' && <Check size={14} />}{state === 'blocked' && <AlertTriangle size={14} />}{['scanning', 'processing'].includes(state) && <Loader2 className="media-spin" size={14} />}{t(`media.compose.assetStates.${state}`)}</span>{asset.asset_type === 'image' && <label>{t('media.compose.altText')}<input value={asset.alt_text || ''} maxLength={1000} onChange={event => { const value = event.target.value; metadataRef.current.set(asset.id, value); setAssets(current => current.map(item => item.id === asset.id ? { ...item, alt_text: value } : item)); setDirty(true); setSaveState('idle'); }} onBlur={event => void updateAltText(asset, event.target.value)} placeholder={t('media.compose.altTextPlaceholder')} /></label>}{asset.asset_type === 'video' && <label className="media-caption-upload">{t('media.compose.captionTrack')}<input type="file" accept="text/vtt,.vtt" onChange={event => void attachCaption(asset, event.target.files?.[0])} /><small>{asset.caption_storage_key ? t('media.compose.captionAttached') : t('media.compose.captionHint')}</small></label>}</div><div className="media-attachment-actions"><button type="button" disabled={index === 0} onClick={() => moveAsset(asset.id, -1)} aria-label={t('media.compose.moveEarlier')}><ArrowUp size={16} /></button><button type="button" disabled={index === assets.length - 1} onClick={() => moveAsset(asset.id, 1)} aria-label={t('media.compose.moveLater')}><ArrowDown size={16} /></button><button type="button" disabled={state === 'blocked'} onClick={() => { setReplaceAssetId(asset.id); fileInputRef.current?.click(); }} aria-label={t('media.compose.replaceAttachment')}><RefreshCw size={16} /></button><button type="button" disabled={state === 'blocked'} onClick={() => removeAsset(asset)} aria-label={t('media.compose.remove')}><Trash2 size={16} /></button></div></article>; })}
              {uploads.map(upload => <article key={upload.id} className={`media-attachment-card state-${upload.state}`}><div className="media-attachment-preview"><Loader2 className={upload.state === 'uploading' ? 'media-spin' : ''} size={24} /></div><div className="media-attachment-details"><strong>{upload.name}</strong><span>{upload.state === 'uploading' ? `${upload.progress}%` : upload.error}</span><progress max="100" value={upload.progress} /></div>{upload.state === 'failed' && <button type="button" onClick={() => void uploadFiles([upload.file], upload.replaceAssetId, upload.id)}>{t('media.compose.retry')}</button>}{upload.state === 'failed' && <button type="button" aria-label={t('media.compose.remove')} onClick={() => setUploads(current => current.filter(item => item.id !== upload.id))}><Trash2 size={16} /></button>}</article>)}
            </div>}
            <div className="media-external-video"><Link2 size={18} /><label><span>{t('media.compose.videoLabel')}</span><input type="url" value={externalUrl} onChange={event => setExternalUrl(event.target.value)} placeholder={t('media.compose.videoPlaceholder')} /></label><button type="button" onClick={addExternalVideo} disabled={!externalUrl.trim() || attachmentCount >= 4}>{t('media.compose.attach')}</button></div>
            {!canVideo && <p className="media-inline-guidance"><ShieldCheck size={16} />{t('media.compose.videoVerification')} <Link to="/media/verification?returnTo=/media/compose">{t('media.compose.verifyNow')}</Link></p>}
          </section>

          <section className="media-compose-section">
            <div className="media-compose-section-heading"><div><h2>{t('media.compose.linkedOn')}</h2><p>{t('media.compose.linkHint')}</p></div><span>{links.length}/5</span></div>
            <div className="media-listing-picker"><select aria-label={t('media.compose.linkTypeLabel')} value={linkType} onChange={event => { setLinkType(event.target.value); setLinkQuery(''); setEntitySuggestions([]); }}>{LINK_TYPES.map(type => <option key={type} value={type}>{t(`media.compose.linkTypes.${type}`)}</option>)}</select><div><input aria-label={t('media.compose.entitySearchPlaceholder')} value={linkQuery} onChange={event => setLinkQuery(event.target.value)} placeholder={t('media.compose.entitySearchPlaceholder')} />{(searchingEntities || entitySuggestions.length > 0) && <div className="media-entity-suggestions" role="listbox">{searchingEntities && <span className="media-entity-suggestion-status">{t('media.compose.searchingEntities')}</span>}{entitySuggestions.map(entity => <button type="button" role="option" key={entity.target_id} onClick={() => addEntity(entity)}>{entity.thumbnail_url ? <img src={entity.thumbnail_url} alt="" /> : <Link2 size={18} />}<span><strong>{entity.name}</strong><small>{t(`media.compose.linkTypes.${entity.link_type}`)}{entity.price_snapshot_cents != null ? ` · ${money(entity.price_snapshot_cents, entity.currency_code)}` : ''}</small></span><Plus size={16} /></button>)}</div>}</div></div>
            {links.length > 0 && <div className="media-selected-listings">{links.map((link, index) => <div key={`${link.link_type}:${link.target_id}`}><span><strong>{link.name_snapshot}</strong><small>{t(`media.compose.linkTypes.${link.link_type}`)}{link.price_snapshot_cents != null ? ` · ${money(link.price_snapshot_cents, link.currency_code)}` : ''}</small></span><button type="button" onClick={() => { setLinks(current => current.filter((_, itemIndex) => itemIndex !== index)); setDirty(true); }} aria-label={t('media.compose.remove')}><Trash2 size={16} /></button></div>)}</div>}
          </section>

          <section className="media-compose-section media-destination-section"><div className="media-compose-section-heading"><div><h2>{t('media.compose.postTo')}</h2><p>{t('media.compose.destinationHint')}</p></div></div><div className="media-destination-options" role="radiogroup" aria-label={t('media.compose.postTo')}>{['main', 'nearby', 'space'].map(value => <label key={value}><input type="radio" name="destination" value={value} checked={destination === value} onChange={() => change(setDestination)(value)} /><span><strong>{t(`media.compose.destinations.${value}.title`)}</strong><small>{value === 'nearby' ? t('media.compose.destinations.nearby.description', { location: publisherLocation }) : t(`media.compose.destinations.${value}.description`)}</small></span></label>)}</div>{destination === 'space' && <label className="media-compose-select">{t('media.compose.chooseSpace')}<select value={communityId} onChange={event => change(setCommunityId)(event.target.value)}><option value="">{t('media.compose.selectSpace')}</option>{communities.map(community => <option key={community.id} value={community.id}>{community.title}</option>)}</select></label>}</section>

          <section className="media-compose-section media-warning-section"><label><input type="checkbox" checked={contentWarningEnabled} onChange={event => { setContentWarningEnabled(event.target.checked); setDirty(true); }} /><span><strong>{t('media.compose.contentWarning')}</strong><small>{t('media.compose.contentWarningHint')}</small></span></label>{contentWarningEnabled && <input aria-label={t('media.compose.contentWarning')} value={contentWarning} maxLength={240} onChange={event => change(setContentWarning)(event.target.value)} placeholder={t('media.compose.contentWarningPlaceholder')} />}</section>
          {publisherStatus === 'error' && <div className="media-compose-error" role="alert">{t('media.compose.publisherUnavailable')}</div>}
          {processingNotice && <p className="media-status" role="status" data-processing-status={processingStatus || undefined}>{processingNotice}</p>}
          {error && <div className="media-compose-error" role="alert"><AlertTriangle size={18} /><span>{error}</span>{saveState === 'error' && <button type="button" onClick={() => saveDraft()}>{t('media.compose.retry')}</button>}{(errorCode === 'media_video_didit_required' || errorCode === 'media_not_verified_poster') && <Link to="/media/verification?returnTo=/media/compose">{t(errorCode === 'media_video_didit_required' ? 'media.compose.resolve' : 'media.verification.request', { defaultValue: errorCode === 'media_video_didit_required' ? 'Resolve verification' : 'Request verification' })}</Link>}{errorCode === 'media_nearby_location_required' && <Link to="/media/verification?returnTo=/media/compose">{t('media.compose.resolve')}</Link>}</div>}

          <footer className="media-compose-actions"><span className={`media-save-state state-${saveState}`} aria-live="polite">{saveState === 'saving' ? <Loader2 className="media-spin" size={15} /> : saveState === 'saved' ? <Check size={15} /> : saveState === 'offline' || saveState === 'error' ? <AlertTriangle size={15} /> : <Save size={15} />}{stateText}</span><div><button type="button" className="media-secondary-button" onClick={() => saveDraft()} disabled={submitting || pendingUpload}>{t('media.compose.saveDraft')}</button>{draftId && <button type="button" className="media-text-button media-danger-button" onClick={discard} disabled={submitting || pendingUpload}>{t('media.compose.discardDraft')}</button>}<button type="button" className="media-text-button" onClick={startNew} disabled={submitting || pendingUpload}>{t('media.compose.startNew')}</button><button type="submit" className="media-primary-button" disabled={submitting || pendingUpload || uploads.length > 0 || !selectedPublisher || publisherStatus !== 'ready'}>{submitting ? <Loader2 className="media-spin" size={17} /> : null}{submitting ? t('media.compose.posting') : t('media.compose.publishPost')}<ChevronRight size={18} /></button></div></footer>
          </fieldset>
        </form>
      </div>
    </div>
  );
}
