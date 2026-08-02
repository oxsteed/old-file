import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate, useSearchParams, useLocation, Link } from 'react-router-dom';
import useJobs from '../hooks/useJobs';
import useAuth from '../hooks/useAuth';
import { formatMoney } from '../lib/format';
import { getDefaultCurrency } from '../lib/countries';
import { fetchBookingPrefillForJob } from '../api/bookings';
import api from '../api/axios';
import '../styles/PostJobPage.css';
import PageMeta from '../components/PageMeta';
import PageShell from '../components/PageShell';
import { useTranslation } from 'react-i18next';
import { useCapabilities } from '../hooks/useCapabilities';

// ─── Category taxonomy ───────────────────────────────────────────────────────
const CATEGORIES = [
  { group: 'Electrical', options: [
    { id: 'electrical-full',      name: 'Electrical - Full Rewire',       suggested: ['license','insurance','skillLevel','backgroundCheck'], defaults: { licenseType:'oh-electrician', minCoverage:'1m', minLevel:'advanced' } },
    { id: 'electrical-repair',    name: 'Electrical - Repair / Panel',    suggested: ['license','insurance','skillLevel'],                    defaults: { licenseType:'oh-electrician', minCoverage:'1m', minLevel:'advanced' } },
    { id: 'electrical-install',   name: 'Electrical - Installation',      suggested: ['license','insurance'],                                defaults: { licenseType:'oh-electrician', minCoverage:'1m' } },
    { id: 'electrical-ev',        name: 'Electrical - EV Charger',        suggested: ['license','insurance'],                                defaults: { licenseType:'oh-electrician', minCoverage:'1m' } },
    { id: 'electrical-solar',     name: 'Electrical - Solar Panels',      suggested: ['license','insurance','skillLevel'],                    defaults: { licenseType:'oh-electrician', minCoverage:'2m', minLevel:'advanced' } },
    { id: 'electrical-generator', name: 'Electrical - Generator Install', suggested: ['license','insurance'],                                defaults: { licenseType:'oh-electrician', minCoverage:'1m' } },
  ]},
  { group: 'Plumbing', options: [
    { id: 'plumbing-general',  name: 'Plumbing - General',          suggested: ['license','insurance'], defaults: { licenseType:'oh-plumber', minCoverage:'1m' } },
    { id: 'plumbing-drain',    name: 'Plumbing - Drain / Sewer',    suggested: ['license','insurance'], defaults: { licenseType:'oh-plumber', minCoverage:'1m' } },
    { id: 'plumbing-heater',   name: 'Plumbing - Water Heater',     suggested: ['license','insurance'], defaults: { licenseType:'oh-plumber', minCoverage:'1m' } },
    { id: 'plumbing-fixture',  name: 'Plumbing - Fixture Install',  suggested: ['license','insurance'], defaults: { licenseType:'oh-plumber', minCoverage:'500k' } },
    { id: 'plumbing-remodel',  name: 'Plumbing - Bathroom Remodel', suggested: ['license','insurance','skillLevel'], defaults: { licenseType:'oh-plumber', minCoverage:'1m', minLevel:'advanced' } },
  ]},
  { group: 'HVAC', options: [
    { id: 'hvac-install',    name: 'HVAC - Full System Install', suggested: ['license','insurance','ownTools'], defaults: { licenseType:'oh-hvac', minCoverage:'1m' } },
    { id: 'hvac-repair',     name: 'HVAC - Repair / Service',    suggested: ['license','insurance'],           defaults: { licenseType:'oh-hvac', minCoverage:'1m' } },
    { id: 'hvac-duct',       name: 'HVAC - Duct Work',           suggested: ['license','insurance'],           defaults: { licenseType:'oh-hvac', minCoverage:'500k' } },
    { id: 'hvac-minisplit',  name: 'HVAC - Mini-Split Install',  suggested: ['license','insurance'],           defaults: { licenseType:'oh-hvac', minCoverage:'1m' } },
  ]},
  { group: 'Construction', options: [
    { id: 'roofing',        name: 'Roofing',                  suggested: ['insurance','skillLevel'],       defaults: { minCoverage:'1m', minLevel:'intermediate' } },
    { id: 'roofing-repair', name: 'Roofing - Repair',         suggested: ['insurance'],                    defaults: { minCoverage:'500k' } },
    { id: 'drywall',        name: 'Drywall',                  suggested: ['skillLevel'],                   defaults: { minLevel:'beginner' } },
    { id: 'framing',        name: 'Framing',                  suggested: ['skillLevel','ownTools'],        defaults: { minLevel:'intermediate' } },
    { id: 'concrete',       name: 'Concrete Work',            suggested: ['skillLevel','ownTools'],        defaults: { minLevel:'intermediate' } },
    { id: 'foundation',     name: 'Foundation / Excavation',  suggested: ['license','insurance','skillLevel'], defaults: { minCoverage:'2m', minLevel:'advanced' } },
    { id: 'masonry',        name: 'Masonry / Brickwork',      suggested: ['skillLevel'],                   defaults: { minLevel:'intermediate' } },
    { id: 'decking',        name: 'Decking / Fencing',        suggested: ['skillLevel','ownTools'],        defaults: { minLevel:'intermediate' } },
    { id: 'siding',         name: 'Siding / Exterior',        suggested: ['skillLevel'],                   defaults: { minLevel:'intermediate' } },
    { id: 'insulation',     name: 'Insulation',               suggested: ['ownTools'],                     defaults: {} },
    { id: 'windows-doors',  name: 'Windows & Doors',          suggested: ['skillLevel'],                   defaults: { minLevel:'intermediate' } },
  ]},
  { group: 'Interior Finishes', options: [
    { id: 'painting-interior', name: 'Painting - Interior',    suggested: [],                       defaults: {} },
    { id: 'painting-exterior', name: 'Painting - Exterior',    suggested: ['insurance'],            defaults: { minCoverage:'300k' } },
    { id: 'flooring-hardwood', name: 'Flooring - Hardwood',    suggested: ['skillLevel','ownTools'],defaults: { minLevel:'intermediate' } },
    { id: 'flooring-tile',     name: 'Flooring - Tile',        suggested: ['skillLevel','ownTools'],defaults: { minLevel:'intermediate' } },
    { id: 'flooring-carpet',   name: 'Flooring - Carpet',      suggested: ['skillLevel'],           defaults: { minLevel:'beginner' } },
    { id: 'carpentry-trim',    name: 'Carpentry - Trim',        suggested: ['skillLevel','ownTools'],defaults: { minLevel:'intermediate' } },
    { id: 'carpentry-cabinets',name: 'Carpentry - Cabinets',    suggested: ['skillLevel','ownTools'],defaults: { minLevel:'advanced' } },
    { id: 'carpentry-custom',  name: 'Carpentry - Custom',      suggested: ['skillLevel','ownTools'],defaults: { minLevel:'advanced' } },
    { id: 'tile-backsplash',   name: 'Tile - Backsplash',       suggested: ['skillLevel'],           defaults: { minLevel:'intermediate' } },
  ]},
  { group: 'Home Services', options: [
    { id: 'home-cleaning',    name: 'Home Cleaning',         suggested: ['backgroundCheck'], defaults: {} },
    { id: 'deep-cleaning',    name: 'Deep Cleaning / Move-Out', suggested: ['backgroundCheck'], defaults: {} },
    { id: 'handyman',         name: 'Handyman',              suggested: ['skillLevel'],      defaults: { minLevel:'intermediate' } },
    { id: 'appliance-install',name: 'Appliance Installation',suggested: ['skillLevel'],      defaults: { minLevel:'beginner' } },
    { id: 'appliance-repair', name: 'Appliance Repair',      suggested: ['skillLevel'],      defaults: { minLevel:'intermediate' } },
    { id: 'smart-home',       name: 'Smart Home / AV Setup', suggested: ['skillLevel'],      defaults: { minLevel:'intermediate' } },
  ]},
  { group: 'Lawn & Outdoor', options: [
    { id: 'lawn-mowing',       name: 'Lawn Mowing',              suggested: [],            defaults: {} },
    { id: 'landscaping',       name: 'Landscaping / Garden',     suggested: [],            defaults: {} },
    { id: 'tree-service',      name: 'Tree Service / Trimming',  suggested: ['insurance'], defaults: { minCoverage:'500k' } },
    { id: 'snow-removal',      name: 'Snow Removal',             suggested: [],            defaults: {} },
    { id: 'irrigation',        name: 'Irrigation / Sprinkler',   suggested: ['license'],   defaults: { licenseType:'other' } },
    { id: 'outdoor-lighting',  name: 'Outdoor Lighting',         suggested: ['license'],   defaults: { licenseType:'oh-electrician' } },
    { id: 'pool-service',      name: 'Pool Service / Repair',    suggested: ['license','insurance'], defaults: { licenseType:'other', minCoverage:'500k' } },
  ]},
  { group: 'Moving & Hauling', options: [
    { id: 'moving-local',  name: 'Moving - Local',          suggested: ['crewSize'],                    defaults: { minCrew:2 } },
    { id: 'moving-long',   name: 'Moving - Long Distance',  suggested: ['license','insurance','crewSize'], defaults: { licenseType:'other', minCoverage:'500k', minCrew:2 } },
    { id: 'junk-removal',  name: 'Junk Removal / Hauling',  suggested: [],                              defaults: {} },
    { id: 'furniture',     name: 'Furniture Assembly',       suggested: [],                              defaults: {} },
  ]},
  { group: 'Vehicles & Auto', options: [
    { id: 'auto-repair',    name: 'Auto Repair',        suggested: ['skillLevel'],       defaults: { minLevel:'intermediate' } },
    { id: 'auto-detailing', name: 'Auto Detailing',     suggested: [],                   defaults: {} },
    { id: 'auto-body',      name: 'Auto Body / Paint',  suggested: ['skillLevel','ownTools'], defaults: { minLevel:'advanced' } },
    { id: 'tire-change',    name: 'Tire Change',        suggested: [],                   defaults: {} },
  ]},
  { group: 'Care & Personal', options: [
    { id: 'pet-care',         name: 'Pet Care / Sitting',  suggested: ['backgroundCheck'], defaults: {} },
    { id: 'dog-walking',      name: 'Dog Walking',          suggested: ['backgroundCheck'], defaults: {} },
    { id: 'childcare',        name: 'Childcare / Babysitting', suggested: ['backgroundCheck'], defaults: {} },
    { id: 'senior-care',      name: 'Senior Care / Errands',  suggested: ['backgroundCheck'], defaults: {} },
    { id: 'personal-training',name: 'Personal Training',     suggested: ['skillLevel'],      defaults: { minLevel:'intermediate' } },
    { id: 'tutoring',         name: 'Tutoring / Teaching',   suggested: [],                  defaults: {} },
  ]},
  { group: 'Professional Services', options: [
    { id: 'tech-support',  name: 'Tech Support / IT',         suggested: ['skillLevel'], defaults: { minLevel:'intermediate' } },
    { id: 'photography',   name: 'Photography / Videography',  suggested: ['skillLevel'], defaults: { minLevel:'intermediate' } },
    { id: 'event-setup',   name: 'Event Setup / Planning',     suggested: [],             defaults: {} },
    { id: 'delivery',      name: 'Delivery & Errands',         suggested: [],             defaults: {} },
    { id: 'security',      name: 'Security / Patrol',          suggested: ['license','backgroundCheck'], defaults: { licenseType:'other' } },
  ]},
  { group: 'General', options: [
    { id: 'general-labor', name: 'General Labor',              suggested: [], defaults: {} },
    { id: 'other',         name: 'Other / Specify in Description', suggested: [], defaults: {} },
  ]},
];

// Flat lookup by id
const CAT_BY_ID = CATEGORIES.flatMap(g => g.options).reduce((acc, o) => { acc[o.id] = o; return acc; }, {});

// ─── Budget config ────────────────────────────────────────────────────────────
const BUDGET_CFG = {
  fixed:  { min: 50,  max: 50000, step: 50,  defaultVal: 800 },
  hourly: { min: 15,  max: 500,   step: 5,   defaultVal: 45 },
  open:   { min: 0,   max: 0,     step: 0,   defaultVal: 0 },
};

