import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate, useSearchParams, Link } from 'react-router-dom';
import useJobs from '../hooks/useJobs';
import useAuth from '../hooks/useAuth';
import api from '../api/axios';
import '../styles/PostJobPage.css';
import PageMeta from '../components/PageMeta';

// ─── Category taxonomy ───────────────────────────────────────────────────────
const CATEGORIES = [
  { group: 'Electrical', options: [
    { id: 'electrical-full',      name: 'Electrical — Full Rewire',       suggested: ['license','insurance','skillLevel','backgroundCheck'], defaults: { licenseType:'oh-electrician', minCoverage:'1m', minLevel:'advanced' } },
    { id: 'electrical-repair',    name: 'Electrical — Repair / Panel',    suggested: ['license','insurance','skillLevel'],                    defaults: { licenseType:'oh-electrician', minCoverage:'1m', minLevel:'advanced' } },
    { id: 'electrical-install',   name: 'Electrical — Installation',      suggested: ['license','insurance'],                                defaults: { licenseType:'oh-electrician', minCoverage:'1m' } },
    { id: 'electrical-ev',        name: 'Electrical — EV Charger',        suggested: ['license','insurance'],                                defaults: { licenseType:'oh-electrician', minCoverage:'1m' } },
    { id: 'electrical-solar',     name: 'Electrical — Solar Panels',      suggested: ['license','insurance','skillLevel'],                    defaults: { licenseType:'oh-electrician', minCoverage:'2m', minLevel:'advanced' } },
    { id: 'electrical-generator', name: 'Electrical — Generator Install', suggested: ['license','insurance'],                                defaults: { licenseType:'oh-electrician', minCoverage:'1m' } },
  ]},
  { group: 'Plumbing', options: [
    { id: 'plumbing-general',  name: 'Plumbing — General',          suggested: ['license','insurance'], defaults: { licenseType:'oh-plumber', minCoverage:'1m' } },
    { id: 'plumbing-drain',    name: 'Plumbing — Drain / Sewer',    suggested: ['license','insurance'], defaults: { licenseType:'oh-plumber', minCoverage:'1m' } },
    { id: 'plumbing-heater',   name: 'Plumbing — Water Heater',     suggested: ['license','insurance'], defaults: { licenseType:'oh-plumber', minCoverage:'1m' } },
    { id: 'plumbing-fixture',  name: 'Plumbing — Fixture Install',  suggested: ['license','insurance'], defaults: { licenseType:'oh-plumber', minCoverage:'500k' } },
    { id: 'plumbing-remodel',  name: 'Plumbing — Bathroom Remodel', suggested: ['license','insurance','skillLevel'], defaults: { licenseType:'oh-plumber', minCoverage:'1m', minLevel:'advanced' } },
  ]},
  { group: 'HVAC', options: [
    { id: 'hvac-install',    name: 'HVAC — Full System Install', suggested: ['license','insurance','ownTools'], defaults: { licenseType:'oh-hvac', minCoverage:'1m' } },
    { id: 'hvac-repair',     name: 'HVAC — Repair / Service',    suggested: ['license','insurance'],           defaults: { licenseType:'oh-hvac', minCoverage:'1m' } },
    { id: 'hvac-duct',       name: 'HVAC — Duct Work',           suggested: ['license','insurance'],           defaults: { licenseType:'oh-hvac', minCoverage:'500k' } },
    { id: 'hvac-minisplit',  name: 'HVAC — Mini-Split Install',  suggested: ['license','insurance'],           defaults: { licenseType:'oh-hvac', minCoverage:'1m' } },
  ]},
  { group: 'Construction', options: [
    { id: 'roofing',        name: 'Roofing',                  suggested: ['insurance','skillLevel'],       defaults: { minCoverage:'1m', minLevel:'intermediate' } },
    { id: 'roofing-repair', name: 'Roofing — Repair',         suggested: ['insurance'],                    defaults: { minCoverage:'500k' } },
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
    { id: 'painting-interior', name: 'Painting — Interior',    suggested: [],                       defaults: {} },
    { id: 'painting-exterior', name: 'Painting — Exterior',    suggested: ['insurance'],            defaults: { minCoverage:'300k' } },
    { id: 'flooring-hardwood', name: 'Flooring — Hardwood',    suggested: ['skillLevel','ownTools'],defaults: { minLevel:'intermediate' } },
    { id: 'flooring-tile',     name: 'Flooring — Tile',        suggested: ['skillLevel','ownTools'],defaults: { minLevel:'intermediate' } },
    { id: 'flooring-carpet',   name: 'Flooring — Carpet',      suggested: ['skillLevel'],           defaults: { minLevel:'beginner' } },
    { id: 'carpentry-trim',    name: 'Carpentry — Trim',        suggested: ['skillLevel','ownTools'],defaults: { minLevel:'intermediate' } },
    { id: 'carpentry-cabinets',name: 'Carpentry — Cabinets',    suggested: ['skillLevel','ownTools'],defaults: { minLevel:'advanced' } },
    { id: 'carpentry-custom',  name: 'Carpentry — Custom',      suggested: ['skillLevel','ownTools'],defaults: { minLevel:'advanced' } },
    { id: 'tile-backsplash',   name: 'Tile — Backsplash',       suggested: ['skillLevel'],           defaults: { minLevel:'intermediate' } },
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
    { id: 'moving-local',  name: 'Moving — Local',          suggested: ['crewSize'],                    defaults: { minCrew:2 } },
    { id: 'moving-long',   name: 'Moving — Long Distance',  suggested: ['license','insurance','crewSize'], defaults: { licenseType:'other', minCoverage:'500k', minCrew:2 } },
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
  fixed:  { min: 50,  max: 50000, step: 50,  defaultVal: 800,  labelMin: '$50',   labelMax: '$50,000', fmt: v => `$${Number(v).toLocaleString()} fixed` },
  hourly: { min: 15,  max: 500,   step: 5,   defaultVal: 45,   labelMin: '$15/hr',labelMax: '$500/hr', fmt: v => `$${v}/hr` },
  open:   { min: 0,   max: 0,     step: 0,   defaultVal: 0,    labelMin: '',      labelMax: '',        fmt: () => 'Open to bids' },
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
function CategorySelect({ value, onChange, error }) {
  const [open, setOpen]         = React.useState(false);
  const [search, setSearch]     = React.useState('');
  const [activeIdx, setActiveIdx] = React.useState(-1);
  const wrapRef  = React.useRef(null);
  const inputRef = React.useRef(null);
  const listRef  = React.useRef(null);

  const allFlat = CATEGORIES.flatMap(g => g.options);

  const filtered = React.useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return CATEGORIES;
    return CATEGORIES
      .map(g => ({
        ...g,
        options: g.options.filter(
          o => o.name.toLowerCase().includes(q) || g.group.toLowerCase().includes(q)
        ),
      }))
      .filter(g => g.options.length > 0);
  }, [search]);

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
    onChange(opt.id, opt.name);
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
        aria-label={selectedOpt ? selectedOpt.name : 'Select a category'}
      >
        {selectedOpt
          ? <span className="pjw-cat-value">{selectedOpt.name}</span>
          : <span className="pjw-cat-placeholder">Select a category…</span>
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
              placeholder="Search categories…"
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
                  <li className="pjw-cat-group-label" role="presentation">{g.group}</li>
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
                        {opt.name}
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
const REQ_META = {
  license:         { label: 'License',          desc: 'State-issued trade license required' },
  insurance:       { label: 'Insurance',         desc: 'Active liability coverage (COI)' },
  skillLevel:      { label: 'Skill Level',       desc: 'Minimum experience required' },
  ownTools:        { label: 'Own Tools',          desc: 'Must bring their own equipment' },
  crewSize:        { label: 'Crew Size',          desc: 'Minimum helpers needed on-site' },
  backgroundCheck: { label: 'Background Check',  desc: 'Verified ID on OxSteed' },
};

const STEP_LABELS = ['Job Details', 'Requirements', 'Budget & Timeline', 'Review & Post'];

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
  locationInput: '', locationCity: '', locationState: '', locationZip: '',
  locationLat: null, locationLng: null,
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
  categorySuggestion: null,
  budgetType: 'open', budgetAmount: 800, budgetAmountHourly: 45,
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

function formatBudgetDisplay(form) {
  if (form.budgetType === 'open') return 'Open to bids';
  if (form.budgetType === 'hourly') return `$${form.budgetAmountHourly}/hr`;
  return `$${Number(form.budgetAmount).toLocaleString()} fixed`;
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

// ─── Main component ──────────────────────────────────────────────────────────
export default function PostJobPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { user }  = useAuth();
  const { createJob } = useJobs();

  // Pre-selected helper from "Book Now" on a helper profile page
  const directHelperId   = searchParams.get('helperId')   || '';
  const directHelperName = searchParams.get('helperName') || '';

  const [form, setForm]     = useState(INIT);
  const [errors, setErrors] = useState({});

  const photoInputRef       = useRef(null);
  const videoInputRef       = useRef(null);
  const audioInputRef       = useRef(null);
  const draftTimer          = useRef(null);

  const [liveCapture, setLiveCapture] = useState(null); // 'photo' | 'video' | 'audio' | null

  const set = useCallback((patch) => setForm(f => ({ ...f, ...patch })), []);
  const setReq = useCallback((key, patch) =>
    setForm(f => ({ ...f, requirements: { ...f.requirements, [key]: { ...f.requirements[key], ...patch } } })),
  []);

  // ── Load draft on mount ───────────────────────────────────────────────────
  useEffect(() => {
    api.get('/jobs/draft').then(({ data }) => {
      if (!data) return;
      const p = data.payload || {};
      setForm(f => ({ ...f, ...p, step: 1, draftId: data.id }));
    }).catch(() => {});
  }, []);

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
  }, [form.title, form.categoryId, form.description, form.locationInput,
      form.requirements, form.budgetType, form.budgetAmount, form.budgetAmountHourly,
      form.urgency, form.notes, form.step]);

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

  // ── Location geocode (on blur) ────────────────────────────────────────────
  async function handleLocationBlur() {
    const q = form.locationInput.trim();
    if (!q) return;
    set({ geocoding: true });
    try {
      const { data } = await api.get(`/geo/suggest?q=${encodeURIComponent(q)}`);
      if (data && data.length > 0) {
        const hit = data[0];
        set({
          locationCity:  hit.city  || '',
          locationState: hit.state || '',
          locationZip:   hit.zip   || '',
          locationLat:   hit.lat   || null,
          locationLng:   hit.lng   || null,
          locationInput: hit.display || q,
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
      if (!form.title.trim() || form.title.trim().length < 10)    errs.title       = 'Title must be at least 10 characters';
      if (!form.categoryId)                                        errs.categoryId  = 'Please select a category';
      if (!form.description.trim() || form.description.trim().length < 50) errs.description = 'Description must be at least 50 characters';
      if (!form.locationInput.trim())                              errs.location    = 'Please enter a location';
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
      // category_id is a DB integer FK — frontend uses string slugs, so only send category_name
      fd.append('category_name', form.categoryName || form.categoryId);
      fd.append('description',   form.description.trim());
      fd.append('location_city', form.locationCity || form.locationInput.split(',')[0]?.trim() || '');
      fd.append('location_state',form.locationState);
      fd.append('location_zip',  form.locationZip);
      if (form.locationLat) fd.append('location_lat', form.locationLat);
      if (form.locationLng) fd.append('location_lng', form.locationLng);
      fd.append('site_access',   form.siteAccess);
      fd.append('job_type_label',form.jobType);
      fd.append('budget_type',   form.budgetType);
      if (form.budgetType === 'fixed')  { fd.append('budget_min', form.budgetAmount); fd.append('budget_max', form.budgetAmount); }
      if (form.budgetType === 'hourly') { fd.append('budget_min', form.budgetAmountHourly); }
      fd.append('urgency',       form.urgency);
      fd.append('notes',         form.notes);
      fd.append('requirements',  JSON.stringify(
        Object.entries(form.requirements)
          .filter(([,v]) => v.enabled)
          .map(([type, v]) => ({ type, required: true, detail: v }))
      ));
      form.mediaFiles.forEach(f => fd.append('media', f));
      if (directHelperId) fd.append('preferred_helper_id', directHelperId);

      const job = await createJob(fd);

      // Clear draft
      api.delete('/jobs/draft').catch(() => {});
      set({ submitted: true, submittedJob: job });
    } catch (err) {
      const msg = err?.response?.data?.error || 'Failed to post job. Please try again.';
      setErrors({ submit: msg });
    } finally {
      set({ submitting: false });
    }
  }

  // ── Sidebar summary ───────────────────────────────────────────────────────
  const isReady = !!(form.title.trim().length >= 10 && form.categoryId && form.locationInput.trim());
  const activeReqs = activeRequirements(form.requirements);

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="pjw-root">
      <PageMeta
        title="Post a Job"
        description="Describe what you need done and get competitive bids from trusted local helpers within hours. Free to post."
        url="https://oxsteed.com/post-job"
        noIndex={true}
      />
      {/* ── Nav ─────────────────────────────────────────────────────────── */}
      <nav className="pjw-nav" aria-label="Main navigation">
        <Link to="/" className="pjw-nav-logo">
          <OxSteedIcon size={26} />
          OxSteed
        </Link>
        <div className="pjw-nav-actions">
          <Link to="/jobs"      className="pjw-nav-link">Browse Jobs</Link>
          <Link to="/dashboard" className="pjw-nav-link">My Posts</Link>
        </div>
      </nav>

      <main className="pjw-main-wrap">

        {/* ── Page header ────────────────────────────────────────────────── */}
        <header>
          <nav className="pjw-breadcrumb" aria-label="Breadcrumb">
            <Link to="/">Home</Link><span>›</span>
            <Link to="/jobs">Jobs</Link><span>›</span>
            <span aria-current="page">Post a Job</span>
          </nav>
          <h1 className="pjw-page-title">Post a Job</h1>
          <p className="pjw-page-sub">Describe what needs doing and set your own requirements. Helpers who meet your bar will bid.</p>
          {directHelperId && (
            <div style={{ display:'flex', alignItems:'center', gap:'10px', marginTop:'12px', padding:'12px 16px', background:'rgba(249,115,22,0.08)', border:'1px solid rgba(249,115,22,0.25)', borderRadius:'12px', fontSize:'13px', color:'#fb923c' }}>
              <span>⚡</span>
              <span>Direct request to <strong style={{ color:'#fff' }}>{directHelperName || 'this helper'}</strong> — they'll be notified when your job is posted.</span>
              <a href={`/helpers/${directHelperId}`} style={{ marginLeft:'auto', color:'#fb923c', textDecoration:'underline', whiteSpace:'nowrap' }}>View profile</a>
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

        <div className="pjw-two-col">
          {/* ── Steps column ──────────────────────────────────────────────── */}
          <div>

            {/* ═══ STEP 1 — Job Details ═════════════════════════════════ */}
            {form.step === 1 && (
              <div className="pjw-card">
                <div className="pjw-section-label">
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden="true"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
                  Step 1 of 4 — Job Details
                </div>

                {/* Title */}
                <div className="pjw-field">
                  <label htmlFor="pjw-title">Job Title <span className="req">*</span></label>
                  <input
                    id="pjw-title" type="text" className={`pjw-input${errors.title?' has-error':''}`}
                    placeholder="e.g. Full kitchen rewire — breakers keep tripping"
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
                  />
                  {errors.categoryId && <div className="pjw-field-error">{errors.categoryId}</div>}
                </div>

                {/* Description */}
                <div className="pjw-field">
                  <label htmlFor="pjw-desc">
                    Describe the Work <span className="req">*</span>
                    <span className="hint">Be specific — what's broken, what outcome you want</span>
                  </label>
                  <textarea
                    id="pjw-desc" className={`pjw-textarea${errors.description?' has-error':''}`}
                    rows={5} maxLength={1000}
                    placeholder="e.g. Kitchen keeps tripping the 20A breaker. Need a licensed electrician to inspect the panel, replace outdated wiring in the kitchen circuit, and install 2 new dedicated circuits for appliances."
                    value={form.description}
                    onChange={e => set({ description: e.target.value })}
                  />
                  <div className="pjw-char-count">{form.description.length}/1000</div>
                  {errors.description && <div className="pjw-field-error">{errors.description}</div>}
                </div>

                {/* Location + Site Access */}
                <div className="pjw-field-row">
                  <div className="pjw-field" style={{ marginBottom: 0 }}>
                    <label htmlFor="pjw-location">Location <span className="req">*</span></label>
                    <div className="pjw-location-wrap">
                      <input
                        id="pjw-location" type="text"
                        className={`pjw-input${errors.location?' has-error':''}`}
                        placeholder="Springfield, OH"
                        value={form.locationInput}
                        onChange={e => set({ locationInput: e.target.value })}
                        onBlur={handleLocationBlur}
                      />
                      {form.geocoding && <div className="pjw-geocoding-spinner" aria-label="Locating…" />}
                    </div>
                    {errors.location && <div className="pjw-field-error">{errors.location}</div>}
                  </div>
                  <div className="pjw-field" style={{ marginBottom: 0 }}>
                    <label htmlFor="pjw-access">Site Access</label>
                    <select id="pjw-access" className="pjw-select" value={form.siteAccess} onChange={e => set({ siteAccess: e.target.value })}>
                      <option value="easy">Easy — I'll be home</option>
                      <option value="lockbox">Lockbox available</option>
                      <option value="schedule">Must schedule access</option>
                    </select>
                  </div>
                </div>

                {/* Job Type */}
                <div className="pjw-field" style={{ marginTop: '1.25rem' }}>
                  <label htmlFor="pjw-jobtype">Job Type</label>
                  <select id="pjw-jobtype" className="pjw-select" value={form.jobType} onChange={e => set({ jobType: e.target.value })}>
                    <option value="one_time">One-Time</option>
                    <option value="recurring">Recurring</option>
                  </select>
                </div>

                {/* Media Upload */}
                <div className="pjw-field">
                  <label>Add Photos, Video, or Audio <span className="hint">Optional</span></label>
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

                  {/* Hidden file inputs — upload */}
                  <input ref={photoInputRef}  type="file" accept="image/*"       multiple style={{ display:'none' }} onChange={e => handleMediaFiles(e.target.files)} />
                  <input ref={videoInputRef}  type="file" accept="video/*"                style={{ display:'none' }} onChange={e => handleMediaFiles(e.target.files)} />
                  <input ref={audioInputRef}  type="file" accept="audio/*"                style={{ display:'none' }} onChange={e => handleMediaFiles(e.target.files)} />

                  {/* Live capture buttons — use real getUserMedia */}
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

            {/* ═══ STEP 2 — Requirements ════════════════════════════════ */}
            {form.step === 2 && (
              <div className="pjw-card">
                <div className="pjw-section-label">
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden="true"><path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/></svg>
                  Step 2 of 4 — Your Requirements
                </div>
                <p className="pjw-section-desc">Select what you require from any helper who bids. Requirements are self-confirmed by helpers — flagged warnings appear if credentials can't be verified.</p>

                {/* Info callout */}
                <div className="pjw-callout" role="note">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden="true"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
                  <p><strong>License &amp; insurance</strong> — when a helper provides credentials, OxSteed will attempt to verify them. All other requirements are <strong>self-confirmed</strong> by the helper before bidding.</p>
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
                        <div><div className="pjw-req-name">License</div><div className="pjw-req-desc">State-issued trade license required</div></div>
                      </div>
                      <div className="pjw-req-check" aria-hidden="true">{form.requirements.license.enabled && <CheckIcon/>}</div>
                    </div>
                    <div className={`pjw-req-detail${form.requirements.license.enabled?' is-open':''}`} aria-hidden={!form.requirements.license.enabled}>
                      <label>License type required</label>
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
                        <div><div className="pjw-req-name">Insurance</div><div className="pjw-req-desc">Active liability coverage (COI)</div></div>
                      </div>
                      <div className="pjw-req-check" aria-hidden="true">{form.requirements.insurance.enabled && <CheckIcon/>}</div>
                    </div>
                    <div className={`pjw-req-detail${form.requirements.insurance.enabled?' is-open':''}`} aria-hidden={!form.requirements.insurance.enabled}>
                      <label>Minimum coverage amount</label>
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
                        <div><div className="pjw-req-name">Skill Level</div><div className="pjw-req-desc">Minimum experience required</div></div>
                      </div>
                      <div className="pjw-req-check" aria-hidden="true">{form.requirements.skillLevel.enabled && <CheckIcon/>}</div>
                    </div>
                    <div className={`pjw-req-detail${form.requirements.skillLevel.enabled?' is-open':''}`} aria-hidden={!form.requirements.skillLevel.enabled}>
                      <label>Minimum skill level</label>
                      <select className="pjw-select" value={form.requirements.skillLevel.minLevel} onClick={e=>e.stopPropagation()} onChange={e=>setReq('skillLevel',{minLevel:e.target.value})}>
                        <option value="beginner">Beginner — basic tasks</option>
                        <option value="intermediate">Intermediate — 2+ years</option>
                        <option value="advanced">Advanced — 5+ years</option>
                        <option value="expert">Expert / Master level</option>
                      </select>
                    </div>
                  </div>

                  {/* Own Tools */}
                  <div className={`pjw-req-toggle${form.requirements.ownTools.enabled?' is-selected':''}`} onClick={() => setReq('ownTools',{ enabled:!form.requirements.ownTools.enabled })} role="checkbox" aria-checked={form.requirements.ownTools.enabled} tabIndex={0} onKeyDown={e=>e.key===' '&&setReq('ownTools',{enabled:!form.requirements.ownTools.enabled})}>
                    <div className="pjw-req-header">
                      <div style={{display:'flex',alignItems:'flex-start',gap:'.5rem'}}>
                        <svg className="pjw-req-icon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/></svg>
                        <div><div className="pjw-req-name">Own Tools</div><div className="pjw-req-desc">Must bring their own equipment</div></div>
                      </div>
                      <div className="pjw-req-check" aria-hidden="true">{form.requirements.ownTools.enabled && <CheckIcon/>}</div>
                    </div>
                    <div className={`pjw-req-detail${form.requirements.ownTools.enabled?' is-open':''}`} aria-hidden={!form.requirements.ownTools.enabled}>
                      <label>Specific tools needed <span style={{fontWeight:400}}>(optional)</span></label>
                      <input className="pjw-input" type="text" placeholder="e.g. Wire tester, fish tape, panel tools" value={form.requirements.ownTools.toolList} onClick={e=>e.stopPropagation()} onChange={e=>setReq('ownTools',{toolList:e.target.value})} />
                    </div>
                  </div>

                  {/* Crew Size */}
                  <div className={`pjw-req-toggle${form.requirements.crewSize.enabled?' is-selected':''}`} onClick={() => setReq('crewSize',{ enabled:!form.requirements.crewSize.enabled })} role="checkbox" aria-checked={form.requirements.crewSize.enabled} tabIndex={0} onKeyDown={e=>e.key===' '&&setReq('crewSize',{enabled:!form.requirements.crewSize.enabled})}>
                    <div className="pjw-req-header">
                      <div style={{display:'flex',alignItems:'flex-start',gap:'.5rem'}}>
                        <svg className="pjw-req-icon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>
                        <div><div className="pjw-req-name">Crew Size</div><div className="pjw-req-desc">Minimum helpers needed on-site</div></div>
                      </div>
                      <div className="pjw-req-check" aria-hidden="true">{form.requirements.crewSize.enabled && <CheckIcon/>}</div>
                    </div>
                    <div className={`pjw-req-detail${form.requirements.crewSize.enabled?' is-open':''}`} aria-hidden={!form.requirements.crewSize.enabled}>
                      <label>Minimum crew size</label>
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
                        <div><div className="pjw-req-name">Background Check</div><div className="pjw-req-desc">Verified ID on OxSteed</div></div>
                      </div>
                      <div className="pjw-req-check" aria-hidden="true">{form.requirements.backgroundCheck.enabled && <CheckIcon/>}</div>
                    </div>
                  </div>

                </div>{/* /req-grid */}

                {/* Warning if requirements narrow the field */}
                {activeReqs.length >= 3 && (
                  <div className="pjw-req-warning" role="note">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden="true"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
                    <span>Strict requirements may limit the number of helpers who can bid. You can still adjust after posting.</span>
                  </div>
                )}
              </div>
            )}

            {/* ═══ STEP 3 — Budget & Timeline ══════════════════════════ */}
            {form.step === 3 && (
              <div className="pjw-card">
                <div className="pjw-section-label">
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden="true"><line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg>
                  Step 3 of 4 — Budget &amp; Timeline
                </div>

                {/* Budget type tabs */}
                <div className="pjw-budget-tabs" role="group" aria-label="Budget type">
                  {['fixed','hourly','open'].map(t => (
                    <button key={t} type="button" className={`pjw-tab-btn${form.budgetType===t?' is-active':''}`}
                      onClick={() => set({ budgetType: t })}>
                      {t === 'fixed' ? 'Fixed Price' : t === 'hourly' ? 'Hourly Rate' : 'Open to Bids'}
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
                      <label>Your Budget <span className="req">*</span></label>
                      <div className="pjw-budget-row">
                        <div className="pjw-budget-display">{cfg.fmt(val)}</div>
                        <input type="range" className="pjw-slider"
                          min={cfg.min} max={cfg.max} step={cfg.step} value={val}
                          style={{ '--range-pct': `${pct}%` }}
                          aria-label="Budget amount"
                          onChange={e => {
                            const n = Number(e.target.value);
                            if (form.budgetType === 'hourly') set({ budgetAmountHourly: n });
                            else set({ budgetAmount: n });
                          }}
                        />
                      </div>
                      <div className="pjw-budget-range-labels"><span>{cfg.labelMin}</span><span>{cfg.labelMax}</span></div>
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
                  <label>Urgency</label>
                  <div className="pjw-pill-group" role="group" aria-label="Job urgency">
                    {[['asap','ASAP'],['this_week','This week'],['next_week','Next week'],['flexible','Flexible']].map(([val,label]) => (
                      <button key={val} type="button"
                        className={`pjw-pill${form.urgency===val?' is-active':''}`}
                        onClick={() => set({ urgency: val })}
                        aria-pressed={form.urgency===val}>
                        {label}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Additional notes */}
                <div className="pjw-field" style={{ marginBottom: 0 }}>
                  <label htmlFor="pjw-notes">Additional Notes <span className="hint">Optional</span></label>
                  <textarea id="pjw-notes" className="pjw-textarea" rows={3}
                    placeholder="Parking, access instructions, existing quotes, anything a helper should know…"
                    value={form.notes} onChange={e => set({ notes: e.target.value })} />
                </div>
              </div>
            )}

            {/* ═══ STEP 4 — Review & Post ══════════════════════════════ */}
            {form.step === 4 && (
              <div className="pjw-card">
                <div className="pjw-section-label">
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden="true"><path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/></svg>
                  Step 4 of 4 — Review &amp; Post
                </div>
                <p className="pjw-section-desc">Check everything looks right before going live.</p>

                {/* Job Details review */}
                <div className="pjw-review-row">
                  <span className="pjw-review-label">Title</span>
                  <span className={`pjw-review-value${!form.title?' is-empty':''}`}>{form.title || 'Not set'}</span>
                  <button className="pjw-edit-btn" type="button" onClick={() => set({ step:1 })}>Edit</button>
                </div>
                <div className="pjw-review-row">
                  <span className="pjw-review-label">Category</span>
                  <span className={`pjw-review-value${!form.categoryName?' is-empty':''}`}>{form.categoryName || 'Not selected'}</span>
                  <button className="pjw-edit-btn" type="button" onClick={() => set({ step:1 })}>Edit</button>
                </div>
                <div className="pjw-review-row">
                  <span className="pjw-review-label">Location</span>
                  <span className={`pjw-review-value${!form.locationInput?' is-empty':''}`}>{form.locationInput || 'Not set'}</span>
                  <button className="pjw-edit-btn" type="button" onClick={() => set({ step:1 })}>Edit</button>
                </div>
                <div className="pjw-review-row">
                  <span className="pjw-review-label">Site Access</span>
                  <span className="pjw-review-value">{{ easy:"I'll be home", lockbox:'Lockbox available', schedule:'Must schedule access' }[form.siteAccess]}</span>
                  <button className="pjw-edit-btn" type="button" onClick={() => set({ step:1 })}>Edit</button>
                </div>
                <div className="pjw-review-row">
                  <span className="pjw-review-label">Job Type</span>
                  <span className="pjw-review-value">{{ one_time:'One-Time', recurring:'Recurring' }[form.jobType]}</span>
                  <button className="pjw-edit-btn" type="button" onClick={() => set({ step:1 })}>Edit</button>
                </div>
                <div className="pjw-review-row">
                  <span className="pjw-review-label">Description</span>
                  <span className="pjw-review-value" style={{ maxWidth:'360px', whiteSpace:'pre-wrap', wordBreak:'break-word' }}>{form.description || <em style={{color:'var(--pjw-text-faint)'}}>Not set</em>}</span>
                  <button className="pjw-edit-btn" type="button" onClick={() => set({ step:1 })}>Edit</button>
                </div>

                <div className="pjw-hr" />

                {/* Requirements review */}
                <div className="pjw-review-row">
                  <span className="pjw-review-label">Requirements</span>
                  <div className="pjw-review-value">
                    {activeReqs.length === 0
                      ? <span style={{color:'var(--pjw-text-faint)',fontStyle:'italic'}}>None selected</span>
                      : <div className="pjw-req-badges">{activeReqs.map(k => <span key={k} className="pjw-req-badge">{REQ_META[k].label}</span>)}</div>
                    }
                  </div>
                  <button className="pjw-edit-btn" type="button" onClick={() => set({ step:2 })}>Edit</button>
                </div>

                <div className="pjw-hr" />

                {/* Budget review */}
                <div className="pjw-review-row">
                  <span className="pjw-review-label">Budget</span>
                  <span className="pjw-review-value">{formatBudgetDisplay(form)}</span>
                  <button className="pjw-edit-btn" type="button" onClick={() => set({ step:3 })}>Edit</button>
                </div>
                <div className="pjw-review-row">
                  <span className="pjw-review-label">Urgency</span>
                  <span className="pjw-review-value">{{ asap:'ASAP', this_week:'This week', next_week:'Next week', flexible:'Flexible' }[form.urgency]}</span>
                  <button className="pjw-edit-btn" type="button" onClick={() => set({ step:3 })}>Edit</button>
                </div>
                {form.notes && (
                  <div className="pjw-review-row">
                    <span className="pjw-review-label">Notes</span>
                    <span className="pjw-review-value" style={{ maxWidth:'360px' }}>{form.notes}</span>
                    <button className="pjw-edit-btn" type="button" onClick={() => set({ step:3 })}>Edit</button>
                  </div>
                )}

                {/* Media review */}
                {form.mediaPreviews.length > 0 && (
                  <div className="pjw-review-row">
                    <span className="pjw-review-label">Media</span>
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
                    <button className="pjw-edit-btn" type="button" onClick={() => set({ step:1 })}>Edit</button>
                  </div>
                )}

                {/* Terms */}
                <div className="pjw-terms-row">
                  <input type="checkbox" id="pjw-terms" checked={form.termsAccepted} onChange={e => set({ termsAccepted: e.target.checked })} />
                  <label className="pjw-terms-label" htmlFor="pjw-terms">
                    I agree to OxSteed's <Link to="/terms">Terms of Service</Link> and <Link to="/privacy">Privacy Policy</Link>. I confirm that the information provided is accurate and I am authorised to post this job.
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
                {form.step === 1 ? 'Cancel' : 'Back'}
              </button>
              <div className="pjw-form-actions-right">
                <button type="button" className="pjw-btn pjw-btn-ghost"
                  onClick={() => api.put('/jobs/draft', { wizard_step: form.step, payload: form }).then(() => navigate('/dashboard'))}>
                  Save Draft
                </button>
                {form.step < 4
                  ? <button type="button" className="pjw-btn pjw-btn-primary" onClick={nextStep}>
                      Next Step
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden="true"><polyline points="9 18 15 12 9 6"/></svg>
                    </button>
                  : <button type="button" className="pjw-btn pjw-btn-primary" disabled={form.submitting || !form.termsAccepted} onClick={handleSubmit}>
                      {form.submitting ? 'Posting…' : 'Post Job & Invite Bids'}
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
                  {isReady ? 'Ready' : 'Draft'}
                </span>
              </div>
              <div className="pjw-summary-body">
                <div className="pjw-sum-row">
                  <span className="pjw-sum-label">Title</span>
                  <span className={`pjw-sum-value${!form.title?' is-empty':''}`}>{form.title || 'Not set yet'}</span>
                </div>
                <div className="pjw-sum-row">
                  <span className="pjw-sum-label">Category</span>
                  <span className={`pjw-sum-value${!form.categoryName?' is-empty':''}`}>{form.categoryName || 'Not selected'}</span>
                </div>
                <div className="pjw-sum-row">
                  <span className="pjw-sum-label">Location</span>
                  <span className={`pjw-sum-value${!form.locationInput?' is-empty':''}`}>{form.locationInput || 'Not set'}</span>
                </div>
                <div className="pjw-sum-row">
                  <span className="pjw-sum-label">Budget</span>
                  <span className="pjw-sum-value">{formatBudgetDisplay(form)}</span>
                </div>
                <div className="pjw-sum-row">
                  <span className="pjw-sum-label">Requirements</span>
                  <div className="pjw-sum-reqs">
                    {activeReqs.length === 0
                      ? <span className="pjw-sum-badge is-empty">None selected</span>
                      : activeReqs.map(k => <span key={k} className="pjw-sum-badge">{REQ_META[k].label}</span>)
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
                  {form.submitting ? 'Posting…' : 'Post Job'}
                  {!form.submitting && <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden="true"><polyline points="9 18 15 12 9 6"/></svg>}
                </button>
                <button type="button" className="pjw-btn pjw-btn-secondary pjw-btn-full"
                  style={{ fontSize:'.8rem' }}
                  onClick={() => api.put('/jobs/draft', { wizard_step: form.step, payload: form })}>
                  Save as Draft
                </button>
                {form.draftSaving && <p className="pjw-draft-saving">Saving draft…</p>}
              </div>
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
        <div className="pjw-overlay" role="dialog" aria-modal="true" aria-labelledby="pjw-success-title">
          <div className="pjw-success-card">
            <div className="pjw-success-icon" aria-hidden="true">
              <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="20 6 9 17 4 12"/></svg>
            </div>
            <h2 className="pjw-success-title" id="pjw-success-title">Job Posted!</h2>
            <p className="pjw-success-sub">
              Your job is live. Qualified helpers in {form.locationCity || 'your area'} can now see it and submit bids.
            </p>
            <div className="pjw-job-id">
              JOB-{String(form.submittedJob.id || '').toUpperCase().slice(0, 8)}
            </div>
            <div className="pjw-success-actions">
              <button type="button" className="pjw-btn pjw-btn-primary pjw-btn-full"
                onClick={() => navigate(`/dashboard`)}>
                View My Jobs
              </button>
              <button type="button" className="pjw-btn pjw-btn-secondary pjw-btn-full"
                onClick={() => { setForm(INIT); setErrors({}); }}>
                Post Another Job
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}
