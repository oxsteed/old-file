import React, { useState, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import useJobs from '../hooks/useJobs';
import Navbar from '../components/Navbar';
import Footer from '../components/Footer';
import '../styles/PostJobPage.css';

const categories = ['Handyman', 'Plumbing', 'Electrical', 'Cleaning', 'Moving', 'Painting', 'Landscaping', 'Assembly', 'Car Help', 'Roadside Assistance', 'Delivery', 'Errands', 'Other'];
const priorities = ['normal', 'high', 'urgent'];

export default function PostJobPage() {
  const navigate = useNavigate();
  const { createJob } = useJobs();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [mediaFiles, setMediaFiles] = useState([]);
  const [mediaType, setMediaType] = useState('photo');
  const [recording, setRecording] = useState(false);
  const [mediaRecorder, setMediaRecorder] = useState(null);
  const [showCamera, setShowCamera] = useState(false);
  const [cameraStream, setCameraStream] = useState(null);
  const videoPreviewRef = useRef(null);
  const [form, setForm] = useState({
    title: '',
    description: '',
    category: '',
    job_type: 'one_time',
    budget_min: '',
    budget_max: '',
    location_city: '',
    location_state: 'OH',
    priority: 'normal',
  });

  const handleChange = (e) => {
    const { name, value } = e.target;
    setForm(prev => ({ ...prev, [name]: value }));
  };

  const handleFileChange = (e) => {
    const files = Array.from(e.target.files);
    setMediaFiles(prev => [...prev, ...files]);
  };

  const removeFile = (index) => {
    setMediaFiles(prev => prev.filter((_, i) => i !== index));
  };

  const startRecording = async (type) => {
    try {
      const constraints = type === 'audio' ? { audio: true } : { audio: true, video: true };
      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      const recorder = new MediaRecorder(stream);
      const chunks = [];
      recorder.ondataavailable = (e) => chunks.push(e.data);
      recorder.onstop = () => {
        const mimeType = type === 'audio' ? 'audio/webm' : 'video/webm';
        const blob = new Blob(chunks, { type: mimeType });
        const ext = 'webm';
        const file = new File([blob], 'recording_' + Date.now() + '.' + ext, { type: mimeType });
        setMediaFiles(prev => [...prev, file]);
        stream.getTracks().forEach(t => t.stop());
      };
      recorder.start();
      setMediaRecorder(recorder);
      setRecording(true);
    } catch (err) {
      alert('Could not access microphone/camera. Please check permissions.');
    }
  };

  const stopRecording = () => {
    if (mediaRecorder) {
      mediaRecorder.stop();
      setRecording(false);
      setMediaRecorder(null);
    }
  };

  const openCamera = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' }, audio: false });
      setCameraStream(stream);
      setShowCamera(true);
      setTimeout(() => {
        if (videoPreviewRef.current) {
          videoPreviewRef.current.srcObject = stream;
        }
      }, 100);
    } catch (err) {
      alert('Could not access camera. Please check permissions.');
    }
  };

  const closeCamera = () => {
    if (cameraStream) {
      cameraStream.getTracks().forEach(t => t.stop());
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
    const ctx = canvas.getContext('2d');
    ctx.drawImage(video, 0, 0);
    canvas.toBlob((blob) => {
      const file = new File([blob], 'live_photo_' + Date.now() + '.jpg', { type: 'image/jpeg' });
      setMediaFiles(prev => [...prev, file]);
    }, 'image/jpeg', 0.92);
    closeCamera();
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const formData = new FormData();
      Object.entries(form).forEach(([key, val]) => formData.append(key, val));
      formData.set('budget_min', parseFloat(form.budget_min));
      formData.set('budget_max', parseFloat(form.budget_max));
      mediaFiles.forEach(file => formData.append('media', file));
      const result = await createJob(formData);
      navigate('/jobs/' + (result.job?.id || result.id));
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to create job');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="post-job-page-wrapper">
      <Navbar />
      <main>
        <div className="post-job-container">
          <h1>Post a Job</h1>
          <p className="subtitle">Describe what you need done and let helpers bid on your project.</p>
          {error && <div style={{background:'#fef2f2',color:'#b91c1c',padding:'0.75rem 1rem',borderRadius:'8px',marginBottom:'1rem',fontSize:'0.9rem'}}>{error}</div>}
          <form onSubmit={handleSubmit}>
            <div className="form-group">
              <label>Job Title *</label>
              <input name="title" value={form.title} onChange={handleChange} placeholder="e.g. Need help moving furniture" required />
            </div>
            <div className="form-group">
              <label>Description *</label>
              <textarea name="description" value={form.description} onChange={handleChange} rows="5" placeholder="Describe the job in detail: what needs to be done, tools needed, estimated time..." required />
            </div>
            <div className="form-row">
              <div className="form-group">
                <label>Category *</label>
                <select name="category" value={form.category} onChange={handleChange} required>
                  <option value="">Select category</option>
                  {categories.map(c => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>
              <div className="form-group">
                <label>Priority</label>
                <select name="priority" value={form.priority} onChange={handleChange}>
                  {priorities.map(p => <option key={p} value={p}>{p.charAt(0).toUpperCase() + p.slice(1)}</option>)}
                </select>
              </div>
            </div>
            <div className="form-row">
              <div className="form-group">
                <label>Budget Min ($) *</label>
                <input name="budget_min" type="number" step="0.01" min="5" value={form.budget_min} onChange={handleChange} placeholder="25" required />
              </div>
              <div className="form-group">
                <label>Budget Max ($) *</label>
                <input name="budget_max" type="number" step="0.01" min="5" value={form.budget_max} onChange={handleChange} placeholder="100" required />
              </div>
            </div>
            <div className="form-row">
              <div className="form-group">
                <label>City *</label>
                <input name="location_city" value={form.location_city} onChange={handleChange} placeholder="Springfield" required />
              </div>
              <div className="form-group">
                <label>State</label>
                <input name="location_state" value={form.location_state} onChange={handleChange} placeholder="OH" />
              </div>
            </div>
            <div className="form-group">
              <label>Job Type</label>
              <select name="job_type" value={form.job_type} onChange={handleChange}>
                <option value="one_time">One-Time</option>
                <option value="recurring">Recurring</option>
                <option value="crew">Crew Job (Multiple Helpers)</option>
              </select>
            </div>

            {/* Media Upload Section */}
            <div className="form-group">
              <label>Add Photos, Video, or Audio <span style={{color:'#9ca3af',fontWeight:'400'}}>(optional)</span></label>
              <div style={{display:'flex',gap:'0.5rem',marginBottom:'0.75rem',flexWrap:'wrap'}}>
                <button type="button" onClick={() => setMediaType('photo')} className={'media-tab-btn' + (mediaType === 'photo' ? ' active' : '')}>📷 Photos</button>
                <button type="button" onClick={() => setMediaType('video')} className={'media-tab-btn' + (mediaType === 'video' ? ' active' : '')}>🎥 Video</button>
                <button type="button" onClick={() => setMediaType('audio')} className={'media-tab-btn' + (mediaType === 'audio' ? ' active' : '')}>🎙️ Audio</button>
              </div>

              {mediaType === 'photo' && (
                <div>
                  <label className="media-upload-area">
                    <span className="upload-icon">📷</span>
                    <span style={{fontSize:'0.9rem'}}>Click to upload photos from your device</span>
                    <input type="file" accept="image/*" multiple onChange={handleFileChange} />
                  </label>
                  {!showCamera ? (
                    <button type="button" className="btn-live-photo" onClick={openCamera}>
                      📸 Take a Live Photo
                    </button>
                  ) : (
                    <div className="camera-preview-container">
                      <video ref={videoPreviewRef} autoPlay playsInline muted />
                      <button type="button" className="camera-capture-btn" onClick={capturePhoto}>📸 Capture</button>
                      <button type="button" className="camera-close-btn" onClick={closeCamera}>✕</button>
                    </div>
                  )}
                </div>
              )}

              {mediaType === 'video' && (
                <div style={{display:'flex',flexDirection:'column',gap:'0.5rem'}}>
                  <label className="media-upload-area">
                    <span className="upload-icon">🎥</span>
                    <span style={{fontSize:'0.9rem'}}>Click to upload a video file</span>
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
                <div style={{display:'flex',flexDirection:'column',gap:'0.5rem'}}>
                  {!recording ? (
                    <button type="button" className="btn-record-audio" onClick={() => startRecording('audio')}>🎙️ Start Audio Recording</button>
                  ) : (
                    <button type="button" className="btn-record-audio recording" onClick={stopRecording}>⏹ Stop Recording</button>
                  )}
                  <p className="audio-hint">Describe your job verbally — helpers will listen to understand what you need.</p>
                </div>
              )}

              {mediaFiles.length > 0 && (
                <div className="attached-files">
                  <p className="attached-files-title">Attached ({mediaFiles.length}):</p>
                  <div>
                    {mediaFiles.map((file, i) => (
                      <span key={i} className="attached-file-chip">
                        <span>{file.type.startsWith('image') ? '📷' : file.type.startsWith('video') ? '🎥' : '🎙️'}</span>
                        <span style={{maxWidth:'120px',overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{file.name}</span>
                        <button type="button" onClick={() => removeFile(i)}>×</button>
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </div>

            <div className="form-actions">
              <button type="button" className="btn-secondary" onClick={() => navigate('/jobs')}>Cancel</button>
              <button type="submit" className="btn-primary" disabled={loading}>
                {loading ? 'Posting...' : 'Post Job'}
              </button>
            </div>
          </form>
        </div>
      </main>
      <Footer />
    </div>
  );
}