// ─── Brand icon (matches homepage) ───────────────────────────────────────────
function OxSteedIcon({ size = 26 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 512 512" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <rect width="512" height="512" rx="88" fill="#16213e"/>
      <path d="M 40 285 A 218 218 0 0 1 173 55 L 211 26 A 178 178 0 0 0 80 279 Z" fill="#F97316"/>
      <path d="M 228 40 A 218 218 0 0 1 457 173 L 486 211 A 178 178 0 0 0 233 80 Z" fill="#F97316"/>
      <path d="M 472 228 A 218 218 0 0 1 339 457 L 301 486 A 178 178 0 0 0 433 233 Z" fill="#F97316"/>
      <path d="M 284 472 A 218 218 0 0 1 55 339 L 26 301 A 178 178 0 0 0 279 433 Z" fill="#F97316"/>
      <circle cx="256" cy="256" r="145" fill="#F97316"/>
      <text x="256" y="236" textAnchor="middle" dominantBaseline="middle" fontFamily="Arial Black, Arial, Helvetica, system-ui, sans-serif" fontWeight="900" fontSize="90" fill="#FFFFFF">OxS</text>
      <polyline points="131,305 172,305 184,295 194,268 204,326 214,297 224,305 381,305" fill="none" stroke="#FFFFFF" strokeWidth="7" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  );
}

// ─── Searchable category dropdown ────────────────────────────────────────────
function CategorySelect({ value, onChange, error, t }) {
  const [open, setOpen]         = React.useState(false);
  const [search, setSearch]     = React.useState('');
  const [activeIdx, setActiveIdx] = React.useState(-1);
  const wrapRef  = React.useRef(null);
  const inputRef = React.useRef(null);
  const listRef  = React.useRef(null);

  const allFlat = CATEGORIES.flatMap(g => g.options);

  // Map category ID to i18n key (e.g., 'electrical-full' -> 'electricalFull')
  const getCategoryKey = (id) => {
    const parts = id.split('-');
    if (parts.length === 1) return parts[0];
    return parts[0] + parts.slice(1).map(p => p.charAt(0).toUpperCase() + p.slice(1)).join('');
  };

  const getCategoryName = (id) => t(`postJob.categories.${getCategoryKey(id)}`);

  // Map group names to i18n keys
  const GROUP_KEY_MAP = {
    'Electrical': 'electrical',
    'Plumbing': 'plumbing',
    'HVAC': 'hvac',
    'Construction': 'construction',
    'Interior Finishes': 'interiorFinishes',
    'Home Services': 'homeServices',
    'Lawn & Outdoor': 'lawnOutdoor',
    'Moving & Hauling': 'movingHauling',
    'Vehicles & Auto': 'vehiclesAuto',
    'Care & Personal': 'carePersonal',
    'Professional Services': 'professionalServices',
    'General': 'general',
  };

  const getGroupName = (group) => {
    const key = GROUP_KEY_MAP[group];
    return key ? t(`postJob.categories.${key}`) : group;
  };

  const filtered = React.useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return CATEGORIES;
    return CATEGORIES
      .map(g => ({
        ...g,
        options: g.options.filter(
          o => getCategoryName(o.id).toLowerCase().includes(q) || getGroupName(g.group).toLowerCase().includes(q)
        ),
      }))
      .filter(g => g.options.length > 0);
  }, [search, t]);

  const filteredFlat = filtered.flatMap(g => g.options);

  // Scroll active item into view
  React.useEffect(() => {
    if (activeIdx < 0 || !listRef.current) return;
    const el = listRef.current.querySelector('[data-active="true"]');
    el?.scrollIntoView({ block: 'nearest' });
  }, [activeIdx]);

  // Close on outside click
  React.useEffect(() => {
    function onOutside(e) {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) {
        setOpen(false);
        setSearch('');
      }
    }
    document.addEventListener('mousedown', onOutside);
    return () => document.removeEventListener('mousedown', onOutside);
  }, []);

  function openDropdown() {
    setOpen(true);
    setSearch('');
    setActiveIdx(-1);
    setTimeout(() => inputRef.current?.focus(), 0);
  }

  function select(opt) {
    onChange(opt.id, getCategoryName(opt.id));
    setOpen(false);
    setSearch('');
    setActiveIdx(-1);
  }

  function handleKeyDown(e) {
    if (!open) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openDropdown(); } return; }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActiveIdx(i => Math.min(i + 1, filteredFlat.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveIdx(i => Math.max(i - 1, -1));
    } else if (e.key === 'Enter' && activeIdx >= 0) {
      e.preventDefault();
      select(filteredFlat[activeIdx]);
    } else if (e.key === 'Escape') {
      setOpen(false);
      setSearch('');
    }
  }

  const selectedOpt = value ? allFlat.find(o => o.id === value) : null;

  return (
    <div className="pjw-cat-wrap" ref={wrapRef}>
      <button
        type="button"
        className={`pjw-cat-trigger${error ? ' has-error' : ''}${open ? ' is-open' : ''}`}
        onClick={openDropdown}
        onKeyDown={handleKeyDown}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={selectedOpt ? getCategoryName(selectedOpt.id) : t('postJob.selectCategory')}
      >
        {selectedOpt
          ? <span className="pjw-cat-value">{getCategoryName(selectedOpt.id)}</span>
          : <span className="pjw-cat-placeholder">{t('postJob.selectCategory')}…</span>
        }
        <svg className="pjw-cat-chevron" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
          <polyline points="6 9 12 15 18 9"/>
        </svg>
      </button>

      {open && (
        <div className="pjw-cat-dropdown" role="dialog" aria-label="Select category">
          {/* Search input */}
          <div className="pjw-cat-search-wrap">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
              <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
            </svg>
            <input
              ref={inputRef}
              type="text"
              className="pjw-cat-search-input"
              placeholder={t('postJob.searchCategories')}
              value={search}
              onChange={e => { setSearch(e.target.value); setActiveIdx(-1); }}
              onKeyDown={handleKeyDown}
              aria-label="Filter categories"
              aria-controls="pjw-cat-list"
              aria-autocomplete="list"
            />
            {search && (
              <button
                type="button"
                className="pjw-cat-search-clear"
                onClick={() => { setSearch(''); setActiveIdx(-1); inputRef.current?.focus(); }}
                aria-label="Clear search"
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" aria-hidden="true">
                  <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
                </svg>
              </button>
            )}
          </div>

          {/* Options list */}
          <ul id="pjw-cat-list" role="listbox" ref={listRef} className="pjw-cat-list" aria-label="Job categories">
            {filteredFlat.length === 0 ? (
              <li className="pjw-cat-empty" role="option" aria-disabled="true">
                No categories match "{search}"
              </li>
            ) : (
              filtered.map(g => (
                <React.Fragment key={g.group}>
                  <li className="pjw-cat-group-label" role="presentation">{getGroupName(g.group)}</li>
                  {g.options.map(opt => {
                    const idx  = filteredFlat.indexOf(opt);
                    const isActive = idx === activeIdx;
                    return (
                      <li
                        key={opt.id}
                        role="option"
                        aria-selected={opt.id === value}
                        data-active={isActive ? 'true' : undefined}
                        className={`pjw-cat-option${opt.id === value ? ' is-selected' : ''}${isActive ? ' is-active' : ''}`}
                        onMouseDown={() => select(opt)}
                        onMouseEnter={() => setActiveIdx(idx)}
                      >
                        {getCategoryName(opt.id)}
                        {opt.id === value && <CheckIcon size={12} />}
                      </li>
                    );
                  })}
                </React.Fragment>
              ))
            )}
          </ul>
        </div>
      )}
    </div>
  );
}

// ─── Requirement metadata ─────────────────────────────────────────────────────
// Keys used: t('postJob.license'), t('postJob.licenseDesc'), etc.
// Labels are now i18n'd - see PostJobPage component render logic
const REQ_META = {
  license:         { key: 'license' },
  insurance:       { key: 'insurance' },
  skillLevel:      { key: 'skillLevel' },
  ownTools:        { key: 'ownTools' },
  crewSize:        { key: 'crewSize' },
  backgroundCheck: { key: 'backgroundCheck' },
};

// STEP_LABELS is now in PostJobPage component and uses i18n

