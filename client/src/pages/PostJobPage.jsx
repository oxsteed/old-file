import React, { useMemo, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import Navbar from '../components/Navbar';
import Footer from '../components/Footer';
import useJobs from '../hooks/useJobs';
import '../styles/PostJobPage.css';

const CATEGORIES = [
  'Handyman',
  'Plumbing',
  'Electrical',
  'Cleaning',
  'Moving',
  'Painting',
  'Landscaping',
  'Assembly',
  'Car Help',
  'Roadside Assistance',
  'Delivery',
  'Errands',
  'Other',
];

const STEPS = [
  { id: 1, label: 'Job Details', icon: '📋' },
  { id: 2, label: 'Requirements', icon: '✅' },
  { id: 3, label: 'Budget & Timeline', icon: '💰' },
  { id: 4, label: 'Review & Post', icon: '🚀' },
];

const SITE_ACCESS_OPTIONS = [
  { value: 'easy', label: "Easy — I'll be home" },
  { value: 'lockbox', label: 'Lockbox / hidden key' },
  { value: 'scheduled', label: 'Scheduled access only' },
  { value: 'other', label: 'Other — will discuss' },
];

const REQUIREMENT_CARDS = [
  { key: 'license', icon: '🪪', title: 'License', desc: 'State-issued trade license required' },
  { key: 'insurance', icon: '🛡️', title: 'Insurance', desc: 'Active liability coverage required' },
  { key: 'skillLevel', icon: '🎯', title: 'Skill Level', desc: 'Minimum experience level required' },
  { key: 'ownTools', icon: '🧰', title: 'Own Tools', desc: 'Must bring tools and equipment' },
  { key: 'crewSize', icon: '👥', title: 'Crew Size', desc: 'Minimum number of workers needed' },
  { key: 'backgroundCheck', icon: '🔍', title: 'Background Check', desc: 'Verified identity and screening preferred' },
];

const SKILL_LEVELS = ['beginner', 'intermediate', 'experienced', 'expert'];
const CREW_SIZES = [1, 2, 3, 4, 5];
const URGENCY_OPTIONS = [
  { value: 'asap', label: 'ASAP' },
  { value: 'this_week', label: 'This week' },
  { value: 'next_week', label: 'Next week' },
  { value: 'flexible', label: 'Flexible' },
];
const BUDGET_TYPES = [
  { value: 'fixed', label: 'Fixed Price' },
  { value: 'hourly', label: 'Hourly Rate' },
  { value: 'open', label: 'Open to Bids' },
];

export default function PostJobPage() {
  const navigate = useNavigate();
  const { createJob } = useJobs();
  const videoPreviewRef = useRef(null);

  const [step, setStep] = useState(1);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [mediaFiles, setMediaFiles] = useState([]);
  const [mediaType, setMediaType] = useState('photo');
  const [recording, setRecording] = useState(false);
  const [mediaRecorder, setMediaRecorder] = useState(null);
  const [showCamera, setShowCamera] = useState(false);
  const [cameraStream, setCameraStream] = useState(null);

  const [form, setForm] = useState({
    title: '',
    description: '',
    category: '',
    job_type: 'one_time',
    location_city: '',
    location_state: 'OH',
    priority: 'normal',
    site_access: 'easy',
    budget_type: 'fixed',
    budget_fixed: 800,
    budget_hourly: 50,
    urgency: 'this_week',
  });

  const [requirements, setRequirements] = useState({
    license: false,
    insurance: false,
    skillLevel: false,
    ownTools: false,
    crewSize: false,
    backgroundCheck: false,
  });

  const [skillLevelValue, setSkillLevelValue] = useState('intermediate');
  const [crewSizeValue, setCrewSizeValue] = useState(2);

  const selectedRequirements = useMemo(
    () =>
      Object.entries(requirements)
        .filter(([, value]) => value)
        .map(([key]) => REQUIREMENT_CARDS.find((card) => card.key === key)?.title)
        .filter(Boolean),
    [requirements]
  );

  const selectedRequirementsCount = selectedRequirements.length;

  const handleChange = (event) => {
    const { name, value } = event.target;
    setForm((prev) => ({ ...prev, [name]: value }));
  };

  const toggleRequirement = (key) => {
    setRequirements((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  const handleFileChange = (event) => {
    const files = Array.from(event.target.files || []);
    if (!files.length) return;
    setMediaFiles((prev) => [...prev, ...files]);
  };

  const removeFile = (indexToRemove) => {
    setMediaFiles((prev) => prev.filter((_, index) => index !== indexToRemove));
  };

  const startRecording = async (type) => {
    try {
      const constraints =
        type === 'audio'
          ? { audio: true }
          : { video: { facingMode: 'environment' }, audio: true };
      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      const recorder = new MediaRecorder(stream);
      const chunks = [];

      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) chunks.push(event.data);
      };

      recorder.onstop = () => {
        const mimeType = type === 'audio' ? 'audio/webm' : 'video/webm';
        const blob = new Blob(chunks, { type: mimeType });
        const file = new File([blob], `${type}-recording-${Date.now()}.webm`, {
          type: mimeType,
        });
        setMediaFiles((prev) => [...prev, file]);
        stream.getTracks().forEach((track) => track.stop());
      };

      recorder.start();
      setMediaRecorder(recorder);
      setRecording(true);
    } catch (err) {
      window.alert('Could not access microphone/camera. Please check permissions.');
    }
  };

  const stopRecording = () => {
    if (!mediaRecorder) return;
    mediaRecorder.stop();
    setRecording(false);
    setMediaRecorder(null);
  };

  const openCamera = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment' },
        audio: false,
      });
      setCameraStream(stream);
      setShowCamera(true);
      setTimeout(() => {
        if (videoPreviewRef.current) {
          videoPreviewRef.current.srcObject = stream;
        }
      }, 50);
    } catch (err) {
      window.alert('Could not access camera. Please check permissions.');
    }
  };

  const closeCamera = () => {
    if (cameraStream) {
      cameraStream.getTracks().forEach((track) => track.stop());
    }
    setCameraStream(null);
    setShowCamera(false);
  };

  const capturePhoto = () => {
    if (!videoPreviewRef.current) return;
    const video = videoPreviewRef.current;
    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const context = canvas.getContext('2d');
    if (!context) return;
    context.drawImage(video, 0, 0, canvas.width, canvas.height);

    canvas.toBlob(
      (blob) => {
        if (!blob) return;
        const file = new File([blob], `live-photo-${Date.now()}.jpg`, {
          type: 'image/jpeg',
        });
        setMediaFiles((prev) => [...prev, file]);
      },
      'image/jpeg',
      0.92
    );

    closeCamera();
  };

  const canProceed = () => {
    if (step === 1) {
      return (
        form.title.trim() &&
        form.category &&
        form.description.trim() &&
        form.location_city.trim()
      );
    }
    return true;
  };

  const nextStep = () => {
    if (step < 4 && canProceed()) {
      setStep((prev) => prev + 1);
    }
  };

  const prevStep = () => {
    if (step > 1) {
      setStep((prev) => prev - 1);
    }
  };

  const getBudgetDisplay = () => {
    if (form.budget_type === 'fixed') return `$${Number(form.budget_fixed).toLocaleString()} fixed`;
    if (form.budget_type === 'hourly') return `$${Number(form.budget_hourly).toLocaleString()}/hr`;
    return 'Open to bids';
  };

  const handleSaveDraft = () => {
    window.alert('Draft save UI placeholder — wire this to your draft endpoint later.');
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    setError('');
    setLoading(true);

    try {
      const payload = new FormData();
      payload.append('title', form.title);
      payload.append('description', form.description);
      payload.append('category', form.category);
      payload.append('job_type', form.job_type);
      payload.append('location_city', form.location_city);
      payload.append('location_state', form.location_state);
      payload.append('priority', form.priority);
      payload.append('site_access', form.site_access);
      payload.append('budget_type', form.budget_type);
      payload.append('urgency', form.urgency);

      if (form.budget_type === 'fixed') {
        payload.append('budget_min', String(form.budget_fixed));
        payload.append('budget_max', String(form.budget_fixed));
      } else if (form.budget_type === 'hourly') {
        payload.append('budget_min', String(form.budget_hourly));
        payload.append('budget_max', String(form.budget_hourly));
      } else {
        payload.append('budget_min', '0');
        payload.append('budget_max', '0');
      }

      const reqList = Object.entries(requirements)
        .filter(([, value]) => value)
        .map(([key]) => key);

      payload.append('requirements', JSON.stringify(reqList));

      if (requirements.skillLevel) payload.append('skill_level', skillLevelValue);
      if (requirements.crewSize) payload.append('crew_size', String(crewSizeValue));

      mediaFiles.forEach((file) => payload.append('media', file));

      const result = await createJob(payload);
      const jobId = result?.job?.id || result?.id;
      if (jobId) {
        navigate(`/jobs/${jobId}`);
        return;
      }
      navigate('/jobs');
    } catch (err) {
      setError(err?.response?.data?.error || 'Failed to create job');
    } finally {
      setLoading(false);
    }
  };

  const renderStepIndicator = () => (
    <div className="pj-steps" aria-label="Progress steps">
      {STEPS.map((stepItem, index) => (
        <React.Fragment key={stepItem.id}>
          <button
            type="button"
            className={`pj-step-dot ${step === stepItem.id ? 'active' : ''} ${step > stepItem.id ? 'done' : ''}`}
            onClick={() => {
              if (stepItem.id < step || canProceed()) setStep(stepItem.id);
            }}
          >
            <span className="pj-step-num">{stepItem.id}</span>
            <span className="pj-step-copy">
              <span className="pj-step-icon" aria-hidden="true">{stepItem.icon}</span>
              <span className="pj-step-label">{stepItem.label}</span>
            </span>
          </button>
          {index < STEPS.length - 1 && <div className={`pj-step-line ${step > stepItem.id ? 'done' : ''}`} />}
        </React.Fragment>
      ))}
    </div>
  );

  const renderStep1 = () => (
    <section className="pj-card">
      <div className="pj-card-head">
        <p className="pj-card-kicker">{STEPS[0].icon} Step 1 of 4</p>
        <h2 className="pj-card-title">Job Details</h2>
        <p className="pj-card-desc">Give helpers a clear picture of what needs to be done and what success looks like.</p>
      </div>

      <div className="pj-field">
        <label htmlFor="title">Job Title <span className="req">*</span></label>
        <input
          id="title"
          name="title"
          value={form.title}
          onChange={handleChange}
          placeholder="e.g. Replace damaged drywall and repaint one bedroom wall"
          maxLength={80}
          required
        />
        <span className="pj-charcount">{form.title.length}/80</span>
      </div>

      <div className="pj-field">
        <label htmlFor="category">Category <span className="req">*</span></label>
        <select id="category" name="category" value={form.category} onChange={handleChange} required>
          <option value="">Select a category...</option>
          {CATEGORIES.map((category) => (
            <option key={category} value={category}>{category}</option>
          ))}
        </select>
      </div>

      <div className="pj-field">
        <label htmlFor="description">
          Describe the Work <span className="req">*</span>
          <span className="pj-label-hint">Be specific about the issue, scope, and desired outcome.</span>
        </label>
        <textarea
          id="description"
          name="description"
          value={form.description}
          onChange={handleChange}
          rows={6}
          maxLength={1000}
          placeholder="Explain the problem, materials involved, access details, measurements, and what finished work should look like."
          required
        />
        <span className="pj-charcount">{form.description.length}/1000</span>
      </div>

      <div className="pj-grid-two">
        <div className="pj-field">
          <label htmlFor="location_city">City <span className="req">*</span></label>
          <input id="location_city" name="location_city" value={form.location_city} onChange={handleChange} placeholder="Springfield" required />
        </div>

        <div className="pj-field">
          <label htmlFor="site_access">Site Access</label>
          <select id="site_access" name="site_access" value={form.site_access} onChange={handleChange}>
            {SITE_ACCESS_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>{option.label}</option>
            ))}
          </select>
        </div>
      </div>
    </section>
  );

  const renderStep2 = () => (
    <section className="pj-card">
      <div className="pj-card-head">
        <p className="pj-card-kicker">{STEPS[1].icon} Step 2 of 4</p>
        <h2 className="pj-card-title">Requirements</h2>
        <p className="pj-card-desc">Set the standard for who can bid so you get better-fit helpers from the start.</p>
      </div>

      <div className="pj-info-banner">
        <strong>License and insurance:</strong> when submitted, those can be verified. Skill, tools, crew size, and screening preferences are helper-confirmed before bidding.
      </div>

      <div className="pj-req-grid">
        {REQUIREMENT_CARDS.map((card) => (
          <button
            type="button"
            key={card.key}
            className={`pj-req-card ${requirements[card.key] ? 'selected' : ''}`}
            onClick={() => toggleRequirement(card.key)}
          >
            <div className="pj-req-card-top">
              <span className="pj-req-icon" aria-hidden="true">{card.icon}</span>
              <span className="pj-req-title">{card.title}</span>
              <span className={`pj-req-check ${requirements[card.key] ? 'on' : ''}`}>{requirements[card.key] ? '✓' : ''}</span>
            </div>
            <span className="pj-req-desc">{card.desc}</span>
          </button>
        ))}
      </div>

      {requirements.skillLevel && (
        <div className="pj-sub-option">
          <label>Minimum Skill Level</label>
          <div className="pj-pill-group">
            {SKILL_LEVELS.map((level) => (
              <button key={level} type="button" className={`pj-pill ${skillLevelValue === level ? 'active' : ''}`} onClick={() => setSkillLevelValue(level)}>
                {level.charAt(0).toUpperCase() + level.slice(1)}
              </button>
            ))}
          </div>
        </div>
      )}

      {requirements.crewSize && (
        <div className="pj-sub-option">
          <label>Minimum Crew Size</label>
          <div className="pj-pill-group">
            {CREW_SIZES.map((size) => (
              <button key={size} type="button" className={`pj-pill ${crewSizeValue === size ? 'active' : ''}`} onClick={() => setCrewSizeValue(size)}>
                {size} {size === 1 ? 'person' : 'people'}
              </button>
            ))}
          </div>
        </div>
      )}
    </section>
  );

  const renderStep3 = () => (
    <section className="pj-card">
      <div className="pj-card-head">
        <p className="pj-card-kicker">{STEPS[2].icon} Step 3 of 4</p>
        <h2 className="pj-card-title">Budget & Timeline</h2>
        <p className="pj-card-desc">Signal the price structure and urgency so the right helpers respond faster.</p>
      </div>

      <div className="pj-field">
        <label>Pricing Style</label>
        <div className="pj-pill-group pj-budget-tabs">
          {BUDGET_TYPES.map((budgetType) => (
            <button
              type="button"
              key={budgetType.value}
              className={`pj-pill ${form.budget_type === budgetType.value ? 'active' : ''}`}
              onClick={() => setForm((prev) => ({ ...prev, budget_type: budgetType.value }))}
            >
              {budgetType.label}
            </button>
          ))}
        </div>
      </div>

      {form.budget_type === 'fixed' && (
        <div className="pj-field pj-slider-field">
          <label htmlFor="budget_fixed">Fixed Budget</label>
          <div className="pj-budget-display">${Number(form.budget_fixed).toLocaleString()}</div>
          <input id="budget_fixed" className="pj-range" type="range" min="100" max="10000" step="50" value={form.budget_fixed} onChange={(event) => setForm((prev) => ({ ...prev, budget_fixed: Number(event.target.value) }))} />
          <div className="pj-range-labels"><span>$100</span><span>$10,000</span></div>
        </div>
      )}

      {form.budget_type === 'hourly' && (
        <div className="pj-field pj-slider-field">
          <label htmlFor="budget_hourly">Hourly Rate</label>
          <div className="pj-budget-display">${Number(form.budget_hourly)}/hr</div>
          <input id="budget_hourly" className="pj-range" type="range" min="15" max="200" step="5" value={form.budget_hourly} onChange={(event) => setForm((prev) => ({ ...prev, budget_hourly: Number(event.target.value) }))} />
          <div className="pj-range-labels"><span>$15/hr</span><span>$200/hr</span></div>
        </div>
      )}

      {form.budget_type === 'open' && <div className="pj-info-banner pj-open-bids-note">Helpers can send their own price proposals. You can compare bids, counter, or accept.</div>}

      <div className="pj-field">
        <label>Urgency</label>
        <div className="pj-pill-group">
          {URGENCY_OPTIONS.map((option) => (
            <button type="button" key={option.value} className={`pj-pill ${form.urgency === option.value ? 'active' : ''}`} onClick={() => setForm((prev) => ({ ...prev, urgency: option.value }))}>
              {option.label}
            </button>
          ))}
        </div>
      </div>

      <div className="pj-field">
        <label htmlFor="job_type">Job Type</label>
        <select id="job_type" name="job_type" value={form.job_type} onChange={handleChange}>
          <option value="one_time">One-Time</option>
          <option value="recurring">Recurring</option>
          <option value="crew">Crew Job</option>
        </select>
      </div>
    </section>
  );

  const renderMediaSection = () => (
    <div className="pj-media-wrap">
      <div className="pj-field">
        <label>Add Photos, Video, or Audio <span className="pj-optional">(optional)</span></label>

        <div className="pj-media-tabs">
          <button type="button" onClick={() => setMediaType('photo')} className={`media-tab-btn ${mediaType === 'photo' ? 'active' : ''}`}>📷 Photos</button>
          <button type="button" onClick={() => setMediaType('video')} className={`media-tab-btn ${mediaType === 'video' ? 'active' : ''}`}>🎥 Video</button>
          <button type="button" onClick={() => setMediaType('audio')} className={`media-tab-btn ${mediaType === 'audio' ? 'active' : ''}`}>🎙️ Audio</button>
        </div>

        {mediaType === 'photo' && (
          <div className="pj-media-panel">
            <label className="media-upload-area">
              <span className="upload-icon">📷</span>
              <span>Click to upload photos from your device</span>
              <input type="file" accept="image/*" multiple onChange={handleFileChange} />
            </label>

            {!showCamera ? (
              <button type="button" className="btn-live-photo" onClick={openCamera}>📸 Take a Live Photo</button>
            ) : (
              <div className="camera-preview-container">
                <video ref={videoPreviewRef} autoPlay playsInline muted />
                <div className="camera-actions">
                  <button type="button" className="camera-capture-btn" onClick={capturePhoto}>Capture</button>
                  <button type="button" className="camera-close-btn" onClick={closeCamera}>Cancel</button>
                </div>
              </div>
            )}
          </div>
        )}

        {mediaType === 'video' && (
          <div className="pj-media-panel">
            <label className="media-upload-area">
              <span className="upload-icon">🎥</span>
              <span>Upload a video file</span>
              <input type="file" accept="video/*" onChange={handleFileChange} />
            </label>
            <div className="or-divider">or</div>
            {!recording ? (
              <button type="button" className="btn-record-video" onClick={() => startRecording('video')}>🔴 Record Video</button>
            ) : (
              <button type="button" className="btn-record-video recording" onClick={stopRecording}>⏹ Stop Recording</button>
            )}
          </div>
        )}

        {mediaType === 'audio' && (
          <div className="pj-media-panel">
            {!recording ? (
              <button type="button" className="btn-record-audio" onClick={() => startRecording('audio')}>🎙️ Start Audio Recording</button>
            ) : (
              <button type="button" className="btn-record-audio recording" onClick={stopRecording}>⏹ Stop Recording</button>
            )}
            <p className="audio-hint">A short voice note can help helpers understand the problem quickly.</p>
          </div>
        )}

        {mediaFiles.length > 0 && (
          <div className="attached-files">
            <p className="attached-files-title">Attached ({mediaFiles.length})</p>
            <div className="attached-files-grid">
              {mediaFiles.map((file, index) => (
                <span key={`${file.name}-${index}`} className="attached-file-chip">
                  <span>{file.type.startsWith('image') ? '📷' : file.type.startsWith('video') ? '🎥' : '🎙️'}</span>
                  <span className="attached-file-name">{file.name}</span>
                  <button type="button" onClick={() => removeFile(index)}>×</button>
                </span>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );

  const renderStep4 = () => (
    <section className="pj-card">
      <div className="pj-card-head">
        <p className="pj-card-kicker">{STEPS[3].icon} Step 4 of 4</p>
        <h2 className="pj-card-title">Review & Post</h2>
        <p className="pj-card-desc">Review the key details, keep the media area from the old flow, and post when ready.</p>
      </div>

      <div className="pj-review-section">
        <div className="pj-review-row"><span className="pj-review-label">Title</span><span>{form.title || '—'}</span></div>
        <div className="pj-review-row"><span className="pj-review-label">Category</span><span>{form.category || '—'}</span></div>
        <div className="pj-review-row"><span className="pj-review-label">Location</span><span>{form.location_city ? `${form.location_city}, ${form.location_state}` : '—'}</span></div>
        <div className="pj-review-row"><span className="pj-review-label">Budget</span><span>{getBudgetDisplay()}</span></div>
        <div className="pj-review-row"><span className="pj-review-label">Urgency</span><span>{form.urgency.replace('_', ' ')}</span></div>
        <div className="pj-review-row"><span className="pj-review-label">Job Type</span><span>{form.job_type === 'one_time' ? 'One-Time' : form.job_type === 'recurring' ? 'Recurring' : 'Crew Job'}</span></div>
        <div className="pj-review-row"><span className="pj-review-label">Requirements</span><span>{selectedRequirementsCount ? selectedRequirements.join(', ') : 'None selected'}</span></div>
      </div>

      <div className="pj-review-desc-box">
        <strong>Description</strong>
        <p>{form.description || '—'}</p>
      </div>

      {renderMediaSection()}
    </section>
  );

  const renderSidebar = () => (
    <aside className="pj-sidebar">
      <div className="pj-sidebar-inner">
        <div className="pj-sidebar-header">
          <div>
            <p className="pj-sidebar-kicker">Live Preview</p>
            <h3>Job Summary</h3>
          </div>
          <span className="pj-badge-draft">Draft</span>
        </div>

        <div className="pj-sidebar-row"><span className="pj-sidebar-label">Title</span><span className="pj-sidebar-val">{form.title || <em>Not set yet</em>}</span></div>
        <div className="pj-sidebar-row"><span className="pj-sidebar-label">Category</span><span className="pj-sidebar-val">{form.category || <em>Not selected</em>}</span></div>
        <div className="pj-sidebar-row"><span className="pj-sidebar-label">Location</span><span className="pj-sidebar-val">{form.location_city ? `${form.location_city}, ${form.location_state}` : <em>Not set</em>}</span></div>
        <div className="pj-sidebar-row"><span className="pj-sidebar-label">Budget</span><span className="pj-sidebar-val pj-sidebar-budget">{getBudgetDisplay()}</span></div>
        <div className="pj-sidebar-row">
          <span className="pj-sidebar-label">Requirements</span>
          <span className="pj-sidebar-tags">
            {selectedRequirementsCount ? selectedRequirements.map((item) => <span key={item} className="pj-sidebar-tag">{item}</span>) : <span className="pj-sidebar-tag muted">None selected</span>}
          </span>
        </div>

        <div className="pj-sidebar-divider" />

        <p className="pj-sidebar-note">Helpers must match <strong>{selectedRequirementsCount}</strong> requirement{selectedRequirementsCount === 1 ? '' : 's'} before bidding.</p>

        <button type="submit" form="post-job-form" className="pj-btn-post" disabled={loading || step < 4}>{loading ? 'Posting...' : 'Post Job'}</button>
        <button type="button" className="pj-btn-draft" onClick={handleSaveDraft}>Save as Draft</button>
      </div>
    </aside>
  );

  return (
    <div className="post-job-page-wrapper">
      <Navbar />

      <main className="pj-page-shell">
        <div className="pj-breadcrumb">
          <Link to="/">Home</Link>
          <span>›</span>
          <Link to="/jobs">Jobs</Link>
          <span>›</span>
          <span>Post a Job</span>
        </div>

        <div className="pj-page-header">
          <div>
            <p className="pj-eyebrow">Client-side job intake</p>
            <h1 className="pj-page-title">Post a Job</h1>
            <p className="pj-page-subtitle">Create a cleaner, more premium intake flow with clear steps, stronger requirement controls, and a live summary on the right.</p>
          </div>
        </div>

        {renderStepIndicator()}

        {error && <div className="pj-error">{error}</div>}

        <div className="pj-layout">
          <form id="post-job-form" className="pj-main" onSubmit={handleSubmit}>
            {step === 1 && renderStep1()}
            {step === 2 && renderStep2()}
            {step === 3 && renderStep3()}
            {step === 4 && renderStep4()}

            <div className="pj-nav-buttons">
              {step > 1 ? <button type="button" className="pj-btn-back" onClick={prevStep}>← Back</button> : <span />}
              {step < 4 && <button type="button" className="pj-btn-next" onClick={nextStep} disabled={!canProceed()}>Continue →</button>}
            </div>
          </form>

          {renderSidebar()}
        </div>
      </main>

      <Footer />
    </div>
  );
}
