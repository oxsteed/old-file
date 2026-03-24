import React, { useState } from 'react';
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
  const [recordedChunks, setRecordedChunks] = useState([]);
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
        const ext = type === 'audio' ? 'webm' : 'webm';
        const file = new File([blob], `recording_${Date.now()}.${ext}`, { type: mimeType });
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
      navigate(`/jobs/${result.job?.id || result.id}`);
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to create job');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex flex-col bg-gray-50">
      <Navbar />
      <main className="flex-1 py-10">
        <div className="post-job-container">
          <h1 className="text-2xl font-bold text-gray-900 mb-2">Post a Job</h1>
          <p className="text-gray-500 mb-6">Describe what you need done and let helpers bid on your project.</p>

          {error && <div className="bg-red-50 text-red-700 p-3 rounded mb-4">{error}</div>}

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
              <label>Add Photos, Video, or Audio <span className="text-gray-400 font-normal">(optional)</span></label>
              <div className="flex gap-2 mb-3">
                <button type="button" onClick={() => setMediaType('photo')} className={`px-3 py-1 rounded-full text-sm border ${mediaType === 'photo' ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-gray-600 border-gray-300'}`}>📷 Photos</button>
                <button type="button" onClick={() => setMediaType('video')} className={`px-3 py-1 rounded-full text-sm border ${mediaType === 'video' ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-gray-600 border-gray-300'}`}>🎥 Video</button>
                <button type="button" onClick={() => setMediaType('audio')} className={`px-3 py-1 rounded-full text-sm border ${mediaType === 'audio' ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-gray-600 border-gray-300'}`}>🎙️ Audio</button>
              </div>

              {mediaType === 'photo' && (
                <div>
                  <label className="cursor-pointer inline-block bg-white border-2 border-dashed border-gray-300 rounded-lg px-6 py-4 text-center text-gray-500 hover:border-blue-400 hover:text-blue-500 transition w-full">
                    <span className="block text-2xl mb-1">📷</span>
                    <span className="text-sm">Click to upload photos</span>
                    <input type="file" accept="image/*" multiple onChange={handleFileChange} className="hidden" />
                  </label>
                </div>
              )}

              {mediaType === 'video' && (
                <div className="flex flex-col gap-2">
                  <label className="cursor-pointer inline-block bg-white border-2 border-dashed border-gray-300 rounded-lg px-6 py-4 text-center text-gray-500 hover:border-blue-400 hover:text-blue-500 transition w-full">
                    <span className="block text-2xl mb-1">🎥</span>
                    <span className="text-sm">Click to upload a video file</span>
                    <input type="file" accept="video/*" onChange={handleFileChange} className="hidden" />
                  </label>
                  <div className="text-center text-gray-400 text-sm">or</div>
                  {!recording ? (
                    <button type="button" onClick={() => startRecording('video')} className="w-full py-3 bg-red-50 border border-red-300 text-red-600 rounded-lg hover:bg-red-100 transition text-sm font-medium">🔴 Record Video</button>
                  ) : (
                    <button type="button" onClick={stopRecording} className="w-full py-3 bg-red-600 text-white rounded-lg hover:bg-red-700 transition text-sm font-medium animate-pulse">⏹ Stop Recording</button>
                  )}
                </div>
              )}

              {mediaType === 'audio' && (
                <div className="flex flex-col gap-2">
                  {!recording ? (
                    <button type="button" onClick={() => startRecording('audio')} className="w-full py-4 bg-blue-50 border border-blue-300 text-blue-600 rounded-lg hover:bg-blue-100 transition text-sm font-medium">🎙️ Start Audio Recording</button>
                  ) : (
                    <button type="button" onClick={stopRecording} className="w-full py-4 bg-red-600 text-white rounded-lg hover:bg-red-700 transition text-sm font-medium animate-pulse">⏹ Stop Recording</button>
                  )}
                  <p className="text-xs text-gray-400 text-center">Describe your job verbally — helpers will listen to understand what you need.</p>
                </div>
              )}

              {mediaFiles.length > 0 && (
                <div className="mt-3">
                  <p className="text-sm font-medium text-gray-700 mb-2">Attached ({mediaFiles.length}):</p>
                  <div className="flex flex-wrap gap-2">
                    {mediaFiles.map((file, i) => (
                      <div key={i} className="flex items-center gap-1 bg-gray-100 rounded-full px-3 py-1 text-sm text-gray-700">
                        <span>{file.type.startsWith('image') ? '📷' : file.type.startsWith('video') ? '🎥' : '🎙️'}</span>
                        <span className="max-w-[120px] truncate">{file.name}</span>
                        <button type="button" onClick={() => removeFile(i)} className="text-gray-400 hover:text-red-500 ml-1 font-bold">&times;</button>
                      </div>
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