// ─── Live Capture Modal ──────────────────────────────────────────────────────
// Uses MediaDevices API for real camera/mic capture (desktop + mobile).
function LiveCaptureModal({ mode, onCapture, onClose }) {
  const videoRef    = React.useRef(null);
  const canvasRef   = React.useRef(null);
  const streamRef   = React.useRef(null);
  const recorderRef = React.useRef(null);
  const chunksRef   = React.useRef([]);
  const timerRef    = React.useRef(null);

  const [phase, setPhase]   = React.useState('init'); // init | preview | recording | processing | error
  const [errMsg, setErrMsg] = React.useState('');
  const [elapsed, setElapsed] = React.useState(0);

  // Attach stream to video element once it's in the DOM (phase === 'preview')
  React.useEffect(() => {
    if ((phase === 'preview' || phase === 'recording') && videoRef.current && streamRef.current && mode !== 'audio') {
      videoRef.current.srcObject = streamRef.current;
    }
  }, [phase, mode]);

  React.useEffect(() => {
    let cancelled = false;
    async function start() {
      try {
        const constraints =
          mode === 'audio' ? { audio: true } :
          mode === 'video' ? { video: { facingMode: 'user' }, audio: true } :
                             { video: { facingMode: 'environment', width: { ideal: 1920 }, height: { ideal: 1080 } } };
        const stream = await navigator.mediaDevices.getUserMedia(constraints);
        if (cancelled) { stream.getTracks().forEach(t => t.stop()); return; }
        streamRef.current = stream;
        setPhase('preview');
      } catch (err) {
        if (cancelled) return;
        const msg = err.name === 'NotAllowedError'
          ? 'Camera/microphone access denied. Allow it in your browser settings and try again.'
          : err.name === 'NotFoundError'
            ? 'No camera or microphone found on this device.'
            : `Could not start capture: ${err.message}`;
        setErrMsg(msg);
        setPhase('error');
      }
    }
    start();
    return () => {
      cancelled = true;
      clearInterval(timerRef.current);
      streamRef.current?.getTracks().forEach(t => t.stop());
    };
  }, [mode]);

  function stopStream() {
    clearInterval(timerRef.current);
    streamRef.current?.getTracks().forEach(t => t.stop());
    streamRef.current = null;
  }

  function capturePhoto() {
    const video  = videoRef.current;
    const canvas = canvasRef.current;
    canvas.width  = video.videoWidth;
    canvas.height = video.videoHeight;
    canvas.getContext('2d').drawImage(video, 0, 0);
    canvas.toBlob(blob => {
      const file = new File([blob], `photo_${Date.now()}.jpg`, { type: 'image/jpeg' });
      stopStream();
      onCapture(file);
      onClose();
    }, 'image/jpeg', 0.92);
  }

  function startRecording() {
    const stream = streamRef.current;
    const preferred = mode === 'video' ? 'video/webm;codecs=vp8,opus' : 'audio/webm;codecs=opus';
    const options = MediaRecorder.isTypeSupported(preferred) ? { mimeType: preferred } : {};
    const recorder = new MediaRecorder(stream, options);
    chunksRef.current = [];
    recorder.ondataavailable = e => { if (e.data.size > 0) chunksRef.current.push(e.data); };
    recorder.onstop = () => {
      const mimeType = recorder.mimeType || (mode === 'video' ? 'video/webm' : 'audio/webm');
      const ext      = mode === 'video' ? 'webm' : 'webm';
      const blob = new Blob(chunksRef.current, { type: mimeType });
      const file = new File([blob], `${mode}_${Date.now()}.${ext}`, { type: mimeType });
      stopStream();
      onCapture(file);
      onClose();
    };
    recorder.start(100);
    recorderRef.current = recorder;
    setElapsed(0);
    timerRef.current = setInterval(() => setElapsed(s => s + 1), 1000);
    setPhase('recording');
  }

  function stopRecording() {
    clearInterval(timerRef.current);
    recorderRef.current?.stop();
    setPhase('processing');
  }

  function fmt(s) {
    return `${String(Math.floor(s / 60)).padStart(2,'0')}:${String(s % 60).padStart(2,'0')}`;
  }

  const title = mode === 'photo' ? '📷 Take a Live Photo'
              : mode === 'video' ? '🎥 Record a Video'
              :                    '🎙 Record Audio';

  return (
    <div style={{ position:'fixed', inset:0, zIndex:9999, background:'rgba(0,0,0,0.85)', display:'flex', alignItems:'center', justifyContent:'center', padding:'1rem' }}>
      <div style={{ background:'#18181b', borderRadius:'1rem', overflow:'hidden', width:'100%', maxWidth:'480px', boxShadow:'0 25px 60px rgba(0,0,0,0.6)' }}>

        {/* Header */}
        <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', padding:'1rem 1.25rem', borderBottom:'1px solid #3f3f46' }}>
          <span style={{ color:'#fff', fontWeight:600, fontSize:'0.9375rem' }}>{title}</span>
          <button onClick={() => { stopStream(); onClose(); }}
            style={{ background:'none', border:'none', color:'#71717a', cursor:'pointer', fontSize:'1.25rem', lineHeight:1, padding:'0.25rem' }}>✕</button>
        </div>

        {/* Error */}
        {phase === 'error' && (
          <div style={{ padding:'2rem', textAlign:'center' }}>
            <p style={{ color:'#f87171', marginBottom:'1.25rem', fontSize:'0.875rem', lineHeight:1.5 }}>{errMsg}</p>
            <button onClick={() => { stopStream(); onClose(); }}
              style={{ background:'#3f3f46', color:'#fff', border:'none', borderRadius:'0.5rem', padding:'0.625rem 1.5rem', cursor:'pointer', fontSize:'0.875rem' }}>
              Close
            </button>
          </div>
        )}

        {/* Initialising */}
        {phase === 'init' && (
          <div style={{ padding:'3rem', textAlign:'center', color:'#71717a', fontSize:'0.875rem' }}>Starting…</div>
        )}

        {/* Processing */}
        {phase === 'processing' && (
          <div style={{ padding:'3rem', textAlign:'center', color:'#71717a', fontSize:'0.875rem' }}>Processing…</div>
        )}

        {/* Photo: live viewfinder */}
        {mode === 'photo' && phase === 'preview' && (
          <>
            <video ref={videoRef} autoPlay playsInline muted
              style={{ width:'100%', display:'block', background:'#000', maxHeight:'340px', objectFit:'cover' }} />
            <canvas ref={canvasRef} style={{ display:'none' }} />
            <div style={{ display:'flex', gap:'0.75rem', padding:'1rem 1.25rem' }}>
              <button onClick={capturePhoto}
                style={{ flex:1, background:'#f97316', color:'#fff', border:'none', borderRadius:'0.5rem', padding:'0.75rem', fontWeight:600, fontSize:'0.9375rem', cursor:'pointer' }}>
                📷 Snap Photo
              </button>
              <button onClick={() => { stopStream(); onClose(); }}
                style={{ background:'#3f3f46', color:'#e4e4e7', border:'none', borderRadius:'0.5rem', padding:'0.75rem 1.25rem', cursor:'pointer', fontSize:'0.875rem' }}>
                Cancel
              </button>
            </div>
          </>
        )}

        {/* Video: live preview + record controls */}
        {mode === 'video' && (phase === 'preview' || phase === 'recording') && (
          <>
            <video ref={videoRef} autoPlay playsInline muted
              style={{ width:'100%', display:'block', background:'#000', maxHeight:'300px', objectFit:'cover' }} />
            <div style={{ display:'flex', alignItems:'center', gap:'0.75rem', padding:'1rem 1.25rem' }}>
              {phase === 'preview' && (
                <button onClick={startRecording}
                  style={{ flex:1, background:'#dc2626', color:'#fff', border:'none', borderRadius:'0.5rem', padding:'0.75rem', fontWeight:600, fontSize:'0.9375rem', cursor:'pointer' }}>
                  ⏺ Start Recording
                </button>
              )}
              {phase === 'recording' && (
                <>
                  <span style={{ color:'#f87171', fontVariantNumeric:'tabular-nums', fontWeight:600, minWidth:'3.5rem' }}>⏺ {fmt(elapsed)}</span>
                  <button onClick={stopRecording}
                    style={{ flex:1, background:'#3f3f46', color:'#fff', border:'none', borderRadius:'0.5rem', padding:'0.75rem', fontWeight:600, fontSize:'0.9375rem', cursor:'pointer' }}>
                    ⏹ Stop
                  </button>
                </>
              )}
              <button onClick={() => { stopStream(); onClose(); }}
                style={{ background:'#27272a', color:'#a1a1aa', border:'none', borderRadius:'0.5rem', padding:'0.75rem 1.25rem', cursor:'pointer', fontSize:'0.875rem' }}>
                Cancel
              </button>
            </div>
          </>
        )}

        {/* Audio: mic controls only */}
        {mode === 'audio' && (phase === 'preview' || phase === 'recording') && (
          <div style={{ padding:'2.5rem 1.25rem', textAlign:'center' }}>
            <div style={{ fontSize:'3.5rem', marginBottom:'0.75rem' }}>🎙</div>
            {phase === 'preview' && (
              <>
                <p style={{ color:'#a1a1aa', fontSize:'0.875rem', marginBottom:'1.5rem' }}>Microphone ready</p>
                <button onClick={startRecording}
                  style={{ background:'#dc2626', color:'#fff', border:'none', borderRadius:'0.5rem', padding:'0.75rem 2rem', fontWeight:600, fontSize:'0.9375rem', cursor:'pointer', display:'inline-block' }}>
                  ⏺ Start Recording
                </button>
              </>
            )}
            {phase === 'recording' && (
              <>
                <p style={{ color:'#f87171', fontSize:'2rem', fontVariantNumeric:'tabular-nums', fontWeight:700, margin:'0 0 1.5rem' }}>⏺ {fmt(elapsed)}</p>
                <button onClick={stopRecording}
                  style={{ background:'#3f3f46', color:'#fff', border:'none', borderRadius:'0.5rem', padding:'0.75rem 2rem', fontWeight:600, fontSize:'0.9375rem', cursor:'pointer', display:'inline-block' }}>
                  ⏹ Stop
                </button>
              </>
            )}
            <br />
            <button onClick={() => { stopStream(); onClose(); }}
              style={{ marginTop:'1.25rem', background:'none', color:'#71717a', border:'none', cursor:'pointer', fontSize:'0.875rem' }}>
              Cancel
            </button>
          </div>
        )}

      </div>
    </div>
  );
}
// ────────────────────────────────────────────────────────────────────────────

const INIT = {
  step: 1,
  title: '', categoryId: '', categoryName: '', description: '',
  // Structured location — each field maps directly to a DB column
  locationCity: '', locationState: '', locationZip: '', locationCountry: '',
  locationLat: null, locationLng: null,
  // locationInput kept for backward compat with saved drafts (migrated on load)
  locationInput: '',
  siteAccess: 'easy', jobType: 'one_time',
  mediaFiles: [], mediaPreviews: [], mediaTab: 'photos',
  requirements: {
    license:         { enabled: false, licenseType: '' },
    insurance:       { enabled: false, minCoverage: '1m' },
    skillLevel:      { enabled: false, minLevel: 'advanced' },
    ownTools:        { enabled: false, toolList: '' },
    crewSize:        { enabled: false, minCrew: 2 },
    backgroundCheck: { enabled: false },
  },
  requiredSkills: [],
  categorySuggestion: null,
  budgetType: 'open', budgetAmount: 800, budgetAmountHourly: 45,
      // ── Scheduling & recurrence (merged from Planned Needs) ──
    scheduledDate: '', scheduledTime: '',
    recurrence: 'none', // none | weekly | biweekly | monthly
    // ── Preferred helper ──
    preferredHelperId: '', preferredHelperName: '',
    // ── Private notes (only visible to poster) ──
    privateNotes: '',
  urgency: 'this_week', notes: '',
  termsAccepted: false,
  submitting: false, submitted: false, submittedJob: null,
  geocoding: false, draftSaving: false, draftId: null,
};

// ─── Helpers ──────────────────────────────────────────────────────────────────
function sliderPct(val, min, max) {
  if (max === min) return 0;
  return Math.round(((val - min) / (max - min)) * 100);
}

function formatBudgetAmount(type, value, currency, t) {
  const amount = formatMoney(value, { currency, minimumFractionDigits: 0, maximumFractionDigits: 0 });
  if (type === 'hourly') return t('postJob.hourlyRateShort', { amount });
  return t('postJob.fixedPriceShort', { amount });
}

function formatBudgetDisplay(form, currency = 'USD', t) {
  if (form.budgetType === 'open') return t('postJob.openToBids');
  if (form.budgetType === 'hourly') {
    return formatBudgetAmount('hourly', form.budgetAmountHourly, currency, t);
  }
  return formatBudgetAmount('fixed', form.budgetAmount, currency, t);
}

function getLocationDisplay(form) {
  return [form.locationCity, form.locationState, form.locationZip, form.locationCountry]
    .filter(Boolean)
    .join(', ');
}

function parsePrefillLocation(locationInput, fallbackCountry = '') {
  const raw = String(locationInput || '').trim();
  if (!raw) return {};

  const parts = raw.split(',').map((part) => part.trim()).filter(Boolean);
  const patch = { locationInput: raw };
  if (parts.length >= 1) patch.locationCity = parts[0];
  if (parts.length >= 2) patch.locationState = parts[1];
  if (parts.length >= 3) patch.locationCountry = parts[parts.length - 1];
  if (!patch.locationCountry && fallbackCountry) patch.locationCountry = fallbackCountry;
  return patch;
}

function activeRequirements(reqs) {
  return Object.entries(reqs).filter(([, v]) => v.enabled).map(([k]) => k);
}

// ─── CheckIcon ───────────────────────────────────────────────────────────────
function CheckIcon({ size = 12 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" aria-hidden="true">
      <polyline points="20 6 9 17 4 12" />
    </svg>
  );
}

// ─── SkillSearch component ───────────────────────────────────────────────────
function SkillSearch({ onAddSkill }) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const { t } = useTranslation();

  const handleSearch = useCallback(async (q) => {
    setQuery(q);
    if (!q.trim()) {
      setResults([]);
      return;
    }
    setLoading(true);
    try {
      const res = await api.get('/user-skills/lookup', {
        params: { q, limit: 20 }
      });
      setResults(res.data.skills || []);
    } catch (err) {
      setResults([]);
    } finally {
      setLoading(false);
    }
  }, []);

  return (
    <div style={{ position: 'relative' }}>
      <input
        type="text"
        placeholder={t('postJob.addSkill')}
        value={query}
        onChange={(e) => handleSearch(e.target.value)}
        className="pjw-input"
        style={{ width: '100%' }}
        autoComplete="off"
      />
      {loading && <div style={{ fontSize: '0.75rem', color: 'var(--muted-text)', marginTop: '0.5rem' }}>{t('common.loading')}</div>}
      {query && results.length > 0 && (
        <div style={{
          position: 'absolute',
          top: '100%',
          left: 0,
          right: 0,
          backgroundColor: 'var(--card-bg)',
          border: '1px solid var(--border-color)',
          borderRadius: '0.375rem',
          marginTop: '0.25rem',
          maxHeight: '200px',
          overflowY: 'auto',
          zIndex: 10
        }}>
          {results.map((skill) => (
            <button
              key={skill.id}
              type="button"
              onClick={() => {
                onAddSkill(skill);
                setQuery('');
                setResults([]);
              }}
              style={{
                display: 'block',
                width: '100%',
                padding: '0.75rem 1rem',
                border: 'none',
                background: 'none',
                textAlign: 'left',
                cursor: 'pointer',
                fontSize: '0.875rem',
                color: 'inherit'
              }}
              onMouseEnter={(e) => e.target.style.backgroundColor = 'var(--app-bg)'}
              onMouseLeave={(e) => e.target.style.backgroundColor = 'transparent'}
            >
              <div>{skill.name}</div>
              <div style={{ fontSize: '0.75rem', color: 'var(--muted-text)' }}>{skill.category}</div>
            </button>
          ))}
        </div>
      )}
      {query && !loading && results.length === 0 && (
        <div style={{ fontSize: '0.75rem', color: 'var(--muted-text)', marginTop: '0.5rem' }}>
          {t('businessSkills.noResults')}
        </div>
      )}
    </div>
  );
}

// ─── Main component ──────────────────────────────────────────────────────────
export default function PostJobPage() {
  const { t } = useTranslation();
  const { isAvailable } = useCapabilities();
  const geocodingAvailable = isAvailable('geocoding');
  const STEP_LABELS = [
    t('postJob.stepJobDetails', 'Job Details'),
    t('postJob.stepRequirements', 'Requirements'),
    t('postJob.stepBudgetTimeline', 'Budget & Timeline'),
    t('postJob.stepReviewPost', 'Review & Post'),
  ];
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const location = useLocation();
  const { user }  = useAuth();
  const currency = user?.preferred_currency
    || (user?.country ? getDefaultCurrency(user.country) : null)
    || 'USD';
  const { createJob } = useJobs();

  // Pre-selected helper from "Book Now" on a helper profile page
  const directHelperId   = searchParams.get('helperId')   || '';
  const directHelperName = searchParams.get('helperName') || '';
  const fromBookingId    = searchParams.get('fromBooking') || '';
  const flowMode         = searchParams.get('mode') || '';
  const businessName     = searchParams.get('businessName') || '';
  const isMaintenanceRequestMode = flowMode === 'maintenance_request';

  const bookingPrefillApplied = useRef(false);
  const [form, setForm]     = useState(INIT);
  const [errors, setErrors] = useState({});
    const [helperHints, setHelperHints] = useState([]);

  const photoInputRef       = useRef(null);
  const videoInputRef       = useRef(null);
  const audioInputRef       = useRef(null);
  const draftTimer          = useRef(null);
  const successModalRef     = useRef(null);

  const [liveCapture, setLiveCapture] = useState(null); // 'photo' | 'video' | 'audio' | null

  const set = useCallback((patch) => setForm(f => ({ ...f, ...patch })), []);
  const setReq = useCallback((key, patch) =>
    setForm(f => ({ ...f, requirements: { ...f.requirements, [key]: { ...f.requirements[key], ...patch } } })),
  []);

  // Prefill from direct booking (failed / expired) — normal post-job flow still required
  useEffect(() => {
    if (bookingPrefillApplied.current) return;
    const statePrefill = location.state?.bookingPrefill;
    if (statePrefill && typeof statePrefill === 'object') {
      const locationPatch = parsePrefillLocation(
        statePrefill.locationInput,
        statePrefill.locationCountry || user?.country || ''
      );
      bookingPrefillApplied.current = true;
      setForm((f) => ({
        ...f,
        title: statePrefill.title || f.title,
        description: statePrefill.description || f.description,
        ...locationPatch,
        notes: statePrefill.notes ?? f.notes,
        preferredHelperId: statePrefill.preferredHelperId || f.preferredHelperId,
        preferredHelperName: statePrefill.preferredHelperName || f.preferredHelperName,
        step: 1,
      }));
      navigate('/post-job', { replace: true, state: {} });
      return;
    }
    if (!fromBookingId) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetchBookingPrefillForJob(fromBookingId);
        const prefill = res?.prefill;
        if (!prefill || cancelled) return;
        const locationPatch = parsePrefillLocation(
          prefill.locationInput,
          prefill.locationCountry || user?.country || ''
        );
        bookingPrefillApplied.current = true;
        setForm((f) => ({
          ...f,
          title: prefill.title || f.title,
          description: prefill.description || f.description,
          ...locationPatch,
          notes: prefill.notes ?? f.notes,
          preferredHelperId: prefill.preferredHelperId || f.preferredHelperId,
          preferredHelperName: prefill.preferredHelperName || f.preferredHelperName,
          step: 1,
        }));
        navigate('/post-job', { replace: true });
      } catch {
        /* user can still post manually */
      }
    })();
    return () => { cancelled = true; };
  }, [fromBookingId, location.state, navigate, user?.country]);

  useEffect(() => {
    if (!isMaintenanceRequestMode || bookingPrefillApplied.current || fromBookingId || location.state?.bookingPrefill) return;
    bookingPrefillApplied.current = true;
    setForm((f) => ({
      ...f,
      title: f.title || 'Maintenance request',
      categoryId: f.categoryId || 'plumbing-general',
      categoryName: f.categoryName || 'Plumbing - General',
      description: f.description || 'Describe the issue, when it started, what you have already tried, and whether there are leaks, safety concerns, or access notes.',
      notes: f.notes || 'Tenant maintenance request. Include permission-to-enter notes, pet/access details, and preferred repair windows.',
      preferredHelperId: directHelperId || f.preferredHelperId,
      preferredHelperName: directHelperName || businessName || f.preferredHelperName,
      urgency: f.urgency || 'this_week',
      step: 1,
    }));
  }, [
    businessName,
    directHelperId,
    directHelperName,
    fromBookingId,
    isMaintenanceRequestMode,
    location.state,
  ]);

  // ── Load draft on mount ───────────────────────────────────────────────────
  useEffect(() => {
    if (fromBookingId || flowMode || location.state?.bookingPrefill) return;
    api.get('/jobs/draft').then(({ data }) => {
      if (!data) return;
      const p = data.payload || {};
      setForm(f => ({ ...f, ...p, step: 1, draftId: data.id }));
    }).catch(() => {});
  }, [flowMode, fromBookingId, location.state]);

  // ── Auto-save draft (debounced 2 s) ──────────────────────────────────────
  useEffect(() => {
    if (form.submitted) return;
    clearTimeout(draftTimer.current);
    draftTimer.current = setTimeout(() => {
      const { submitting, submitted, submittedJob, geocoding, draftSaving, mediaPreviews, mediaFiles, ...payload } = form;
      set({ draftSaving: true });
      api.put('/jobs/draft', { wizard_step: form.step, payload })
        .catch(() => {})
        .finally(() => set({ draftSaving: false }));
    }, 2000);
    return () => clearTimeout(draftTimer.current);
  }, [form.title, form.categoryId, form.description,
      form.locationCity, form.locationState, form.locationZip, form.locationCountry,
      form.requirements, form.budgetType, form.budgetAmount, form.budgetAmountHourly,
      form.urgency, form.notes, form.step]);

  // ── Success modal focus management & cleanup ────────────────────────────────
  useEffect(() => {
    if (form.submitted && form.submittedJob && successModalRef.current) {
      // Auto-focus first button in success modal for accessibility
      const firstButton = successModalRef.current.querySelector('button');
      if (firstButton) {
        setTimeout(() => firstButton.focus(), 0);
      }
    }
  }, [form.submitted, form.submittedJob]);

  // ── Clear submitted state on unmount to prevent stale state ────────────────
  useEffect(() => {
    return () => {
      if (form.submitted) {
        set({ submitted: false, submittedJob: null });
      }
    };
  }, []);

  // ── Category selection & suggestions ─────────────────────────────────────
  function handleCategoryChange(id, name) {
    const cat = CAT_BY_ID[id];
    if (!cat) { set({ categoryId: id, categoryName: name, categorySuggestion: null }); return; }

    const newReqs = { ...INIT.requirements };
    cat.suggested.forEach(key => {
      newReqs[key] = { ...newReqs[key], enabled: true };
      if (key === 'license'     && cat.defaults.licenseType) newReqs.license    = { ...newReqs.license,    licenseType: cat.defaults.licenseType };
      if (key === 'insurance'   && cat.defaults.minCoverage) newReqs.insurance  = { ...newReqs.insurance,  minCoverage: cat.defaults.minCoverage };
      if (key === 'skillLevel'  && cat.defaults.minLevel)    newReqs.skillLevel = { ...newReqs.skillLevel,  minLevel:   cat.defaults.minLevel };
      if (key === 'crewSize'    && cat.defaults.minCrew)     newReqs.crewSize   = { ...newReqs.crewSize,   minCrew:    cat.defaults.minCrew };
    });

    setForm(f => ({
      ...f,
      categoryId: id,
      categoryName: name,
      requirements: newReqs,
      categorySuggestion: cat.suggested.length > 0
        ? `For "${name}" we've pre-selected recommended requirements. Adjust as needed.`
        : null,
    }));
  }

  // ── Location geocode (on blur of any location field) ─────────────────────
  // Builds a geocode query from the explicit city/state/zip/country fields and
  // fills in lat/lng if the Google Maps API resolves it. The user-typed values
  // for city, state, zip, country are always preserved — geocoding only adds
  // the hidden coordinates used for radius search on the /jobs page.
  async function handleLocationBlur() {
    if (!geocodingAvailable) return;
    const city    = form.locationCity.trim();
    const state   = form.locationState.trim();
    const zip     = form.locationZip.trim();
    const country = form.locationCountry.trim();
    // Need at minimum a city to geocode
    if (!city) return;
    const parts = [city, state, zip, country].filter(Boolean);
    const q = parts.join(', ');
    set({ geocoding: true });
    try {
      const { data } = await api.get(`/geo/suggest?q=${encodeURIComponent(q)}`);
      if (data && data.length > 0) {
        const hit = data[0];
        // Only update lat/lng from geocoder — never overwrite what the user typed
        set({
          locationLat: hit.lat || null,
          locationLng: hit.lng || null,
        });
      }
    } catch (_) {}
    finally { set({ geocoding: false }); }
  }

  // ── Media handling ────────────────────────────────────────────────────────
  function handleMediaFiles(files) {
    const allowed = form.mediaTab === 'photos'
      ? ['image/jpeg','image/png','image/webp','image/gif']
      : form.mediaTab === 'video'
        ? ['video/mp4','video/quicktime','video/webm','video/x-m4v','video/3gpp']
        : ['audio/mpeg','audio/mp3','audio/wav','audio/x-wav','audio/ogg','audio/webm','audio/aac','audio/x-aac'];

    const maxFiles = form.mediaTab === 'photos' ? 5 : 1;
    const valid = Array.from(files).filter(f => allowed.includes(f.type)).slice(0, maxFiles - form.mediaFiles.length);
    if (!valid.length) return;

    const previews = valid.map(f => URL.createObjectURL(f));
    setForm(f => ({
      ...f,
      mediaFiles:    [...f.mediaFiles,    ...valid],
      mediaPreviews: [...f.mediaPreviews, ...previews],
    }));
  }

  function removeMedia(idx) {
    URL.revokeObjectURL(form.mediaPreviews[idx]);
    setForm(f => ({
      ...f,
      mediaFiles:    f.mediaFiles.filter((_,i)    => i !== idx),
      mediaPreviews: f.mediaPreviews.filter((_,i) => i !== idx),
    }));
  }

  function handleDrop(e) {
    e.preventDefault();
    handleMediaFiles(e.dataTransfer.files);
  }

  // ── Validation ────────────────────────────────────────────────────────────
  function validateStep(n) {
    const errs = {};
    if (n === 1) {
      if (!form.title.trim() || form.title.trim().length < 10)    errs.title       = t('postJob.titleValidation');
      if (!form.categoryId)                                        errs.categoryId  = t('postJob.categoryValidation');
      if (!form.description.trim() || form.description.trim().length < 50) errs.description = t('postJob.descriptionValidation');
      if (!form.locationCity.trim())                               errs.locationCity    = t('postJob.cityValidation');
      if (!form.locationCountry.trim())                            errs.locationCountry = t('postJob.countryValidation');
    }
    return errs;
  }

  function nextStep() {
    const errs = validateStep(form.step);
    if (Object.keys(errs).length) { setErrors(errs); return; }
    setErrors({});
    set({ step: form.step + 1 });
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function prevStep() {
    setErrors({});
    set({ step: form.step - 1 });
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  // ── Submit ────────────────────────────────────────────────────────────────
  async function handleSubmit() {
    if (!form.termsAccepted) { setErrors({ terms: 'You must accept the terms to post.' }); return; }
    set({ submitting: true });
    setErrors({});
    try {
      const fd = new FormData();
      fd.append('title',         form.title.trim());
      // category_id is a DB integer FK - frontend uses string slugs, so only send category_name
      fd.append('category_name', form.categoryName || form.categoryId);
      fd.append('description',   form.description.trim());
      fd.append('location_city',    form.locationCity.trim());
      fd.append('location_state',   form.locationState.trim());
      fd.append('location_zip',     form.locationZip.trim());
      fd.append('location_country', form.locationCountry.trim());
      if (form.locationLat) fd.append('location_lat', form.locationLat);
      if (form.locationLng) fd.append('location_lng', form.locationLng);
      fd.append('site_access',   form.siteAccess);
      fd.append('job_type_label',form.jobType);
      fd.append('budget_type',   form.budgetType);
      if (form.budgetType === 'fixed')  { fd.append('budget_min', form.budgetAmount); fd.append('budget_max', form.budgetAmount); }
      if (form.budgetType === 'hourly') { fd.append('budget_min', form.budgetAmountHourly); }
      fd.append('urgency',       form.urgency);
      fd.append('notes',         form.notes);
      if (form.scheduledDate) fd.append('scheduled_date', form.scheduledDate);
      if (form.scheduledTime) fd.append('scheduled_time', form.scheduledTime);
      if (form.recurrence && form.recurrence !== 'none') fd.append('recurrence', form.recurrence);
      fd.append('requirements',  JSON.stringify(
        Object.entries(form.requirements)
          .filter(([,v]) => v.enabled)
          .map(([type, v]) => ({ type, required: true, detail: v }))
      ));
      if (form.requiredSkills.length > 0) {
        fd.append('required_skills', JSON.stringify(form.requiredSkills));
      }

      // Validate file sizes before uploading
      const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB
      form.mediaFiles.forEach(f => {
        if (f.size > MAX_FILE_SIZE) {
          throw new Error(`File "${f.name}" is too large. Maximum file size is 10MB.`);
        }
        fd.append('media', f);
      });

      const prefId = form.preferredHelperId || directHelperId;
      if (prefId) fd.append('preferred_helper_id', prefId);
      const prefName = form.preferredHelperName || directHelperName;
      if (prefName) fd.append('preferred_helper_name', prefName);

      const job = await createJob(fd);

      // Clear draft
      api.delete('/jobs/draft').catch(() => {});
      set({ submitted: true, submittedJob: job });
    } catch (err) {
      // Extract field-level validation errors first
      if (err?.response?.data?.fields) {
        setErrors(err.response.data.fields);
      } else {
        // Fallback to error message
        const msg = err?.response?.data?.error || err?.message || 'Failed to post job. Please try again.';
        setErrors({ submit: msg });
      }
      // Log error details for debugging
      console.error('[PostJob] createJob failed:', {
        status: err?.response?.status,
        error: err?.response?.data?.error,
        fields: err?.response?.data?.fields,
        message: err?.message,
      });
    } finally {
      set({ submitting: false });
    }
  }

  // ── Sidebar summary ───────────────────────────────────────────────────────
  const locationDisplay = getLocationDisplay(form);
  const isReady = !!(form.title.trim().length >= 10 && form.categoryId && form.locationCity.trim() && form.locationCountry.trim());
  const activeReqs = activeRequirements(form.requirements);
  const stepMeta = {
    1: {
      eyebrow: 'Scope the work',
      title: 'Tell OxSteed what needs to get done.',
      body: 'A stronger title, clearer location, and useful media help the right helpers self-select faster.',
    },
    2: {
      eyebrow: 'Set the bar',
      title: 'Define who is qualified to bid.',
      body: 'Use requirements to filter for the kind of helper, team, tools, and trust signals this job really needs.',
    },
    3: {
      eyebrow: 'Budget and timing',
      title: 'Make the timeline feel real.',
      body: 'Set a budget style, urgency, schedule preferences, and private notes so bids arrive with better context.',
    },
    4: {
      eyebrow: 'Final review',
      title: 'Check the post before it goes live.',
      body: 'This is the last pass before your job starts attracting bids from helpers who match the request.',
    },
  }[form.step];
  const helperFitCount = activeReqs.length + (form.requiredSkills.length ? 1 : 0);

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <PageShell>
      <div className="pjw-root">
        <PageMeta
          title={t('postJob.title')}
          description="Describe what you need done and get competitive bids from trusted local helpers within hours. Free to post."
          url="https://oxsteed.com/post-job"
          noIndex={true}
        />
        <main className="pjw-main-wrap">

          {/* ── Page header ────────────────────────────────────────────────── */}
          <header className="pjw-hero">
            <nav className="pjw-breadcrumb" aria-label="Breadcrumb">
              <Link to="/">Home</Link><span>›</span>
              <Link to="/jobs">Jobs</Link><span>›</span>
              <span aria-current="page">Post a Job</span>
            </nav>
            <div className="pjw-hero-grid">
              <div className="pjw-hero-copy">
                <div className="pjw-hero-kicker">Customer job post</div>
                <h1 className="pjw-page-title">{t('postJob.title')}</h1>
                <p className="pjw-page-sub">Describe what needs doing, set the bar for who can bid, and turn one messy task into a clear request helpers can price quickly.</p>

                <div className="pjw-hero-trust">
                  <span className="pjw-hero-pill">Free to post</span>
                  <span className="pjw-hero-pill">Set your own requirements</span>
                  <span className="pjw-hero-pill">Invite competitive bids</span>
                </div>
              </div>

              <div className="pjw-hero-panel">
                <div className="pjw-hero-panel-card">
                  <div className="pjw-hero-panel-label">What makes bids better</div>
                  <ul className="pjw-hero-panel-list">
                    <li>Specific scope beats broad descriptions.</li>
                    <li>Photos or video reduce back-and-forth questions.</li>
                    <li>Requirements prevent low-fit helpers from wasting your time.</li>
                  </ul>
                </div>
              </div>
            </div>
            {directHelperId && (
              <div style={{ display:'flex', alignItems:'center', gap:'10px', marginTop:'12px', padding:'12px 16px', background:'rgba(249,115,22,0.08)', border:'1px solid rgba(249,115,22,0.25)', borderRadius:'12px', fontSize:'13px', color:'#fb923c' }}>
                <span>⚡</span>
                <span>Direct request to <strong style={{ color:'#fff' }}>{directHelperName || 'this helper'}</strong> - they'll be notified when your job is posted.</span>
                <a href={`/helpers/${directHelperId}`} style={{ marginLeft:'auto', color:'#fb923c', textDecoration:'underline', whiteSpace:'nowrap' }}>View profile</a>
              </div>
            )}
            {fromBookingId && (
              <div style={{ marginTop:'12px', padding:'12px 16px', background:'rgba(59,130,246,0.08)', border:'1px solid rgba(59,130,246,0.25)', borderRadius:'12px', fontSize:'13px', color:'#93c5fd' }}>
                {t('postJob.prefillFromBooking', 'We pulled details from your booking request. Review everything below before posting publicly.')}
              </div>
            )}
            {isMaintenanceRequestMode && (
              <div style={{ marginTop:'12px', padding:'12px 16px', background:'rgba(16,185,129,0.08)', border:'1px solid rgba(16,185,129,0.25)', borderRadius:'12px', fontSize:'13px', color:'#6ee7b7' }}>
                Maintenance request mode is on. Add photos, access notes, urgency, and preferred repair windows so the property manager can accept, schedule, or assign the work.
              </div>
            )}
          </header>

        {/* ── Step bar ───────────────────────────────────────────────────── */}
        <div className="pjw-step-bar" role="list" aria-label="Progress steps">
          {STEP_LABELS.map((label, i) => {
            const n = i + 1;
            const cls = n === form.step ? 'is-active' : n < form.step ? 'is-done' : '';
            return (
              <React.Fragment key={n}>
                {i > 0 && <div className="pjw-step-line" aria-hidden="true" />}
                <div className={`pjw-step ${cls}`} role="listitem">
                  <div className="pjw-step-dot">
                    {n < form.step ? <CheckIcon size={12} /> : n}
                  </div>
                  <span className="pjw-step-label">{label}</span>
                </div>
              </React.Fragment>
            );
          })}
        </div>

        <section className="pjw-step-intro">
          <div className="pjw-step-intro-copy">
            <span className="pjw-step-intro-eyebrow">{stepMeta.eyebrow}</span>
            <h2>{stepMeta.title}</h2>
            <p>{stepMeta.body}</p>
          </div>
          <div className="pjw-step-intro-stats">
            <div className="pjw-step-stat">
              <span className="pjw-step-stat-label">Current step</span>
              <strong>{form.step} / 4</strong>
            </div>
            <div className="pjw-step-stat">
              <span className="pjw-step-stat-label">Helper filters</span>
              <strong>{helperFitCount}</strong>
            </div>
            <div className="pjw-step-stat">
              <span className="pjw-step-stat-label">Media added</span>
              <strong>{form.mediaFiles.length}</strong>
            </div>
          </div>
        </section>

        <div className="pjw-two-col">
          {/* ── Steps column ──────────────────────────────────────────────── */}
          <div>

            {/* ═══ STEP 1 - Job Details ═════════════════════════════════ */}
            {form.step === 1 && (
              <div className="pjw-card">
                <div className="pjw-section-label">
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden="true"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
                  Step 1 of 4 - Job Details
                </div>

                {/* Title */}
                <div className="pjw-field">
                  <label htmlFor="pjw-title">{t('postJob.jobTitleLabel')} <span className="req">*</span></label>
                  <input
                    id="pjw-title" type="text" className={`pjw-input${errors.title?' has-error':''}`}
                    placeholder={t('postJob.jobTitleExample')}
                    maxLength={80} value={form.title}
                    onChange={e => set({ title: e.target.value })}
                  />
                  <div className="pjw-char-count">{form.title.length}/80</div>
                  {errors.title && <div className="pjw-field-error">{errors.title}</div>}
                </div>

                {/* Category */}
                <div className="pjw-field">
                  <label id="pjw-category-label">Category <span className="req">*</span></label>
                  <CategorySelect
                    value={form.categoryId}
                    onChange={handleCategoryChange}
                    error={!!errors.categoryId}
                    t={t}
                  />
                  {errors.categoryId && <div className="pjw-field-error">{errors.categoryId}</div>}
                </div>

                {/* Description */}
                <div className="pjw-field">
                  <label htmlFor="pjw-desc">
                    {t('postJob.describeWork')} <span className="req">*</span>
                    <span className="hint">{t('postJob.describeWorkHint')}</span>
                  </label>
                  <textarea
                    id="pjw-desc" className={`pjw-textarea${errors.description?' has-error':''}`}
                    rows={5} maxLength={1000}
                    placeholder={t('postJob.jobDescExample')}
                    value={form.description}
                    onChange={e => set({ description: e.target.value })}
                  />
                  <div className="pjw-char-count">{form.description.length}/1000</div>
                  {errors.description && <div className="pjw-field-error">{errors.description}</div>}
                </div>

                {/* Location — structured 4-field layout */}
                <div className="pjw-field">
                  <label style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                    {t('postJob.locationSection')}
                    {form.geocoding && <span className="pjw-geocoding-spinner" style={{ position: 'static', transform: 'none', marginLeft: '0.25rem' }} aria-label={t('postJob.locating')} />}
                  </label>

                  {/* Row 1: City + State/Region */}
                  <div className="pjw-field-row" style={{ marginBottom: '0.75rem' }}>
                    <div>
                      <label htmlFor="pjw-city" className="pjw-sublabel">
                        {t('postJob.cityLabel')} <span className="req">*</span>
                      </label>
                      <input
                        id="pjw-city" type="text"
                        className={`pjw-input${errors.locationCity ? ' has-error' : ''}`}
                        placeholder={t('postJob.cityPlaceholder')}
                        value={form.locationCity}
                        onChange={e => set({ locationCity: e.target.value })}
                        onBlur={handleLocationBlur}
                      />
                      {errors.locationCity && <div className="pjw-field-error">{errors.locationCity}</div>}
                    </div>
                    <div>
                      <label htmlFor="pjw-state" className="pjw-sublabel">
                        {t('postJob.stateLabel')}
                      </label>
                      <input
                        id="pjw-state" type="text"
                        className="pjw-input"
                        placeholder={t('postJob.statePlaceholder')}
                        value={form.locationState}
                        onChange={e => set({ locationState: e.target.value })}
                        onBlur={handleLocationBlur}
                      />
                    </div>
                  </div>

                  {/* Row 2: ZIP + Country */}
                  <div className="pjw-field-row" style={{ marginBottom: 0 }}>
                    <div>
                      <label htmlFor="pjw-zip" className="pjw-sublabel">
                        {t('postJob.zipLabel')}
                      </label>
                      <input
                        id="pjw-zip" type="text"
                        className="pjw-input"
                        placeholder={t('postJob.zipPlaceholder')}
                        value={form.locationZip}
                        onChange={e => set({ locationZip: e.target.value })}
                        onBlur={handleLocationBlur}
                      />
                    </div>
                    <div>
                      <label htmlFor="pjw-country" className="pjw-sublabel">
                        {t('postJob.countryLabel')} <span className="req">*</span>
                      </label>
                      <input
                        id="pjw-country" type="text"
                        className={`pjw-input${errors.locationCountry ? ' has-error' : ''}`}
                        placeholder={t('postJob.countryPlaceholder')}
                        value={form.locationCountry}
                        onChange={e => set({ locationCountry: e.target.value })}
                        onBlur={handleLocationBlur}
                      />
                      {errors.locationCountry && <div className="pjw-field-error">{errors.locationCountry}</div>}
                    </div>
                  </div>
                </div>

                {/* Site Access */}
                <div className="pjw-field-row">
                  <div className="pjw-field" style={{ marginBottom: 0 }}>
                    <label htmlFor="pjw-access">{t('postJob.siteAccess')}</label>
                    <select id="pjw-access" className="pjw-select" value={form.siteAccess} onChange={e => set({ siteAccess: e.target.value })}>
                      <option value="easy">{t('postJob.siteAccessEasy')}</option>
                      <option value="lockbox">{t('postJob.siteAccessLockbox')}</option>
                      <option value="schedule">{t('postJob.siteAccessSchedule')}</option>
                    </select>
                  </div>
                </div>

                {/* Job Type */}
                <div className="pjw-field" style={{ marginTop: '1.25rem' }}>
                  <label htmlFor="pjw-jobtype">{t('postJob.jobType')}</label>
                  <select id="pjw-jobtype" className="pjw-select" value={form.jobType} onChange={e => set({ jobType: e.target.value })}>
                    <option value="one_time">{t('postJob.jobTypeOneTime')}</option>
                    <option value="recurring">{t('postJob.jobTypeRecurring')}</option>
                  </select>
                </div>

                {/* Media Upload */}
                <div className="pjw-field">
                  <label>{t('postJob.addPhotosVideoAudio')} <span className="hint">Optional</span></label>
                  <div className="pjw-media-tabs" role="group" aria-label="Media type">
                    {['photos','video','audio'].map(tab => (
                      <button
                        key={tab} type="button"
                        className={`pjw-media-tab${form.mediaTab===tab?' is-active':''}`}
                        onClick={() => { setForm(f => ({ ...f, mediaTab: tab, mediaFiles: [], mediaPreviews: [] })); }}
                      >
                        {tab === 'photos' ? '📷' : tab === 'video' ? '🎬' : '🎙'}
                        {tab.charAt(0).toUpperCase() + tab.slice(1)}
                      </button>
                    ))}
                  </div>

                  {/* Drop zone */}
                  <div
                    className="pjw-drop-zone"
                    onClick={() => (form.mediaTab === 'photos' ? photoInputRef : form.mediaTab === 'video' ? videoInputRef : audioInputRef).current?.click()}
                    onDrop={handleDrop}
                    onDragOver={e => { e.preventDefault(); e.currentTarget.classList.add('is-dragover'); }}
                    onDragLeave={e => e.currentTarget.classList.remove('is-dragover')}
                    role="button" tabIndex={0}
                    onKeyDown={e => e.key === 'Enter' && photoInputRef.current?.click()}
                    aria-label={`Click to upload ${form.mediaTab}`}
                  >
                    <div className="pjw-drop-icon">{form.mediaTab === 'photos' ? '📷' : form.mediaTab === 'video' ? '🎬' : '🎙'}</div>
                    <p><strong>Click to upload {form.mediaTab}</strong> or drag and drop</p>
                    <span className="pjw-drop-hint">
                      {form.mediaTab === 'photos' ? 'JPG, PNG, WEBP · up to 5 photos · 10 MB each' : form.mediaTab === 'video' ? 'MP4, MOV · up to 1 video · 100 MB' : 'MP3, WAV · up to 1 file · 20 MB'}
                    </span>
                  </div>

                  {/* Hidden file inputs - upload */}
                  <input ref={photoInputRef}  type="file" accept="image/*"       multiple style={{ display:'none' }} onChange={e => handleMediaFiles(e.target.files)} />
                  <input ref={videoInputRef}  type="file" accept="video/*"                style={{ display:'none' }} onChange={e => handleMediaFiles(e.target.files)} />
                  <input ref={audioInputRef}  type="file" accept="audio/*"                style={{ display:'none' }} onChange={e => handleMediaFiles(e.target.files)} />

                  {/* Live capture buttons - use real getUserMedia */}
                  {form.mediaTab === 'photos' && (
                    <button type="button" className="pjw-camera-btn" onClick={() => setLiveCapture('photo')}>
                      📷 Take a Live Photo
                    </button>
                  )}
                  {form.mediaTab === 'video' && form.mediaFiles.length === 0 && (
                    <button type="button" className="pjw-camera-btn" onClick={() => setLiveCapture('video')}>
                      🎥 Record a Video
                    </button>
                  )}
                  {form.mediaTab === 'audio' && form.mediaFiles.length === 0 && (
                    <button type="button" className="pjw-camera-btn" onClick={() => setLiveCapture('audio')}>
                      🎙 Record Audio
                    </button>
                  )}

                  {/* Previews */}
                  {form.mediaPreviews.length > 0 && (
                    <div className={`pjw-preview-grid${form.mediaTab !== 'photos' ? ' pjw-preview-grid--media' : ''}`}>
                      {form.mediaPreviews.map((src, i) => (
                        <div key={i} className={`pjw-preview-item${form.mediaTab === 'video' ? ' pjw-preview-item--video' : form.mediaTab === 'audio' ? ' pjw-preview-item--audio' : ''}`}>
                          {form.mediaTab === 'photos' && <img src={src} alt={`Preview ${i + 1}`} />}
                          {form.mediaTab === 'video'  && <video src={src} controls playsInline />}
                          {form.mediaTab === 'audio'  && <audio src={src} controls />}
                          <button className="pjw-preview-remove" type="button" onClick={() => removeMedia(i)} aria-label="Remove">✕</button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* ═══ STEP 2 - Requirements ════════════════════════════════ */}
            {form.step === 2 && (
              <div className="pjw-card">
                <div className="pjw-section-label">
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden="true"><path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/></svg>
                  {t('postJob.step2')}
                </div>
                <p className="pjw-section-desc">{t('postJob.requirementsDesc')}</p>

                {/* Info callout */}
                <div className="pjw-callout" role="note">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden="true"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
                  <p><strong>License &amp; insurance</strong> - when a helper provides credentials, OxSteed will attempt to verify them. All other requirements are <strong>self-confirmed</strong> by the helper before bidding.</p>
                </div>

                {/* Category suggestion callout */}
                {form.categorySuggestion && (
                  <div className="pjw-callout is-suggestion" role="note">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden="true"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>
                    <p>{form.categorySuggestion}</p>
                    <button className="pjw-callout-dismiss" type="button" onClick={() => set({ categorySuggestion: null })} aria-label="Dismiss">✕</button>
                  </div>
                )}

                {/* Requirement toggles */}
                <div className="pjw-req-grid" role="group" aria-label="Job requirements">

                  {/* License */}
                  <div className={`pjw-req-toggle${form.requirements.license.enabled?' is-selected':''}`} onClick={() => setReq('license',{ enabled:!form.requirements.license.enabled })} role="checkbox" aria-checked={form.requirements.license.enabled} tabIndex={0} onKeyDown={e=>e.key===' '&&setReq('license',{enabled:!form.requirements.license.enabled})}>
                    <div className="pjw-req-header">
                      <div style={{display:'flex',alignItems:'flex-start',gap:'.5rem'}}>
                        <svg className="pjw-req-icon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><rect x="2" y="7" width="20" height="14" rx="2"/><path d="M16 7V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v2"/></svg>
                        <div><div className="pjw-req-name">{t('postJob.license')}</div><div className="pjw-req-desc">{t('postJob.licenseDesc')}</div></div>
                      </div>
                      <div className="pjw-req-check" aria-hidden="true">{form.requirements.license.enabled && <CheckIcon/>}</div>
                    </div>
                    <div className={`pjw-req-detail${form.requirements.license.enabled?' is-open':''}`} aria-hidden={!form.requirements.license.enabled}>
                      <label>{t('postJob.licenseTypeRequired')}</label>
                      <select className="pjw-select" value={form.requirements.license.licenseType} onClick={e=>e.stopPropagation()} onChange={e=>setReq('license',{licenseType:e.target.value})}>
                        <option value="">Specify license type…</option>
                        <option value="oh-electrician">OH Electrician (OCILB)</option>
                        <option value="oh-plumber">OH Plumber</option>
                        <option value="oh-hvac">OH HVAC Contractor</option>
                        <option value="contractor">General Contractor</option>
                        <option value="other">Other / Specify in description</option>
                      </select>
                    </div>
                  </div>

                  {/* Insurance */}
                  <div className={`pjw-req-toggle${form.requirements.insurance.enabled?' is-selected':''}`} onClick={() => setReq('insurance',{ enabled:!form.requirements.insurance.enabled })} role="checkbox" aria-checked={form.requirements.insurance.enabled} tabIndex={0} onKeyDown={e=>e.key===' '&&setReq('insurance',{enabled:!form.requirements.insurance.enabled})}>
                    <div className="pjw-req-header">
                      <div style={{display:'flex',alignItems:'flex-start',gap:'.5rem'}}>
                        <svg className="pjw-req-icon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>
                        <div><div className="pjw-req-name">{t('postJob.insurance')}</div><div className="pjw-req-desc">{t('postJob.insuranceDesc')}</div></div>
                      </div>
                      <div className="pjw-req-check" aria-hidden="true">{form.requirements.insurance.enabled && <CheckIcon/>}</div>
                    </div>
                    <div className={`pjw-req-detail${form.requirements.insurance.enabled?' is-open':''}`} aria-hidden={!form.requirements.insurance.enabled}>
                      <label>{t('postJob.minimumCoverageAmount')}</label>
                      <select className="pjw-select" value={form.requirements.insurance.minCoverage} onClick={e=>e.stopPropagation()} onChange={e=>setReq('insurance',{minCoverage:e.target.value})}>
                        <option value="300k">$300,000</option>
                        <option value="500k">$500,000</option>
                        <option value="1m">$1,000,000</option>
                        <option value="2m">$2,000,000</option>
                      </select>
                    </div>
                  </div>

                  {/* Skill Level */}
                  <div className={`pjw-req-toggle${form.requirements.skillLevel.enabled?' is-selected':''}`} onClick={() => setReq('skillLevel',{ enabled:!form.requirements.skillLevel.enabled })} role="checkbox" aria-checked={form.requirements.skillLevel.enabled} tabIndex={0} onKeyDown={e=>e.key===' '&&setReq('skillLevel',{enabled:!form.requirements.skillLevel.enabled})}>
                    <div className="pjw-req-header">
                      <div style={{display:'flex',alignItems:'flex-start',gap:'.5rem'}}>
                        <svg className="pjw-req-icon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/></svg>
                        <div><div className="pjw-req-name">{t('postJob.skillLevel')}</div><div className="pjw-req-desc">{t('postJob.skillLevelDesc')}</div></div>
                      </div>
                      <div className="pjw-req-check" aria-hidden="true">{form.requirements.skillLevel.enabled && <CheckIcon/>}</div>
                    </div>
                    <div className={`pjw-req-detail${form.requirements.skillLevel.enabled?' is-open':''}`} aria-hidden={!form.requirements.skillLevel.enabled}>
                      <label>{t('postJob.minimumSkillLevel')}</label>
                      <select className="pjw-select" value={form.requirements.skillLevel.minLevel} onClick={e=>e.stopPropagation()} onChange={e=>setReq('skillLevel',{minLevel:e.target.value})}>
                        <option value="beginner">Beginner - basic tasks</option>
                        <option value="intermediate">Intermediate - 2+ years</option>
                        <option value="advanced">Advanced - 5+ years</option>
                        <option value="expert">Expert / Master level</option>
                      </select>
                    </div>
                  </div>

                  {/* Own Tools */}
                  <div className={`pjw-req-toggle${form.requirements.ownTools.enabled?' is-selected':''}`} onClick={() => setReq('ownTools',{ enabled:!form.requirements.ownTools.enabled })} role="checkbox" aria-checked={form.requirements.ownTools.enabled} tabIndex={0} onKeyDown={e=>e.key===' '&&setReq('ownTools',{enabled:!form.requirements.ownTools.enabled})}>
                    <div className="pjw-req-header">
                      <div style={{display:'flex',alignItems:'flex-start',gap:'.5rem'}}>
                        <svg className="pjw-req-icon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/></svg>
                        <div><div className="pjw-req-name">{t('postJob.ownTools')}</div><div className="pjw-req-desc">{t('postJob.ownToolsDesc')}</div></div>
                      </div>
                      <div className="pjw-req-check" aria-hidden="true">{form.requirements.ownTools.enabled && <CheckIcon/>}</div>
                    </div>
                    <div className={`pjw-req-detail${form.requirements.ownTools.enabled?' is-open':''}`} aria-hidden={!form.requirements.ownTools.enabled}>
                      <label>{t('postJob.specificToolsNeeded')} <span style={{fontWeight:400}}>({t('postJob.specificToolsNeededHint')})</span></label>
                      <input className="pjw-input" type="text" placeholder={t('postJob.toolsExample')} value={form.requirements.ownTools.toolList} onClick={e=>e.stopPropagation()} onChange={e=>setReq('ownTools',{toolList:e.target.value})} />
                    </div>
                  </div>

                  {/* Crew Size */}
                  <div className={`pjw-req-toggle${form.requirements.crewSize.enabled?' is-selected':''}`} onClick={() => setReq('crewSize',{ enabled:!form.requirements.crewSize.enabled })} role="checkbox" aria-checked={form.requirements.crewSize.enabled} tabIndex={0} onKeyDown={e=>e.key===' '&&setReq('crewSize',{enabled:!form.requirements.crewSize.enabled})}>
                    <div className="pjw-req-header">
                      <div style={{display:'flex',alignItems:'flex-start',gap:'.5rem'}}>
                        <svg className="pjw-req-icon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>
                        <div><div className="pjw-req-name">{t('postJob.crewSize')}</div><div className="pjw-req-desc">{t('postJob.crewSizeDesc')}</div></div>
                      </div>
                      <div className="pjw-req-check" aria-hidden="true">{form.requirements.crewSize.enabled && <CheckIcon/>}</div>
                    </div>
                    <div className={`pjw-req-detail${form.requirements.crewSize.enabled?' is-open':''}`} aria-hidden={!form.requirements.crewSize.enabled}>
                      <label>{t('postJob.minimumCrewSize')}</label>
                      <select className="pjw-select" value={form.requirements.crewSize.minCrew} onClick={e=>e.stopPropagation()} onChange={e=>setReq('crewSize',{minCrew:Number(e.target.value)})}>
                        <option value={1}>Solo (1 person)</option>
                        <option value={2}>2 people</option>
                        <option value={3}>3 people</option>
                        <option value={4}>4+ people</option>
                      </select>
                    </div>
                  </div>

                  {/* Background Check */}
                  <div className={`pjw-req-toggle${form.requirements.backgroundCheck.enabled?' is-selected':''}`} onClick={() => setReq('backgroundCheck',{ enabled:!form.requirements.backgroundCheck.enabled })} role="checkbox" aria-checked={form.requirements.backgroundCheck.enabled} tabIndex={0} onKeyDown={e=>e.key===' '&&setReq('backgroundCheck',{enabled:!form.requirements.backgroundCheck.enabled})}>
                    <div className="pjw-req-header">
                      <div style={{display:'flex',alignItems:'flex-start',gap:'.5rem'}}>
                        <svg className="pjw-req-icon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
                        <div><div className="pjw-req-name">{t('postJob.backgroundCheck')}</div><div className="pjw-req-desc">{t('postJob.backgroundCheckDesc')}</div></div>
                      </div>
                      <div className="pjw-req-check" aria-hidden="true">{form.requirements.backgroundCheck.enabled && <CheckIcon/>}</div>
                    </div>
                  </div>

                </div>{/* /req-grid */}

                {/* Required Skills Section */}
                <div className="pjw-skills-section" style={{ marginTop: '2rem', paddingTop: '2rem', borderTop: '1px solid var(--border-color)' }}>
                  <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.75rem', fontWeight: 600, fontSize: '0.9375rem' }}>
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
                    {t('postJob.skills')}
                  </label>
                  <p style={{ fontSize: '0.875rem', color: 'var(--muted-text)', marginBottom: '1rem' }}>{t('postJob.skillsDesc')}</p>

                  {/* Skill search and add */}
                  <div style={{ marginBottom: '1.5rem' }}>
                    <SkillSearch
                      onAddSkill={(skill) => {
                        if (!form.requiredSkills.find(s => s.id === skill.id)) {
                          set({ requiredSkills: [...form.requiredSkills, skill] });
                        }
                      }}
                    />
                  </div>

                  {/* Selected skills display */}
                  {form.requiredSkills.length > 0 && (
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem' }}>
                      {form.requiredSkills.map((skill) => (
                        <div key={skill.id} style={{
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: '0.5rem',
                          padding: '0.5rem 1rem',
                          backgroundColor: 'var(--card-bg)',
                          border: '1px solid var(--border-color)',
                          borderRadius: '0.375rem',
                          fontSize: '0.875rem'
                        }}>
                          <span>{skill.name}</span>
                          <button
                            type="button"
                            onClick={() => set({ requiredSkills: form.requiredSkills.filter(s => s.id !== skill.id) })}
                            style={{ background: 'none', border: 'none', color: 'var(--muted-text)', cursor: 'pointer', padding: 0, fontSize: '1rem', lineHeight: 1 }}
                            aria-label={`Remove ${skill.name}`}
                          >
                            ✕
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {/* Warning if requirements narrow the field */}
                {activeReqs.length >= 3 && (
                  <div className="pjw-req-warning" role="note">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden="true"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
                    <span>Strict requirements may limit the number of helpers who can bid. You can still adjust after posting.</span>
                  </div>
                )}
              </div>
            )}

            {/* ═══ STEP 3 - Budget & Timeline ══════════════════════════ */}
            {form.step === 3 && (
              <div className="pjw-card">
                <div className="pjw-section-label">
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden="true"><line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg>
                  {t('postJob.step3BudgetTimeline')}
                </div>

                {/* Budget type tabs */}
                <div className="pjw-budget-tabs" role="group" aria-label={t('postJob.budgetType')}>
                  {['fixed','hourly','open'].map(type => (
                    <button key={type} type="button" className={`pjw-tab-btn${form.budgetType===type?' is-active':''}`}
                      onClick={() => set({ budgetType: type })}>
                      {t(`postJob.budgetTabs.${type}`)}
                    </button>
                  ))}
                </div>

                {/* Slider (fixed / hourly) */}
                {form.budgetType !== 'open' && (() => {
                  const cfg = BUDGET_CFG[form.budgetType];
                  const val = form.budgetType === 'hourly' ? form.budgetAmountHourly : form.budgetAmount;
                  const pct = sliderPct(val, cfg.min, cfg.max);
                  return (
                    <div className="pjw-field">
                      <label>{t('postJob.yourBudget')} <span className="req">*</span></label>
                      <div className="pjw-budget-row">
                        <div className="pjw-budget-display">{formatBudgetAmount(form.budgetType, val, currency, t)}</div>
                        <input type="range" className="pjw-slider"
                          min={cfg.min} max={cfg.max} step={cfg.step} value={val}
                          style={{ '--range-pct': `${pct}%` }}
                          aria-label={t('postJob.budgetAmountAria')}
                          onChange={e => {
                            const n = Number(e.target.value);
                            if (form.budgetType === 'hourly') set({ budgetAmountHourly: n });
                            else set({ budgetAmount: n });
                          }}
                        />
                      </div>
                      <div className="pjw-budget-range-labels">
                        <span>{formatBudgetAmount(form.budgetType, cfg.min, currency, t)}</span>
                        <span>{formatBudgetAmount(form.budgetType, cfg.max, currency, t)}</span>
                      </div>
                    </div>
                  );
                })()}

                {/* Open to bids note */}
                {form.budgetType === 'open' && (
                  <div className="pjw-callout" role="note">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden="true"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
                    <p>Helpers will submit their own price. You'll see all bids and choose the one that fits your budget.</p>
                  </div>
                )}

                <div className="pjw-hr" />

                {/* Urgency */}
                <div className="pjw-field">
                  <label>{t('postJob.urgency')}</label>
                  <div className="pjw-pill-group" role="group" aria-label="Job urgency">
                    {[['asap','urgencyASAP'],['this_week','urgencyThisWeek'],['next_week','urgencyNextWeek'],['flexible','urgencyFlexible']].map(([val,key]) => (
                      <button key={val} type="button"
                        className={`pjw-pill${form.urgency===val?' is-active':''}`}
                        onClick={() => set({ urgency: val })}
                        aria-pressed={form.urgency===val}>
                        {t(`postJob.${key}`)}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Additional notes */}
                <div className="pjw-field" style={{ marginBottom: 0 }}>
                  <label htmlFor="pjw-notes">{t('postJob.additionalNotes')} <span className="hint">Optional</span></label>
                  <textarea id="pjw-notes" className="pjw-textarea" rows={3}
                    placeholder={t('postJob.notesPlaceholder')}
                    value={form.notes} onChange={e => set({ notes: e.target.value })} />
                </div>

                {/* Scheduling (future date) */}
            <div className="pjw-field">
              <label>{t('postJob.scheduleForLater')} <span className="hint">Optional</span></label>
              <div style={{ display: 'flex', gap: '0.5rem' }}>
                <input type="date" className="pjw-input" value={form.scheduledDate}
                  onChange={e => set({ scheduledDate: e.target.value })} />
                <input type="time" className="pjw-input" value={form.scheduledTime}
                  onChange={e => set({ scheduledTime: e.target.value })} />
              </div>
            </div>

            {/* Recurrence */}
            <div className="pjw-field">
              <label>{t('postJob.recurrence')}</label>
              <div className="pjw-pill-group" role="group" aria-label="Recurrence">
                {[['none','recurrenceOneTime'],['weekly','recurrenceWeekly'],['biweekly','recurrenceBiWeekly'],['monthly','recurrenceMonthly']].map(([val,key]) =>
                  <button key={val} type="button"
                    className={`pjw-pill${form.recurrence===val?' is-active':''}`}
                    onClick={() => set({ recurrence: val })}
                    aria-pressed={form.recurrence===val}>
                    {t(`postJob.${key}`)}
                  </button>
                )}
              </div>
            </div>

            {/* Preferred helper */}
            <div className="pjw-field" style={{ position: 'relative' }}>
              <label htmlFor="pjw-preferred-helper">{t('postJob.preferredHelper')} <span className="hint">Optional</span></label>
              <input id="pjw-preferred-helper" className="pjw-input"
                placeholder={t('postJob.preferredHelperPlaceholder')}
                value={form.preferredHelperName}
                onChange={e => {
                  const v = e.target.value;
                  set({ preferredHelperName: v, preferredHelperId: '' });
                  if (v.length >= 2) {
                    api.get(`/helpers?query=${encodeURIComponent(v)}&limit=5`)
                      .then(r => setHelperHints(r.data.helpers || []))
                      .catch(() => setHelperHints([]));
                  } else { setHelperHints([]); }
                }}
                onBlur={() => setTimeout(() => setHelperHints([]), 200)} />
              {helperHints.length > 0 && (
                <ul className="pjw-autocomplete">
                  {helperHints.map(h => (
                    <li key={h.id}
                      onMouseDown={() => {
                        set({ preferredHelperId: h.id, preferredHelperName: h.ownerName });
                        setHelperHints([]);
                      }}>
                      {h.ownerName} {h.rating ? `★ ${h.rating}` : ''}
                    </li>
                  ))}
                </ul>
              )}
            </div>
            {/* Private notes */}
            <div className="pjw-field">
              <label htmlFor="pjw-private-notes">{t('postJob.privateNotes')} <span className="hint">{t('postJob.privateNotesHint')}</span></label>
              <textarea id="pjw-private-notes" className="pjw-textarea" rows={2}
                placeholder={t('postJob.privateNotesExample')}
                value={form.privateNotes} onChange={e => set({ privateNotes: e.target.value })} />
            </div>
              </div>
            )}

            {/* ═══ STEP 4 - Review & Post ══════════════════════════════ */}
            {form.step === 4 && (
              <div className="pjw-card">
                <div className="pjw-section-label">
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden="true"><path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/></svg>
                  Step 4 of 4 - Review &amp; Post
                </div>
                <p className="pjw-section-desc">Check everything looks right before going live.</p>

                {/* Job Details review */}
                <div className="pjw-review-row">
                  <span className="pjw-review-label">{t('postJob.jobDetailsTitle')}</span>
                  <span className={`pjw-review-value${!form.title?' is-empty':''}`}>{form.title || t('postJob.notSet')}</span>
                  <button className="pjw-edit-btn" type="button" onClick={() => set({ step:1 })}>Edit</button>
                </div>
                <div className="pjw-review-row">
                  <span className="pjw-review-label">{t('postJob.category')}</span>
                  <span className={`pjw-review-value${!form.categoryName?' is-empty':''}`}>{form.categoryName || t('postJob.notSelected')}</span>
                  <button className="pjw-edit-btn" type="button" onClick={() => set({ step:1 })}>Edit</button>
                </div>
                <div className="pjw-review-row">
                  <span className="pjw-review-label">{t('postJob.location')}</span>
                  <span className={`pjw-review-value${!form.locationCity ? ' is-empty' : ''}`}>
                    {form.locationCity
                      ? [form.locationCity, form.locationState, form.locationZip, form.locationCountry].filter(Boolean).join(', ')
                      : t('postJob.notSet')}
                  </span>
                  <button className="pjw-edit-btn" type="button" onClick={() => set({ step:1 })}>Edit</button>
                </div>
                <div className="pjw-review-row">
                  <span className="pjw-review-label">{t('postJob.siteAccess')}</span>
                  <span className="pjw-review-value">{{ easy: t('postJob.siteAccessEasy'), lockbox: t('postJob.siteAccessLockbox'), schedule: t('postJob.siteAccessSchedule') }[form.siteAccess]}</span>
                  <button className="pjw-edit-btn" type="button" onClick={() => set({ step:1 })}>Edit</button>
                </div>
                <div className="pjw-review-row">
                  <span className="pjw-review-label">{t('postJob.jobType')}</span>
                  <span className="pjw-review-value">{{ one_time: t('postJob.jobTypeOneTime'), recurring: t('postJob.jobTypeRecurring') }[form.jobType]}</span>
                  <button className="pjw-edit-btn" type="button" onClick={() => set({ step:1 })}>Edit</button>
                </div>
                <div className="pjw-review-row">
                  <span className="pjw-review-label">{t('postJob.description')}</span>
                  <span className="pjw-review-value" style={{ maxWidth:'360px', whiteSpace:'pre-wrap', wordBreak:'break-word' }}>{form.description || <em style={{color:'var(--pjw-text-faint)'}}>{t('postJob.notSet')}</em>}</span>
                  <button className="pjw-edit-btn" type="button" onClick={() => set({ step:1 })}>Edit</button>
                </div>

                <div className="pjw-hr" />

                {/* Requirements review */}
                <div className="pjw-review-row">
                  <span className="pjw-review-label">{t('postJob.requirements')}</span>
                  <div className="pjw-review-value">
                    {activeReqs.length === 0
                      ? <span style={{color:'var(--pjw-text-faint)',fontStyle:'italic'}}>{t('postJob.notSelected')}</span>
                      : <div className="pjw-req-badges">{activeReqs.map(k => <span key={k} className="pjw-req-badge">{REQ_META[k].label}</span>)}</div>
                    }
                  </div>
                  <button
                    className="pjw-edit-btn"
                    type="button"
                    onClick={() => set({ step:2 })}
                    aria-label={t('postJob.editRequirements')}
                  >
                    Edit
                  </button>
                </div>

                {/* Required Skills review - always visible for consistency */}
                <div className="pjw-review-row">
                  <span className="pjw-review-label">{t('postJob.skills')}</span>
                  <div className="pjw-review-value">
                    {form.requiredSkills.length === 0
                      ? <span style={{color:'var(--pjw-text-faint)',fontStyle:'italic'}}>{t('postJob.notSelected')}</span>
                      : <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem' }}>
                          {form.requiredSkills.map((skill) => (
                            <span key={skill.id} className="pjw-req-badge" aria-label={`${skill.name}, read-only`}>
                              {skill.name}
                            </span>
                          ))}
                        </div>
                    }
                  </div>
                  <button
                    className="pjw-edit-btn"
                    type="button"
                    onClick={() => set({ step:2 })}
                    aria-label={t('postJob.editRequiredSkills')}
                  >
                    Edit
                  </button>
                </div>

                <div className="pjw-hr" />

                {/* Budget review */}
                <div className="pjw-review-row">
                  <span className="pjw-review-label">{t('postJob.budget')}</span>
                  <span className="pjw-review-value">{formatBudgetDisplay(form, currency, t)}</span>
                  <button
                    className="pjw-edit-btn"
                    type="button"
                    onClick={() => set({ step:3 })}
                    aria-label={t('postJob.editBudget')}
                  >
                    Edit
                  </button>
                </div>
                <div className="pjw-review-row">
                  <span className="pjw-review-label">{t('postJob.urgency')}</span>
                  <span className="pjw-review-value">{{ asap: t('postJob.urgencyASAP'), this_week: t('postJob.urgencyThisWeek'), next_week: t('postJob.urgencyNextWeek'), flexible: t('postJob.urgencyFlexible') }[form.urgency]}</span>
                  <button
                    className="pjw-edit-btn"
                    type="button"
                    onClick={() => set({ step:3 })}
                    aria-label={t('postJob.editUrgency')}
                  >
                    Edit
                  </button>
                </div>
                {form.notes && (
                  <div className="pjw-review-row">
                    <span className="pjw-review-label">{t('postJob.notes')}</span>
                    <span className="pjw-review-value" style={{ maxWidth:'360px' }}>{form.notes}</span>
                    <button
                      className="pjw-edit-btn"
                      type="button"
                      onClick={() => set({ step:3 })}
                      aria-label={t('postJob.editNotes')}
                    >
                      Edit
                    </button>
                  </div>
                )}

                {/* Media review */}
                {form.mediaPreviews.length > 0 && (
                  <div className="pjw-review-row">
                    <span className="pjw-review-label">{t('postJob.media')}</span>
                    <div className="pjw-review-value">
                      <div className={`pjw-preview-grid${form.mediaTab !== 'photos' ? ' pjw-preview-grid--media' : ''}`} style={{ maxWidth:'300px' }}>
                        {form.mediaPreviews.map((src,i) => (
                          <div key={i} className={`pjw-preview-item${form.mediaTab === 'video' ? ' pjw-preview-item--video' : form.mediaTab === 'audio' ? ' pjw-preview-item--audio' : ''}`}>
                            {form.mediaTab === 'photos' && <img src={src} alt={`Media ${i+1}`} />}
                            {form.mediaTab === 'video'  && <video src={src} controls playsInline />}
                            {form.mediaTab === 'audio'  && <audio src={src} controls />}
                          </div>
                        ))}
                      </div>
                    </div>
                    <button
                      className="pjw-edit-btn"
                      type="button"
                      onClick={() => set({ step:1 })}
                      aria-label={t('postJob.editMedia')}
                    >
                      Edit
                    </button>
                  </div>
                )}

                {/* Terms */}
                <div className="pjw-terms-row">
                  <input type="checkbox" id="pjw-terms" checked={form.termsAccepted} onChange={e => set({ termsAccepted: e.target.checked })} />
                  <label className="pjw-terms-label" htmlFor="pjw-terms">
                    {t('postJob.termsPrefix')} <Link to="/terms">{t('postJob.termsOfService')}</Link> {t('postJob.termsAnd')} <Link to="/privacy">{t('postJob.privacyPolicy')}</Link>. {t('postJob.termsConfirm')}
                  </label>
                </div>
                {errors.terms  && <div className="pjw-field-error" style={{ marginTop:'.5rem' }}>{errors.terms}</div>}
                {errors.submit && <div className="pjw-field-error" style={{ marginTop:'.5rem' }}>{errors.submit}</div>}
              </div>
            )}

            {/* ── Form Actions ─────────────────────────────────────────── */}
            <div className="pjw-form-actions">
              <button type="button" className="pjw-btn pjw-btn-ghost"
                onClick={form.step === 1 ? () => navigate('/dashboard') : prevStep}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><polyline points="15 18 9 12 15 6"/></svg>
                {form.step === 1 ? t('postJob.cancel') : t('postJob.back')}
              </button>
              <div className="pjw-form-actions-right">
                <button type="button" className="pjw-btn pjw-btn-ghost"
                  onClick={() => api.put('/jobs/draft', { wizard_step: form.step, payload: form }).then(() => navigate('/dashboard'))}>
                  {t('postJob.saveDraft')}
                </button>
                {form.step < 4
                  ? <button type="button" className="pjw-btn pjw-btn-primary" onClick={nextStep}>
                      Next Step
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden="true"><polyline points="9 18 15 12 9 6"/></svg>
                    </button>
                  : <button type="button" className="pjw-btn pjw-btn-primary" disabled={form.submitting || !form.termsAccepted} onClick={handleSubmit}>
                      {form.submitting ? t('postJob.submitting') : 'Post Job & Invite Bids'}
                      {!form.submitting && <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden="true"><polyline points="9 18 15 12 9 6"/></svg>}
                    </button>
                }
              </div>
            </div>

          </div>{/* /steps column */}

          {/* ── Sidebar ───────────────────────────────────────────────── */}
          <aside className="pjw-sidebar" aria-label="Job posting summary">
            <div className="pjw-summary-card">
              <div className="pjw-summary-header">
                <h3>Job Summary</h3>
                <span className={`pjw-summary-status ${isReady ? 'pjw-status-ready' : 'pjw-status-draft'}`}>
                  {isReady ? t('postJob.ready') : t('postJob.draft')}
                </span>
              </div>
              <div className="pjw-summary-body">
                <div className="pjw-sum-row">
                  <span className="pjw-sum-label">{t('postJob.jobDetailsTitle')}</span>
                  <span className={`pjw-sum-value${!form.title?' is-empty':''}`}>{form.title || t('postJob.notSet')}</span>
                </div>
                <div className="pjw-sum-row">
                  <span className="pjw-sum-label">{t('postJob.category')}</span>
                  <span className={`pjw-sum-value${!form.categoryName?' is-empty':''}`}>{form.categoryName || t('postJob.notSelected')}</span>
                </div>
                <div className="pjw-sum-row">
                  <span className="pjw-sum-label">{t('postJob.location')}</span>
                  <span className={`pjw-sum-value${!locationDisplay ? ' is-empty' : ''}`}>{locationDisplay || t('postJob.notSet')}</span>
                </div>
                <div className="pjw-sum-row">
                  <span className="pjw-sum-label">{t('postJob.budgetType')}</span>
                  <span className="pjw-sum-value">{formatBudgetDisplay(form, currency, t)}</span>
                </div>
                <div className="pjw-sum-row">
                  <span className="pjw-sum-label">{t('postJob.requirements')}</span>
                  <div className="pjw-sum-reqs">
                    {activeReqs.length === 0
                      ? <span className="pjw-sum-badge is-empty">{t('postJob.notSelected')}</span>
                      : activeReqs.map(k => <span key={k} className="pjw-sum-badge">{t(`postJob.${REQ_META[k].key}`)}</span>)
                    }
                  </div>
                </div>
              </div>
              <div className="pjw-summary-footer">
                <p className="pjw-summary-note">
                  Helpers must confirm <strong>{activeReqs.length}</strong> requirement{activeReqs.length !== 1 ? 's' : ''} before they can bid on this job.
                </p>
                <button type="button" className="pjw-btn pjw-btn-primary pjw-btn-full"
                  onClick={form.step === 4 ? handleSubmit : () => { setErrors({}); set({ step: 4 }); }}
                  disabled={form.submitting}>
                  {form.submitting ? t('postJob.submitting') : t('postJob.submitJob')}
                  {!form.submitting && <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden="true"><polyline points="9 18 15 12 9 6"/></svg>}
                </button>
                <button type="button" className="pjw-btn pjw-btn-secondary pjw-btn-full"
                  style={{ fontSize:'.8rem' }}
                  onClick={() => api.put('/jobs/draft', { wizard_step: form.step, payload: form })}>
                  {t('postJob.saveDraft')}
                </button>
                {form.draftSaving && <p className="pjw-draft-saving">{t('postJob.savingDraft')}</p>}
              </div>
            </div>

            <div className="pjw-side-note-card">
              <div className="pjw-side-note-kicker">Before you post</div>
              <h4>Make the job easier to price.</h4>
              <ul className="pjw-side-note-list">
                <li>Include exact problem details, not just the category.</li>
                <li>Add preferred dates if access depends on your schedule.</li>
                <li>List any special tools, permits, or materials helpers should expect.</li>
              </ul>
            </div>

            <div className="pjw-side-note-card">
              <div className="pjw-side-note-kicker">What happens next</div>
              <p className="pjw-side-note-copy">
                Once your job is live, helpers who match the location, category, and requirements can send bids. You can compare offers, ask follow-up questions, and hire when you are ready.
              </p>
            </div>
          </aside>

          </div>{/* /two-col */}
        </main>

        {/* ── Live Capture Modal ───────────────────────────────────────────── */}
        {liveCapture && (
          <LiveCaptureModal
            mode={liveCapture}
            onCapture={file => handleMediaFiles([file])}
            onClose={() => setLiveCapture(null)}
          />
        )}

        {/* ── Success Overlay ──────────────────────────────────────────────── */}
        {form.submitted && form.submittedJob && (
          <div
            ref={successModalRef}
            className="pjw-overlay"
            role="dialog"
            aria-modal="true"
            aria-labelledby="pjw-success-title"
          >
            <div className="pjw-success-card">
              <div className="pjw-success-icon" aria-hidden="true">
                <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="20 6 9 17 4 12"/></svg>
              </div>
              <h2 className="pjw-success-title" id="pjw-success-title">{t('postJob.jobPostedSuccess')}</h2>
              <p className="pjw-success-sub">
                {t('postJob.jobLiveMessage', { city: form.locationCity?.trim() || t('postJob.yourArea') })}
              </p>
              <div className="pjw-job-id">
                JOB-{String(form.submittedJob.id || '').toUpperCase().slice(0, 8)}
              </div>
              <div className="pjw-success-actions">
                <button
                  type="button"
                  className="pjw-btn pjw-btn-primary pjw-btn-full"
                  onClick={() => navigate('/dashboard')}
                  aria-label={t('postJob.viewMyJobsAriaLabel')}
                >
                  {t('postJob.viewMyJobs')}
                </button>
                <button
                  type="button"
                  className="pjw-btn pjw-btn-secondary pjw-btn-full"
                  onClick={() => { setForm(INIT); setErrors({}); }}
                  aria-label={t('postJob.postAnotherJobAriaLabel')}
                >
                  {t('postJob.postAnotherJob')}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </PageShell>
  );
}
